import { classifyContent, moderationExcerpt, type Risk } from "./moderation";

/**
 * Governance layer for the shared network (whitepaper §29 launch gates):
 * trusted anonymous identity, moderation queue, reports, blocks, author
 * retraction and an audit log.
 *
 * Written against a minimal SQL interface so the same code runs on Cloudflare
 * D1 in production and on a better-sqlite3 shim in unit tests.
 */

export interface SqlStatement {
  bind(...values: unknown[]): SqlStatement;
  first<T = unknown>(): Promise<T | null>;
  all<T = unknown>(): Promise<{ results: T[] }>;
  run(): Promise<unknown>;
}

export interface SqlDatabase {
  prepare(query: string): SqlStatement;
  batch(statements: SqlStatement[]): Promise<unknown>;
}

export class GovernanceError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

/** FNV-1a → short public tag. One-way; the bearer key itself is never exposed. */
export function authorTagOf(authorKey: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < authorKey.length; index += 1) {
    hash ^= authorKey.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return `kc-${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

const GOVERNANCE_DDL = [
  "CREATE TABLE IF NOT EXISTS network_authors (author_key TEXT PRIMARY KEY NOT NULL, author_tag TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'active', created_at INTEGER NOT NULL, last_seen_at INTEGER NOT NULL, note TEXT NOT NULL DEFAULT '')",
  "CREATE INDEX IF NOT EXISTS network_authors_tag_idx ON network_authors (author_tag)",
  "CREATE TABLE IF NOT EXISTS network_reports (id TEXT PRIMARY KEY NOT NULL, target_type TEXT NOT NULL, target_id TEXT NOT NULL, reporter_key TEXT NOT NULL, reason TEXT NOT NULL, detail TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'open', created_at INTEGER NOT NULL)",
  "CREATE INDEX IF NOT EXISTS network_reports_target_idx ON network_reports (target_type, target_id)",
  "CREATE INDEX IF NOT EXISTS network_reports_status_idx ON network_reports (status, created_at)",
  "CREATE TABLE IF NOT EXISTS network_blocks (id TEXT PRIMARY KEY NOT NULL, blocker_key TEXT NOT NULL, blocked_tag TEXT NOT NULL, created_at INTEGER NOT NULL)",
  "CREATE INDEX IF NOT EXISTS network_blocks_pair_idx ON network_blocks (blocker_key, blocked_tag)",
  "CREATE TABLE IF NOT EXISTS moderation_items (id TEXT PRIMARY KEY NOT NULL, target_type TEXT NOT NULL, target_id TEXT NOT NULL, source TEXT NOT NULL, risk TEXT NOT NULL, categories TEXT NOT NULL DEFAULT '', excerpt TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'pending', created_at INTEGER NOT NULL, decided_at INTEGER, decided_by TEXT, note TEXT NOT NULL DEFAULT '')",
  "CREATE INDEX IF NOT EXISTS moderation_items_status_idx ON moderation_items (status, risk, created_at)",
  "CREATE INDEX IF NOT EXISTS moderation_items_target_idx ON moderation_items (target_type, target_id)",
  "CREATE TABLE IF NOT EXISTS audit_log (id TEXT PRIMARY KEY NOT NULL, actor TEXT NOT NULL, action TEXT NOT NULL, target_type TEXT NOT NULL, target_id TEXT NOT NULL, detail TEXT NOT NULL DEFAULT '', created_at INTEGER NOT NULL)",
  "CREATE INDEX IF NOT EXISTS audit_log_time_idx ON audit_log (created_at)",
  "CREATE TABLE IF NOT EXISTS place_cache (cell_id TEXT PRIMARY KEY NOT NULL, payload TEXT NOT NULL, created_at INTEGER NOT NULL)",
];

let governanceReady: WeakMap<object, Promise<void>> = new WeakMap();

export function ensureGovernanceSchema(db: SqlDatabase): Promise<void> {
  const existing = governanceReady.get(db as object);
  if (existing) return existing;
  const promise = db
    .batch(GOVERNANCE_DDL.map((statement) => db.prepare(statement)))
    .then(() => undefined)
    .catch((error) => {
      governanceReady.delete(db as object);
      throw error;
    });
  governanceReady.set(db as object, promise);
  return promise;
}

/** Test hook: forget memoized schema promises (fresh in-memory databases). */
export function resetGovernanceSchemaCache(): void {
  governanceReady = new WeakMap();
}

function newId(prefix: string): string {
  return `${prefix}-${crypto.randomUUID()}`;
}

export async function writeAudit(
  db: SqlDatabase,
  actor: string,
  action: string,
  targetType: string,
  targetId: string,
  detail: string,
  now: number,
): Promise<void> {
  await db
    .prepare("INSERT INTO audit_log (id, actor, action, target_type, target_id, detail, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
    .bind(newId("audit"), actor, action, targetType, targetId, detail.slice(0, 600), now)
    .run();
}

export type AuthorRecord = { tag: string; status: "active" | "limited" | "banned" };

/** Upsert the device-bound anonymous identity and return its public face. */
export async function touchAuthor(db: SqlDatabase, authorKey: string, now: number): Promise<AuthorRecord> {
  const tag = authorTagOf(authorKey);
  const existing = await db
    .prepare("SELECT author_tag, status FROM network_authors WHERE author_key = ?")
    .bind(authorKey)
    .first<{ author_tag: string; status: string }>();
  if (!existing) {
    await db
      .prepare("INSERT OR IGNORE INTO network_authors (author_key, author_tag, status, created_at, last_seen_at) VALUES (?, ?, 'active', ?, ?)")
      .bind(authorKey, tag, now, now)
      .run();
    return { tag, status: "active" };
  }
  await db.prepare("UPDATE network_authors SET last_seen_at = ? WHERE author_key = ?").bind(now, authorKey).run();
  const status = existing.status === "limited" || existing.status === "banned" ? existing.status : "active";
  return { tag: existing.author_tag, status };
}

export type ModerationDecisionInput = {
  itemId: string;
  decision: "approved" | "removed" | "escalated";
  moderator: string;
  note?: string;
};

export type PublicModeration = {
  /** Row status to store: visible now, or held until a human approves. */
  status: "visible" | "pending_review";
  risk: Risk;
  categories: string[];
};

/**
 * Classify a public body and queue it for review when needed.
 * Throws GovernanceError(422) for content that must not be stored at all.
 * Crisis-adjacent text stays visible and is escalated — a person reaching out
 * must never be silently muted.
 */
export async function moderatePublicBody(
  db: SqlDatabase,
  targetType: "signal" | "reply",
  targetId: string,
  body: string,
  now: number,
): Promise<PublicModeration> {
  const classification = classifyContent(body);
  if (classification.outcome === "reject") {
    const reason = classification.categories.includes("contact_info")
      ? "private_contact_blocked"
      : classification.categories.includes("spam")
        ? "promotional_content_blocked"
        : classification.categories.includes("too_long")
          ? "text_too_long"
          : "empty_text";
    throw new GovernanceError(422, reason, "This text cannot be published.");
  }
  if (classification.outcome !== "allow") {
    await db
      .prepare(
        "INSERT INTO moderation_items (id, target_type, target_id, source, risk, categories, excerpt, status, created_at) VALUES (?, ?, ?, 'auto', ?, ?, ?, ?, ?)",
      )
      .bind(
        newId("mod"),
        targetType,
        targetId,
        classification.risk,
        classification.categories.join(","),
        moderationExcerpt(body),
        classification.risk === "crisis" && classification.outcome === "flag" ? "escalated" : "pending",
        now,
      )
      .run();
  }
  return {
    status: classification.outcome === "hold" ? "pending_review" : "visible",
    risk: classification.risk,
    categories: classification.categories,
  };
}

export type ViewerFilters = { blockedTags: Set<string>; bannedTags: Set<string> };

export async function viewerFilters(db: SqlDatabase, viewerKey: string | null): Promise<ViewerFilters> {
  const bannedRows = await db
    .prepare("SELECT author_tag FROM network_authors WHERE status = 'banned'")
    .all<{ author_tag: string }>();
  const bannedTags = new Set(bannedRows.results.map((row) => row.author_tag));
  const blockedTags = new Set<string>();
  if (viewerKey) {
    const blockRows = await db
      .prepare("SELECT blocked_tag FROM network_blocks WHERE blocker_key = ?")
      .bind(viewerKey)
      .all<{ blocked_tag: string }>();
    for (const row of blockRows.results) blockedTags.add(row.blocked_tag);
  }
  return { blockedTags, bannedTags };
}

const CONTENT_TABLE: Record<"signal" | "reply", string> = {
  signal: "network_signals",
  reply: "network_replies",
};

export async function retractContent(
  db: SqlDatabase,
  input: { authorKey: string; targetType: "signal" | "reply"; targetId: string },
  now: number,
): Promise<void> {
  const table = CONTENT_TABLE[input.targetType];
  const row = await db
    .prepare(`SELECT author_key FROM ${table} WHERE id = ?`)
    .bind(input.targetId)
    .first<{ author_key: string }>();
  if (!row) throw new GovernanceError(404, "not_found", "Content not found.");
  if (row.author_key !== input.authorKey) {
    throw new GovernanceError(403, "not_owner", "Only the author can withdraw this.");
  }
  await db
    .prepare(`UPDATE ${table} SET status = 'removed_by_author' WHERE id = ?`)
    .bind(input.targetId)
    .run();
  await writeAudit(db, `author:${authorTagOf(input.authorKey)}`, "retract", input.targetType, input.targetId, "", now);
}

export const REPORT_REASONS = ["harassment", "self_harm_risk", "spam", "privacy", "hate", "other"] as const;
export type ReportReason = (typeof REPORT_REASONS)[number];

const REPORT_RISK: Record<ReportReason, Risk> = {
  self_harm_risk: "crisis",
  harassment: "high",
  hate: "high",
  privacy: "high",
  spam: "medium",
  other: "medium",
};

export async function createReport(
  db: SqlDatabase,
  input: {
    reporterKey: string;
    targetType: "signal" | "reply";
    targetId: string;
    reason: ReportReason;
    detail?: string;
  },
  now: number,
): Promise<{ duplicate: boolean }> {
  const table = CONTENT_TABLE[input.targetType];
  const target = await db
    .prepare(`SELECT body FROM ${table} WHERE id = ?`)
    .bind(input.targetId)
    .first<{ body: string }>();
  if (!target) throw new GovernanceError(404, "not_found", "Content not found.");

  const existing = await db
    .prepare(
      "SELECT id FROM network_reports WHERE target_type = ? AND target_id = ? AND reporter_key = ? AND status = 'open'",
    )
    .bind(input.targetType, input.targetId, input.reporterKey)
    .first<{ id: string }>();
  if (existing) return { duplicate: true };

  await db
    .prepare(
      "INSERT INTO network_reports (id, target_type, target_id, reporter_key, reason, detail, status, created_at) VALUES (?, ?, ?, ?, ?, ?, 'open', ?)",
    )
    .bind(newId("rpt"), input.targetType, input.targetId, input.reporterKey, input.reason, (input.detail ?? "").slice(0, 600), now)
    .run();

  const pendingItem = await db
    .prepare(
      "SELECT id FROM moderation_items WHERE target_type = ? AND target_id = ? AND status IN ('pending','escalated')",
    )
    .bind(input.targetType, input.targetId)
    .first<{ id: string }>();
  if (!pendingItem) {
    await db
      .prepare(
        "INSERT INTO moderation_items (id, target_type, target_id, source, risk, categories, excerpt, status, created_at) VALUES (?, ?, ?, 'report', ?, ?, ?, ?, ?)",
      )
      .bind(
        newId("mod"),
        input.targetType,
        input.targetId,
        REPORT_RISK[input.reason],
        input.reason,
        moderationExcerpt(target.body ?? ""),
        input.reason === "self_harm_risk" ? "escalated" : "pending",
        now,
      )
      .run();
  }
  await writeAudit(db, `author:${authorTagOf(input.reporterKey)}`, "report.create", input.targetType, input.targetId, input.reason, now);
  return { duplicate: false };
}

export async function setBlock(
  db: SqlDatabase,
  input: { blockerKey: string; blockedTag: string; blocked: boolean },
  now: number,
): Promise<void> {
  if (authorTagOf(input.blockerKey) === input.blockedTag) {
    throw new GovernanceError(400, "self_block", "You cannot block yourself.");
  }
  const existing = await db
    .prepare("SELECT id FROM network_blocks WHERE blocker_key = ? AND blocked_tag = ?")
    .bind(input.blockerKey, input.blockedTag)
    .first<{ id: string }>();
  if (input.blocked && !existing) {
    await db
      .prepare("INSERT INTO network_blocks (id, blocker_key, blocked_tag, created_at) VALUES (?, ?, ?, ?)")
      .bind(newId("blk"), input.blockerKey, input.blockedTag, now)
      .run();
  }
  if (!input.blocked && existing) {
    await db.prepare("DELETE FROM network_blocks WHERE id = ?").bind(existing.id).run();
  }
  await writeAudit(
    db,
    `author:${authorTagOf(input.blockerKey)}`,
    input.blocked ? "block.set" : "block.remove",
    "author",
    input.blockedTag,
    "",
    now,
  );
}

export type ModerationItemRow = {
  id: string;
  target_type: string;
  target_id: string;
  source: string;
  risk: string;
  categories: string;
  excerpt: string;
  status: string;
  created_at: number;
  decided_at: number | null;
  decided_by: string | null;
  note: string;
};

export async function listModeration(
  db: SqlDatabase,
  filter: { status?: "pending" | "approved" | "removed" | "escalated"; limit?: number },
): Promise<ModerationItemRow[]> {
  const limit = Math.max(1, Math.min(200, filter.limit ?? 50));
  const result = filter.status
    ? await db
        .prepare("SELECT * FROM moderation_items WHERE status = ? ORDER BY created_at DESC LIMIT ?")
        .bind(filter.status, limit)
        .all<ModerationItemRow>()
    : await db.prepare("SELECT * FROM moderation_items ORDER BY created_at DESC LIMIT ?").bind(limit).all<ModerationItemRow>();
  return result.results;
}

export async function decideModeration(db: SqlDatabase, input: ModerationDecisionInput, now: number): Promise<void> {
  const item = await db
    .prepare("SELECT target_type, target_id FROM moderation_items WHERE id = ?")
    .bind(input.itemId)
    .first<{ target_type: string; target_id: string }>();
  if (!item) throw new GovernanceError(404, "not_found", "Moderation item not found.");
  const targetType = item.target_type === "reply" ? "reply" : "signal";
  const table = CONTENT_TABLE[targetType];

  await db
    .prepare("UPDATE moderation_items SET status = ?, decided_at = ?, decided_by = ?, note = ? WHERE id = ?")
    .bind(input.decision, now, input.moderator, (input.note ?? "").slice(0, 600), input.itemId)
    .run();

  if (input.decision === "approved") {
    await db
      .prepare(`UPDATE ${table} SET status = 'visible' WHERE id = ? AND status = 'pending_review'`)
      .bind(item.target_id)
      .run();
  }
  if (input.decision === "removed") {
    await db
      .prepare(`UPDATE ${table} SET status = 'removed_by_moderator' WHERE id = ?`)
      .bind(item.target_id)
      .run();
  }
  if (input.decision !== "escalated") {
    await db
      .prepare("UPDATE network_reports SET status = ? WHERE target_type = ? AND target_id = ? AND status = 'open'")
      .bind(input.decision === "removed" ? "resolved" : "dismissed", item.target_type, item.target_id)
      .run();
  }
  await writeAudit(db, `moderator:${input.moderator}`, `moderation.${input.decision}`, item.target_type, item.target_id, input.note ?? "", now);
}

export async function setAuthorStatus(
  db: SqlDatabase,
  input: { authorTag: string; status: "active" | "limited" | "banned"; moderator: string; note?: string },
  now: number,
): Promise<void> {
  const existing = await db
    .prepare("SELECT author_key FROM network_authors WHERE author_tag = ?")
    .bind(input.authorTag)
    .first<{ author_key: string }>();
  if (!existing) throw new GovernanceError(404, "not_found", "Author not found.");
  await db
    .prepare("UPDATE network_authors SET status = ?, note = ? WHERE author_tag = ?")
    .bind(input.status, (input.note ?? "").slice(0, 300), input.authorTag)
    .run();
  await writeAudit(db, `moderator:${input.moderator}`, `author.${input.status}`, "author", input.authorTag, input.note ?? "", now);
}
