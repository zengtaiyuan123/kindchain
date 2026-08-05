/**
 * Content classification for the shared network.
 *
 * Honest boundary (whitepaper §21): this is an automatic FIRST pass that
 * routes content into a human moderation queue. It never claims to have
 * notified a real person, and crisis-adjacent text is never silently hidden —
 * it stays visible (someone reaching out must not be muted) while being
 * escalated for priority human review.
 *
 * Outcomes:
 * - "reject":  not stored at all (contact info / doxxing vectors, spam).
 * - "hold":    stored as pending_review, not publicly visible (harassment,
 *              hate, explicit danger to others).
 * - "flag":    publicly visible + queued for human review.
 * - "allow":   publicly visible, no queue entry.
 */

export type Risk = "low" | "medium" | "high" | "crisis";
export type Outcome = "allow" | "flag" | "hold" | "reject";

export type Classification = {
  outcome: Outcome;
  risk: Risk;
  categories: string[];
};

export const MAX_BODY_LENGTH = 600;

// --- contact / off-platform routing (privacy boundary: whitepaper §24) ---
const CONTACT_PATTERNS: RegExp[] = [
  /[\w.+-]+@[\w-]+\.[\w.]{2,}/i, // email
  /https?:\/\/\S+/i,
  /\bwww\.\S+\.\S+/i,
  /\b(?:wechat|weixin|微信|vx|qq|whatsapp|telegram|t\.me|line id|kakao|instagram|ig[:：]|discord)\b[\s:：#@-]*[\w.-]{3,}/i,
  /微信号|加我(?:微信|好友|qq)|私聊我|加个好友/i,
];

// --- harassment / hate / threats: held for review before showing ---
const HOSTILE_PATTERNS: RegExp[] = [
  /\b(?:kill (?:yourself|urself)|kys)\b/i,
  /去死|你去死|自杀吧|杀了你|弄死你/,
  /\b(?:i (?:will|'ll) (?:kill|hurt|find) you)\b/i,
  /\b(?:stupid bitch|worthless piece|nobody loves you)\b/i,
  /废物|贱人|你这种人不配活/,
];

// --- crisis language: stays visible, escalated for human care ---
const CRISIS_PATTERNS: RegExp[] = [
  /\b(?:suicide|suicidal|end my life|kill myself|self[- ]harm|cut myself|don'?t want to (?:live|be alive)|no reason to live)\b/i,
  /自杀|轻生|不想活|活不下去|想死|自残|割腕|结束(?:自己的)?生命|遗书/,
  /死にたい|消えたい|自殺/,
  /quiero morir|no quiero vivir|suicidarme/i,
  /je veux mourir|me suicider/i,
];

// --- spam-ish commercial pushes ---
const SPAM_PATTERNS: RegExp[] = [
  /\b(?:casino|crypto pump|free money|click here|earn \$\d+|loan approval)\b/i,
  /代购|刷单|兼职日结|加群|优惠券|赌博|博彩/,
];

// --- mild profanity: visible, low-priority queue entry ---
const MILD_PATTERNS: RegExp[] = [/\b(?:fuck|shit|asshole)\b/i, /他妈的|妈的|滚蛋/];

export function classifyContent(rawBody: string): Classification {
  const body = rawBody.trim();
  const categories: string[] = [];

  if (!body) return { outcome: "reject", risk: "low", categories: ["empty"] };
  if (body.length > MAX_BODY_LENGTH) {
    return { outcome: "reject", risk: "low", categories: ["too_long"] };
  }

  const digitsOnly = body.replace(/[\s()./-]/g, "");
  const phoneLike = /(?:\+|00)?\d{8,15}(?!\d)/.test(digitsOnly);
  if (phoneLike || CONTACT_PATTERNS.some((pattern) => pattern.test(body))) {
    categories.push("contact_info");
  }
  if (SPAM_PATTERNS.some((pattern) => pattern.test(body))) {
    categories.push("spam");
  }
  if (categories.length > 0) {
    // Contact info and spam are rejected outright: an anonymous network with
    // no DM system must not become a funnel to off-platform channels (§20).
    return { outcome: "reject", risk: "medium", categories };
  }

  const hostile = HOSTILE_PATTERNS.some((pattern) => pattern.test(body));
  const crisis = CRISIS_PATTERNS.some((pattern) => pattern.test(body));

  if (hostile && crisis) {
    // Ambiguous ("go kill yourself" vs "I want to die") — a human must look
    // before it is shown to vulnerable readers.
    return { outcome: "hold", risk: "crisis", categories: ["hostile", "crisis"] };
  }
  if (hostile) {
    return { outcome: "hold", risk: "high", categories: ["hostile"] };
  }
  if (crisis) {
    // Visible + escalated. Muting a person in crisis is the one failure mode
    // this product must never have.
    return { outcome: "flag", risk: "crisis", categories: ["crisis"] };
  }

  if (MILD_PATTERNS.some((pattern) => pattern.test(body))) {
    return { outcome: "flag", risk: "medium", categories: ["profanity"] };
  }

  return { outcome: "allow", risk: "low", categories: [] };
}

/** Short public excerpt for the moderation queue (moderators see context, logs stay small). */
export function moderationExcerpt(body: string, limit = 120): string {
  const trimmed = body.trim().replace(/\s+/g, " ");
  return trimmed.length <= limit ? trimmed : `${trimmed.slice(0, limit - 1)}…`;
}
