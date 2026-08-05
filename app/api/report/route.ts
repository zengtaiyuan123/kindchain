import {
  createReport,
  ensureGovernanceSchema,
  GovernanceError,
  REPORT_REASONS,
  touchAuthor,
  type ReportReason,
  type SqlDatabase,
} from "../../../lib/governance";

async function database(): Promise<SqlDatabase> {
  const { env } = await import("cloudflare:workers");
  if (!env.DB) throw new Error("D1 binding DB is unavailable");
  return env.DB as unknown as SqlDatabase;
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
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, max) : "";
}

export async function POST(request: Request) {
  try {
    if (!request.headers.get("content-type")?.toLowerCase().includes("application/json")) return json({ error: "json_required" }, 415);
    const body = await request.json() as Record<string, unknown>;
    const reporterKey = compactText(request.headers.get("x-kindchain-author"), 96) || compactText(body.authorKey, 96);
    if (!reporterKey) return json({ error: "author_required" }, 401);
    const reason = compactText(body.reason, 24);
    const targetId = compactText(body.targetId, 96);
    if (!targetId) return json({ error: "invalid_payload" }, 400);
    const db = await database();
    await ensureGovernanceSchema(db);
    const now = Date.now();
    await touchAuthor(db, reporterKey, now);
    const result = await createReport(db, {
      reporterKey,
      targetType: body.targetType === "reply" ? "reply" : "signal",
      targetId,
      reason: (REPORT_REASONS.includes(reason as ReportReason) ? reason : "other") as ReportReason,
      detail: compactText(body.detail, 600),
    }, now);
    return json({ ok: true, duplicate: result.duplicate }, 201);
  } catch (error) {
    if (error instanceof GovernanceError) return json({ error: error.code }, error.status);
    return json({ error: "network_unavailable" }, 503);
  }
}
