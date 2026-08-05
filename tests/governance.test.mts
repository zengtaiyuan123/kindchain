import assert from "node:assert/strict";
import test from "node:test";
import Database from "better-sqlite3";
import {
  authorTagOf,
  createReport,
  decideModeration,
  ensureGovernanceSchema,
  GovernanceError,
  listModeration,
  moderatePublicBody,
  resetGovernanceSchemaCache,
  retractContent,
  setAuthorStatus,
  setBlock,
  touchAuthor,
  viewerFilters,
  type SqlDatabase,
  type SqlStatement,
} from "../lib/governance";
import { classifyContent } from "../lib/moderation";
import { fallbackPlace } from "../lib/place-fallback";

/** Minimal D1 shim over better-sqlite3 so the production SQL runs verbatim. */
function makeDb(): SqlDatabase {
  const sqlite = new Database(":memory:");
  const statement = (query: string, bound: unknown[] = []): SqlStatement => ({
    bind: (...values: unknown[]) => statement(query, values),
    first: async <T>() => (sqlite.prepare(query).get(...(bound as never[])) as T | undefined) ?? null,
    all: async <T>() => ({ results: sqlite.prepare(query).all(...(bound as never[])) as T[] }),
    run: async () => sqlite.prepare(query).run(...(bound as never[])),
  });
  return {
    prepare: (query: string) => statement(query),
    batch: async (statements: SqlStatement[]) => {
      for (const entry of statements) await entry.run();
      return [];
    },
  };
}

const CONTENT_DDL = [
  "CREATE TABLE network_signals (id TEXT PRIMARY KEY NOT NULL, chain_id TEXT NOT NULL, kind TEXT NOT NULL, lang TEXT NOT NULL DEFAULT 'auto', body TEXT NOT NULL, lat REAL NOT NULL, lon REAL NOT NULL, region TEXT NOT NULL, country TEXT NOT NULL, scene TEXT, author_key TEXT NOT NULL, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'visible')",
  "CREATE TABLE network_replies (id TEXT PRIMARY KEY NOT NULL, signal_id TEXT NOT NULL, lang TEXT NOT NULL DEFAULT 'auto', body TEXT NOT NULL, lat REAL, lon REAL, region TEXT NOT NULL, country TEXT NOT NULL, scene TEXT, author_key TEXT NOT NULL, created_at INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'visible')",
];

async function makeFullDb(): Promise<SqlDatabase> {
  resetGovernanceSchemaCache();
  const db = makeDb();
  for (const ddl of CONTENT_DDL) await db.prepare(ddl).run();
  await ensureGovernanceSchema(db);
  return db;
}

async function insertSignal(db: SqlDatabase, id: string, authorKey: string, body: string, now: number, status = "visible") {
  await db
    .prepare("INSERT INTO network_signals (id, chain_id, kind, lang, body, lat, lon, region, country, scene, author_key, created_at, expires_at, status) VALUES (?, ?, 'light', 'auto', ?, 36.6, 101.8, '青海', '中国', NULL, ?, ?, ?, ?)")
    .bind(id, `chain-${id}`, body, authorKey, now, now + 86_400_000, status)
    .run();
}

const KEY_A = "device-key-aaaa-0001";
const KEY_B = "device-key-bbbb-0002";
const T0 = 1_754_000_000_000;

// --- moderation classifier ---

test("plain kindness is allowed", () => {
  for (const body of ["You are not alone tonight.", "今晚的雨会停的，我在世界另一边陪你。"]) {
    assert.equal(classifyContent(body).outcome, "allow", body);
  }
});

test("contact info and spam are rejected", () => {
  for (const body of ["email me at someone@example.com", "call +1 (555) 123-4567 anytime", "加我微信 kind123", "兼职日结，加群了解"]) {
    assert.equal(classifyContent(body).outcome, "reject", body);
  }
});

test("hostile content is held; crisis stays visible but escalates", () => {
  assert.equal(classifyContent("你去死吧").outcome, "hold");
  const crisis = classifyContent("最近总是想死，撑不下去了");
  assert.equal(crisis.outcome, "flag");
  assert.equal(crisis.risk, "crisis");
});

test("oversized and empty bodies are rejected", () => {
  assert.equal(classifyContent("   ").outcome, "reject");
  assert.equal(classifyContent("x".repeat(601)).outcome, "reject");
  assert.equal(classifyContent("x".repeat(600)).outcome, "allow");
});

// --- author identity ---

test("touchAuthor issues a stable public tag and never exposes the key", async () => {
  const db = await makeFullDb();
  const first = await touchAuthor(db, KEY_A, T0);
  const second = await touchAuthor(db, KEY_A, T0 + 1000);
  assert.equal(first.tag, second.tag);
  assert.equal(first.tag, authorTagOf(KEY_A));
  assert.match(first.tag, /^kc-[0-9a-f]{8}$/);
  assert.equal(first.status, "active");
});

// --- moderatePublicBody ---

test("hostile body is stored as pending_review and queued", async () => {
  const db = await makeFullDb();
  const review = await moderatePublicBody(db, "signal", "sig-hostile-1", "你去死吧", T0);
  assert.equal(review.status, "pending_review");
  const queue = await listModeration(db, { status: "pending" });
  assert.equal(queue.length, 1);
  assert.equal(queue[0].risk, "high");
});

test("crisis body stays visible and lands in the escalated queue", async () => {
  const db = await makeFullDb();
  const review = await moderatePublicBody(db, "signal", "sig-crisis-1", "不想活了，撑不住了", T0);
  assert.equal(review.status, "visible");
  const escalated = await listModeration(db, { status: "escalated" });
  assert.equal(escalated.length, 1);
  assert.equal(escalated[0].risk, "crisis");
});

test("contact info throws a 422 GovernanceError", async () => {
  const db = await makeFullDb();
  await assert.rejects(
    moderatePublicBody(db, "signal", "sig-contact-1", "加我微信 abc123", T0),
    (error: GovernanceError) => error.status === 422 && error.code === "private_contact_blocked",
  );
});

// --- retraction ---

test("author can retract; strangers cannot", async () => {
  const db = await makeFullDb();
  await insertSignal(db, "sig-own-1", KEY_A, "to be withdrawn", T0);
  await assert.rejects(
    retractContent(db, { authorKey: KEY_B, targetType: "signal", targetId: "sig-own-1" }, T0 + 1),
    (error: GovernanceError) => error.code === "not_owner",
  );
  await retractContent(db, { authorKey: KEY_A, targetType: "signal", targetId: "sig-own-1" }, T0 + 2);
  const row = await db.prepare("SELECT status FROM network_signals WHERE id = ?").bind("sig-own-1").first<{ status: string }>();
  assert.equal(row?.status, "removed_by_author");
});

// --- blocks ---

test("blocks are per-viewer and reversible", async () => {
  const db = await makeFullDb();
  await touchAuthor(db, KEY_A, T0);
  const tagA = authorTagOf(KEY_A);
  await setBlock(db, { blockerKey: KEY_B, blockedTag: tagA, blocked: true }, T0);
  const filtered = await viewerFilters(db, KEY_B);
  assert.ok(filtered.blockedTags.has(tagA));
  const other = await viewerFilters(db, "device-key-cccc-0003");
  assert.ok(!other.blockedTags.has(tagA));
  await setBlock(db, { blockerKey: KEY_B, blockedTag: tagA, blocked: false }, T0 + 1);
  const after = await viewerFilters(db, KEY_B);
  assert.ok(!after.blockedTags.has(tagA));
});

test("self-block is refused", async () => {
  const db = await makeFullDb();
  await assert.rejects(
    setBlock(db, { blockerKey: KEY_A, blockedTag: authorTagOf(KEY_A), blocked: true }, T0),
    (error: GovernanceError) => error.code === "self_block",
  );
});

// --- reports ---

test("report queues review, self-harm escalates, duplicates fold", async () => {
  const db = await makeFullDb();
  await insertSignal(db, "sig-rep-1", KEY_A, "ordinary text", T0);
  const first = await createReport(db, { reporterKey: KEY_B, targetType: "signal", targetId: "sig-rep-1", reason: "self_harm_risk", detail: "worried" }, T0 + 1);
  assert.equal(first.duplicate, false);
  const second = await createReport(db, { reporterKey: KEY_B, targetType: "signal", targetId: "sig-rep-1", reason: "self_harm_risk" }, T0 + 2);
  assert.equal(second.duplicate, true);
  const escalated = await listModeration(db, { status: "escalated" });
  assert.equal(escalated.length, 1);
  assert.equal(escalated[0].risk, "crisis");
});

test("reporting missing content 404s", async () => {
  const db = await makeFullDb();
  await assert.rejects(
    createReport(db, { reporterKey: KEY_B, targetType: "signal", targetId: "sig-none", reason: "other" }, T0),
    (error: GovernanceError) => error.status === 404,
  );
});

// --- moderation decisions ---

test("moderator removal hides content and resolves reports", async () => {
  const db = await makeFullDb();
  await insertSignal(db, "sig-mod-1", KEY_A, "borderline", T0);
  await createReport(db, { reporterKey: KEY_B, targetType: "signal", targetId: "sig-mod-1", reason: "harassment" }, T0 + 1);
  const [item] = await listModeration(db, { status: "pending" });
  await decideModeration(db, { itemId: item.id, decision: "removed", moderator: "tester", note: "clear violation" }, T0 + 2);
  const row = await db.prepare("SELECT status FROM network_signals WHERE id = ?").bind("sig-mod-1").first<{ status: string }>();
  assert.equal(row?.status, "removed_by_moderator");
  const report = await db.prepare("SELECT status FROM network_reports WHERE target_id = ?").bind("sig-mod-1").first<{ status: string }>();
  assert.equal(report?.status, "resolved");
});

test("moderator approval releases held content", async () => {
  const db = await makeFullDb();
  const review = await moderatePublicBody(db, "signal", "sig-hold-1", "你去死吧", T0);
  await insertSignal(db, "sig-hold-1", KEY_A, "你去死吧", T0, review.status === "pending_review" ? "pending_review" : "visible");
  const [item] = await listModeration(db, { status: "pending" });
  await decideModeration(db, { itemId: item.id, decision: "approved", moderator: "tester" }, T0 + 1);
  const row = await db.prepare("SELECT status FROM network_signals WHERE id = ?").bind("sig-hold-1").first<{ status: string }>();
  assert.equal(row?.status, "visible");
});

// --- author status ---

test("banned author tags surface in viewer filters", async () => {
  const db = await makeFullDb();
  await touchAuthor(db, KEY_A, T0);
  await setAuthorStatus(db, { authorTag: authorTagOf(KEY_A), status: "banned", moderator: "tester" }, T0 + 1);
  const banned = await touchAuthor(db, KEY_A, T0 + 2);
  assert.equal(banned.status, "banned");
  const filters = await viewerFilters(db, null);
  assert.ok(filters.bannedTags.has(authorTagOf(KEY_A)));
});

// --- audit trail ---

test("governance actions leave an audit trail", async () => {
  const db = await makeFullDb();
  await insertSignal(db, "sig-audit-1", KEY_A, "hello", T0);
  await retractContent(db, { authorKey: KEY_A, targetType: "signal", targetId: "sig-audit-1" }, T0 + 1);
  await createReport(db, { reporterKey: KEY_B, targetType: "signal", targetId: "sig-audit-1", reason: "other" }, T0 + 2);
  const rows = await db.prepare("SELECT action FROM audit_log ORDER BY created_at").all<{ action: string }>();
  assert.deepEqual(rows.results.map((row) => row.action), ["retract", "report.create"]);
});

// --- place fallback ---

test("builtin place fallback names broad regions", () => {
  assert.equal(fallbackPlace(36.6, 101.8).region, "East Asia");
  assert.ok(fallbackPlace(2, -150).region.includes("Pacific"));
  assert.equal(fallbackPlace(36.6, 101.8).source, "fallback");
});
