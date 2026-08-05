import {
  authorTagOf,
  ensureGovernanceSchema,
  GovernanceError,
  moderatePublicBody,
  retractContent,
  touchAuthor,
  viewerFilters,
  type SqlDatabase,
} from "../../../lib/governance";

const HOUR = 3_600_000;
const SIGNAL_LIMIT = 96;
const REPLY_LIMIT = 240;
const ID_PATTERN = /^[a-z0-9][a-z0-9-]{7,95}$/i;
const PARENT_ID_PATTERN = /^[a-z0-9][a-z0-9-]{2,95}$/i;
const PUBLIC_KINDS = new Set(["light", "wish"]);
const LANGUAGES = new Set(["auto", "zh", "en", "es", "fr", "ja"]);
const SCENES = new Set(["terminator", "region-choir", "night-watch", "weather-shelter"]);

type PublicPayload = {
  id?: unknown;
  signalId?: unknown;
  chain?: unknown;
  kind?: unknown;
  lang?: unknown;
  text?: unknown;
  lat?: unknown;
  lon?: unknown;
  region?: unknown;
  country?: unknown;
  scene?: unknown;
  authorKey?: unknown;
};

type SignalRow = {
  id: string; chain_id: string; kind: string; lang: string; body: string;
  lat: number; lon: number; region: string; country: string; scene: string | null;
  created_at: number; expires_at: number; author_key: string; status: string;
};

type ReplyRow = {
  id: string; signal_id: string; lang: string; body: string;
  lat: number | null; lon: number | null; region: string; country: string;
  scene: string | null; created_at: number; author_key: string; status: string;
};

let schemaReady: Promise<void> | null = null;

async function database() {
  const { env } = await import("cloudflare:workers");
  if (!env.DB) throw new Error("D1 binding DB is unavailable");
  return env.DB;
}

async function ensureNetworkSchema() {
  if (schemaReady) return schemaReady;
  const db = await database();
  schemaReady = db.batch([
    db.prepare("CREATE TABLE IF NOT EXISTS network_signals (id TEXT PRIMARY KEY NOT NULL, chain_id TEXT NOT NULL, kind TEXT NOT NULL, lang TEXT NOT NULL DEFAULT 'auto', body TEXT NOT NULL, lat REAL NOT NULL, lon REAL NOT NULL, region TEXT NOT NULL, country TEXT NOT NULL, scene TEXT, author_key TEXT NOT NULL, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'visible')"),
    db.prepare("CREATE INDEX IF NOT EXISTS network_signals_created_idx ON network_signals (created_at)"),
    db.prepare("CREATE INDEX IF NOT EXISTS network_signals_visible_idx ON network_signals (status, expires_at)"),
    db.prepare("CREATE INDEX IF NOT EXISTS network_signals_author_idx ON network_signals (author_key, created_at)"),
    db.prepare("CREATE TABLE IF NOT EXISTS network_replies (id TEXT PRIMARY KEY NOT NULL, signal_id TEXT NOT NULL, lang TEXT NOT NULL DEFAULT 'auto', body TEXT NOT NULL, lat REAL, lon REAL, region TEXT NOT NULL, country TEXT NOT NULL, scene TEXT, author_key TEXT NOT NULL, created_at INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'visible')"),
    db.prepare("CREATE INDEX IF NOT EXISTS network_replies_signal_idx ON network_replies (signal_id, created_at)"),
    db.prepare("CREATE INDEX IF NOT EXISTS network_replies_author_idx ON network_replies (author_key, created_at)"),
  ]).then(async () => {
    // Governance tables (authors, reports, blocks, moderation queue, audit
    // log) ride the same idempotent bootstrap.
    await ensureGovernanceSchema(db as unknown as SqlDatabase);
  }).catch((error) => {
    schemaReady = null;
    throw error;
  });
  return schemaReady;
}

function json(payload: unknown, status = 200) {
  return Response.json(payload, {
    status,
    headers: {
      "Cache-Control": "no-store, max-age=0",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
    },
  });
}

function compactText(value: unknown, max: number) {
  return typeof value === "string"
    ? value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "").replace(/\s+/g, " ").trim().slice(0, max)
    : "";
}

function safeId(value: unknown) {
  const id = compactText(value, 96);
  return ID_PATTERN.test(id) ? id : "";
}

function safeParentId(value: unknown) {
  const id = compactText(value, 96);
  return PARENT_ID_PATTERN.test(id) ? id : "";
}

function coarseCoordinate(value: unknown, min: number, max: number) {
  const number = typeof value === "number" ? value : Number.NaN;
  if (!Number.isFinite(number)) return null;
  return Math.round(Math.max(min, Math.min(max, number)) * 10) / 10;
}

function containsPrivateContact(text: string) {
  const digits = text.replace(/\D/g, "");
  return /(?:https?:\/\/|www\.)\S+/i.test(text)
    || /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i.test(text)
    || /(?:^|\s)@[a-z0-9_]{3,}/i.test(text)
    || (digits.length >= 7 && /(?:\+?\d[\d\s().-]{5,}\d)/.test(text));
}

function containsUnsafePublicContent(text: string) {
  return /(杀死|杀了你|去死|自杀教程|炸弹威胁|kill\s+(?:you|them|him|her)|bomb\s+threat|doxx)/i.test(text);
}

async function rateLimited(authorKey: string, now: number) {
  const db = await database();
  const recentSignals = await db.prepare("SELECT COUNT(*) AS total FROM network_signals WHERE author_key = ? AND created_at > ?")
    .bind(authorKey, now - 60_000).first<{ total: number }>();
  const recentReplies = await db.prepare("SELECT COUNT(*) AS total FROM network_replies WHERE author_key = ? AND created_at > ?")
    .bind(authorKey, now - 60_000).first<{ total: number }>();
  const dailySignals = await db.prepare("SELECT COUNT(*) AS total FROM network_signals WHERE author_key = ? AND created_at > ?")
    .bind(authorKey, now - 24 * HOUR).first<{ total: number }>();
  const dailyReplies = await db.prepare("SELECT COUNT(*) AS total FROM network_replies WHERE author_key = ? AND created_at > ?")
    .bind(authorKey, now - 24 * HOUR).first<{ total: number }>();
  return Number(recentSignals?.total ?? 0) + Number(recentReplies?.total ?? 0) >= 3
    || Number(dailySignals?.total ?? 0) + Number(dailyReplies?.total ?? 0) >= 30;
}

export async function GET(request: Request) {
  try {
    await ensureNetworkSchema();
    const db = await database();
    const now = Date.now();
    const viewerKey = compactText(request.headers.get("x-kindchain-author"), 96) || null;
    const [signalResult, replyResult, countRow, filters] = await Promise.all([
      db.prepare("SELECT id, chain_id, kind, lang, body, lat, lon, region, country, scene, created_at, expires_at, author_key, status FROM network_signals WHERE status IN ('visible','pending_review') AND expires_at > ? ORDER BY created_at DESC LIMIT ?")
        .bind(now, SIGNAL_LIMIT * 2).all<SignalRow>(),
      db.prepare("SELECT id, signal_id, lang, body, lat, lon, region, country, scene, created_at, author_key, status FROM network_replies WHERE status IN ('visible','pending_review') AND created_at > ? ORDER BY created_at DESC LIMIT ?")
        .bind(now - 72 * HOUR, REPLY_LIMIT * 2).all<ReplyRow>(),
      db.prepare("SELECT COUNT(*) AS total FROM network_signals WHERE status = 'visible' AND expires_at > ?")
        .bind(now).first<{ total: number }>(),
      viewerFilters(db as unknown as SqlDatabase, viewerKey),
    ]);
    // Per-viewer governance: banned authors vanish for everyone, blocked
    // authors vanish for the blocker, held content is visible only to its own
    // author (labelled in-review by the client).
    const visibleRow = (row: { author_key: string; status: string }) => {
      const tag = authorTagOf(row.author_key);
      if (filters.bannedTags.has(tag) || filters.blockedTags.has(tag)) return false;
      if (row.status === "pending_review") return viewerKey !== null && row.author_key === viewerKey;
      return true;
    };
    const signals = signalResult.results.filter(visibleRow).slice(0, SIGNAL_LIMIT);
    const replies = replyResult.results.filter(visibleRow).slice(0, REPLY_LIMIT);
    return json({
      generatedAt: now,
      cadenceMs: 6000,
      realCount: Number(countRow?.total ?? 0),
      signals: signals.map((row) => ({
        id: row.id, chain: row.chain_id, kind: row.kind, lang: row.lang, text: row.body,
        lat: row.lat, lon: row.lon, region: row.region, country: row.country,
        scene: row.scene ?? undefined, createdAt: row.created_at, expiresAt: row.expires_at,
        authorTag: authorTagOf(row.author_key), reviewStatus: row.status,
      })),
      replies: replies.map((row) => ({
        id: row.id, signalId: row.signal_id, lang: row.lang, text: row.body,
        lat: row.lat ?? undefined, lon: row.lon ?? undefined, region: row.region,
        country: row.country, scene: row.scene ?? undefined, createdAt: row.created_at,
        authorTag: authorTagOf(row.author_key), reviewStatus: row.status,
      })),
    });
  } catch {
    return json({ error: "network_unavailable" }, 503);
  }
}

export async function POST(request: Request) {
  try {
    await ensureNetworkSchema();
    if (!request.headers.get("content-type")?.toLowerCase().includes("application/json")) return json({ error: "json_required" }, 415);
    const body = await request.json() as { action?: unknown; payload?: PublicPayload };
    const action = body.action === "signal" || body.action === "reply" ? body.action : null;
    const payload = body.payload ?? {};
    const id = safeId(payload.id);
    const text = compactText(payload.text, 600);
    const authorKey = compactText(payload.authorKey, 96) || "anonymous-pilot";
    if (!action || !id || !text) return json({ error: "invalid_payload" }, 400);
    if (containsPrivateContact(text)) return json({ error: "private_contact_blocked" }, 422);
    if (containsUnsafePublicContent(text)) return json({ error: "unsafe_public_content" }, 422);
    const now = Date.now();
    if (await rateLimited(authorKey, now)) return json({ error: "rate_limited" }, 429);

    const db = await database();
    const governanceDb = db as unknown as SqlDatabase;
    const author = await touchAuthor(governanceDb, authorKey, now);
    if (author.status === "banned") return json({ error: "author_banned" }, 403);
    let review: { status: "visible" | "pending_review" };
    try {
      review = await moderatePublicBody(governanceDb, action === "signal" ? "signal" : "reply", id, text, now);
    } catch (error) {
      if (error instanceof GovernanceError) return json({ error: error.code }, error.status);
      throw error;
    }
    const lang = LANGUAGES.has(String(payload.lang)) ? String(payload.lang) : "auto";
    const scene = SCENES.has(String(payload.scene)) ? String(payload.scene) : null;
    const region = compactText(payload.region, 80) || "Somewhere on Earth";
    const country = compactText(payload.country, 60) || "Earth";
    const lat = coarseCoordinate(payload.lat, -90, 90);
    const lon = coarseCoordinate(payload.lon, -180, 180);

    if (action === "signal") {
      const kind = String(payload.kind);
      const chain = safeId(payload.chain);
      if (!PUBLIC_KINDS.has(kind) || !chain || lat === null || lon === null) return json({ error: "invalid_signal" }, 400);
      const expiresAt = now + (kind === "wish" ? 48 : 24) * HOUR;
      await db.prepare("INSERT OR IGNORE INTO network_signals (id, chain_id, kind, lang, body, lat, lon, region, country, scene, author_key, created_at, expires_at, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
        .bind(id, chain, kind, lang, text, lat, lon, region, country, scene, authorKey, now, expiresAt, review.status).run();
      return json({ ok: true, id, createdAt: now, expiresAt, reviewStatus: review.status, authorTag: author.tag }, 201);
    }

    const signalId = safeParentId(payload.signalId);
    if (!signalId) return json({ error: "invalid_reply" }, 400);
    await db.prepare("INSERT OR IGNORE INTO network_replies (id, signal_id, lang, body, lat, lon, region, country, scene, author_key, created_at, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .bind(id, signalId, lang, text, lat, lon, region, country, scene, authorKey, now, review.status).run();
    return json({ ok: true, id, signalId, createdAt: now, reviewStatus: review.status, authorTag: author.tag }, 201);
  } catch {
    return json({ error: "network_unavailable" }, 503);
  }
}

/** Author retraction: the delete half of the governance loop. */
export async function DELETE(request: Request) {
  try {
    await ensureNetworkSchema();
    if (!request.headers.get("content-type")?.toLowerCase().includes("application/json")) return json({ error: "json_required" }, 415);
    const body = await request.json() as { targetType?: unknown; targetId?: unknown; authorKey?: unknown };
    const authorKey = compactText(request.headers.get("x-kindchain-author"), 96)
      || compactText(body.authorKey, 96);
    const targetId = safeParentId(body.targetId);
    const targetType = body.targetType === "reply" ? "reply" as const : "signal" as const;
    if (!authorKey || !targetId) return json({ error: "invalid_payload" }, 400);
    const db = await database();
    await retractContent(db as unknown as SqlDatabase, { authorKey, targetType, targetId }, Date.now());
    return json({ ok: true });
  } catch (error) {
    if (error instanceof GovernanceError) return json({ error: error.code }, error.status);
    return json({ error: "network_unavailable" }, 503);
  }
}
