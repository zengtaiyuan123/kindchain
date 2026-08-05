export const GLOBE_ZOOM_STOPS = Object.freeze([0.06, 0.22, 0.4, 0.58, 0.76, 0.92]);

export const COURIER_MODES = Object.freeze(["hand", "pigeon", "carriage", "rail", "plane", "rocket", "starship"]);
export const COURIER_FAMILIES = Object.freeze(["hand", "wing", "postal", "orbit"]);

const MODE_FAMILY = Object.freeze({
  hand: "hand",
  pigeon: "wing",
  carriage: "postal",
  rail: "postal",
  plane: "postal",
  rocket: "orbit",
  starship: "orbit",
});

const emptyModeRecord = () => Object.fromEntries(COURIER_MODES.map((mode) => [mode, 0]));
const emptyFamilyRecord = () => Object.fromEntries(COURIER_FAMILIES.map((family) => [family, 0]));

export const EMPTY_MESSENGER_MEMORY = Object.freeze({
  replies: 0,
  distanceKm: 0,
  weatherMarks: 0,
  escorts: 0,
  arrivals: 0,
  terminatorCrossings: 0,
  modeTrips: Object.freeze(emptyModeRecord()),
  familyDistanceKm: Object.freeze(emptyFamilyRecord()),
  zones: Object.freeze([]),
  stamps: Object.freeze([]),
  settledJourneyIds: Object.freeze([]),
});

export function nearestZoomStop(value) {
  return GLOBE_ZOOM_STOPS.reduce((nearest, stop) =>
    Math.abs(stop - value) < Math.abs(nearest - value) ? stop : nearest,
  GLOBE_ZOOM_STOPS[0]);
}

export function messengerGrowthScore(memory) {
  const safe = sanitizeMessengerMemory(memory);
  return safe.replies * 2 + safe.modeTrips.pigeon * 2;
}

export function messengerProfileFor(memory, locale = "en") {
  const score = messengerGrowthScore(memory);
  const zh = locale === "zh";
  if (score >= 12) return { level: 4, variant: 3, slots: 3, flock: 3, nextAt: 20, name: zh ? "星羽鸽群" : "Starlit flock", tint: "gold", score };
  if (score >= 6) return { level: 3, variant: 2, slots: 2, flock: 2, nextAt: 12, name: zh ? "银羽成鸽" : "Silverwing", tint: "violet", score };
  if (score >= 2) return { level: 2, variant: 1, slots: 1, flock: 1, nextAt: 6, name: zh ? "青羽信鸽" : "Bluewing", tint: "blue", score };
  return { level: 1, variant: 0, slots: 1, flock: 1, nextAt: 2, name: zh ? "初生小鸽" : "Young messenger", tint: "pearl", score };
}

export function sanitizeMessengerMemory(value) {
  const memory = value && typeof value === "object" ? value : {};
  const sourceTrips = memory.modeTrips && typeof memory.modeTrips === "object" ? memory.modeTrips : {};
  const sourceDistances = memory.familyDistanceKm && typeof memory.familyDistanceKm === "object" ? memory.familyDistanceKm : {};
  const uniqueStrings = (items, limit) => Array.isArray(items)
    ? [...new Set(items.filter((item) => typeof item === "string" && item.length > 0))].slice(-limit)
    : [];
  return {
    replies: Math.max(0, Number(memory.replies) || 0),
    distanceKm: Math.max(0, Number(memory.distanceKm) || 0),
    weatherMarks: Math.max(0, Number(memory.weatherMarks) || 0),
    escorts: Math.max(0, Number(memory.escorts) || 0),
    arrivals: Math.max(0, Number(memory.arrivals) || 0),
    terminatorCrossings: Math.max(0, Number(memory.terminatorCrossings) || 0),
    modeTrips: Object.fromEntries(COURIER_MODES.map((mode) => [mode, Math.max(0, Number(sourceTrips[mode]) || 0)])),
    familyDistanceKm: Object.fromEntries(COURIER_FAMILIES.map((family) => [family, Math.max(0, Number(sourceDistances[family]) || 0)])),
    zones: uniqueStrings(memory.zones, 32),
    stamps: uniqueStrings(memory.stamps, 48),
    settledJourneyIds: uniqueStrings(memory.settledJourneyIds, 80),
  };
}

export function courierFamilyFor(mode) {
  return MODE_FAMILY[mode] ?? "hand";
}

export function courierUnlockState(mode, memory, locale = "en") {
  const safe = sanitizeMessengerMemory(memory);
  const zh = locale === "zh";
  const postalDistance = safe.familyDistanceKm.postal;
  const stampKinds = new Set(safe.stamps.map((stamp) => stamp.split("@")[0])).size;
  const groundFamiliesTravelled = safe.modeTrips.hand > 0
    && safe.modeTrips.pigeon > 0
    && safe.modeTrips.carriage + safe.modeTrips.rail + safe.modeTrips.plane > 0;
  if (mode === "hand" || mode === "pigeon") {
    return { unlocked: true, progress: 1, target: 1, hint: zh ? "从第一封信开始陪你" : "With you from the first letter" };
  }
  if (mode === "carriage") {
    const progress = Math.max(safe.arrivals, Math.min(1, safe.escorts / 2));
    return { unlocked: safe.arrivals >= 1 || safe.escorts >= 2, progress, target: 1, hint: zh ? "第一次真实抵达，或两次留灯 / 守夜后相遇" : "Meet after one real arrival or two quiet acts" };
  }
  if (mode === "rail") {
    const unlocked = safe.arrivals >= 3 && safe.zones.length >= 2;
    return { unlocked, progress: Math.min(1, Math.min(safe.arrivals / 3, safe.zones.length / 2)), target: 1, hint: zh ? `三次抵达 + 两片模糊地域（${safe.arrivals}/3 · ${safe.zones.length}/2）` : `Three arrivals + two coarse regions (${safe.arrivals}/3 · ${safe.zones.length}/2)` };
  }
  if (mode === "plane") {
    const unlocked = postalDistance >= 8000 && stampKinds >= 1;
    return { unlocked, progress: Math.min(1, Math.min(postalDistance / 8000, stampKinds)), target: 1, hint: zh ? `人间邮路抵达 8,000 km + 一枚天气印记（${Math.round(postalDistance).toLocaleString()} km）` : `8,000 km by human mail routes + one weather mark` };
  }
  if (mode === "rocket") {
    const unlocked = safe.terminatorCrossings >= 1 && stampKinds >= 3;
    return { unlocked, progress: Math.min(1, Math.min(safe.terminatorCrossings, stampKinds / 3)), target: 1, hint: zh ? `穿过一次晨昏线 + 三种真实天气印记（${safe.terminatorCrossings}/1 · ${stampKinds}/3）` : `Cross the terminator once + collect three weather marks` };
  }
  const unlocked = groundFamiliesTravelled && safe.replies >= 3 && safe.modeTrips.rocket >= 1;
  return { unlocked, progress: Math.min(1, (Number(groundFamiliesTravelled) + Math.min(1, safe.replies / 3) + Math.min(1, safe.modeTrips.rocket)) / 3), target: 1, hint: zh ? `让前三本护照都启程、完成三次回应，并让火箭抵达（${safe.replies}/3 回应）` : `Travel with the first three passports, make three replies, and land a rocket` };
}

export function courierGrowthScore(mode, memory) {
  const safe = sanitizeMessengerMemory(memory);
  const trips = safe.modeTrips[mode] ?? 0;
  if (mode === "hand") return trips * 2 + safe.escorts * 2;
  if (mode === "pigeon") return trips * 2 + safe.replies * 2;
  if (mode === "rocket" || mode === "starship") return trips * 2 + safe.terminatorCrossings;
  return trips * 2 + Math.min(4, safe.zones.length);
}

export function courierProfileFor(mode, memory, locale = "en") {
  const score = courierGrowthScore(mode, memory);
  const zh = locale === "zh";
  const names = {
    hand: zh ? ["纸袋脚步", "提灯同行", "温柔脚印", "归来的人"] : ["Paper satchel", "Lantern walker", "Kind footsteps", "The one who returns"],
    pigeon: zh ? ["初生小鸽", "青羽信鸽", "银羽成鸽", "星羽鸽群"] : ["Young messenger", "Bluewing", "Silverwing", "Starlit flock"],
    carriage: zh ? ["初见驿车", "邮戳马车", "夜路驿灯", "双马星路"] : ["First carriage", "Postmark carriage", "Night-road lantern", "Twin-horse starlight"],
    rail: zh ? ["夜邮列车", "铜牌邮车", "亮灯车厢", "蒸汽光尾"] : ["Night mail", "Brass mail train", "Lit mail carriage", "Steam-light trail"],
    plane: zh ? ["第一封航邮", "云上邮纹", "双翼灯", "晨昏航线"] : ["First airmail", "Cloud postmark", "Wing lights", "Terminator route"],
    rocket: zh ? ["地球边缘", "任务章", "晨昏火焰", "温柔轨道"] : ["Edge of Earth", "Mission patch", "Terminator flame", "Kind orbit"],
    starship: zh ? ["初航 Kindship", "船身星纹", "同行微星", "温柔星环"] : ["Kindship maiden flight", "Starlit hull", "Companion stars", "Gentle star-ring"],
  };
  const level = score >= 12 ? 4 : score >= 6 ? 3 : score >= 2 ? 2 : 1;
  const nextAt = level === 4 ? 20 : [0, 2, 6, 12][level];
  const unlock = courierUnlockState(mode, memory, locale);
  return { mode, family: courierFamilyFor(mode), score, level, nextAt, variant: level - 1, name: names[mode]?.[level - 1] ?? names.hand[level - 1], ...unlock };
}

export function courierFamilyProfileFor(family, memory, locale = "en") {
  const safe = sanitizeMessengerMemory(memory);
  const zh = locale === "zh";
  const trips = Object.entries(safe.modeTrips).reduce((sum, [mode, value]) => sum + (courierFamilyFor(mode) === family ? value : 0), 0);
  const scores = {
    hand: trips + safe.escorts * 2,
    wing: trips + safe.replies * 2,
    postal: trips * 2 + Math.min(6, safe.zones.length),
    orbit: trips * 2 + safe.terminatorCrossings * 2 + Math.min(6, safe.stamps.length),
  };
  const titles = {
    hand: zh ? "手与灯" : "Hand & lamp",
    wing: zh ? "羽与风" : "Wing & wind",
    postal: zh ? "人间邮路" : "Human mailways",
    orbit: zh ? "地球边缘" : "Edge of Earth",
  };
  const notes = {
    hand: zh ? "愿意慢下来，陪一束光走近一点。" : "Willing to slow down and walk closer to a light.",
    wing: zh ? "相信一封信会凭风找到归途。" : "Trusting a letter to find its way home.",
    postal: zh ? "人类为彼此修过路、点过灯。" : "Roads and lamps people built for one another.",
    orbit: zh ? "从远处看见我们共用一颗地球。" : "Seeing from afar that we share one Earth.",
  };
  const score = scores[family] ?? 0;
  return { family, title: titles[family] ?? titles.hand, note: notes[family] ?? notes.hand, score, level: score >= 20 ? 4 : score >= 10 ? 3 : score >= 4 ? 2 : 1, nextAt: score >= 20 ? 28 : score >= 10 ? 20 : score >= 4 ? 10 : 4, trips };
}

export function settleCourierJourney(memory, journey) {
  const safe = sanitizeMessengerMemory(memory);
  if (!journey?.id || safe.settledJourneyIds.includes(journey.id)) return safe;
  const mode = COURIER_MODES.includes(journey.mode) ? journey.mode : "hand";
  const family = courierFamilyFor(mode);
  const stampList = Array.isArray(journey.stamps) ? journey.stamps.filter((stamp) => typeof stamp === "string") : [];
  const zoneList = Array.isArray(journey.zones) ? journey.zones.filter((zone) => typeof zone === "string") : [];
  const stamps = [...new Set([...safe.stamps, ...stampList])].slice(-48);
  const zones = [...new Set([...safe.zones, ...zoneList])].slice(-32);
  return {
    ...safe,
    replies: safe.replies + (journey.reply ? 1 : 0),
    distanceKm: safe.distanceKm + Math.max(0, Number(journey.distanceKm) || 0),
    weatherMarks: new Set(stamps.map((stamp) => stamp.split("@")[0])).size,
    arrivals: safe.arrivals + 1,
    terminatorCrossings: safe.terminatorCrossings + (journey.crossedTerminator ? 1 : 0),
    modeTrips: { ...safe.modeTrips, [mode]: safe.modeTrips[mode] + 1 },
    familyDistanceKm: { ...safe.familyDistanceKm, [family]: safe.familyDistanceKm[family] + Math.max(0, Number(journey.distanceKm) || 0) },
    zones,
    stamps,
    settledJourneyIds: [...safe.settledJourneyIds, journey.id].slice(-80),
  };
}

export function courierPresentationAtZoom(mode, stage) {
  const matrix = {
    hand: { REGION: "trace", CITY: "model", DISTRICT: "model", COMMUNITY: "model" },
    pigeon: { ORBIT: "trace", EARTH: "trace", CONTINENT: "model", COUNTRY: "model", REGION: "model", CITY: "model", DISTRICT: "model", COMMUNITY: "model" },
    carriage: { CONTINENT: "trace", COUNTRY: "model", REGION: "model", CITY: "model", DISTRICT: "trace" },
    rail: { CONTINENT: "model", COUNTRY: "model", REGION: "model", CITY: "trace" },
    plane: { ORBIT: "trace", EARTH: "model", CONTINENT: "model", COUNTRY: "trace", REGION: "trace", CITY: "trace" },
    rocket: { ORBIT: "model", EARTH: "model", CONTINENT: "trace" },
    starship: { ORBIT: "model", EARTH: "trace" },
  };
  return matrix[mode]?.[stage] ?? "hidden";
}

export function courierAltitudeFor(mode) {
  return ({ hand: 2.285, pigeon: 2.48, carriage: 2.31, rail: 2.34, plane: 2.78, rocket: 3.2, starship: 3.55 })[mode] ?? 2.32;
}

export function coarsePublicPoint(point) {
  const step = 0.1;
  return {
    lat: Math.round(point.lat / step) * step,
    lon: Math.round(point.lon / step) * step,
  };
}

export function kindnessActKey(storyId, act, date = new Date()) {
  const day = date instanceof Date ? date.toISOString().slice(0, 10) : String(date).slice(0, 10);
  return `${day}|${act}|${storyId}`;
}

export function extendLightExpiry(story, now = Date.now(), minutes = 30) {
  if (!story?.expiresAt) return story;
  const createdAt = Number(story.createdAt) || now;
  const hardCap = createdAt + 72 * 60 * 60 * 1000;
  const extended = Math.max(Number(story.expiresAt) || now, now) + Math.max(0, minutes) * 60 * 1000;
  return { ...story, expiresAt: Math.min(hardCap, extended) };
}
