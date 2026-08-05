"use client";

/**
 * Persistent device-bound anonymous identity + governance client calls.
 *
 * The bearer key never appears in the UI or in public API payloads; its public
 * face is the server-derived `kc-xxxxxxxx` tag. A persistent key (unlike the
 * old day-scoped actor key) is what makes retraction, blocking and rate
 * limiting hold together across days.
 */

const AUTHOR_KEY_STORAGE = "kindchain-author-key";

export function getAuthorKey(): string {
  try {
    const existing = window.localStorage.getItem(AUTHOR_KEY_STORAGE);
    if (existing && /^[A-Za-z0-9_-]{16,96}$/.test(existing)) return existing;
    const fresh = `${crypto.randomUUID()}${crypto.randomUUID()}`.replace(/-/g, "").slice(0, 48);
    window.localStorage.setItem(AUTHOR_KEY_STORAGE, fresh);
    return fresh;
  } catch {
    return "session-fallback-anonymous-key";
  }
}

/** FNV-1a mirror of the server's tag derivation for local "own content" checks. */
export function authorTagOf(authorKey: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < authorKey.length; index += 1) {
    hash ^= authorKey.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return `kc-${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

export type ReportReason = "harassment" | "self_harm_risk" | "spam" | "privacy" | "hate" | "other";

export async function reportContent(targetType: "signal" | "reply", targetId: string, reason: ReportReason): Promise<boolean> {
  try {
    const response = await fetch("/api/report", {
      method: "POST",
      headers: { "content-type": "application/json", "x-kindchain-author": getAuthorKey() },
      body: JSON.stringify({ targetType, targetId, reason }),
    });
    return response.ok;
  } catch {
    return false;
  }
}

export async function blockAuthor(blockedTag: string, blocked: boolean): Promise<boolean> {
  try {
    const response = await fetch("/api/block", {
      method: "POST",
      headers: { "content-type": "application/json", "x-kindchain-author": getAuthorKey() },
      body: JSON.stringify({ blockedTag, blocked }),
    });
    return response.ok;
  } catch {
    return false;
  }
}

export async function retractContent(targetType: "signal" | "reply", targetId: string): Promise<boolean> {
  try {
    const response = await fetch("/api/network", {
      method: "DELETE",
      headers: { "content-type": "application/json", "x-kindchain-author": getAuthorKey() },
      body: JSON.stringify({ targetType, targetId }),
    });
    return response.ok;
  } catch {
    return false;
  }
}
