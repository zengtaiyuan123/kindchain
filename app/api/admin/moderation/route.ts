import {
  decideModeration,
  ensureGovernanceSchema,
  GovernanceError,
  listModeration,
  setAuthorStatus,
  type SqlDatabase,
} from "../../../../lib/governance";

/**
 * Moderator console API.
 *
 * Auth: the `x-kindchain-admin` header must equal the KINDCHAIN_ADMIN_TOKEN
 * environment variable (>=16 chars). While the token is unset the endpoint is
 * disabled entirely — a safe default with no accidental open surface.
 */

async function workerEnv(): Promise<Record<string, unknown>> {
  const { env } = await import("cloudflare:workers");
  return env as unknown as Record<string, unknown>;
}

async function database(): Promise<SqlDatabase> {
  const env = await workerEnv();
  if (!env.DB) throw new Error("D1 binding DB is unavailable");
  return env.DB as SqlDatabase;
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

async function requireAdmin(request: Request): Promise<string | Response> {
  const env = await workerEnv();
  const configured = env.KINDCHAIN_ADMIN_TOKEN;
  if (typeof configured !== "string" || configured.length < 16) {
    return json({ error: "admin_disabled", message: "Set KINDCHAIN_ADMIN_TOKEN (>=16 chars) to enable moderation." }, 403);
  }
  if ((request.headers.get("x-kindchain-admin") ?? "") !== configured) {
    return json({ error: "forbidden" }, 403);
  }
  return request.headers.get("x-kindchain-moderator") ?? "moderator";
}

export async function GET(request: Request) {
  const admin = await requireAdmin(request);
  if (admin instanceof Response) return admin;
  try {
    const db = await database();
    await ensureGovernanceSchema(db);
    const url = new URL(request.url);
    const statusParam = url.searchParams.get("status");
    const status =
      statusParam === "pending" || statusParam === "approved" || statusParam === "removed" || statusParam === "escalated"
        ? statusParam
        : undefined;
    const items = await listModeration(db, { status, limit: Number(url.searchParams.get("limit") ?? 50) });
    return json({ items });
  } catch {
    return json({ error: "network_unavailable" }, 503);
  }
}

export async function POST(request: Request) {
  const admin = await requireAdmin(request);
  if (admin instanceof Response) return admin;
  try {
    if (!request.headers.get("content-type")?.toLowerCase().includes("application/json")) return json({ error: "json_required" }, 415);
    const body = await request.json() as Record<string, unknown>;
    const db = await database();
    await ensureGovernanceSchema(db);
    const now = Date.now();
    const action = String(body.action ?? "decide");

    if (action === "decide") {
      const decision = String(body.decision ?? "");
      if (decision !== "approved" && decision !== "removed" && decision !== "escalated") {
        return json({ error: "invalid_decision" }, 400);
      }
      await decideModeration(db, {
        itemId: String(body.itemId ?? ""),
        decision,
        moderator: admin,
        note: typeof body.note === "string" ? body.note : undefined,
      }, now);
      return json({ ok: true });
    }

    if (action === "author_status") {
      const status = String(body.status ?? "");
      if (status !== "active" && status !== "limited" && status !== "banned") {
        return json({ error: "invalid_status" }, 400);
      }
      await setAuthorStatus(db, {
        authorTag: String(body.authorTag ?? ""),
        status,
        moderator: admin,
        note: typeof body.note === "string" ? body.note : undefined,
      }, now);
      return json({ ok: true });
    }

    return json({ error: "invalid_action" }, 400);
  } catch (error) {
    if (error instanceof GovernanceError) return json({ error: error.code }, error.status);
    return json({ error: "network_unavailable" }, 503);
  }
}
