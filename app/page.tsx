"use client";

import { CSSProperties, FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { geoCentroid, geoContains, geoEquirectangular, geoMercator, geoPath } from "d3-geo";
import { feature } from "topojson-client";
import type { GeometryCollection, Topology } from "topojson-specification";
import countriesTopologyJson from "world-atlas/countries-110m.json";
import {
  authorTagOf as deviceTagOf,
  blockAuthor,
  getAuthorKey,
  reportContent as reportToKeepers,
  retractContent as retractFromNetwork,
  type ReportReason,
} from "./network-identity";
import {
  COURIER_FAMILIES,
  EMPTY_MESSENGER_MEMORY,
  GLOBE_ZOOM_STOPS,
  coarsePublicPoint,
  courierAltitudeFor,
  courierFamilyFor,
  courierFamilyProfileFor,
  courierPresentationAtZoom,
  courierProfileFor,
  courierUnlockState,
  extendLightExpiry,
  kindnessActKey,
  messengerProfileFor,
  nearestZoomStop,
  sanitizeMessengerMemory,
  settleCourierJourney,
} from "./kindchain-domain.mjs";

type ThreeModule = typeof import("three");

const countriesTopology = countriesTopologyJson as unknown as Topology<{ countries: GeometryCollection }>;
const landFeatures = feature(countriesTopology, countriesTopology.objects.countries).features;

type GeoLabelKind = "ocean" | "continent" | "country";
type GeoLabelDefinition = { kind: GeoLabelKind; lat: number; lon: number; en: string; zh: string };

const GEO_LABELS: GeoLabelDefinition[] = [
  { kind: "ocean", lat: 4, lon: -155, en: "Pacific Ocean", zh: "太平洋" },
  { kind: "ocean", lat: 18, lon: -38, en: "Atlantic Ocean", zh: "大西洋" },
  { kind: "ocean", lat: -18, lon: 76, en: "Indian Ocean", zh: "印度洋" },
  { kind: "ocean", lat: 78, lon: -15, en: "Arctic Ocean", zh: "北冰洋" },
  { kind: "ocean", lat: -61, lon: 80, en: "Southern Ocean", zh: "南冰洋" },
  { kind: "continent", lat: 47, lon: -104, en: "North America", zh: "北美洲" },
  { kind: "continent", lat: -17, lon: -60, en: "South America", zh: "南美洲" },
  { kind: "continent", lat: 51, lon: 16, en: "Europe", zh: "欧洲" },
  { kind: "continent", lat: 5, lon: 20, en: "Africa", zh: "非洲" },
  { kind: "continent", lat: 43, lon: 88, en: "Asia", zh: "亚洲" },
  { kind: "continent", lat: -25, lon: 135, en: "Oceania", zh: "大洋洲" },
  { kind: "continent", lat: -76, lon: 28, en: "Antarctica", zh: "南极洲" },
  { kind: "country", lat: 56, lon: -106, en: "Canada", zh: "加拿大" },
  { kind: "country", lat: 38, lon: -98, en: "United States", zh: "美国" },
  { kind: "country", lat: 23, lon: -102, en: "Mexico", zh: "墨西哥" },
  { kind: "country", lat: -11, lon: -53, en: "Brazil", zh: "巴西" },
  { kind: "country", lat: -38, lon: -64, en: "Argentina", zh: "阿根廷" },
  { kind: "country", lat: 54, lon: -2, en: "United Kingdom", zh: "英国" },
  { kind: "country", lat: 46, lon: 2, en: "France", zh: "法国" },
  { kind: "country", lat: 51, lon: 10, en: "Germany", zh: "德国" },
  { kind: "country", lat: 40, lon: -4, en: "Spain", zh: "西班牙" },
  { kind: "country", lat: 42, lon: 12, en: "Italy", zh: "意大利" },
  { kind: "country", lat: 59, lon: 82, en: "Russia", zh: "俄罗斯" },
  { kind: "country", lat: 35, lon: 104, en: "China", zh: "中国" },
  { kind: "country", lat: 22, lon: 79, en: "India", zh: "印度" },
  { kind: "country", lat: 37, lon: 138, en: "Japan", zh: "日本" },
  { kind: "country", lat: 36, lon: 128, en: "South Korea", zh: "韩国" },
  { kind: "country", lat: 47, lon: 104, en: "Mongolia", zh: "蒙古" },
  { kind: "country", lat: 48, lon: 68, en: "Kazakhstan", zh: "哈萨克斯坦" },
  { kind: "country", lat: 39, lon: 35, en: "Türkiye", zh: "土耳其" },
  { kind: "country", lat: 32, lon: 53, en: "Iran", zh: "伊朗" },
  { kind: "country", lat: 23, lon: 45, en: "Saudi Arabia", zh: "沙特阿拉伯" },
  { kind: "country", lat: 27, lon: 30, en: "Egypt", zh: "埃及" },
  { kind: "country", lat: 9, lon: 8, en: "Nigeria", zh: "尼日利亚" },
  { kind: "country", lat: 0, lon: 38, en: "Kenya", zh: "肯尼亚" },
  { kind: "country", lat: -30, lon: 25, en: "South Africa", zh: "南非" },
  { kind: "country", lat: -2, lon: 118, en: "Indonesia", zh: "印度尼西亚" },
  { kind: "country", lat: -25, lon: 134, en: "Australia", zh: "澳大利亚" },
  { kind: "country", lat: -41, lon: 174, en: "New Zealand", zh: "新西兰" },
];

const COUNTRY_ZH: Record<string, string> = Object.fromEntries(GEO_LABELS.filter((label) => label.kind === "country").map((label) => [label.en, label.zh]));
COUNTRY_ZH["United States of America"] = "美国";
COUNTRY_ZH["S. Korea"] = "韩国";
COUNTRY_ZH["Dem. Rep. Korea"] = "朝鲜";

function continentForPoint(lat: number, lon: number) {
  if (lat < -60) return { en: "Antarctica", zh: "南极洲" };
  if ((lon >= 110 || lon < -150) && lat < 12) return { en: "Oceania", zh: "大洋洲" };
  if (lon < -30) return lat >= 12 ? { en: "North America", zh: "北美洲" } : { en: "South America", zh: "南美洲" };
  if (lon >= -25 && lon <= 55 && lat >= -37 && lat < 35) return { en: "Africa", zh: "非洲" };
  if (lon >= -25 && lon < 60 && lat >= 35) return { en: "Europe", zh: "欧洲" };
  return { en: "Asia", zh: "亚洲" };
}

function geographicContextFor(point: { lat: number; lon: number; label?: string }) {
  const countryFeature = landFeatures.find((country) => geoContains(country, [point.lon, point.lat]));
  const countryEn = ((countryFeature?.properties ?? {}) as { name?: string }).name ?? "Open Ocean";
  const continent = countryEn === "Open Ocean" ? { en: "World Ocean", zh: "世界海洋" } : continentForPoint(point.lat, point.lon);
  return {
    continent,
    country: { en: countryEn, zh: COUNTRY_ZH[countryEn] ?? countryEn },
    region: point.label ?? countryEn,
  };
}

type Locale = "en" | "zh" | "es" | "fr" | "ja";
type TimePhase = "dawn" | "day" | "dusk" | "night";
type WeatherKind = "clear" | "cloud" | "fog" | "rain" | "snow" | "storm";
type Biome = "polar" | "boreal" | "temperate" | "desert" | "tropical" | "coastal" | "mountain";
type Hazard = "none" | "heat" | "dust" | "dry" | "ice";
type Environment = {
  time: TimePhase;
  weather: WeatherKind;
  biome: Biome;
  hazard: Hazard;
  aurora: boolean;
  auroraChance: number;
};
type Panel = "story" | "region" | "nearby" | "archive" | "menu" | "compose" | "journeys" | "pulse" | "light-choice" | "support" | null;
type ComposeMode = "light" | "reply" | "wish";
type ComposeScene = "terminator" | "region-choir" | "night-watch" | "weather-shelter" | null;
type SupportLevel = "listen" | "urgent";
type SupportNeed = "heard" | "reply" | "next";
type SupportStep = "level" | "safety" | "write" | "crisis";
type Delivery = "random" | "nearby" | "place";
type CourierMode = "hand" | "pigeon" | "carriage" | "rail" | "plane" | "rocket" | "starship";
type CourierFamily = "hand" | "wing" | "postal" | "orbit";
type RegionZone = "northern-lakes" | "arctic" | "east-asia" | "mediterranean" | "savanna" | "desert-belt" | "tropical-isles" | "andes" | "open-ocean";
type ZoomStage = "ORBIT" | "EARTH" | "CONTINENT" | "COUNTRY" | "REGION" | "CITY" | "DISTRICT" | "COMMUNITY";
type PlaceHierarchy = {
  country: string;
  region: string;
  city: string;
  district: string;
  locality: string;
  source: "openstreetmap" | "fallback";
};
type EarthLens = "atlas" | "daily" | "night";
type EarthDataLayer = "kindness" | "events" | "aurora";
type ArchiveTab = "paths" | "passport" | "stamps" | "keepsakes";
type WorldTab = "now" | "messengers" | "memories" | "lenses";
type WeatherStatus = "sample" | "loading" | "live" | "unavailable";
type JourneyScenario = "companionship" | "reply" | "wish" | "shelter" | "terminator" | "resonance" | "memorial";

type GeoPoint = { lat: number; lon: number; label: string };

type EarthObservationPoint = {
  id: string;
  lat: number;
  lon: number;
  intensity: number;
  title: string;
  category: string;
  observedAt?: number;
};

type ActivityOrigin = {
  cellId: string;
  centroidLat: number;
  centroidLon: number;
  regionLabel: string;
};

type ActivityBand = "quiet" | "glimmer" | "radiant" | "surge";

type DailyRegionActivity = {
  cellId: string;
  centroidLat: number;
  centroidLon: number;
  regionLabel: string;
  uniquePublishers: number;
  textCount: number;
  lightCount: number;
  wishCount: number;
  replyCount: number;
  recentCount: number;
  lastPublishedAt: number;
  intensity: number;
  band: ActivityBand;
  sample: boolean;
};

type DailyActivitySnapshot = {
  version: string;
  generatedAt: number;
  cells: DailyRegionActivity[];
  globalUnlocated: number;
};

type Journey = {
  id: string;
  storyId: string;
  mode: CourierMode;
  from: GeoPoint;
  to: GeoPoint;
  distance: number;
  etaHours: number;
  routeDistance: number;
  startedAt: number;
  demoDurationMs: number;
  courierVariant?: number;
  flockSize?: number;
  zones?: RegionZone[];
  stamps?: string[];
  crossedTerminator?: boolean;
  reply?: boolean;
  scenario?: JourneyScenario;
};

type Reply = {
  id: string;
  lang: Locale | "auto";
  text: string;
  translations: Partial<Record<Locale, string>>;
  lat?: number;
  lon?: number;
  region?: string;
  country?: string;
  createdAt?: number;
  origin?: ActivityOrigin;
  authorDayKey?: string;
  scene?: Exclude<ComposeScene, null>;
  authorTag?: string;
  reviewStatus?: string;
};

type Story = {
  id: string;
  chain: string;
  lat: number;
  lon: number;
  region: string;
  country: string;
  lang: Locale | "auto";
  text: string;
  translations: Partial<Record<Locale, string>>;
  replies: Reply[];
  kind?: "light" | "wish" | "support";
  supportLevel?: SupportLevel;
  supportNeed?: SupportNeed;
  localOnly?: boolean;
  createdAt?: number;
  expiresAt?: number;
  preserved?: boolean;
  origin?: ActivityOrigin;
  authorDayKey?: string;
  scene?: Exclude<ComposeScene, null>;
  networkState?: "pending" | "shared" | "local";
  authorTag?: string;
  reviewStatus?: string;
};

type NetworkSignal = Omit<Story, "replies" | "translations" | "kind"> & { kind: "light" | "wish" };
type NetworkReply = Omit<Reply, "translations"> & { signalId: string };
type NetworkSnapshot = { generatedAt: number; cadenceMs: number; realCount: number; signals: NetworkSignal[]; replies: NetworkReply[] };
type NetworkStatus = "connecting" | "live" | "offline";

function sameNetworkReply(current: Reply, incoming: Reply) {
  return current.lang === incoming.lang
    && current.text === incoming.text
    && current.lat === incoming.lat
    && current.lon === incoming.lon
    && current.region === incoming.region
    && current.country === incoming.country
    && current.createdAt === incoming.createdAt
    && current.scene === incoming.scene
    && current.authorTag === incoming.authorTag
    && current.reviewStatus === incoming.reviewStatus;
}

function sameNetworkSignal(current: Story, incoming: NetworkSignal) {
  return current.chain === incoming.chain
    && current.kind === incoming.kind
    && current.lang === incoming.lang
    && current.text === incoming.text
    && current.lat === incoming.lat
    && current.lon === incoming.lon
    && current.region === incoming.region
    && current.country === incoming.country
    && current.createdAt === incoming.createdAt
    && current.expiresAt === incoming.expiresAt
    && current.scene === incoming.scene
    && current.authorTag === incoming.authorTag
    && current.reviewStatus === incoming.reviewStatus
    && current.networkState === "shared";
}

function mergeNetworkSnapshot(current: Story[], snapshot: NetworkSnapshot) {
  const remoteSignals = new Map(snapshot.signals.map((signal) => [signal.id, signal]));
  const remoteReplies = new Map<string, Reply[]>();
  snapshot.replies.forEach(({ signalId, ...reply }) => {
    const list = remoteReplies.get(signalId) ?? [];
    list.push({ ...reply, translations: {} });
    remoteReplies.set(signalId, list);
  });
  const mergeReplies = (story: Story, incoming: Reply[] = []) => {
    if (story.localOnly) return story.replies;
    let changed = false;
    const replies = [...story.replies];
    incoming.forEach((reply) => {
      const index = replies.findIndex((candidate) => candidate.id === reply.id);
      if (index < 0) {
        replies.push(reply);
        changed = true;
        return;
      }
      if (sameNetworkReply(replies[index], reply)) return;
      replies[index] = { ...replies[index], ...reply, translations: replies[index].translations };
      changed = true;
    });
    return changed ? replies.sort((a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0)) : story.replies;
  };
  let changed = false;
  const merged = current.map((story) => {
    const remote = remoteSignals.get(story.id);
    let next = remote && !sameNetworkSignal(story, remote)
      ? { ...story, ...remote, translations: story.translations, networkState: "shared" as const }
      : story;
    const replies = mergeReplies(next, remoteReplies.get(story.id));
    if (replies !== next.replies) next = { ...next, replies };
    if (next !== story) changed = true;
    return next;
  });
  const known = new Set(merged.map((story) => story.id));
  snapshot.signals.forEach((signal) => {
    if (known.has(signal.id)) return;
    merged.push({
      ...signal,
      translations: {},
      replies: mergeReplies({ ...signal, translations: {}, replies: [] }, remoteReplies.get(signal.id)),
      networkState: "shared",
    });
    changed = true;
  });
  // Keeping referential identity here is a visual stability guarantee: routine
  // network polls must never tear down and rebuild the Three.js Earth.
  return changed ? merged : current;
}

type Weather = {
  temperature: number;
  apparent: number;
  wind: number;
  gust: number;
  cloud: number;
  precipitation: number;
  humidity: number;
  visibility: number;
  soilMoisture: number;
  code: number;
  isDay: boolean;
  localHour: number;
  timezone: string;
};

type FocusPoint = { lat: number; lon: number; nonce: number };
type ZoomCommand = { delta: number; nonce: number; targetZoom?: number };
type MessengerMemory = {
  replies: number; distanceKm: number; weatherMarks: number; escorts: number; arrivals: number; terminatorCrossings: number;
  modeTrips: Record<CourierMode, number>; familyDistanceKm: Record<CourierFamily, number>;
  zones: string[]; stamps: string[]; settledJourneyIds: string[];
};
type OnboardingStage = "boot" | "seeking" | "ready" | "done";
type LocationIntent = "locate" | "nearby" | null;
type QuietAct = "lamp" | "watch";
type ReplyCeremony = { id: string; region: string; weather: string; localTime: string; message: string };
type DepartureTicket = { id: string; journeyId: string; from: string; to: string; messenger: string; distance: number; message: string; createdAt: number };
type KeepsakePayload = { kind: "departure" | "arrival" | "stamp"; label: string; message: string; meta: string; fileStem: string };
type KeepsakeRecord = KeepsakePayload & { id: string; createdAt: number };
type StoredLocalState = { version: 1; savedAt: number; stories: Story[]; journeys: Journey[] };
type SupportReceipt = { id: string; storyId: string; message: string; level: SupportLevel; need: SupportNeed };

type PlaceProfile = {
  id: string;
  zone: RegionZone;
  title: Record<"zh" | "en", string>;
  signature: Record<"zh" | "en", string>;
  confidence: "curated" | "regional";
  palette: { zenith: string; horizon: string; far: string; near: string; water: string; glow: string };
};

type DescentGeoLabel = {
  lat: number;
  lon: number;
  zh: string;
  en: string;
  kind: "region" | "city" | "water";
  minZoom: number;
  maxZoom?: number;
};

// A small, art-directed Pearl River Delta label set proves that real geography
// can remain legible inside KindChain without inheriting a navigation app's
// visual noise. The imagery/reference tiles still provide worldwide context;
// these labels make the first China descent especially clear and testable.
const PEARL_RIVER_DESCENT_LABELS: DescentGeoLabel[] = [
  { lat: 23.42, lon: 113.30, zh: "广东省", en: "GUANGDONG", kind: "region", minZoom: 4.5, maxZoom: 7.4 },
  { lat: 23.129, lon: 113.264, zh: "广州市", en: "GUANGZHOU", kind: "city", minZoom: 5.1 },
  { lat: 23.022, lon: 113.121, zh: "佛山市", en: "FOSHAN", kind: "city", minZoom: 5.4 },
  { lat: 22.543, lon: 114.058, zh: "深圳市", en: "SHENZHEN", kind: "city", minZoom: 5.2 },
  { lat: 23.020, lon: 113.752, zh: "东莞市", en: "DONGGUAN", kind: "city", minZoom: 5.8 },
  { lat: 23.112, lon: 114.416, zh: "惠州市", en: "HUIZHOU", kind: "city", minZoom: 5.8 },
  { lat: 22.271, lon: 113.577, zh: "珠海市", en: "ZHUHAI", kind: "city", minZoom: 5.8 },
  { lat: 22.517, lon: 113.392, zh: "中山市", en: "ZHONGSHAN", kind: "city", minZoom: 5.9 },
  { lat: 22.579, lon: 113.082, zh: "江门市", en: "JIANGMEN", kind: "city", minZoom: 5.9 },
  { lat: 22.319, lon: 114.169, zh: "香港", en: "HONG KONG", kind: "city", minZoom: 5.6 },
  { lat: 22.63, lon: 113.69, zh: "珠江口", en: "PEARL RIVER ESTUARY", kind: "water", minZoom: 5.0, maxZoom: 9.1 },
  { lat: 21.88, lon: 113.20, zh: "南海", en: "SOUTH CHINA SEA", kind: "water", minZoom: 4.3, maxZoom: 7.5 },
];

// MapLibre zoom levels now match the story scale: province/state, city,
// district, then a deliberately coarse community area. The old 10.8 entry
// jumped directly to street scale and made the named hierarchy invisible.
const MAP_ENTRY_ZOOM = 4.8;
const MAP_EXIT_ZOOM = 3.58;
const MAP_MIN_ZOOM = 3.35;
// The public experience deliberately stops before building/address scale.
// Z10.8 still reads as a broad neighbourhood/area, not a house or a trail.
const MAP_MAX_ZOOM = 10.8;
const LOCAL_MAP_STYLE: import("maplibre-gl").StyleSpecification = {
  version: 8,
  sources: {
    "osm-raster": {
      type: "raster",
      tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
      tileSize: 256,
      maxzoom: 11,
      attribution: "© OpenStreetMap contributors",
    },
    // The satellite layer is deliberately an enhancement, not a dependency.
    // OSM stays underneath and the bundled atlas remains below both, so a
    // blocked imagery host can never turn a descent into an empty screen.
    "world-imagery": {
      type: "raster",
      tiles: ["https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"],
      tileSize: 256,
      maxzoom: 18,
      attribution: "Tiles © Esri — Esri, Maxar, Earthstar Geographics, and the GIS User Community",
    },
    "world-reference": {
      type: "raster",
      tiles: ["https://services.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}"],
      tileSize: 256,
      maxzoom: 18,
      attribution: "Reference layer © Esri and contributors",
    },
    "world-transportation": {
      type: "raster",
      tiles: ["https://services.arcgisonline.com/ArcGIS/rest/services/Reference/World_Transportation/MapServer/tile/{z}/{y}/{x}"],
      tileSize: 256,
      maxzoom: 18,
      attribution: "Transportation layer © Esri and contributors",
    },
  },
  layers: [
    { id: "kindchain-map-sky", type: "background", paint: { "background-color": "#07121d" } },
    {
      id: "osm-geography",
      type: "raster",
      source: "osm-raster",
      paint: {
        "raster-saturation": -.18,
        "raster-contrast": .12,
        "raster-brightness-min": .08,
        "raster-brightness-max": .96,
        "raster-fade-duration": 260,
      },
    },
    {
      id: "kindchain-real-surface",
      type: "raster",
      source: "world-imagery",
      paint: {
        "raster-opacity": .96,
        "raster-saturation": -.12,
        "raster-contrast": .08,
        "raster-brightness-min": .04,
        "raster-brightness-max": 1.04,
        "raster-fade-duration": 520,
      },
    },
    {
      id: "kindchain-transportation-reference",
      type: "raster",
      source: "world-transportation",
      minzoom: 5.3,
      paint: { "raster-opacity": .36, "raster-saturation": -.25, "raster-fade-duration": 360 },
    },
    {
      id: "kindchain-place-reference",
      type: "raster",
      source: "world-reference",
      minzoom: 3.6,
      paint: { "raster-opacity": .82, "raster-saturation": -.18, "raster-fade-duration": 360 },
    },
  ],
};
// The local map begins loading as soon as the regional scale is reached. The
// previous .90/.985 handoff left a huge dark globe on screen and required one
// extra zoom action before anything local appeared.
const MAP_MOUNT_DEPTH = .74;

// v47: phones get a lighter graphics diet. Mobile browsers enforce hard
// per-tab memory ceilings (iOS Safari kills and reloads the page beyond
// roughly a gigabyte) — three simultaneous GL contexts at 3× pixel ratio
// with desktop-sized textures is exactly how a "stable" page becomes a
// crash-reload loop on a phone.
function isCompactDevice() {
  if (typeof window === "undefined") return false;
  const coarse = typeof window.matchMedia === "function" && window.matchMedia("(pointer: coarse)").matches;
  return window.innerWidth <= 860 || (coarse && window.innerWidth <= 1180);
}
const MAP_HANDOFF_DEPTH = .92;
const LOCAL_HANDOFF_ZOOM = .92;
const ONBOARDING_STORY_ID = "ke-1";
const INITIAL_EARTH_ZOOM = .06;
// Keep enough of the sphere in frame at maximum globe depth. The final move
// into a place is a cross-fade into the coarse regional map, never a camera
// move through the Earth's surface.
const CAMERA_NEAR = 4.15;
const CAMERA_FAR = 15.5;
const WORLD_EXPERIENCE_PEOPLE = 10_000;

const EXTRA_UI: Record<Locale, {
  relay: string; expiring: string; capture: string; share: string; preserve: string; proof: string;
  notOnChain: string; pigeonNest: string; shares: string; slots: string; nextMorph: string;
  textOnly: string; saved: string; shared: string; chainLater: string; pigeonBusy: string;
}> = {
  en: { relay: "Relay constellation", expiring: "fades in", capture: "Keep a portrait", share: "Ask your circle", preserve: "Seal on-chain", proof: "STAR PATH PROOF", notOnChain: "Local proof · not yet on-chain", pigeonNest: "Messenger roost", shares: "kindness marks", slots: "flight slots", nextMorph: "next plumage", textOnly: "TEXT ONLY · language detected automatically", saved: "Your star-path portrait was saved.", shared: "Invitation sent. Sharing opens a door; only a real reply grows your messenger and extends the constellation.", chainLater: "Wallet and contract connection are required before real on-chain sealing.", pigeonBusy: "Your messenger is still carrying another light. A real reply, journey or escort can unlock more flight capacity." },
  zh: { relay: "限时接力星系", expiring: "后消散", capture: "星途留影", share: "向自己的圈子求接力", preserve: "链上封存", proof: "独一无二的星途凭证", notOnChain: "本地凭证 · 尚未真实上链", pigeonNest: "信使成长巢", shares: "枚善意印记", slots: "个飞行位", nextMorph: "下一次羽色蜕变", textOnly: "只接受文字 · 自动识别任何国家与语言", saved: "星途留影已经保存。", shared: "邀请已发出。分享只打开入口；真实回复才会让星系续命，也让信使成长。", chainLater: "真实链上封存需要接入钱包和正式合约；当前不会假装已经上链。", pigeonBusy: "你的小信使还在送上一封信。完成真实回复、旅程或护送，才能逐渐解锁更多飞行能力。" },
  es: { relay: "Constelación de relevo", expiring: "se desvanece en", capture: "Guardar retrato", share: "Pedir relevo", preserve: "Sellar en cadena", proof: "PRUEBA DE RUTA ESTELAR", notOnChain: "Prueba local · aún no está en cadena", pigeonNest: "Palomar mensajero", shares: "huellas de bondad", slots: "vuelos", nextMorph: "próximo plumaje", textOnly: "SOLO TEXTO · idioma detectado automáticamente", saved: "Se guardó tu retrato estelar.", shared: "Invitación enviada. Compartir abre una puerta; solo una respuesta real hace crecer al mensajero y prolonga la constelación.", chainLater: "Se necesita una cartera y un contrato real para sellar en cadena.", pigeonBusy: "Tu mensajero aún lleva otra luz. Las respuestas y los viajes desbloquean más capacidad." },
  fr: { relay: "Constellation relais", expiring: "disparaît dans", capture: "Garder un portrait", share: "Demander un relais", preserve: "Sceller sur chaîne", proof: "PREUVE DU CHEMIN D'ÉTOILES", notOnChain: "Preuve locale · pas encore sur chaîne", pigeonNest: "Colombier", shares: "traces de bonté", slots: "vols", nextMorph: "prochain plumage", textOnly: "TEXTE UNIQUEMENT · langue détectée automatiquement", saved: "Votre portrait stellaire est enregistré.", shared: "Invitation envoyée. Le partage ouvre une porte ; seule une vraie réponse fait grandir le messager et prolonge la constellation.", chainLater: "Un portefeuille et un contrat réel sont requis pour le scellement.", pigeonBusy: "Votre messager porte encore une lumière. Les réponses et les voyages ouvrent plus de capacité." },
  ja: { relay: "期間限定リレー星座", expiring: "で消えます", capture: "星の旅を保存", share: "仲間にリレーを頼む", preserve: "チェーンに保存", proof: "星の旅の証明", notOnChain: "ローカル証明・まだオンチェーンではありません", pigeonNest: "伝書鳩の巣", shares: "やさしさの印", slots: "飛行枠", nextMorph: "次の羽色", textOnly: "テキストのみ・言語を自動判定", saved: "星の旅の画像を保存しました。", shared: "招待を送りました。共有は入口を開くだけで、実際の返信だけが鳩を成長させ、星座の光を延ばします。", chainLater: "実際のオンチェーン保存にはウォレットと正式なコントラクトが必要です。", pigeonBusy: "鳩はまだ別の光を運んでいます。実際の返信や旅が飛行能力を育てます。" },
};

const PULSE_UI: Record<Locale, {
  title: string; sample: string; ordinary: string; bands: Record<ActivityBand, string>;
  signals: string; recent: string; global: string; terminator: string; terminatorCopy: string;
  sendAcross: string; choir: string; choirCopy: string; addVoice: string; watch: string;
  watchCopy: string; relayNow: string; shelter: string; shelterCopy: string; shelterAction: string;
  noRank: string; compose: Record<Exclude<ComposeScene, null>, string>;
}> = {
  zh: {
    title: "此刻星潮", sample: "体验星潮 · 多人数据接入后按地区实时更新", ordinary: "普通天空 · 尚无投放", bands: { quiet: "微光", glimmer: "闪烁", radiant: "明亮", surge: "星潮" },
    signals: "束文字 / 24H", recent: "刚刚亮起", global: "全球共振", terminator: "晨昏接力", terminatorCopy: "把白昼的一句话送进仍在夜里的天空。两边都亮起，光桥才会完整。",
    sendAcross: "写一句，送过晨昏线", choir: "区域星光合奏", choirCopy: "不同的人各留一句，让这片天空长成今天独有的星纹。", addVoice: "加入一颗文字星", watch: "星链守夜",
    watchCopy: "只靠真实文字接力延长星光；分享本身不会续命。", relayNow: "写一句，接住它", shelter: "风雨避光港", shelterCopy: "雨雪、沙尘或极寒里，三句话会共同撑起一层临时光穹。", shelterAction: "写一句，撑起光穹",
    noRank: "星光按自然时序淡去 · 不设个人或地区排名", compose: { terminator: "晨昏接力 · 你的文字将越过明暗交界", "region-choir": "区域合奏 · 你的文字会成为下一颗星", "night-watch": "星链守夜 · 真实回复会让它继续发光", "weather-shelter": "风雨避光港 · 一句话也能成为遮雨的光" },
  },
  en: {
    title: "Living pulse", sample: "EXPERIENCE FLOW · becomes region-live with multi-user data", ordinary: "Ordinary sky · no signals yet", bands: { quiet: "Whisper", glimmer: "Glimmer", radiant: "Radiant", surge: "Star tide" },
    signals: "text signals / 24H", recent: "newly lit", global: "global resonance", terminator: "Terminator relay", terminatorCopy: "Carry one sentence from daylight into a sky that is still in night. The bridge completes only when both sides glow.",
    sendAcross: "Write across the terminator", choir: "Regional sky chorus", choirCopy: "Different people leave one true line each, shaping today's local star pattern.", addVoice: "Add one text-star", watch: "Constellation watch",
    watchCopy: "Only a real text relay extends the light; sharing alone never does.", relayNow: "Write and hold the light", shelter: "Weather shelter", shelterCopy: "In rain, snow, dust or cold, three lines raise a temporary dome of light.", shelterAction: "Write into the shelter",
    noRank: "Light fades on a natural rhythm · no people or region rankings", compose: { terminator: "TERMINATOR RELAY · your line will cross day and night", "region-choir": "REGIONAL CHORUS · your line becomes the next star", "night-watch": "CONSTELLATION WATCH · a real reply keeps it glowing", "weather-shelter": "WEATHER SHELTER · one line can become cover" },
  },
  es: {
    title: "Pulso vivo", sample: "FLUJO DE EXPERIENCIA · será regional en tiempo real", ordinary: "Cielo normal · aún sin señales", bands: { quiet: "Susurro", glimmer: "Destello", radiant: "Radiante", surge: "Marea estelar" },
    signals: "textos / 24H", recent: "recién encendidos", global: "resonancia global", terminator: "Relevo de amanecer", terminatorCopy: "Lleva una frase del día hacia un cielo que aún está de noche.", sendAcross: "Escribir a través de la luz", choir: "Coro regional", choirCopy: "Cada persona deja una frase y forma el dibujo estelar del día.", addVoice: "Añadir una estrella", watch: "Vigilia estelar", watchCopy: "Solo un relevo de texto prolonga la luz.", relayNow: "Escribir y sostener", shelter: "Refugio del clima", shelterCopy: "Tres frases levantan una cúpula temporal en la tormenta.", shelterAction: "Escribir en el refugio", noRank: "La luz sigue un ritmo natural · sin clasificaciones personales ni regionales", compose: { terminator: "RELEVO DEL AMANECER", "region-choir": "CORO REGIONAL", "night-watch": "VIGILIA ESTELAR", "weather-shelter": "REFUGIO DEL CLIMA" },
  },
  fr: {
    title: "Pouls vivant", sample: "FLUX D'EXPÉRIENCE · bientôt régional en direct", ordinary: "Ciel ordinaire · aucun signal", bands: { quiet: "Murmure", glimmer: "Lueur", radiant: "Rayonnant", surge: "Marée d'étoiles" },
    signals: "textes / 24H", recent: "tout juste allumés", global: "résonance mondiale", terminator: "Relais de l'aube", terminatorCopy: "Portez une phrase du jour vers un ciel encore dans la nuit.", sendAcross: "Écrire au-delà de l'aube", choir: "Chœur régional", choirCopy: "Une phrase par personne dessine le ciel local du jour.", addVoice: "Ajouter une étoile", watch: "Veille de constellation", watchCopy: "Seul un vrai relais de texte prolonge la lumière.", relayNow: "Écrire et la garder", shelter: "Abri météo", shelterCopy: "Trois phrases élèvent un dôme de lumière temporaire.", shelterAction: "Écrire dans l'abri", noRank: "La lumière suit son rythme naturel · aucun classement personnel ou régional", compose: { terminator: "RELAIS DE L'AUBE", "region-choir": "CHŒUR RÉGIONAL", "night-watch": "VEILLE DE CONSTELLATION", "weather-shelter": "ABRI MÉTÉO" },
  },
  ja: {
    title: "いまの星潮", sample: "体験フロー・マルチユーザーデータ接続後は地域別に更新", ordinary: "いつもの空・まだ光はありません", bands: { quiet: "ささやき", glimmer: "きらめき", radiant: "輝き", surge: "星の潮" },
    signals: "のテキスト / 24H", recent: "いま点灯", global: "世界の共鳴", terminator: "朝夜リレー", terminatorCopy: "昼の一文を、まだ夜の空へ届けます。", sendAcross: "朝と夜を越えて書く", choir: "地域の星空合奏", choirCopy: "一人一文で、今日だけの星模様を作ります。", addVoice: "文字の星を加える", watch: "星座の見守り", watchCopy: "本当の文字リレーだけが光を延ばします。", relayNow: "書いて光を受け取る", shelter: "天気の光シェルター", shelterCopy: "雨雪や砂嵐の中、三つの言葉が光の屋根になります。", shelterAction: "シェルターへ書く", noRank: "光は自然な時の流れで淡くなる · 個人や地域の順位なし", compose: { terminator: "朝夜リレー", "region-choir": "地域の星空合奏", "night-watch": "星座の見守り", "weather-shelter": "天気の光シェルター" },
  },
};

const UI = {
  en: {
    drift: "Drift", nearby: "Near me", drop: "Drop a light", wish: "Make a wish", archive: "Star archive",
    locate: "Find my sky", soundOn: "Sound on", soundOff: "Sound off", original: "Original", translate: "Translate",
    reply: "Reply into this chain", hold: "Hold this light", region: "Sky conditions", source: "NASA Earth · Open-Meteo weather",
    drag: "drag to turn · pinch or use ± to zoom", live: "LIVE SKY", close: "Close", choose: "Choose a language",
    menu: "Hidden controls", routes: "Send it", cancel: "Cancel", message: "Write what is true right now…",
    response: "Write back gently…", wishText: "A small wish that someone could safely grant…", random: "Anywhere",
    near: "Near me", place: "Choose on Earth", selected: "Selected place", auto: "Your language will be detected and translated for the reader.",
    sent: "A new star has entered the sky.", locating: "Looking for your sky…", denied: "Location stays private. You can still choose anywhere on Earth.",
    nearbyTitle: "Lights near this sky", archiveTitle: "Constellations made by kindness", countries: "countries", stars: "stars",
    journeys: "journeys", rarity: ["common", "rare", "epic"], legacy: "Existing KindChain journey logic, now placed around the Earth.",
    menuItems: ["Weather wall", "Constellation paths", "Automatic translation", "Journey observatory", "Anonymous replies", "Wish signals"],
    privacy: "Exact personal locations are never shown. Nearby placement is softly blurred.",
    courier: "Choose a messenger", estimate: "route estimate", cinema: "Follow the journey", earthOn: "Show Earth", earthOff: "Hide Earth",
    inFlight: "in transit", distance: "distance", arrival: "estimated arrival", noJourneys: "No lights are travelling yet.",
  },
  zh: {
    drift: "随缘漂流", nearby: "看看附近", drop: "投放一束光", wish: "许一个愿望", archive: "星辰档案",
    locate: "找到我的天空", soundOn: "开启声音", soundOff: "关闭声音", original: "原文", translate: "自动翻译",
    reply: "接力回复", hold: "接住这束光", region: "此刻天空", source: "NASA 地球 · Open-Meteo 天气",
    drag: "拖动地球 · 双指或 ± 缩放", live: "实时天空", close: "关闭", choose: "选择语言",
    menu: "隐藏控制台", routes: "投放", cancel: "取消", message: "写下此刻真实的感受……",
    response: "温柔地回复一句……", wishText: "许一个具体、适度并可以安全实现的小愿望……", random: "随缘去任何地方",
    near: "投放在我附近", place: "选择地球上的地点", selected: "已选择地点", auto: "系统识别原语言，并为阅读者自动翻译。",
    sent: "一颗新星已经进入这片天空。", locating: "正在寻找你的天空……", denied: "你的位置仍然是私密的，也可以直接在地球上选择地点。",
    nearbyTitle: "这片天空附近的光", archiveTitle: "善意连成的星座", countries: "个国家", stars: "颗星",
    journeys: "条旅程", rarity: ["普通", "稀有", "史诗"], legacy: "保留 KindChain 现有的善意旅程逻辑，并把它放回真实地球。",
    menuItems: ["天气背景墙", "星座连接", "自动翻译", "旅程观测站", "匿名回复", "愿望信号"],
    privacy: "不会显示个人的精确位置；“附近”只使用经过模糊处理的区域。",
    courier: "选择送信方式", estimate: "路线估算", cinema: "跟随这段旅程", earthOn: "显示地球", earthOff: "隐藏地球",
    inFlight: "正在途中", distance: "距离", arrival: "预计抵达", noJourneys: "还没有正在旅行的光。",
  },
  es: {
    drift: "Derivar", nearby: "Cerca", drop: "Dejar luz", wish: "Pedir un deseo", archive: "Archivo estelar",
    locate: "Encontrar mi cielo", soundOn: "Sonido", soundOff: "Silencio", original: "Original", translate: "Traducir",
    reply: "Responder a la cadena", hold: "Guardar esta luz", region: "Cielo actual", source: "NASA Tierra · Open-Meteo",
    drag: "arrastra para girar · pellizca o usa ±", live: "CIELO EN VIVO", close: "Cerrar", choose: "Elegir idioma",
    menu: "Controles ocultos", routes: "Enviar", cancel: "Cancelar", message: "Escribe lo que es verdad ahora…",
    response: "Responde con cuidado…", wishText: "Un deseo pequeño y seguro…", random: "Cualquier lugar", near: "Cerca de mí",
    place: "Elegir en la Tierra", selected: "Lugar elegido", auto: "Detectamos el idioma y lo traducimos para cada lector.", sent: "Una nueva estrella entró en el cielo.",
    locating: "Buscando tu cielo…", denied: "Tu ubicación sigue privada. Puedes elegir un lugar en la Tierra.", nearbyTitle: "Luces cerca de este cielo",
    archiveTitle: "Constelaciones de bondad", countries: "países", stars: "estrellas", journeys: "viajes", rarity: ["común", "raro", "épico"],
    legacy: "La lógica actual de KindChain, ahora alrededor de la Tierra.", menuItems: ["Clima", "Constelaciones", "Traducción", "Entrega local", "Respuestas", "Deseos"],
    privacy: "Nunca mostramos ubicaciones personales exactas.",
    courier: "Elegir mensajero", estimate: "ruta estimada", cinema: "Seguir el viaje", earthOn: "Mostrar Tierra", earthOff: "Ocultar Tierra", inFlight: "en tránsito", distance: "distancia", arrival: "llegada estimada", noJourneys: "Aún no hay luces viajando.",
  },
  fr: {
    drift: "Dériver", nearby: "À proximité", drop: "Déposer une lumière", wish: "Faire un vœu", archive: "Archives",
    locate: "Trouver mon ciel", soundOn: "Son", soundOff: "Silence", original: "Original", translate: "Traduire",
    reply: "Répondre à la chaîne", hold: "Garder cette lumière", region: "Ciel actuel", source: "NASA Terre · Open-Meteo",
    drag: "glisser pour tourner · pincer ou utiliser ±", live: "CIEL EN DIRECT", close: "Fermer", choose: "Choisir la langue",
    menu: "Commandes cachées", routes: "Envoyer", cancel: "Annuler", message: "Écrivez ce qui est vrai maintenant…",
    response: "Répondez doucement…", wishText: "Un petit vœu sûr…", random: "N'importe où", near: "Près de moi",
    place: "Choisir sur Terre", selected: "Lieu choisi", auto: "La langue est détectée et traduite pour le lecteur.", sent: "Une nouvelle étoile est entrée dans le ciel.",
    locating: "Recherche de votre ciel…", denied: "Votre position reste privée. Choisissez un lieu sur Terre.", nearbyTitle: "Lumières près de ce ciel",
    archiveTitle: "Constellations de bonté", countries: "pays", stars: "étoiles", journeys: "voyages", rarity: ["commun", "rare", "épique"],
    legacy: "La logique KindChain existante, replacée autour de la Terre.", menuItems: ["Météo", "Constellations", "Traduction", "Envoi local", "Réponses", "Vœux"],
    privacy: "Les positions personnelles exactes ne sont jamais affichées.",
    courier: "Choisir le messager", estimate: "trajet estimé", cinema: "Suivre le voyage", earthOn: "Voir la Terre", earthOff: "Masquer la Terre", inFlight: "en route", distance: "distance", arrival: "arrivée estimée", noJourneys: "Aucune lumière ne voyage encore.",
  },
  ja: {
    drift: "漂う", nearby: "近くの光", drop: "光を置く", wish: "願いごと", archive: "星の記録",
    locate: "私の空", soundOn: "音をオン", soundOff: "音をオフ", original: "原文", translate: "翻訳",
    reply: "この光に返信", hold: "この光を受け取る", region: "今の空", source: "NASA Earth · Open-Meteo",
    drag: "ドラッグで回転 · ピンチまたは±で拡大", live: "ライブスカイ", close: "閉じる", choose: "言語を選択",
    menu: "隠れた操作", routes: "送る", cancel: "キャンセル", message: "今、本当に感じていることを…",
    response: "やさしく返信する…", wishText: "安全に叶えられる小さな願い…", random: "どこかへ", near: "私の近く",
    place: "地球上で選ぶ", selected: "選んだ場所", auto: "言語を検出し、読む人の言語に翻訳します。", sent: "新しい星が空に生まれました。",
    locating: "あなたの空を探しています…", denied: "位置情報は非公開のままです。地球上から選べます。", nearbyTitle: "この空の近くの光",
    archiveTitle: "やさしさが作った星座", countries: "か国", stars: "個の星", journeys: "の旅", rarity: ["コモン", "レア", "エピック"],
    legacy: "現在のKindChainの旅を、地球上に再配置しました。", menuItems: ["天気の壁", "星座", "自動翻訳", "地域配信", "匿名返信", "願い"],
    privacy: "正確な個人位置は表示されません。",
    courier: "届け方を選ぶ", estimate: "推定ルート", cinema: "旅を追いかける", earthOn: "地球を表示", earthOff: "地球を隠す", inFlight: "移動中", distance: "距離", arrival: "到着予定", noJourneys: "旅をしている光はまだありません。",
  },
} as const;

const LOCALE_NAMES: Record<Locale, string> = { en: "English", zh: "中文", es: "Español", fr: "Français", ja: "日本語" };

const SUPPORT_UI = {
  en: {
    oneLight: "One light", oneLightHint: "give · receive", gateKicker: "LIGHT GOES BOTH WAYS",
    gateTitle: "What do you need from this light?", gateCopy: "Kindness can leave you, or find you when yours is running low.",
    giveTitle: "I want to give a light", giveCopy: "Leave an honest sentence for someone on Earth.",
    needTitle: "I need a light right now", needCopy: "Ask to be heard without explaining everything.", privacy: "No exact location · no public count · no direct messages",
    supportKicker: "A LIGHT FOR YOU", supportTitle: "How heavy is this moment?", supportIntro: "Choose the closest answer. There is no score and nothing to prove.",
    listenTitle: "I want someone to listen", listenCopy: "I feel lost, low, or unsure where life is going.",
    urgentTitle: "I am really struggling", urgentCopy: "I hope to be seen as soon as someone is available.",
    unsafeTitle: "I may not be safe", unsafeCopy: "I may hurt myself, someone may hurt me, or I am not sure.",
    safetyTitle: "Before we continue, are you safe right now?", safetyCopy: "Are you thinking about hurting yourself or someone else, or are you in immediate physical danger?",
    safe: "No — I am safe right now", notSafe: "Yes / I am not sure", back: "Back", close: "Close",
    crisisTitle: "Please reach trained support now", crisisCopy: "KindChain can stay beside you, but it cannot provide emergency rescue or monitor your safety.",
    canada: "In Canada · trained crisis support, 24/7", call988: "Call 9-8-8", text988: "Text 9-8-8", danger911: "Immediate danger · call 9-1-1",
    outside: "Outside Canada, contact your local emergency service or nearest emergency department.", visit988: "What happens when I contact 9-8-8 ↗", afterHelp: "I have contacted support and still want to write",
    writeTitle: "You do not have to explain everything", writeCopy: "Write the one thing you most want another person to understand.", placeholder: "Right now, I wish someone knew…",
    heard: "Just hear me", reply: "A gentle reply", next: "Help me see one next step", safeChip: "You confirmed you are safe right now",
    localOnly: "Experience version: this signal is saved only on this device. It is not yet delivered to a live responder network.", submit: "Light a companion signal",
    receiptTitle: "Your light is breathing", receiptCopy: "It will remain a quiet, anonymous signal for six hours unless you end it sooner.",
    receiptTruth: "No real responder has been notified in this experience version. If your safety changes, contact professional support immediately.", view: "See this light", done: "Return to Earth",
    storyLabel: "COMPANION SIGNAL", companionRules: "Listen first · no diagnosis · no lectures · no requests for contact details · no promises of offline rescue", closeSignal: "End this signal",
  },
  zh: {
    oneLight: "一束光", oneLightHint: "给予 · 需要", gateKicker: "光可以双向流动",
    gateTitle: "这一刻，你希望这束光去哪里？", gateCopy: "有余力时，把光留给世界；撑不住时，也可以让世界靠近你。",
    giveTitle: "我想给出一束光", giveCopy: "留下一句真实的话，送给地球上的某个人。",
    needTitle: "我现在需要一束光", needCopy: "不必把一切解释清楚，只需要让一个人听见。", privacy: "不显示精确位置 · 不公开人数 · 不开放私聊",
    supportKicker: "一盏为你亮起的灯", supportTitle: "这一刻有多难熬？", supportIntro: "选择最接近的感受。这里没有评分，也不需要证明什么。",
    listenTitle: "我想有人听我说", listenCopy: "我有些迷茫、低落，不知道人生接下来往哪里走。",
    urgentTitle: "我现在真的很难受", urgentCopy: "希望有人有余力时，能尽快看见我。",
    unsafeTitle: "我现在可能不安全", unsafeCopy: "我可能会伤害自己、有人正在伤害我，或者我不确定。",
    safetyTitle: "继续之前，先确认你此刻是否安全", safetyCopy: "你现在是否有伤害自己或他人的想法，或者正处于即时的人身危险中？",
    safe: "没有，我此刻是安全的", notSafe: "有 / 我不确定", back: "返回", close: "关闭",
    crisisTitle: "请现在就联系受过训练的支持人员", crisisCopy: "KindChain 可以陪在旁边，但不能提供紧急救援，也无法监测你是否安全。",
    canada: "加拿大 · 受训危机支持 · 全年无休", call988: "拨打 9-8-8", text988: "短信 9-8-8", danger911: "有即时危险 · 拨打 9-1-1",
    outside: "如果你不在加拿大，请联系所在地紧急服务或前往最近的急诊。", visit988: "了解联系 9-8-8 后会发生什么 ↗", afterHelp: "我已联系专业支持，也想写下此刻的感受",
    writeTitle: "你不必把一切说清楚", writeCopy: "只写下此刻最希望另一个人知道的一件事。", placeholder: "此刻，我希望有人知道……",
    heard: "只希望被听见", reply: "想收到一句温柔回应", next: "陪我看见下一小步", safeChip: "你已确认自己此刻安全",
    localOnly: "体验版说明：这枚信号目前只保存在这台设备，尚未连接实时陪伴者网络。", submit: "点亮陪伴信号",
    receiptTitle: "你的灯正在呼吸", receiptCopy: "它会匿名、安静地亮六小时；你也可以随时结束。",
    receiptTruth: "体验版尚未通知真人回应者。如果你的安全状况发生变化，请立即联系专业支持。", view: "看看这盏灯", done: "回到地球",
    storyLabel: "陪伴信号", companionRules: "先听见 · 不诊断 · 不说教 · 不索要联系方式 · 不承诺线下救援", closeSignal: "结束这次信号",
  },
  es: {
    oneLight: "Una luz", oneLightHint: "dar · recibir", gateKicker: "LA LUZ VA EN AMBOS SENTIDOS",
    gateTitle: "¿Qué necesitas de esta luz?", gateCopy: "Puedes ofrecer bondad, o dejar que te encuentre cuando te falte fuerza.",
    giveTitle: "Quiero dar una luz", giveCopy: "Deja una frase honesta para alguien en la Tierra.", needTitle: "Necesito una luz ahora", needCopy: "Pide ser escuchado sin explicarlo todo.", privacy: "Sin ubicación exacta · sin conteo público · sin mensajes privados",
    supportKicker: "UNA LUZ PARA TI", supportTitle: "¿Qué tan difícil es este momento?", supportIntro: "Elige la respuesta más cercana. No hay puntuación ni nada que demostrar.",
    listenTitle: "Quiero que alguien me escuche", listenCopy: "Me siento perdido, triste o sin rumbo.", urgentTitle: "Lo estoy pasando muy mal", urgentCopy: "Espero que alguien pueda verme pronto.", unsafeTitle: "Puede que no esté a salvo", unsafeCopy: "Podría hacerme daño, alguien podría hacerme daño o no estoy seguro.",
    safetyTitle: "Antes de continuar, ¿estás a salvo ahora?", safetyCopy: "¿Piensas hacerte daño o dañar a otra persona, o estás en peligro físico inmediato?", safe: "No — ahora estoy a salvo", notSafe: "Sí / no estoy seguro", back: "Volver", close: "Cerrar",
    crisisTitle: "Contacta ahora con ayuda capacitada", crisisCopy: "KindChain puede acompañarte, pero no ofrece rescate de emergencia ni vigila tu seguridad.", canada: "En Canadá · apoyo de crisis 24/7", call988: "Llamar al 9-8-8", text988: "Escribir al 9-8-8", danger911: "Peligro inmediato · llamar al 9-1-1", outside: "Fuera de Canadá, contacta los servicios de emergencia locales o urgencias.", visit988: "Qué ocurre al contactar 9-8-8 ↗", afterHelp: "Ya contacté ayuda y aún quiero escribir",
    writeTitle: "No tienes que explicarlo todo", writeCopy: "Escribe lo que más quieres que otra persona entienda.", placeholder: "Ahora mismo, quisiera que alguien supiera…", heard: "Solo escúchame", reply: "Una respuesta amable", next: "Ayúdame a ver un siguiente paso", safeChip: "Confirmaste que ahora estás a salvo", localOnly: "Versión de experiencia: esta señal solo se guarda en este dispositivo; aún no llega a una red real.", submit: "Encender señal de compañía",
    receiptTitle: "Tu luz está respirando", receiptCopy: "Permanecerá anónima durante seis horas, salvo que la cierres antes.", receiptTruth: "Nadie real ha sido avisado en esta versión. Si cambia tu seguridad, busca ayuda profesional.", view: "Ver esta luz", done: "Volver a la Tierra", storyLabel: "SEÑAL DE COMPAÑÍA", companionRules: "Escuchar · no diagnosticar · no sermonear · no pedir contacto · no prometer rescate", closeSignal: "Cerrar esta señal",
  },
  fr: {
    oneLight: "Une lumière", oneLightHint: "donner · recevoir", gateKicker: "LA LUMIÈRE VA DANS LES DEUX SENS",
    gateTitle: "De quoi avez-vous besoin maintenant ?", gateCopy: "Offrez une lumière, ou laissez le monde vous en apporter une.", giveTitle: "Je veux offrir une lumière", giveCopy: "Laissez une phrase sincère à quelqu’un sur Terre.", needTitle: "J’ai besoin d’une lumière", needCopy: "Demandez à être entendu sans tout expliquer.", privacy: "Pas de lieu précis · pas de compteur public · pas de messages privés",
    supportKicker: "UNE LUMIÈRE POUR VOUS", supportTitle: "À quel point ce moment est-il difficile ?", supportIntro: "Choisissez la réponse la plus proche. Rien à prouver.", listenTitle: "J’aimerais être écouté", listenCopy: "Je me sens perdu, triste ou sans direction.", urgentTitle: "Je traverse un moment très difficile", urgentCopy: "J’espère être vu dès que quelqu’un le pourra.", unsafeTitle: "Je ne suis peut-être pas en sécurité", unsafeCopy: "Je pourrais me blesser, quelqu’un pourrait me blesser, ou je ne sais pas.",
    safetyTitle: "Avant de continuer, êtes-vous en sécurité ?", safetyCopy: "Pensez-vous à vous blesser ou à blesser quelqu’un, ou êtes-vous en danger physique immédiat ?", safe: "Non — je suis en sécurité", notSafe: "Oui / je ne sais pas", back: "Retour", close: "Fermer",
    crisisTitle: "Contactez maintenant un soutien formé", crisisCopy: "KindChain peut rester à vos côtés, mais ne fournit pas de secours d’urgence.", canada: "Au Canada · soutien de crise 24 h/24", call988: "Appeler le 9-8-8", text988: "Texter le 9-8-8", danger911: "Danger immédiat · appeler le 9-1-1", outside: "Hors du Canada, contactez les services d’urgence locaux ou les urgences médicales.", visit988: "À quoi s’attendre avec le 9-8-8 ↗", afterHelp: "J’ai contacté de l’aide et je veux encore écrire",
    writeTitle: "Vous n’avez pas à tout expliquer", writeCopy: "Écrivez ce que vous souhaitez le plus faire comprendre.", placeholder: "Maintenant, j’aimerais que quelqu’un sache…", heard: "Seulement m’écouter", reply: "Une réponse douce", next: "Voir une prochaine petite étape", safeChip: "Vous confirmez être en sécurité", localOnly: "Version d’expérience : ce signal reste sur cet appareil et n’est pas envoyé à un réseau réel.", submit: "Allumer un signal de présence",
    receiptTitle: "Votre lumière respire", receiptCopy: "Elle restera anonyme pendant six heures, sauf si vous l’arrêtez.", receiptTruth: "Aucun répondant réel n’a été averti. Si votre sécurité change, contactez une aide professionnelle.", view: "Voir cette lumière", done: "Retour à la Terre", storyLabel: "SIGNAL DE PRÉSENCE", companionRules: "Écouter · ne pas diagnostiquer · ne pas faire la leçon · ne pas demander de contact · ne pas promettre de secours", closeSignal: "Arrêter ce signal",
  },
  ja: {
    oneLight: "ひとつの光", oneLightHint: "贈る · 受け取る", gateKicker: "光はどちらにも流れる",
    gateTitle: "今、この光に何を望みますか？", gateCopy: "誰かに光を贈ることも、光を受け取ることもできます。", giveTitle: "光を贈りたい", giveCopy: "地球の誰かへ、正直な一文を残します。", needTitle: "今、光が必要です", needCopy: "すべて説明しなくても、誰かに聞いてもらえます。", privacy: "正確な場所なし · 公開人数なし · 個別DMなし",
    supportKicker: "あなたのための光", supportTitle: "今はどれくらいつらいですか？", supportIntro: "一番近いものを選んでください。評価も証明もありません。", listenTitle: "誰かに聞いてほしい", listenCopy: "迷いや落ち込みがあり、先が見えません。", urgentTitle: "今、とてもつらい", urgentCopy: "誰かにできるだけ早く気づいてほしいです。", unsafeTitle: "安全ではないかもしれない", unsafeCopy: "自分を傷つけるか、誰かに傷つけられるか、分かりません。",
    safetyTitle: "続ける前に、今は安全ですか？", safetyCopy: "自分や他人を傷つける考え、または差し迫った身体的危険がありますか？", safe: "いいえ — 今は安全です", notSafe: "はい / 分かりません", back: "戻る", close: "閉じる",
    crisisTitle: "今すぐ訓練を受けた支援につながってください", crisisCopy: "KindChain は寄り添えますが、緊急救助や安全確認はできません。", canada: "カナダ · 24時間の危機支援", call988: "9-8-8 に電話", text988: "9-8-8 にSMS", danger911: "差し迫った危険 · 9-1-1", outside: "カナダ国外では、地域の緊急サービスまたは救急外来へ連絡してください。", visit988: "9-8-8につながるとどうなるか ↗", afterHelp: "支援に連絡し、気持ちも書きたい",
    writeTitle: "すべて説明しなくて大丈夫です", writeCopy: "今、誰かに一番知ってほしいことを書いてください。", placeholder: "今、誰かに知ってほしいのは…", heard: "ただ聞いてほしい", reply: "やさしい返事がほしい", next: "次の小さな一歩を見たい", safeChip: "今は安全だと確認しました", localOnly: "体験版：この信号はこの端末だけに保存され、実際の支援者には届きません。", submit: "寄り添いの光を灯す",
    receiptTitle: "あなたの光が呼吸しています", receiptCopy: "終了しない限り、匿名で6時間灯ります。", receiptTruth: "体験版では実際の人に通知されません。安全が変わったら専門支援へ連絡してください。", view: "この光を見る", done: "地球へ戻る", storyLabel: "寄り添い信号", companionRules: "まず聞く · 診断しない · 説教しない · 連絡先を求めない · 救助を約束しない", closeSignal: "この信号を終了",
  },
} as const;

const TRANSPORTS: Record<CourierMode, {
  glyph: string; names: Record<Locale, string>; era: Record<Locale, string>; speed: number; routeFactor: number; handling: number; color: number;
}> = {
  hand: { glyph: "人", names: { en: "On foot", zh: "人工步行", es: "A pie", fr: "À pied", ja: "人の手" }, era: { en: "the first road", zh: "最初的道路", es: "el primer camino", fr: "la première route", ja: "最初の道" }, speed: 4.8, routeFactor: 1.28, handling: .2, color: 0xf1c69c },
  pigeon: { glyph: "◇", names: { en: "Homing pigeon", zh: "信鸽", es: "Paloma mensajera", fr: "Pigeon voyageur", ja: "伝書鳩" }, era: { en: "wind & instinct", zh: "风与本能", es: "viento e instinto", fr: "vent et instinct", ja: "風と本能" }, speed: 72, routeFactor: 1.06, handling: .5, color: 0xe7edf4 },
  carriage: { glyph: "◉", names: { en: "Mail carriage", zh: "邮驿马车", es: "Coche de correo", fr: "Malle-poste", ja: "郵便馬車" }, era: { en: "lantern roads", zh: "提灯照亮的驿道", es: "caminos de farol", fr: "routes aux lanternes", ja: "ランタンの街道" }, speed: 13, routeFactor: 1.35, handling: 1.5, color: 0xd9a260 },
  rail: { glyph: "▰", names: { en: "Night mail train", zh: "夜行邮政列车", es: "Tren postal", fr: "Train postal", ja: "夜行郵便列車" }, era: { en: "iron & midnight", zh: "钢铁与午夜", es: "hierro y medianoche", fr: "fer et minuit", ja: "鉄と真夜中" }, speed: 105, routeFactor: 1.22, handling: 2, color: 0xc68e61 },
  plane: { glyph: "✈", names: { en: "Airmail", zh: "航空邮件", es: "Correo aéreo", fr: "Poste aérienne", ja: "航空便" }, era: { en: "above the weather", zh: "飞越天气", es: "sobre el clima", fr: "au-dessus du temps", ja: "雲の上" }, speed: 820, routeFactor: 1.08, handling: 4, color: 0x9ec9e8 },
  rocket: { glyph: "↑", names: { en: "Orbital rocket", zh: "轨道火箭", es: "Cohete orbital", fr: "Fusée orbitale", ja: "軌道ロケット" }, era: { en: "edge of Earth", zh: "掠过地球边缘", es: "borde de la Tierra", fr: "lisière de la Terre", ja: "地球の縁" }, speed: 27000, routeFactor: 1.42, handling: 8, color: 0xffb16f },
  starship: { glyph: "✦", names: { en: "Kindship", zh: "星际飞船", es: "Nave Kindship", fr: "Vaisseau Kindship", ja: "星間船" }, era: { en: "a future route", zh: "来自未来的航线", es: "una ruta futura", fr: "une route future", ja: "未来の航路" }, speed: 46000, routeFactor: 1.6, handling: .3, color: 0xb99cff },
};

const TRANSPORT_ORDER = Object.keys(TRANSPORTS) as CourierMode[];

const COURIER_COACH_KEY = "kindchain-courier-coach-done";

// v46: the KindChain courier fleet is self-hosted — our own Blender-built
// models (purple/gold/pearl family, heart badges, named animation clips)
// served from /public/models. Only the future-era Kindship still borrows a
// third-party model until its own design lands.
const COURIER_ASSETS: Partial<Record<CourierMode, string[]>> = {
  hand: ["/KC_WALKING_MAIL_CARRIER_LOD0.glb"],
  pigeon: ["/KC_DOVE_LOD0.glb"],
  carriage: ["/KC_POSTAL_STAGECOACH_LOD0.glb"],
  rail: ["/KC_TRAIN_LOD0.glb"],
  plane: ["/KC_AIRPLANE_LOD0.glb"],
  rocket: ["/KC_ROCKET_LOD0.glb"],
  starship: ["https://static.poly.pizza/0843ab59-1800-4d96-9cc7-b4d6afbecf21.glb"],
};

// Which named clips (from our GLBs) should loop while a courier travels.
const COURIER_CLIPS: Partial<Record<CourierMode, string[]>> = {
  hand: ["Walk_Loop"],
  pigeon: ["Wing_Flap"],
  carriage: ["Travel_Loop", "Lantern_Pulse"],
  rail: ["Wheel_Loop", "Rod_Loop"],
  plane: ["Idle_Flight", "Engine_Loop"],
  rocket: ["Flame_Loop", "Idle_Hover"],
};

const INITIAL_STORIES: Story[] = [
  {
    id: "ca-1", chain: "aurora", lat: 53.55, lon: -113.49, region: "Edmonton", country: "Canada", lang: "en",
    text: "I made it through today. That is all I have, but it is something.", kind: "light",
    translations: { zh: "我熬过了今天。虽然我只有这么多，但这本身已经是一件事。", es: "Logré superar el día. Es todo lo que tengo, pero es algo.", fr: "J'ai traversé cette journée. C'est tout ce que j'ai, mais c'est déjà quelque chose.", ja: "今日をなんとか越えた。それだけだけど、それでも意味はある。" },
    replies: [
      { id: "r1", lang: "ja", text: "今日を越えたあなたに、静かな拍手を送ります。", translations: { en: "A quiet round of applause for making it through today.", zh: "为熬过今天的你，送上一阵安静的掌声。" } },
      { id: "r2", lang: "fr", text: "Je suis heureux que tu sois encore ici.", translations: { en: "I am glad you are still here.", zh: "我很高兴你仍然在这里。" } },
    ],
  },
  {
    id: "kr-1", chain: "aurora", lat: 37.57, lon: 126.98, region: "Seoul", country: "Korea", lang: "en",
    text: "오늘 아무것도 해내지 못했어도, 살아낸 것만으로 충분해요.",
    translations: { en: "Even if you accomplished nothing today, surviving it was enough.", zh: "即使今天什么都没有完成，能够熬过来就已经足够。", es: "Aunque hoy no hayas logrado nada, sobrevivir fue suficiente.", fr: "Même si tu n'as rien accompli aujourd'hui, avoir tenu bon suffit.", ja: "今日何もできなかったとしても、生き抜いただけで十分です。" },
    replies: [{ id: "r3", lang: "es", text: "Gracias. Necesitaba leer esto esta noche.", translations: { en: "Thank you. I needed to read this tonight.", zh: "谢谢你，今晚我正需要读到这句话。" } }],
  },
  {
    id: "mx-1", chain: "aurora", lat: 19.43, lon: -99.13, region: "Ciudad de México", country: "Mexico", lang: "es",
    text: "No necesito consejos. Solo necesito que alguien sepa que lo estoy intentando.",
    translations: { en: "I do not need advice. I just need someone to know I am trying.", zh: "我不需要建议，只希望有人知道我真的在努力。", fr: "Je n'ai pas besoin de conseils. J'ai seulement besoin que quelqu'un sache que j'essaie.", ja: "アドバイスはいらない。ただ、頑張っていることを誰かに知ってほしい。" },
    replies: [{ id: "r4", lang: "en", text: "I see the effort. You do not have to prove it here.", translations: { zh: "我看见你的努力了。在这里，你不需要证明什么。", es: "Veo tu esfuerzo. Aquí no tienes que demostrar nada." } }],
  },
  {
    id: "ke-1", chain: "aurora", lat: -1.29, lon: 36.82, region: "Nairobi", country: "Kenya", lang: "en",
    text: "The version of you that is tired is still worthy of tenderness.",
    translations: { zh: "那个疲惫的你，依然值得被温柔对待。", es: "La versión cansada de ti también merece ternura.", fr: "La version fatiguée de toi mérite toujours de la tendresse.", ja: "疲れているあなたも、やさしくされる価値がある。" }, replies: [],
  },
  {
    id: "jp-1", chain: "moon-thread", lat: 43.06, lon: 141.35, region: "Sapporo", country: "Japan", lang: "ja",
    text: "雪の朝は静かすぎて寂しい。でも、どこかの誰かも同じ空を見ていると思いたい。",
    translations: { en: "Snowy mornings are so quiet they feel lonely. I want to believe someone somewhere is looking at the same sky.", zh: "雪天的清晨安静得让人孤独。我愿意相信，某个地方也有人望着同一片天空。", es: "Las mañanas de nieve son tan silenciosas que dan soledad. Quiero creer que alguien mira el mismo cielo.", fr: "Les matins de neige sont si silencieux qu'ils semblent solitaires. Je veux croire que quelqu'un regarde le même ciel." }, replies: [],
  },
  {
    id: "fr-1", chain: "moon-thread", lat: 45.76, lon: 4.84, region: "Lyon", country: "France", lang: "fr",
    text: "J'aimerais recevoir une carte postale pour mon anniversaire. Rien de grand, juste une preuve que le monde m'a vu.", kind: "wish",
    translations: { en: "I would love a postcard for my birthday. Nothing big—just proof that the world saw me.", zh: "生日时，我想收到一张明信片。不需要贵重，只想知道世界曾经看见我。", es: "Me gustaría recibir una postal por mi cumpleaños. Nada grande, solo una prueba de que el mundo me vio.", ja: "誕生日にポストカードがほしい。大きなものではなく、世界が私を見つけてくれた証として。" }, replies: [],
  },
  {
    id: "au-1", chain: "moon-thread", lat: -33.87, lon: 151.21, region: "Sydney", country: "Australia", lang: "en",
    text: "The sun is rising here. I can lend you a little morning until yours arrives.",
    translations: { zh: "我这里太阳正在升起。在你的清晨到来之前，我可以先借给你一点光。", es: "Aquí está amaneciendo. Puedo prestarte un poco de mañana hasta que llegue la tuya.", fr: "Le soleil se lève ici. Je peux te prêter un peu de matin jusqu'à ce que le tien arrive.", ja: "こちらでは朝日が昇っています。あなたの朝が来るまで、少しだけ光を貸します。" }, replies: [],
  },
  {
    id: "br-1", chain: "ember", lat: -23.55, lon: -46.63, region: "São Paulo", country: "Brazil", lang: "es",
    text: "Hoje foi pesado. Deixo aqui uma pequena esperança para quem passar depois de mim.",
    translations: { en: "Today was heavy. I am leaving a small hope here for whoever passes after me.", zh: "今天很沉重。我在这里留下一点希望，给下一个经过的人。", fr: "Aujourd'hui était lourd. Je laisse ici un peu d'espoir pour la prochaine personne.", ja: "今日は重い一日だった。次にここを通る人へ、小さな希望を置いていきます。" }, replies: [],
  },
];

// Explicitly marked experience data so the visual system can be felt before a
// real multi-user activity feed is connected. Local text events are merged in
// immediately; unlocated events never invent a region.
const DEMO_ACTIVITY_SEED = [
  { cellId: "demo-edmonton", centroidLat: 53.55, centroidLon: -113.49, regionLabel: "Edmonton", uniquePublishers: 420, textCount: 312, lightCount: 180, wishCount: 44, replyCount: 88, recentCount: 16, ageMinutes: 2 },
  { cellId: "demo-vancouver", centroidLat: 49.28, centroidLon: -123.12, regionLabel: "Vancouver", uniquePublishers: 560, textCount: 410, lightCount: 238, wishCount: 52, replyCount: 120, recentCount: 21, ageMinutes: 1 },
  { cellId: "demo-mexico", centroidLat: 19.43, centroidLon: -99.13, regionLabel: "Ciudad de México", uniquePublishers: 780, textCount: 590, lightCount: 350, wishCount: 70, replyCount: 170, recentCount: 30, ageMinutes: 3 },
  { cellId: "demo-sao-paulo", centroidLat: -23.55, centroidLon: -46.63, regionLabel: "São Paulo", uniquePublishers: 820, textCount: 612, lightCount: 356, wishCount: 66, replyCount: 190, recentCount: 28, ageMinutes: 2 },
  { cellId: "demo-buenos-aires", centroidLat: -34.60, centroidLon: -58.38, regionLabel: "Buenos Aires", uniquePublishers: 390, textCount: 285, lightCount: 170, wishCount: 33, replyCount: 82, recentCount: 12, ageMinutes: 6 },
  { cellId: "demo-london", centroidLat: 51.51, centroidLon: -0.13, regionLabel: "London", uniquePublishers: 700, textCount: 520, lightCount: 310, wishCount: 55, replyCount: 155, recentCount: 24, ageMinutes: 4 },
  { cellId: "demo-lyon", centroidLat: 45.76, centroidLon: 4.84, regionLabel: "Lyon", uniquePublishers: 360, textCount: 266, lightCount: 154, wishCount: 38, replyCount: 74, recentCount: 11, ageMinutes: 7 },
  { cellId: "demo-lagos", centroidLat: 6.52, centroidLon: 3.38, regionLabel: "Lagos", uniquePublishers: 560, textCount: 405, lightCount: 247, wishCount: 46, replyCount: 112, recentCount: 19, ageMinutes: 5 },
  { cellId: "demo-nairobi", centroidLat: -1.29, centroidLon: 36.82, regionLabel: "Nairobi", uniquePublishers: 430, textCount: 318, lightCount: 190, wishCount: 38, replyCount: 90, recentCount: 15, ageMinutes: 3 },
  { cellId: "demo-cairo", centroidLat: 30.04, centroidLon: 31.24, regionLabel: "Cairo", uniquePublishers: 420, textCount: 304, lightCount: 190, wishCount: 31, replyCount: 83, recentCount: 14, ageMinutes: 8 },
  { cellId: "demo-mumbai", centroidLat: 19.08, centroidLon: 72.88, regionLabel: "Mumbai", uniquePublishers: 780, textCount: 584, lightCount: 341, wishCount: 71, replyCount: 172, recentCount: 27, ageMinutes: 1 },
  { cellId: "demo-seoul", centroidLat: 37.57, centroidLon: 126.98, regionLabel: "Seoul", uniquePublishers: 760, textCount: 576, lightCount: 330, wishCount: 68, replyCount: 178, recentCount: 31, ageMinutes: 1 },
  { cellId: "demo-tokyo", centroidLat: 35.68, centroidLon: 139.69, regionLabel: "Tokyo", uniquePublishers: 850, textCount: 642, lightCount: 373, wishCount: 79, replyCount: 190, recentCount: 34, ageMinutes: 2 },
  { cellId: "demo-sapporo", centroidLat: 43.06, centroidLon: 141.35, regionLabel: "Sapporo", uniquePublishers: 270, textCount: 198, lightCount: 115, wishCount: 28, replyCount: 55, recentCount: 9, ageMinutes: 9 },
  { cellId: "demo-singapore", centroidLat: 1.35, centroidLon: 103.82, regionLabel: "Singapore", uniquePublishers: 520, textCount: 386, lightCount: 225, wishCount: 51, replyCount: 110, recentCount: 18, ageMinutes: 4 },
  { cellId: "demo-sydney", centroidLat: -33.87, centroidLon: 151.21, regionLabel: "Sydney", uniquePublishers: 480, textCount: 354, lightCount: 210, wishCount: 44, replyCount: 100, recentCount: 17, ageMinutes: 5 },
  { cellId: "demo-auckland", centroidLat: -36.85, centroidLon: 174.76, regionLabel: "Auckland", uniquePublishers: 180, textCount: 128, lightCount: 74, wishCount: 18, replyCount: 36, recentCount: 6, ageMinutes: 12 },
  { cellId: "demo-reykjavik", centroidLat: 64.15, centroidLon: -21.94, regionLabel: "Reykjavík", uniquePublishers: 120, textCount: 88, lightCount: 51, wishCount: 12, replyCount: 25, recentCount: 4, ageMinutes: 14 },
  { cellId: "demo-jakarta", centroidLat: -6.21, centroidLon: 106.85, regionLabel: "Jakarta", uniquePublishers: 600, textCount: 448, lightCount: 260, wishCount: 60, replyCount: 128, recentCount: 22, ageMinutes: 3 },
] as const;

const WORLD_MESSENGER_COUNTS: Record<CourierMode, number> = {
  hand: 32, pigeon: 74, carriage: 24, rail: 38, plane: 67, rocket: 29, starship: 22,
};

const EXPERIENCE_MEMORIES = [
  { id: "mother-light", year: "2019", zh: "留给妈妈的光", en: "A light kept for Mum", className: "memory-north" },
  { id: "old-promise", year: "2022", zh: "那年的约定", en: "The promise we kept", className: "memory-west" },
  { id: "we-were-here", year: "2026", zh: "我们曾在这里", en: "We were here", className: "memory-east" },
] as const;

const COLOR_BY_CHAIN: Record<string, number> = { aurora: 0xbda2ff, "moon-thread": 0xffd99d, ember: 0xff9f81, new: 0x8de6d0 };

function chainColor(chain: string) {
  if (COLOR_BY_CHAIN[chain]) return COLOR_BY_CHAIN[chain];
  const hue = stableHash(chain) % 360;
  const saturation = 58 + (stableHash(`${chain}-s`) % 17);
  const lightness = 68 + (stableHash(`${chain}-l`) % 12);
  const h = hue / 360;
  const s = saturation / 100;
  const l = lightness / 100;
  const a = s * Math.min(l, 1 - l);
  const channel = (n: number) => {
    const k = (n + h * 12) % 12;
    return l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
  };
  return (Math.round(channel(0) * 255) << 16) | (Math.round(channel(8) * 255) << 8) | Math.round(channel(4) * 255);
}

function latLonVector(THREE: ThreeModule, lat: number, lon: number, radius = 2.22) {
  const phi = THREE.MathUtils.degToRad(90 - lat);
  const theta = THREE.MathUtils.degToRad(lon);
  return new THREE.Vector3(
    radius * Math.sin(phi) * Math.sin(theta),
    radius * Math.cos(phi),
    radius * Math.sin(phi) * Math.cos(theta),
  );
}

function vectorLatLon(vector: import("three").Vector3) {
  const unit = vector.clone().normalize();
  return {
    lat: 90 - Math.acos(unit.y) * 180 / Math.PI,
    lon: Math.atan2(unit.x, unit.z) * 180 / Math.PI,
  };
}

const FALLBACK_MAP_SCALE_X = 2.05;
const FALLBACK_LONGITUDE_SPAN = 360 / FALLBACK_MAP_SCALE_X;

function wrapLongitude(lon: number) {
  return ((lon + 540) % 360) - 180;
}

function fallbackBackgroundX(lon: number) {
  const textureX = (wrapLongitude(lon) + 180) / 360;
  return ((FALLBACK_MAP_SCALE_X * textureX - .5) / (FALLBACK_MAP_SCALE_X - 1)) * 100;
}

function fallbackProjectedPoint(lat: number, lon: number, focusLon: number) {
  const deltaLon = wrapLongitude(lon - focusLon);
  return {
    visible: Math.abs(deltaLon) <= FALLBACK_LONGITUDE_SPAN / 2 + 3,
    x: 50 + deltaLon / FALLBACK_LONGITUDE_SPAN * 100,
    y: (90 - lat) / 180 * 100,
  };
}

function stableHash(value: string) {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function createLocalId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function activityIntensity(uniquePublishers: number) {
  if (uniquePublishers <= 0) return 0;
  const q = Math.min(1, Math.log1p(uniquePublishers) / Math.log1p(1400));
  const eased = q * q;
  const privacyFactor = uniquePublishers === 1 ? .65 : uniquePublishers === 2 ? .82 : 1;
  return privacyFactor * (.06 + .94 * eased);
}

function activityBand(intensity: number): ActivityBand {
  if (intensity < .14) return "quiet";
  if (intensity < .38) return "glimmer";
  if (intensity < .76) return "radiant";
  return "surge";
}

function activityOriginFor(point: { lat: number; lon: number }, label: string): ActivityOrigin {
  const latStep = 2.5;
  const lonStep = 2.5;
  const latIndex = Math.floor((point.lat + 90) / latStep);
  const lonIndex = Math.floor((point.lon + 180) / lonStep);
  return {
    cellId: `cell-${latIndex}-${lonIndex}`,
    centroidLat: Math.max(-88.75, Math.min(88.75, latIndex * latStep - 90 + latStep / 2)),
    centroidLon: lonIndex * lonStep - 180 + lonStep / 2,
    regionLabel: label,
  };
}

function buildDailyActivity(stories: Story[], current: number): DailyActivitySnapshot {
  type MutableCell = { cell: DailyRegionActivity; authors: Set<string>; simulatedPublishers: number };
  const cells = new Map<string, MutableCell>();
  const rollingStart = current - 24 * 3600000;
  let globalUnlocated = 0;

  DEMO_ACTIVITY_SEED.forEach((seed) => {
    const intensity = activityIntensity(seed.uniquePublishers);
    cells.set(seed.cellId, {
      authors: new Set<string>(),
      simulatedPublishers: seed.uniquePublishers,
      cell: {
        cellId: seed.cellId,
        centroidLat: seed.centroidLat,
        centroidLon: seed.centroidLon,
        regionLabel: seed.regionLabel,
        uniquePublishers: seed.uniquePublishers,
        textCount: seed.textCount,
        lightCount: seed.lightCount,
        wishCount: seed.wishCount,
        replyCount: seed.replyCount,
        recentCount: seed.recentCount,
        lastPublishedAt: current - seed.ageMinutes * 60000,
        intensity,
        band: activityBand(intensity),
        sample: true,
      },
    });
  });

  const addEvent = (origin: ActivityOrigin | undefined, authorKey: string | undefined, id: string, kind: "light" | "wish" | "reply", createdAt: number | undefined) => {
    if (!createdAt || createdAt < rollingStart || createdAt > current + 60000) return;
    if (!origin) { globalUnlocated += 1; return; }
    let entry = cells.get(origin.cellId);
    if (!entry) {
      entry = {
        authors: new Set<string>(),
        simulatedPublishers: 0,
        cell: {
          cellId: origin.cellId,
          centroidLat: origin.centroidLat,
          centroidLon: origin.centroidLon,
          regionLabel: origin.regionLabel,
          uniquePublishers: 0,
          textCount: 0,
          lightCount: 0,
          wishCount: 0,
          replyCount: 0,
          recentCount: 0,
          lastPublishedAt: createdAt,
          intensity: 0,
          band: "quiet",
          sample: false,
        },
      };
      cells.set(origin.cellId, entry);
    }
    entry.authors.add(authorKey || id);
    entry.cell.textCount += 1;
    if (kind === "reply") entry.cell.replyCount += 1;
    else if (kind === "wish") entry.cell.wishCount += 1;
    else entry.cell.lightCount += 1;
    if (current - createdAt <= 15 * 60000) entry.cell.recentCount += 1;
    entry.cell.lastPublishedAt = Math.max(entry.cell.lastPublishedAt, createdAt);
  };

  stories.forEach((story) => {
    addEvent(story.origin, story.authorDayKey, story.id, story.kind === "wish" ? "wish" : "light", story.createdAt);
    story.replies.forEach((reply) => addEvent(reply.origin, reply.authorDayKey, reply.id, "reply", reply.createdAt));
  });

  const resolved = [...cells.values()].map(({ cell, authors, simulatedPublishers }) => {
    const uniquePublishers = simulatedPublishers + authors.size;
    const intensity = activityIntensity(uniquePublishers);
    return { ...cell, uniquePublishers, intensity, band: activityBand(intensity) };
  }).sort((a, b) => b.intensity - a.intensity || a.cellId.localeCompare(b.cellId));
  const signature = resolved.map((cell) => `${cell.cellId}:${cell.uniquePublishers}:${cell.textCount}:${cell.recentCount}`).join("|");
  return { version: stableHash(signature).toString(36), generatedAt: current, cells: resolved, globalUnlocated };
}

function rasterizeActivityMap(snapshot: DailyActivitySnapshot, width: number, height: number) {
  const data = new Uint8Array(width * height * 4);
  const merge = (oldValue: number, contribution: number) => Math.round(255 * (1 - (1 - oldValue / 255) * (1 - Math.max(0, Math.min(1, contribution)))));
  snapshot.cells.forEach((cell) => {
    if (cell.intensity <= 0) return;
    const centerX = ((cell.centroidLon + 180) / 360) * width;
    const centerY = ((cell.centroidLat + 90) / 180) * height;
    const radiusY = 2.2 + cell.intensity * 4.6;
    const radiusX = Math.min(12, radiusY / Math.max(.42, Math.cos(cell.centroidLat * Math.PI / 180)));
    const wishRatio = cell.textCount ? cell.wishCount / cell.textCount : 0;
    const replyRatio = cell.textCount ? cell.replyCount / cell.textCount : 0;
    const freshness = Math.min(1, cell.recentCount / Math.max(1, Math.min(5, cell.uniquePublishers)));
    const minX = Math.floor(centerX - radiusX * 2.25);
    const maxX = Math.ceil(centerX + radiusX * 2.25);
    const minY = Math.max(0, Math.floor(centerY - radiusY * 2.25));
    const maxY = Math.min(height - 1, Math.ceil(centerY + radiusY * 2.25));
    for (let y = minY; y <= maxY; y++) {
      for (let x = minX; x <= maxX; x++) {
        const dx = (x - centerX) / radiusX;
        const dy = (y - centerY) / radiusY;
        const gaussian = Math.exp(-(dx * dx + dy * dy) * 1.75);
        if (gaussian < .012) continue;
        const wrappedX = ((x % width) + width) % width;
        const index = (y * width + wrappedX) * 4;
        data[index] = merge(data[index], cell.intensity * gaussian);
        data[index + 1] = merge(data[index + 1], wishRatio * gaussian);
        data[index + 2] = merge(data[index + 2], replyRatio * gaussian);
        data[index + 3] = merge(data[index + 3], freshness * gaussian);
      }
    }
  });
  return data;
}

function createActivityTexture(THREE: ThreeModule, snapshot: DailyActivitySnapshot, width: number) {
  const height = width / 2;
  const texture = new THREE.DataTexture(rasterizeActivityMap(snapshot, width, height), width, height, THREE.RGBAFormat);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearFilter;
  texture.generateMipmaps = false;
  texture.needsUpdate = true;
  return texture;
}

function createLocalEarthTexture(THREE: ThreeModule, width: number) {
  const height = Math.round(width / 2);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) return new THREE.Texture();

  const ocean = context.createLinearGradient(0, 0, 0, height);
  ocean.addColorStop(0, "#173a59");
  ocean.addColorStop(.48, "#0b3553");
  ocean.addColorStop(1, "#08233d");
  context.fillStyle = ocean;
  context.fillRect(0, 0, width, height);

  const projection = geoEquirectangular().translate([width / 2, height / 2]).scale(width / (2 * Math.PI));
  const path = geoPath(projection, context);
  const land = context.createLinearGradient(0, height * .12, 0, height * .88);
  land.addColorStop(0, "#7b8c70");
  land.addColorStop(.5, "#4c765f");
  land.addColorStop(1, "#86765f");
  context.beginPath();
  landFeatures.forEach((country) => { path(country); });
  context.fillStyle = land;
  context.fill();
  context.strokeStyle = "rgba(190,220,205,.22)";
  context.lineWidth = Math.max(.45, width / 2400);
  context.stroke();

  const polar = context.createLinearGradient(0, 0, 0, height);
  polar.addColorStop(0, "rgba(223,239,239,.9)");
  polar.addColorStop(.12, "rgba(208,227,228,.16)");
  polar.addColorStop(.25, "rgba(255,255,255,0)");
  polar.addColorStop(.75, "rgba(255,255,255,0)");
  polar.addColorStop(.9, "rgba(217,233,234,.18)");
  polar.addColorStop(1, "rgba(232,242,242,.94)");
  context.fillStyle = polar;
  context.fillRect(0, 0, width, height);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.needsUpdate = true;
  return texture;
}

function subsolarPoint(date = new Date()) {
  const start = Date.UTC(date.getUTCFullYear(), 0, 0);
  const day = Math.floor((date.getTime() - start) / 86400000);
  const declination = 23.44 * Math.sin((Math.PI * 2 * (day - 80)) / 365.2422);
  const utcHours = date.getUTCHours() + date.getUTCMinutes() / 60 + date.getUTCSeconds() / 3600;
  let lon = 180 - utcHours * 15;
  if (lon > 180) lon -= 360;
  if (lon < -180) lon += 360;
  return { lat: declination, lon };
}

function solarPhaseAt(lat: number, lon: number, date = new Date()): TimePhase {
  const solar = subsolarPoint(date);
  const toRad = Math.PI / 180;
  const solarDot = Math.sin(lat * toRad) * Math.sin(solar.lat * toRad)
    + Math.cos(lat * toRad) * Math.cos(solar.lat * toRad) * Math.cos((lon - solar.lon) * toRad);
  const altitude = Math.asin(Math.max(-1, Math.min(1, solarDot))) / toRad;
  if (altitude > 6) return "day";
  if (altitude < -6) return "night";
  const hourAngle = ((lon - solar.lon + 540) % 360) - 180;
  return hourAngle < 0 ? "dawn" : "dusk";
}

function isLandPoint(lat: number, lon: number) {
  return landFeatures.some((country) => geoContains(country, [lon, lat]));
}

function zoneFor(lat: number, lon: number): RegionZone {
  if (!isLandPoint(lat, lon)) return "open-ocean";
  if (Math.abs(lat) >= 66) return "arctic";
  if (inBox(lat, lon, 12, 38, -18, 66) || inBox(lat, lon, 34, 48, 72, 118) || inBox(lat, lon, -34, -18, 114, 145)) return "desert-belt";
  if (inBox(lat, lon, -56, 14, -82, -66)) return "andes";
  if (inBox(lat, lon, 5, 65, 60, 151)) return "east-asia";
  if (inBox(lat, lon, 28, 64, -13, 45)) return "mediterranean";
  if (inBox(lat, lon, -36, 24, -19, 55)) return Math.abs(lat) < 12 ? "tropical-isles" : "savanna";
  if (inBox(lat, lon, 14, 72, -168, -50)) return lat < 33 && lon < -95 ? "desert-belt" : "northern-lakes";
  if (inBox(lat, lon, -56, 14, -66, -34)) return Math.abs(lat) < 24 ? "tropical-isles" : "savanna";
  if (inBox(lat, lon, -46, -10, 110, 155)) return "desert-belt";
  if (Math.abs(lat) < 27 && (Math.abs(lon) > 65 || Math.abs(lon) < 55)) return "tropical-isles";
  return "open-ocean";
}

const CURATED_PLACE_PROFILES: Array<PlaceProfile & { lat: number; lon: number; aliases: string[] }> = [
  {
    id: "edmonton-river-valley", zone: "northern-lakes", lat: 53.55, lon: -113.49, aliases: ["edmonton"], confidence: "curated",
    title: { zh: "北方河谷与长天", en: "Northern river valley" }, signature: { zh: "低远草原 · 河谷凹面 · 白杨与针叶林边缘", en: "Long prairie horizon · river valley · aspen and spruce edge" },
    palette: { zenith: "#07152a", horizon: "#3b5369", far: "#1b3440", near: "#06191d", water: "#6fa2ae", glow: "#e2b46f" },
  },
  {
    id: "seoul-river-basin", zone: "east-asia", lat: 37.57, lon: 126.98, aliases: ["seoul", "서울"], confidence: "curated",
    title: { zh: "河流盆地与环城山脊", en: "River basin and mountain rim" }, signature: { zh: "湿润空气 · 层叠山脊 · 珍珠色城市光网", en: "Humid air · layered ridges · pearl city-light lattice" },
    palette: { zenith: "#091423", horizon: "#5d586a", far: "#313849", near: "#101b27", water: "#9fb3bd", glow: "#e7cfaa" },
  },
  {
    id: "mexico-volcanic-basin", zone: "desert-belt", lat: 19.43, lon: -99.13, aliases: ["méxico", "mexico city", "ciudad de méxico"], confidence: "curated",
    title: { zh: "高原火山盆地", en: "High volcanic basin" }, signature: { zh: "层叠深色山脊 · 高海拔薄雾 · 琥珀城市光毯", en: "Layered dark ridges · high-altitude haze · amber light field" },
    palette: { zenith: "#101326", horizon: "#725149", far: "#3d3540", near: "#171724", water: "#7e818b", glow: "#e0a15c" },
  },
  {
    id: "nairobi-highland", zone: "savanna", lat: -1.29, lon: 36.82, aliases: ["nairobi"], confidence: "curated",
    title: { zh: "赤道高地与辽阔天空", en: "Equatorial highland sky" }, signature: { zh: "高地平台 · 克制红土空气色 · 稀疏暖灯", en: "Highland plateau · restrained red-earth air · sparse warm lamps" },
    palette: { zenith: "#071827", horizon: "#725946", far: "#3d4334", near: "#171d19", water: "#6f8a83", glow: "#e6b46d" },
  },
  {
    id: "sapporo-snow-basin", zone: "east-asia", lat: 43.06, lon: 141.35, aliases: ["sapporo", "札幌"], confidence: "curated",
    title: { zh: "雪盆地与山框", en: "Snow basin and mountain frame" }, signature: { zh: "蓝色雪面反光 · 环抱山脊 · 密集温暖窗灯", en: "Blue snow reflection · enclosing ridges · warm window field" },
    palette: { zenith: "#071426", horizon: "#607a91", far: "#43576a", near: "#162735", water: "#b4d3dd", glow: "#f1c47a" },
  },
  {
    id: "lyon-river-confluence", zone: "mediterranean", lat: 45.76, lon: 4.84, aliases: ["lyon"], confidence: "curated",
    title: { zh: "双河汇流与低丘", en: "Two rivers and low hills" }, signature: { zh: "淡石灰岩色 · 低缓丘线 · 金色水面碎光", en: "Pale limestone · low hill line · fractured gold on water" },
    palette: { zenith: "#0c1422", horizon: "#6b5b5a", far: "#46424a", near: "#1c2025", water: "#9d8872", glow: "#edc17d" },
  },
  {
    id: "sydney-sandstone-coast", zone: "open-ocean", lat: -33.87, lon: 151.21, aliases: ["sydney"], confidence: "curated",
    title: { zh: "砂岩海岸与水天线", en: "Sandstone coast and open water" }, signature: { zh: "冷青海面 · 海雾 · 低缓砂岩岸线", en: "Cool-cyan water · sea haze · low sandstone edge" },
    palette: { zenith: "#071728", horizon: "#476c78", far: "#314e58", near: "#10242b", water: "#71aebb", glow: "#e4bd7e" },
  },
  {
    id: "sao-paulo-humid-plateau", zone: "tropical-isles", lat: -23.55, lon: -46.63, aliases: ["são paulo", "sao paulo"], confidence: "curated",
    title: { zh: "湿润高原与巨大灯场", en: "Humid plateau and vast light field" }, signature: { zh: "绿灰空气 · 层积云体量 · 细密琥珀灯网", en: "Green-grey air · towering clouds · dense amber light lattice" },
    palette: { zenith: "#07171d", horizon: "#445d57", far: "#2d423e", near: "#111e1d", water: "#668e8b", glow: "#dca060" },
  },
];

const REGIONAL_PLACE_PROFILES: Record<RegionZone, PlaceProfile> = {
  "northern-lakes": { id: "boreal-horizon", zone: "northern-lakes", confidence: "regional", title: { zh: "北方森林与湖泊", en: "Boreal lakes" }, signature: { zh: "长天际线 · 林缘 · 冷水反光", en: "Long horizon · forest edge · cold water reflection" }, palette: { zenith: "#07152a", horizon: "#425a6b", far: "#223a44", near: "#071b20", water: "#75a6b0", glow: "#ddb16e" } },
  arctic: { id: "polar-tundra", zone: "arctic", confidence: "regional", title: { zh: "极地冻原", en: "Polar tundra" }, signature: { zh: "低日光 · 冰原折线 · 蓝白反射", en: "Low sun · ice-plane geometry · blue-white reflection" }, palette: { zenith: "#071527", horizon: "#5f8395", far: "#587887", near: "#172c35", water: "#b9dbe3", glow: "#d9efe7" } },
  "east-asia": { id: "monsoon-ridges", zone: "east-asia", confidence: "regional", title: { zh: "季风平原与山海", en: "Monsoon plains and ridges" }, signature: { zh: "层叠山线 · 湿润空气 · 细密城光", en: "Layered ridges · humid air · fine city lights" }, palette: { zenith: "#081522", horizon: "#525b65", far: "#35424b", near: "#111f24", water: "#829ea5", glow: "#dfbc80" } },
  mediterranean: { id: "temperate-riverlands", zone: "mediterranean", confidence: "regional", title: { zh: "温带河谷与石岸", en: "Temperate riverlands" }, signature: { zh: "低丘 · 石灰色地表 · 金色水光", en: "Low hills · pale stone · gold water glint" }, palette: { zenith: "#0a1524", horizon: "#685b5a", far: "#454047", near: "#1b2025", water: "#8f8374", glow: "#e4bd76" } },
  savanna: { id: "highland-plain", zone: "savanna", confidence: "regional", title: { zh: "高地与开阔平原", en: "Highland plain" }, signature: { zh: "开阔天穹 · 平台地形 · 稀疏灯火", en: "Open sky · plateau geometry · sparse warm lights" }, palette: { zenith: "#081725", horizon: "#705a48", far: "#454534", near: "#1b211a", water: "#718984", glow: "#dfab66" } },
  "desert-belt": { id: "arid-plateau", zone: "desert-belt", confidence: "regional", title: { zh: "干旱高原", en: "Arid plateau" }, signature: { zh: "远山折线 · 干燥空气 · 克制暖色地平线", en: "Distant folded ridge · dry air · restrained warm horizon" }, palette: { zenith: "#0b1423", horizon: "#785244", far: "#513c38", near: "#211b1d", water: "#83796f", glow: "#dc9c5b" } },
  "tropical-isles": { id: "humid-basin", zone: "tropical-isles", confidence: "regional", title: { zh: "湿热盆地与海岸", en: "Humid basin and coast" }, signature: { zh: "厚云体量 · 深绿地平线 · 潮湿反光", en: "Cloud volume · deep-green horizon · humid reflections" }, palette: { zenith: "#06161f", horizon: "#3f625d", far: "#2b4942", near: "#0c211e", water: "#65a29d", glow: "#dda65f" } },
  andes: { id: "mountain-cordillera", zone: "andes", confidence: "regional", title: { zh: "高山纵谷", en: "Mountain cordillera" }, signature: { zh: "多层山脊 · 高海拔空气 · 深色纵谷", en: "Layered ridges · high air · deep longitudinal valleys" }, palette: { zenith: "#081426", horizon: "#5c5962", far: "#454c5b", near: "#171c29", water: "#778a9b", glow: "#dfae69" } },
  "open-ocean": { id: "open-water", zone: "open-ocean", confidence: "regional", title: { zh: "开阔海洋", en: "Open ocean" }, signature: { zh: "无尽水天线 · 低云 · 冷青反光", en: "Long waterline · low cloud · cool-cyan reflection" }, palette: { zenith: "#06162a", horizon: "#3d6677", far: "#244654", near: "#071c28", water: "#68aabc", glow: "#d6b57b" } },
};

const CHINA_PLACE_PROFILES: Record<"plateau" | "north" | "riverlands" | "south" | "coast", PlaceProfile> = {
  plateau: { id: "china-western-plateau", zone: "east-asia", confidence: "regional", title: { zh: "高原星河与雪脊", en: "Plateau starlight and snow ridges" }, signature: { zh: "高海拔蓝影 · 雪脊 · 遥远湖光", en: "High-altitude blue · snow ridges · distant lake light" }, palette: { zenith: "#06152b", horizon: "#526f83", far: "#405365", near: "#101d29", water: "#8fc9d4", glow: "#efd3a0" } },
  north: { id: "china-northern-rivers", zone: "east-asia", confidence: "regional", title: { zh: "北方长天与河山", en: "Northern rivers under a wide sky" }, signature: { zh: "辽阔天际 · 深色山脊 · 河流与城光", en: "Wide horizon · dark ridges · river and city light" }, palette: { zenith: "#07172a", horizon: "#666b72", far: "#3d4650", near: "#111b22", water: "#91abb3", glow: "#ecc486" } },
  riverlands: { id: "china-central-riverlands", zone: "east-asia", confidence: "regional", title: { zh: "江河雾岭与平原灯海", en: "River mist and a plain of lights" }, signature: { zh: "长江水脉 · 层叠雾岭 · 温暖聚落", en: "River threads · layered mist ridges · warm settlements" }, palette: { zenith: "#071828", horizon: "#587276", far: "#354e50", near: "#0c2223", water: "#8fc0bd", glow: "#efc98b" } },
  south: { id: "china-southern-mists", zone: "east-asia", confidence: "regional", title: { zh: "南方雨岭与青绿水网", en: "Southern rain ridges and green waters" }, signature: { zh: "湿润青山 · 漫长水网 · 雨后微光", en: "Humid green hills · long waterways · after-rain glow" }, palette: { zenith: "#051923", horizon: "#476f69", far: "#2c514a", near: "#09251f", water: "#76c1b4", glow: "#e8c27e" } },
  coast: { id: "china-eastern-coast", zone: "east-asia", confidence: "regional", title: { zh: "东部海岸与潮汐灯火", en: "Eastern coast and tidal lights" }, signature: { zh: "海雾天际 · 河口潮汐 · 稠密而克制的灯海", en: "Sea-haze horizon · estuary tides · restrained fields of light" }, palette: { zenith: "#061629", horizon: "#4a6875", far: "#304856", near: "#0b1e28", water: "#75b7c8", glow: "#f1c58a" } },
};

function chinaPlaceProfileFor(lat: number, lon: number) {
  if (lon < 99) return CHINA_PLACE_PROFILES.plateau;
  if (lon > 116) return CHINA_PLACE_PROFILES.coast;
  if (lat >= 38) return CHINA_PLACE_PROFILES.north;
  if (lat < 28) return CHINA_PLACE_PROFILES.south;
  return CHINA_PLACE_PROFILES.riverlands;
}

function placeProfileFor(lat: number, lon: number, label = "") {
  const normalized = label.toLocaleLowerCase();
  const curated = CURATED_PLACE_PROFILES.find((profile) => profile.aliases.some((alias) => normalized.includes(alias)))
    ?? CURATED_PLACE_PROFILES.map((profile) => ({ profile, distance: distanceKm({ lat, lon }, profile) })).sort((a, b) => a.distance - b.distance)[0];
  if (curated && ("profile" in curated ? curated.distance <= 180 : true)) return "profile" in curated ? curated.profile : curated;
  if (geographicContextFor({ lat, lon }).country.en === "China") return chinaPlaceProfileFor(lat, lon);
  return REGIONAL_PLACE_PROFILES[zoneFor(lat, lon)];
}

function routeScene(journey: Journey, progress: number) {
  const lonDelta = ((journey.to.lon - journey.from.lon + 540) % 360) - 180;
  const lat = journey.from.lat + (journey.to.lat - journey.from.lat) * progress;
  let lon = journey.from.lon + lonDelta * progress;
  if (lon > 180) lon -= 360;
  if (lon < -180) lon += 360;
  const localHour = (new Date().getUTCHours() + new Date().getUTCMinutes() / 60 + lon / 15 + 24) % 24;
  const time: TimePhase = localHour < 5.5 || localHour >= 20 ? "night" : localHour < 8 ? "dawn" : localHour >= 17.5 ? "dusk" : "day";
  const zone = zoneFor(lat, lon);
  const biome: Biome = zone === "arctic" ? "polar" : zone === "desert-belt" ? "desert" : zone === "tropical-isles" || zone === "savanna" ? "tropical" : zone === "andes" ? "mountain" : zone === "open-ocean" ? "coastal" : Math.abs(lat) > 50 ? "boreal" : "temperate";
  const weather: WeatherKind = biome === "polar" ? "snow" : biome === "tropical" && stableHash(`${journey.id}-${Math.floor(progress * 5)}`) % 3 === 0 ? "rain" : zone === "open-ocean" && stableHash(journey.id) % 2 === 0 ? "fog" : "clear";
  const hazard: Hazard = biome === "desert" && stableHash(`${journey.id}-dust`) % 3 === 0 ? "dust" : biome === "polar" ? "ice" : "none";
  return { lat, lon, localHour, time, zone, biome, weather, hazard };
}

function formatCountdown(ms: number) {
  if (ms <= 0) return "00:00:00";
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return [hours, minutes, seconds].map((value) => String(value).padStart(2, "0")).join(":");
}

function lifeAlpha(expiresAt?: number, current = Date.now()) {
  if (!expiresAt) return 1;
  const remaining = expiresAt - current;
  if (remaining <= 0) return 0;
  if (remaining >= 600000) return 1;
  const x = remaining / 600000;
  return x * x * (3 - 2 * x);
}

function detectTextLocale(text: string): Locale | "auto" {
  if (/[ぁ-ゟ゠-ヿ]/u.test(text)) return "ja";
  if (/\p{Script=Han}/u.test(text)) return "zh";
  if (/[¿¡ñáéíóúü]/iu.test(text) || /\b(hola|gracias|quiero|estoy|para|pero|una|que)\b/iu.test(text)) return "es";
  if (/[àâçèéêëîïôûùüÿœ]/iu.test(text) || /\b(merci|bonjour|avec|pour|mais|une|je|suis)\b/iu.test(text)) return "fr";
  if (/^[\p{Script=Latin}\p{Number}\p{Punctuation}\p{Separator}]+$/u.test(text)) return "en";
  return "auto";
}

function miniConstellationLayout(stories: Story[]) {
  const points: { id: string; x: number; y: number; parent: string | null; root: boolean }[] = [];
  stories.forEach((story, storyIndex) => {
    const hash = stableHash(story.id);
    points.push({ id: story.id, x: 13 + hash % 74, y: 15 + (hash >>> 9) % 68, parent: storyIndex ? stories[storyIndex - 1].id : null, root: true });
    story.replies.forEach((reply) => {
      const replyHash = stableHash(reply.id);
      points.push({ id: reply.id, x: 10 + replyHash % 80, y: 12 + (replyHash >>> 9) % 74, parent: story.id, root: false });
    });
  });
  const byId = new Map(points.map((point) => [point.id, point]));
  return {
    points,
    edges: points.flatMap((point) => point.parent && byId.get(point.parent) ? [{ from: byId.get(point.parent)!, to: point, reply: !point.root }] : []),
  };
}

function constellationName(chain: string, locale: Locale) {
  if (!chain.startsWith("path-")) return chain.replaceAll("-", " ");
  const index = stableHash(chain) % 6;
  const names: Record<Locale, string[]> = {
    zh: ["晨羽星途", "微光渡口", "远方来信", "温柔航线", "月下回声", "星河接力"],
    en: ["Dawnfeather Path", "Harbour of Light", "A Letter Afar", "Tender Orbit", "Moonlit Echo", "Starlight Relay"],
    es: ["Ruta Pluma del Alba", "Puerto de Luz", "Carta Lejana", "Órbita Amable", "Eco Lunar", "Relevo Estelar"],
    fr: ["Route Plume d'Aube", "Port de Lumière", "Lettre Lointaine", "Orbite Tendre", "Écho Lunaire", "Relais d'Étoiles"],
    ja: ["暁羽の星路", "微光の港", "遠い手紙", "やさしい軌道", "月夜のこだま", "星明かりのリレー"],
  };
  return `${names[locale][index]} · ${chain.slice(-4).toUpperCase()}`;
}

function distanceKm(a: { lat: number; lon: number }, b: { lat: number; lon: number }) {
  const r = 6371;
  const toRad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * toRad;
  const dLon = (b.lon - a.lon) * toRad;
  const v = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * toRad) * Math.cos(b.lat * toRad) * Math.sin(dLon / 2) ** 2;
  return 2 * r * Math.asin(Math.sqrt(v));
}

function estimateRoute(mode: CourierMode, from: { lat: number; lon: number }, to: { lat: number; lon: number }) {
  const direct = distanceKm(from, to);
  const spec = TRANSPORTS[mode];
  const routeDistance = direct * spec.routeFactor;
  return { distance: direct, routeDistance, etaHours: routeDistance / spec.speed + spec.handling };
}

function createExperienceJourneys(now = Date.now()): Journey[] {
  const routes: Array<{
    mode: CourierMode;
    storyId: string;
    from: GeoPoint;
    to: GeoPoint;
    scenario: JourneyScenario;
    duration: number;
    offset: number;
  }> = [
    { mode: "hand", storyId: "ca-1", from: { lat: 53.55, lon: -113.49, label: "Edmonton" }, to: { lat: 51.05, lon: -114.07, label: "Calgary" }, scenario: "companionship", duration: 94000, offset: .38 },
    { mode: "pigeon", storyId: "kr-1", from: { lat: 37.57, lon: 126.98, label: "Seoul" }, to: { lat: 43.06, lon: 141.35, label: "Sapporo" }, scenario: "reply", duration: 78000, offset: .64 },
    { mode: "carriage", storyId: "fr-1", from: { lat: 45.76, lon: 4.84, label: "Lyon" }, to: { lat: 45.07, lon: 7.69, label: "Torino" }, scenario: "wish", duration: 106000, offset: .21 },
    { mode: "rail", storyId: "fr-1", from: { lat: 51.51, lon: -.13, label: "London" }, to: { lat: 48.86, lon: 2.35, label: "Paris" }, scenario: "shelter", duration: 88000, offset: .51 },
    { mode: "plane", storyId: "au-1", from: { lat: -33.87, lon: 151.21, label: "Sydney" }, to: { lat: 35.68, lon: 139.69, label: "Tokyo" }, scenario: "terminator", duration: 72000, offset: .73 },
    { mode: "rocket", storyId: "br-1", from: { lat: -23.55, lon: -46.63, label: "São Paulo" }, to: { lat: 64.15, lon: -21.94, label: "Reykjavík" }, scenario: "resonance", duration: 84000, offset: .44 },
    { mode: "starship", storyId: "mx-1", from: { lat: 19.43, lon: -99.13, label: "Ciudad de México" }, to: { lat: 1.35, lon: 103.82, label: "Singapore" }, scenario: "memorial", duration: 112000, offset: .17 },
  ];
  return routes.map((route) => ({
    id: `journey-demo-world-${route.mode}`,
    storyId: route.storyId,
    mode: route.mode,
    from: route.from,
    to: route.to,
    ...estimateRoute(route.mode, route.from, route.to),
    startedAt: now - route.duration * route.offset,
    demoDurationMs: route.duration,
    scenario: route.scenario,
    crossedTerminator: route.scenario === "terminator" || route.mode === "rocket" || route.mode === "starship",
  }));
}

function needsMailRelay(mode: CourierMode, distance: number) {
  return ["hand", "carriage", "rail"].includes(mode) && distance > 1600;
}

function formatDuration(hours: number, locale: Locale) {
  if (hours < 1) return `${Math.max(1, Math.round(hours * 60))} min`;
  if (hours < 48) return `${hours < 10 ? hours.toFixed(1) : Math.round(hours)} h`;
  const days = hours / 24;
  return locale === "zh" ? `${days < 10 ? days.toFixed(1) : Math.round(days)} 天` : `${days < 10 ? days.toFixed(1) : Math.round(days)} d`;
}

function journeyScenarioLabel(scenario: JourneyScenario | undefined, locale: Locale) {
  const labels: Record<JourneyScenario, Record<"zh" | "en", string>> = {
    companionship: { zh: "陪一束光走近一点", en: "Walking one light closer" },
    reply: { zh: "一封回应正在归途", en: "A reply finding its way home" },
    wish: { zh: "一个小愿望正在被看见", en: "A small wish being seen" },
    shelter: { zh: "风雨里的文字避光港", en: "Words carrying shelter through weather" },
    terminator: { zh: "越过晨昏线的接力", en: "A relay across day and night" },
    resonance: { zh: "从远处看见同一颗地球", en: "Seeing the Earth we share" },
    memorial: { zh: "把抵达留成一颗纪念星", en: "Keeping an arrival as a memory-star" },
  };
  return scenario ? labels[scenario][locale === "zh" ? "zh" : "en"] : (locale === "zh" ? "一束光正在路上" : "A light is on its way");
}

function journeyProgress(journey: Journey) {
  const elapsed = Date.now() - journey.startedAt;
  if (journey.id.startsWith("journey-demo-world-")) {
    const loop = ((elapsed % journey.demoDurationMs) + journey.demoDurationMs) % journey.demoDurationMs;
    return Math.max(.01, loop / journey.demoDurationMs);
  }
  return Math.min(1, Math.max(.025, elapsed / journey.demoDurationMs));
}

function createCourierModel(THREE: ThreeModule, mode: CourierMode, color: number) {
  const group = new THREE.Group();
  const bodyMaterial = new THREE.MeshStandardMaterial({ color, roughness: .42, metalness: mode === "rail" || mode === "plane" || mode === "rocket" || mode === "starship" ? .58 : .08 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x171522, roughness: .7, metalness: .2 });
  const glowMaterial = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: .58, blending: THREE.AdditiveBlending });
  const add = (geometry: import("three").BufferGeometry, material: import("three").Material = bodyMaterial, x = 0, y = 0, z = 0) => {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(x, y, z);
    group.add(mesh);
    return mesh;
  };

  if (mode === "hand") {
    add(new THREE.SphereGeometry(.07, 14, 14), bodyMaterial, .08, .1, 0);
    const coat = add(new THREE.CapsuleGeometry(.075, .18, 5, 10), bodyMaterial, .02, -.06, 0);
    coat.rotation.z = -.18;
    const satchel = add(new THREE.BoxGeometry(.09, .075, .04), dark, -.08, -.03, .065);
    satchel.rotation.z = .15;
    add(new THREE.CylinderGeometry(.025, .025, .16, 8), dark, -.02, -.22, 0).rotation.z = -.18;
    add(new THREE.CylinderGeometry(.025, .025, .16, 8), dark, .09, -.21, 0).rotation.z = .22;
  } else if (mode === "pigeon") {
    const body = add(new THREE.SphereGeometry(.095, 20, 14)); body.scale.set(1.55, .7, .68);
    add(new THREE.SphereGeometry(.055, 16, 12), bodyMaterial, .13, .035, 0);
    const beak = add(new THREE.ConeGeometry(.025, .08, 8), new THREE.MeshStandardMaterial({ color: 0xe0ad64 }), .2, .035, 0); beak.rotation.z = -Math.PI / 2;
    const wingGeo = new THREE.ConeGeometry(.085, .25, 3);
    const wingA = add(wingGeo, bodyMaterial, -.02, .02, .08); wingA.rotation.set(1.2, 0, .72); wingA.userData.wing = 1;
    const wingB = add(wingGeo.clone(), bodyMaterial, -.02, .02, -.08); wingB.rotation.set(-1.2, 0, .72); wingB.userData.wing = -1;
  } else if (mode === "carriage") {
    add(new THREE.BoxGeometry(.24, .13, .15), bodyMaterial, .06, .03, 0);
    add(new THREE.BoxGeometry(.08, .11, .13), dark, -.1, .02, 0);
    [-.07, .14].forEach((x) => [-.09, .09].forEach((z) => { const wheel = add(new THREE.TorusGeometry(.052, .012, 8, 18), dark, x, -.065, z); wheel.rotation.y = Math.PI / 2; }));
    const horse = add(new THREE.CapsuleGeometry(.045, .14, 4, 8), bodyMaterial, -.26, -.005, 0); horse.rotation.z = Math.PI / 2;
    add(new THREE.SphereGeometry(.05, 12, 10), bodyMaterial, -.35, .06, 0);
  } else if (mode === "rail") {
    add(new THREE.BoxGeometry(.34, .12, .14), bodyMaterial, 0, 0, 0);
    add(new THREE.BoxGeometry(.12, .16, .13), dark, .06, .08, 0);
    const boiler = add(new THREE.CylinderGeometry(.06, .06, .21, 18), bodyMaterial, -.11, .07, 0); boiler.rotation.z = Math.PI / 2;
    [-.12, .02, .13].forEach((x) => [-.08, .08].forEach((z) => { const wheel = add(new THREE.TorusGeometry(.045, .013, 8, 16), dark, x, -.075, z); wheel.rotation.y = Math.PI / 2; }));
  } else if (mode === "plane") {
    const fuselage = add(new THREE.CapsuleGeometry(.045, .31, 6, 12)); fuselage.rotation.z = Math.PI / 2;
    const wing = add(new THREE.BoxGeometry(.15, .018, .46), bodyMaterial, 0, 0, 0); wing.rotation.y = -.08;
    add(new THREE.BoxGeometry(.09, .015, .17), bodyMaterial, .16, .035, 0);
  } else if (mode === "rocket") {
    const body = add(new THREE.CylinderGeometry(.055, .068, .26, 18)); body.rotation.z = -Math.PI / 2;
    const nose = add(new THREE.ConeGeometry(.056, .12, 18), bodyMaterial, .19, 0, 0); nose.rotation.z = -Math.PI / 2;
    add(new THREE.ConeGeometry(.06, .18, 18), glowMaterial, -.22, 0, 0).rotation.z = Math.PI / 2;
    add(new THREE.BoxGeometry(.1, .13, .018), bodyMaterial, -.09, 0, 0).rotation.z = .48;
  } else {
    const hull = add(new THREE.SphereGeometry(.11, 24, 14)); hull.scale.set(1.85, .42, 1);
    const canopy = add(new THREE.SphereGeometry(.065, 18, 12), new THREE.MeshStandardMaterial({ color: 0xacc8e6, transparent: true, opacity: .72, roughness: .1, metalness: .15 }), .04, .055, 0); canopy.scale.set(1.1, .55, .8);
    const ring = add(new THREE.TorusGeometry(.13, .018, 10, 28), glowMaterial); ring.rotation.x = Math.PI / 2;
  }
  group.rotation.y = -Math.PI / 2;
  return group;
}

function inBox(lat: number, lon: number, south: number, north: number, west: number, east: number) {
  return lat >= south && lat <= north && lon >= west && lon <= east;
}

function inferBiome(lat: number, lon: number, weather: Weather): Biome {
  const absLat = Math.abs(lat);
  if (absLat >= 66 || weather.temperature <= -18) return "polar";
  const desert = inBox(lat, lon, 14, 34, -18, 36)
    || inBox(lat, lon, 12, 33, 35, 61)
    || inBox(lat, lon, 34, 48, 74, 116)
    || inBox(lat, lon, -36, -17, 113, 146)
    || inBox(lat, lon, 24, 39, -121, -100)
    || inBox(lat, lon, -31, -16, -76, -65);
  if (desert || (weather.humidity < 28 && weather.soilMoisture < .12 && weather.temperature > 22)) return "desert";
  if (absLat < 24 && weather.humidity >= 62) return "tropical";
  if (absLat >= 48) return "boreal";
  const coastal = Math.abs(lon) < 6 || Math.abs(Math.abs(lon) - 180) < 5 || weather.humidity > 84;
  if (coastal) return "coastal";
  if (absLat > 27 && weather.temperature < 8 && weather.visibility > 14000) return "mountain";
  return "temperate";
}

function resolveEnvironment(weather: Weather, lat: number, lon: number, auroraChance: number): Environment {
  const biome = inferBiome(lat, lon, weather);
  const time: TimePhase = !weather.isDay ? "night" : weather.localHour < 8 ? "dawn" : weather.localHour >= 17 ? "dusk" : "day";
  let weatherKind: WeatherKind = weather.cloud > 72 ? "cloud" : "clear";
  if ([95, 96, 99].includes(weather.code)) weatherKind = "storm";
  else if ([71, 73, 75, 77, 85, 86].includes(weather.code)) weatherKind = "snow";
  else if ([51, 53, 55, 61, 63, 65, 80, 81, 82].includes(weather.code) || weather.precipitation > 0) weatherKind = "rain";
  else if ([45, 48].includes(weather.code) || weather.visibility < 2500) weatherKind = "fog";
  let hazard: Hazard = "none";
  if ([30, 31, 32, 33, 34, 35].includes(weather.code) || (biome === "desert" && weather.gust >= 35)) hazard = "dust";
  else if (weather.temperature >= 34 || weather.apparent >= 38) hazard = "heat";
  else if (biome === "desert" && weather.soilMoisture < .1 && weather.humidity < 30) hazard = "dry";
  else if ((biome === "polar" || weatherKind === "snow") && weather.temperature <= 0) hazard = "ice";
  const aurora = time === "night" && Math.abs(lat) >= 54 && weather.cloud < 66 && auroraChance >= 12;
  return { time, weather: weatherKind, biome, hazard, aurora, auroraChance };
}

function weatherIcon(environment: Environment) {
  if (environment.weather === "storm") return "ϟ";
  if (environment.weather === "snow") return "❄";
  if (environment.weather === "rain") return "╱";
  if (environment.weather === "fog") return "≋";
  if (environment.hazard === "dust") return "◌";
  if (environment.aurora) return "⌁";
  if (environment.time === "night") return "☾";
  if (environment.time === "dawn" || environment.time === "dusk") return "◐";
  return "☼";
}

function environmentLabel(environment: Environment) {
  if (environment.weather === "storm") return "STORM";
  if (environment.weather === "snow") return "SNOW";
  if (environment.weather === "rain") return "RAIN";
  if (environment.weather === "fog") return "FOG";
  if (environment.hazard === "dust") return "SANDSTORM";
  if (environment.aurora) return "AURORA";
  if (environment.hazard === "heat") return "HEAT";
  if (environment.biome === "desert") return "DESERT";
  return environment.time.toUpperCase();
}

function seasonFor(lat: number, month = new Date().getUTCMonth()) {
  const north = ["WINTER", "SPRING", "SUMMER", "AUTUMN"];
  const index = month === 11 || month <= 1 ? 0 : month <= 4 ? 1 : month <= 7 ? 2 : 3;
  return north[lat >= 0 ? index : (index + 2) % 4];
}

type BackgroundIdentity = {
  season: "winter" | "spring" | "summer" | "autumn";
  latitude: "equatorial" | "tropical" | "temperate" | "boreal" | "polar";
  air: "humid" | "balanced" | "dry";
  wind: "calm" | "breeze" | "strong";
  settlement: "dense" | "river" | "coastal" | "sparse" | "layered";
  material: "forest" | "ice" | "ridge" | "stone" | "grassland" | "sand" | "humid" | "mountain" | "water";
  celestialX: number;
};

function backgroundIdentityFor(point: { lat: number; lon: number }, profile: PlaceProfile, weather: Weather, environment: Environment): BackgroundIdentity {
  const absLat = Math.abs(point.lat);
  const latitude: BackgroundIdentity["latitude"] = absLat < 14 ? "equatorial" : absLat < 30 ? "tropical" : absLat < 50 ? "temperate" : absLat < 66 ? "boreal" : "polar";
  const air: BackgroundIdentity["air"] = weather.humidity >= 72 || ["rain", "storm", "fog"].includes(environment.weather) ? "humid" : weather.humidity <= 34 || ["heat", "dust", "dry"].includes(environment.hazard) ? "dry" : "balanced";
  const wind: BackgroundIdentity["wind"] = weather.wind < 8 ? "calm" : weather.wind < 26 ? "breeze" : "strong";
  const densePlaces = ["seoul-river-basin", "mexico-volcanic-basin", "sao-paulo-humid-plateau"];
  const riverPlaces = ["edmonton-river-valley", "lyon-river-confluence", "boreal-horizon", "temperate-riverlands"];
  const coastalPlaces = ["sydney-sandstone-coast", "open-water"];
  const settlement: BackgroundIdentity["settlement"] = densePlaces.includes(profile.id) ? "dense" : riverPlaces.includes(profile.id) ? "river" : coastalPlaces.includes(profile.id) ? "coastal" : ["savanna", "arctic"].includes(profile.zone) ? "sparse" : "layered";
  const materialByZone: Record<RegionZone, BackgroundIdentity["material"]> = {
    "northern-lakes": "forest", arctic: "ice", "east-asia": "ridge", mediterranean: "stone", savanna: "grassland", "desert-belt": "sand", "tropical-isles": "humid", andes: "mountain", "open-ocean": "water",
  };
  return {
    season: seasonFor(point.lat).toLowerCase() as BackgroundIdentity["season"],
    latitude,
    air,
    wind,
    settlement,
    material: materialByZone[profile.zone],
    celestialX: 8 + (((weather.localHour + 6) % 24) / 24) * 84,
  };
}

function storyText(story: Story, locale: Locale, showOriginal: boolean) {
  if (showOriginal || story.lang === locale) return story.text;
  return story.translations[locale] ?? story.translations.en ?? story.text;
}

function replyText(reply: Reply, locale: Locale, showOriginal: boolean) {
  if (showOriginal || reply.lang === locale) return reply.text;
  return reply.translations[locale] ?? reply.translations.en ?? reply.text;
}

type WorldProps = {
  locale: Locale;
  stories: Story[];
  activity: DailyActivitySnapshot;
  journeys: Journey[];
  activeJourneyId: string | null;
  textureUrl: string;
  baseTextureUrl: string;
  earthLens: EarthLens;
  earthDataLayer: EarthDataLayer;
  observations: EarthObservationPoint[];
  zoomStage: ZoomStage;
  homePoint: { lat: number; lon: number } | null;
  activePoint: { lat: number; lon: number } | null;
  arrivalBloom: { lat: number; lon: number; nonce: number } | null;
  pickingPlace: boolean;
  selectedId: string | null;
  heldStoryIds: string[];
  focus: FocusPoint;
  zoomCommand: ZoomCommand;
  onSelect: (story: Story) => void;
  onSelectJourney: (journey: Journey) => void;
  onPick: (lat: number, lon: number) => void;
  onZoom: (zoom: number) => void;
  onNear: () => void;
  onInteract: () => void;
};

type WorldApi = {
  focus: (lat: number, lon: number) => void;
  zoom: (delta: number) => void;
  zoomTo: (targetZoom: number) => void;
  setActivity: (snapshot: DailyActivitySnapshot) => void;
  setSelection: (lat: number, lon: number) => void;
  clearSelection: () => void;
  setStories: (stories: Story[]) => void;
  setJourneys: (journeys: Journey[]) => void;
  setObservations: (observations: EarthObservationPoint[], layer: EarthDataLayer) => void;
  setHomePoint: (point: { lat: number; lon: number } | null) => void;
  setEarthAppearance: (appearance: { textureUrl: string; baseTextureUrl: string; lens: EarthLens; dataLayer: EarthDataLayer }) => void;
  setLocale: (locale: Locale) => void;
  bloomAt: (lat: number, lon: number) => void;
};

type WorldViewState = {
  initialized: boolean;
  quaternion: [number, number, number, number];
  cameraZ: number;
  cameraTarget: number;
  focusLocked: boolean;
};

function keepFocusInside(event: KeyboardEvent, root: HTMLElement | null) {
  if (event.key !== "Tab" || !root) return;
  const focusable = [...root.querySelectorAll<HTMLElement>(
    'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
  )].filter((element) => !element.hasAttribute("hidden") && element.getAttribute("aria-hidden") !== "true");
  if (focusable.length === 0) return;
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}

function LivingWorld({ locale, stories, activity, journeys, activeJourneyId, textureUrl, baseTextureUrl, earthLens, earthDataLayer, observations, zoomStage, homePoint, activePoint, arrivalBloom, pickingPlace, selectedId, heldStoryIds, focus, zoomCommand, onSelect, onSelectJourney, onPick, onZoom, onNear, onInteract }: WorldProps) {
  const mountRef = useRef<HTMLDivElement>(null);
  const [renderMode, setRenderMode] = useState<"loading" | "webgl" | "fallback">("loading");
  const [courierCoachVisible, setCourierCoachVisible] = useState(false);
  const coachRef = useRef<HTMLDivElement | null>(null);
  const dismissCourierCoach = useCallback(() => {
    try { window.localStorage.setItem(COURIER_COACH_KEY, "1"); } catch { /* private mode */ }
    setCourierCoachVisible(false);
  }, []);
  useEffect(() => {
    if (!courierCoachVisible) return;
    const timer = window.setTimeout(() => setCourierCoachVisible(false), 16000);
    return () => window.clearTimeout(timer);
  }, [courierCoachVisible]);
  const apiRef = useRef<WorldApi | null>(null);
  const activityRef = useRef(activity);
  const localeRef = useRef(locale);
  const storiesRef = useRef(stories);
  const journeysRef = useRef(journeys);
  const observationsRef = useRef(observations);
  const homePointRef = useRef(homePoint);
  const earthLensRef = useRef(earthLens);
  const earthDataLayerRef = useRef(earthDataLayer);
  const textureUrlRef = useRef(textureUrl);
  const baseTextureUrlRef = useRef(baseTextureUrl);
  const activeJourneyRef = useRef(activeJourneyId);
  const selectedRef = useRef(selectedId);
  const heldRef = useRef(new Set(heldStoryIds));
  const onSelectRef = useRef(onSelect);
  const onSelectJourneyRef = useRef(onSelectJourney);
  const onPickRef = useRef(onPick);
  const onZoomRef = useRef(onZoom);
  const onNearRef = useRef(onNear);
  const onInteractRef = useRef(onInteract);
  const zoomCommandRef = useRef(zoomCommand);
  const zoomStageRef = useRef(zoomStage);
  const focusRef = useRef(focus);
  const lastAppliedFocusNonceRef = useRef(-1);
  const viewStateRef = useRef<WorldViewState>({
    initialized: false,
    quaternion: [0, 0, 0, 1],
    cameraZ: CAMERA_NEAR + (1 - INITIAL_EARTH_ZOOM) * (CAMERA_FAR - CAMERA_NEAR),
    cameraTarget: CAMERA_NEAR + (1 - INITIAL_EARTH_ZOOM) * (CAMERA_FAR - CAMERA_NEAR),
    focusLocked: false,
  });
  const activePointRef = useRef(activePoint);
  const arrivalBloomRef = useRef(arrivalBloom);
  const pickingPlaceRef = useRef(pickingPlace);
  const lastZoomNonceRef = useRef(0);

  useEffect(() => { selectedRef.current = selectedId; }, [selectedId]);
  useEffect(() => {
    storiesRef.current = stories;
    apiRef.current?.setStories(stories);
  }, [stories]);
  useEffect(() => {
    journeysRef.current = journeys;
    apiRef.current?.setJourneys(journeys);
  }, [journeys]);
  useEffect(() => {
    observationsRef.current = observations;
    apiRef.current?.setObservations(observations, earthDataLayer);
  }, [earthDataLayer, observations]);
  useEffect(() => {
    homePointRef.current = homePoint;
    apiRef.current?.setHomePoint(homePoint);
  }, [homePoint]);
  useEffect(() => {
    earthLensRef.current = earthLens;
    earthDataLayerRef.current = earthDataLayer;
    textureUrlRef.current = textureUrl;
    baseTextureUrlRef.current = baseTextureUrl;
    apiRef.current?.setEarthAppearance({ textureUrl, baseTextureUrl, lens: earthLens, dataLayer: earthDataLayer });
  }, [baseTextureUrl, earthDataLayer, earthLens, textureUrl]);
  useEffect(() => { activeJourneyRef.current = activeJourneyId; }, [activeJourneyId]);
  useEffect(() => { heldRef.current = new Set(heldStoryIds); }, [heldStoryIds]);
  useEffect(() => { onSelectRef.current = onSelect; }, [onSelect]);
  useEffect(() => { onSelectJourneyRef.current = onSelectJourney; }, [onSelectJourney]);
  useEffect(() => { onPickRef.current = onPick; }, [onPick]);
  useEffect(() => { onZoomRef.current = onZoom; }, [onZoom]);
  useEffect(() => { onNearRef.current = onNear; }, [onNear]);
  useEffect(() => { onInteractRef.current = onInteract; }, [onInteract]);
  useEffect(() => { zoomStageRef.current = zoomStage; }, [zoomStage]);
  useEffect(() => {
    localeRef.current = locale;
    apiRef.current?.setLocale(locale);
  }, [locale]);
  useEffect(() => { pickingPlaceRef.current = pickingPlace; }, [pickingPlace]);
  useEffect(() => {
    focusRef.current = focus;
    if (focus.nonce !== lastAppliedFocusNonceRef.current && apiRef.current) {
      apiRef.current.focus(focus.lat, focus.lon);
      lastAppliedFocusNonceRef.current = focus.nonce;
    }
  }, [focus]);
  useEffect(() => {
    activePointRef.current = activePoint;
    if (activePoint) apiRef.current?.setSelection(activePoint.lat, activePoint.lon);
    else apiRef.current?.clearSelection();
  }, [activePoint]);
  useEffect(() => {
    arrivalBloomRef.current = arrivalBloom;
    if (arrivalBloom) apiRef.current?.bloomAt(arrivalBloom.lat, arrivalBloom.lon);
  }, [arrivalBloom]);
  useEffect(() => {
    activityRef.current = activity;
    apiRef.current?.setActivity(activity);
  }, [activity]);
  useEffect(() => {
    zoomCommandRef.current = zoomCommand;
    if (zoomCommand.nonce > lastZoomNonceRef.current && apiRef.current) {
      if (zoomCommand.targetZoom === undefined) apiRef.current.zoom(zoomCommand.delta);
      else apiRef.current.zoomTo(zoomCommand.targetZoom);
      lastZoomNonceRef.current = zoomCommand.nonce;
    }
  }, [zoomCommand]);

  useEffect(() => {
    const host = mountRef.current;
    if (!host) return;

    let cancelled = false;
    let cleanup: (() => void) | undefined;
    void import("three").then((THREE) => {
      if (cancelled) return;

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(42, host.clientWidth / host.clientHeight, 0.1, 100);
    const restoredView = viewStateRef.current.initialized;
    camera.position.set(0, 0, restoredView ? viewStateRef.current.cameraZ : CAMERA_NEAR + (1 - INITIAL_EARTH_ZOOM) * (CAMERA_FAR - CAMERA_NEAR));
    let renderer: import("three").WebGLRenderer;
    const compactDevice = isCompactDevice();
    try {
      // Compact devices: no MSAA and no discrete-GPU hint — the visual
      // difference at 3× DPR is negligible, the memory difference is not.
      renderer = new THREE.WebGLRenderer({ antialias: !compactDevice, alpha: true, powerPreference: compactDevice ? "default" : "high-performance" });
    } catch {
      host.classList.add("no-webgl");
      setRenderMode("fallback");
      let fallbackZoom = INITIAL_EARTH_ZOOM;
      apiRef.current = {
        focus: () => { /* The fallback keeps the user's current depth. */ },
        setActivity: () => { /* CSS fallback activity glows update through React. */ },
        setSelection: () => { /* The React fallback marker follows activePoint. */ },
        clearSelection: () => { /* The React fallback marker follows activePoint. */ },
        setStories: () => { /* The React fallback reads story props directly. */ },
        setJourneys: () => { /* The React fallback reads journey props directly. */ },
        setObservations: () => { /* The React fallback reads observation props directly. */ },
        setHomePoint: () => { /* The React fallback reads the home point directly. */ },
        setEarthAppearance: () => { /* The React fallback reads Earth appearance props directly. */ },
        bloomAt: () => { /* The React fallback bloom is rendered declaratively. */ },
        zoom: (delta) => {
          fallbackZoom = THREE.MathUtils.clamp(fallbackZoom - delta / 6.28, 0, 1);
          onZoomRef.current(fallbackZoom);
          if (fallbackZoom >= .98 && delta < 0) onNearRef.current();
        },
        zoomTo: (targetZoom) => {
          fallbackZoom = THREE.MathUtils.clamp(targetZoom, 0, 1);
          onZoomRef.current(fallbackZoom);
        },
      };
      const fallbackPointers = new Map<number, { x: number; y: number }>();
      let fallbackPinchDistance = 0;
      let fallbackStartX = 0;
      let fallbackStartY = 0;
      let fallbackThreshold = 7;
      let fallbackMoved = false;
      let fallbackHadMultiplePointers = false;
      let fallbackStartedOnStory = false;
      const fallbackWheel = (event: WheelEvent) => {
        event.preventDefault();
        onInteractRef.current();
        apiRef.current?.zoom(event.deltaY * .0034);
      };
      const fallbackDown = (event: PointerEvent) => {
        if (event.pointerType === "mouse" && event.button !== 0) return;
        fallbackPointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
        if (fallbackPointers.size === 1) {
          fallbackStartX = event.clientX;
          fallbackStartY = event.clientY;
          fallbackThreshold = event.pointerType === "touch" ? 14 : 7;
          fallbackMoved = false;
          fallbackHadMultiplePointers = false;
          fallbackStartedOnStory = Boolean((event.target as Element | null)?.closest?.(".fallback-star"));
        } else if (fallbackPointers.size === 2) {
          const [a, b] = [...fallbackPointers.values()];
          fallbackPinchDistance = Math.hypot(a.x - b.x, a.y - b.y);
          fallbackHadMultiplePointers = true;
          fallbackMoved = true;
          host.setPointerCapture(event.pointerId);
        }
      };
      const fallbackMove = (event: PointerEvent) => {
        if (!fallbackPointers.has(event.pointerId)) return;
        fallbackPointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
        if (fallbackPointers.size < 2) {
          if (!fallbackMoved && Math.hypot(event.clientX - fallbackStartX, event.clientY - fallbackStartY) >= fallbackThreshold) {
            fallbackMoved = true;
            onInteractRef.current();
          }
          return;
        }
        const [a, b] = [...fallbackPointers.values()];
        const nextDistance = Math.hypot(a.x - b.x, a.y - b.y);
        if (fallbackPinchDistance > 0) apiRef.current?.zoom((fallbackPinchDistance - nextDistance) * .008);
        onInteractRef.current();
        fallbackPinchDistance = nextDistance;
      };
      const fallbackUp = (event: PointerEvent) => {
        const wasSinglePointer = fallbackPointers.size === 1;
        const wasTap = wasSinglePointer && !fallbackMoved && !fallbackHadMultiplePointers && !fallbackStartedOnStory
          && Math.hypot(event.clientX - fallbackStartX, event.clientY - fallbackStartY) < fallbackThreshold;
        fallbackPointers.delete(event.pointerId);
        if (fallbackPointers.size < 2) fallbackPinchDistance = 0;
        if (wasTap) {
          onInteractRef.current();
          const globe = host.querySelector<HTMLElement>(".fallback-globe");
          const rect = globe?.getBoundingClientRect();
          if (rect) {
            const x = (event.clientX - rect.left) / rect.width;
            const y = (event.clientY - rect.top) / rect.height;
            const dx = x - .5;
            const dy = y - .5;
            if (x >= 0 && x <= 1 && y >= 0 && y <= 1 && dx * dx + dy * dy <= .25) {
              const lon = wrapLongitude(focusRef.current.lon + (x - .5) * FALLBACK_LONGITUDE_SPAN);
              onPickRef.current(90 - y * 180, lon);
            }
          }
        }
        if (fallbackPointers.size === 0) {
          fallbackMoved = false;
          fallbackHadMultiplePointers = false;
          fallbackStartedOnStory = false;
        }
      };
      host.addEventListener("wheel", fallbackWheel, { passive: false });
      host.addEventListener("pointerdown", fallbackDown);
      host.addEventListener("pointermove", fallbackMove);
      host.addEventListener("pointerup", fallbackUp);
      host.addEventListener("pointercancel", fallbackUp);
      if (zoomCommandRef.current.nonce > lastZoomNonceRef.current) {
        if (zoomCommandRef.current.targetZoom === undefined) apiRef.current.zoom(zoomCommandRef.current.delta);
        else apiRef.current.zoomTo(zoomCommandRef.current.targetZoom);
        lastZoomNonceRef.current = zoomCommandRef.current.nonce;
      }
      cleanup = () => {
        host.removeEventListener("wheel", fallbackWheel);
        host.removeEventListener("pointerdown", fallbackDown);
        host.removeEventListener("pointermove", fallbackMove);
        host.removeEventListener("pointerup", fallbackUp);
        host.removeEventListener("pointercancel", fallbackUp);
        host.classList.remove("no-webgl");
        apiRef.current = null;
      };
      return;
    }
    const compactRenderer = compactDevice || window.innerWidth <= 760 || window.devicePixelRatio > 2.5;
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, compactRenderer ? 1.15 : 1.65));
    renderer.setSize(host.clientWidth, host.clientHeight);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.02;
    host.appendChild(renderer.domElement);
    let frame = 0;
    let firstFrameReady = false;
    let webglUnavailable = false;
    const showStaticFallback = () => {
      if (webglUnavailable) return;
      webglUnavailable = true;
      cancelAnimationFrame(frame);
      host.classList.remove("has-webgl");
      host.classList.add("no-webgl");
      setRenderMode("fallback");
    };
    const onWebglContextLost = (event: Event) => {
      event.preventDefault();
      showStaticFallback();
    };
    renderer.domElement.addEventListener("webglcontextlost", onWebglContextLost);

    const world = new THREE.Group();
    if (restoredView) world.quaternion.fromArray(viewStateRef.current.quaternion);
    else world.rotation.set(-0.08, -0.3, 0.02);
    scene.add(world);

    const geoLabelLayer = new THREE.Group();
    geoLabelLayer.renderOrder = 18;
    world.add(geoLabelLayer);
    const createGeoLabelTexture = (definition: GeoLabelDefinition, nextLocale: Locale) => {
      const canvas = document.createElement("canvas");
      canvas.width = definition.kind === "continent" ? 640 : definition.kind === "ocean" ? 560 : 480;
      canvas.height = 128;
      const context = canvas.getContext("2d");
      if (!context) return new THREE.CanvasTexture(canvas);
      const text = nextLocale === "zh" ? definition.zh : definition.en.toLocaleUpperCase();
      const inset = definition.kind === "continent" ? 26 : definition.kind === "ocean" ? 34 : 20;
      context.fillStyle = definition.kind === "continent" ? "rgba(4,12,25,.68)" : definition.kind === "ocean" ? "rgba(5,30,45,.34)" : "rgba(4,12,22,.62)";
      context.strokeStyle = definition.kind === "continent" ? "rgba(201,231,225,.32)" : definition.kind === "ocean" ? "rgba(131,214,228,.28)" : "rgba(188,220,215,.24)";
      context.lineWidth = 2;
      context.beginPath();
      context.roundRect(inset, 22, canvas.width - inset * 2, 84, 42);
      context.fill();
      context.stroke();
      context.textAlign = "center";
      context.textBaseline = "middle";
      context.fillStyle = definition.kind === "continent" ? "rgba(232,244,241,.94)" : definition.kind === "ocean" ? "rgba(180,231,239,.84)" : "rgba(221,236,232,.88)";
      context.font = `${definition.kind === "continent" ? 600 : definition.kind === "ocean" ? 480 : 520} ${definition.kind === "continent" ? 42 : definition.kind === "ocean" ? 34 : 36}px system-ui, -apple-system, sans-serif`;
      context.letterSpacing = definition.kind === "continent" ? "4px" : definition.kind === "ocean" ? "5px" : "2px";
      context.fillText(text, canvas.width / 2, 64, canvas.width - inset * 3);
      const texture = new THREE.CanvasTexture(canvas);
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.magFilter = THREE.LinearFilter;
      texture.minFilter = THREE.LinearMipmapLinearFilter;
      texture.needsUpdate = true;
      return texture;
    };
    const geoLabelVisuals = GEO_LABELS.map((definition) => {
      const texture = createGeoLabelTexture(definition, localeRef.current);
      const material = new THREE.SpriteMaterial({ map: texture, transparent: true, opacity: definition.kind === "continent" ? .88 : definition.kind === "ocean" ? .7 : .82, depthTest: true, depthWrite: false });
      const sprite = new THREE.Sprite(material);
      sprite.position.copy(latLonVector(THREE, definition.lat, definition.lon, 2.31));
      sprite.scale.set(definition.kind === "continent" ? 1.12 : definition.kind === "ocean" ? .84 : .7, definition.kind === "continent" ? .224 : definition.kind === "ocean" ? .192 : .187, 1);
      sprite.visible = false;
      sprite.renderOrder = 18;
      geoLabelLayer.add(sprite);
      return { definition, sprite, material, texture };
    });
    const updateGeoLabelLocale = (nextLocale: Locale) => {
      geoLabelVisuals.forEach((visual) => {
        const nextTexture = createGeoLabelTexture(visual.definition, nextLocale);
        visual.material.map = nextTexture;
        visual.material.needsUpdate = true;
        visual.texture.dispose();
        visual.texture = nextTexture;
      });
    };

    const textureLoader = new THREE.TextureLoader();
    textureLoader.setCrossOrigin("anonymous");
    const tuneTexture = (map: import("three").Texture) => {
      map.colorSpace = THREE.SRGBColorSpace;
      map.anisotropy = renderer.capabilities.getMaxAnisotropy();
      map.needsUpdate = true;
    };
    const localEarthTexture = createLocalEarthTexture(THREE, compactRenderer ? 768 : 1280);
    tuneTexture(localEarthTexture);
    const remoteEarthTextures = new Set<import("three").Texture>();
    const activityTextures = new Set<import("three").Texture>();
    const activityTextureSize = window.innerWidth <= 760 ? 256 : 512;
    let activityFromTexture = createActivityTexture(THREE, activityRef.current, activityTextureSize);
    let activityToTexture = activityFromTexture;
    activityTextures.add(activityFromTexture);
    let activityBlendStartedAt = 0;
    let activityTextureToDispose: import("three").Texture | null = null;
    const solarDirection = latLonVector(THREE, subsolarPoint().lat, subsolarPoint().lon, 1).normalize();
    const earthMaterial = new THREE.ShaderMaterial({
      uniforms: {
        dailyMap: { value: localEarthTexture },
        baseMap: { value: localEarthTexture },
        activityMapFrom: { value: activityFromTexture },
        activityMapTo: { value: activityToTexture },
        activityMix: { value: 1 },
        sunDirection: { value: solarDirection },
        lensMode: { value: earthLensRef.current === "night" ? 2 : earthLensRef.current === "daily" ? 1 : 0 },
        kindnessVisibility: { value: earthDataLayerRef.current === "kindness" ? 1 : .08 },
      },
      vertexShader: `
        varying vec2 vUv;
        varying vec3 vViewNormal;
        varying vec3 vObjectNormal;
        varying vec3 vViewPosition;
        varying vec3 vSunView;
        uniform vec3 sunDirection;
        void main() {
          vUv = uv;
          vViewNormal = normalize(normalMatrix * normal);
          vObjectNormal = normalize(normal);
          vSunView = normalize(normalMatrix * sunDirection);
          vec4 viewPosition = modelViewMatrix * vec4(position, 1.0);
          vViewPosition = viewPosition.xyz;
          gl_Position = projectionMatrix * viewPosition;
        }
      `,
      fragmentShader: `
        uniform sampler2D dailyMap;
        uniform sampler2D baseMap;
        uniform sampler2D activityMapFrom;
        uniform sampler2D activityMapTo;
        uniform float activityMix;
        uniform float lensMode;
        uniform float kindnessVisibility;
        uniform vec3 sunDirection;
        varying vec2 vUv;
        varying vec3 vViewNormal;
        varying vec3 vObjectNormal;
        varying vec3 vViewPosition;
        varying vec3 vSunView;
        float lightness(vec3 c) { return dot(c, vec3(.2126, .7152, .0722)); }
        float hash21(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123); }
        void main() {
          vec2 earthUv = vec2(fract(vUv.x + .25), vUv.y);
          vec3 daily = texture2D(dailyMap, earthUv).rgb;
          vec3 base = texture2D(baseMap, earthUv).rgb;
          float baseSignal = smoothstep(.012, .07, lightness(base));
          base = mix(vec3(.025, .11, .19), base, baseSignal);
          float polarIce = smoothstep(.9, .985, abs(vObjectNormal.y));
          base = mix(base, vec3(.62, .76, .81), polarIce * .72);
          float dailySignal = smoothstep(.035, .12, lightness(daily)) * step(.5, lensMode) * (1.0 - step(1.5, lensMode));
          float polarCoverage = 1.0 - smoothstep(.68, .91, abs(vObjectNormal.y));
          dailySignal *= polarCoverage;
          vec3 dayColor = mix(base, daily, dailySignal);
          float southPolar = smoothstep(.5, .86, -vObjectNormal.y);
          float iceVariation = sin(earthUv.x * 137.0) * .018 + sin((earthUv.x + earthUv.y) * 223.0) * .012;
          vec3 southIceColor = vec3(.61, .7, .73) + iceVariation;
          dayColor = mix(dayColor, southIceColor, southPolar * .9);
          float solar = dot(normalize(vObjectNormal), normalize(sunDirection));
          float daylight = smoothstep(-.11, .17, solar);
          float twilight = smoothstep(-.18, -.03, solar) * (1.0 - smoothstep(-.03, .14, solar));
          float land = smoothstep(.035, .18, max(dayColor.r, dayColor.g) - dayColor.b * .72);
          float citySeed = hash21(floor(earthUv * vec2(720.0, 360.0)));
          float cityLights = smoothstep(.992, .9995, citySeed) * land * (1.0 - daylight);
          vec3 nightColor = dayColor * vec3(.075, .105, .19) + vec3(.012, .028, .075);
          vec3 color = mix(nightColor, dayColor, daylight);
          float observationNight = smoothstep(.035, .48, lightness(daily));
          vec3 nightObservation = nightColor + vec3(.56, .68, .9) * observationNight * (.18 + (1.0 - daylight) * .62);
          color = mix(color, nightObservation, step(1.5, lensMode) * .58);
          float ocean = smoothstep(.015, .16, dayColor.b - max(dayColor.r, dayColor.g) * .82);
          vec3 normalView = normalize(vViewNormal);
          vec3 viewDirection = normalize(-vViewPosition);
          vec3 halfDirection = normalize(normalize(vSunView) + viewDirection);
          float oceanGlint = pow(max(dot(normalView, halfDirection), 0.0), 72.0) * ocean * daylight;
          color += vec3(.48, .66, .78) * oceanGlint * .42;
          color += vec3(1.0, .58, .2) * cityLights * 1.5;
          color += vec3(.42, .22, .12) * twilight * .2;
          vec4 activeFrom = texture2D(activityMapFrom, earthUv);
          vec4 activeTo = texture2D(activityMapTo, earthUv);
          vec4 activityData = mix(activeFrom, activeTo, activityMix);
          float activity = activityData.r;
          vec3 activityColor = vec3(.49, .37, 1.0);
          activityColor = mix(activityColor, vec3(.28, .9, .76), activityData.b * .42);
          activityColor = mix(activityColor, vec3(1.0, .72, .32), activityData.g * .44);
          float nightGain = mix(1.06, .3, daylight) + twilight * .18;
          float freshness = .82 + activityData.a * .28;
          color += activityColor * activity * nightGain * freshness * (.55 + activity * .52) * kindnessVisibility;
          float limb = pow(1.0 - max(vViewNormal.z, 0.0), 2.8);
          color += mix(vec3(.02, .035, .075), vec3(.055, .11, .18), daylight) * limb;
          gl_FragColor = vec4(color, 1.0);
        }
      `,
    });
    const textureRequestVersion: Record<"dailyMap" | "baseMap", number> = { dailyMap: 0, baseMap: 0 };
    const activeRemoteTexture: Partial<Record<"dailyMap" | "baseMap", import("three").Texture>> = {};
    const bindRemoteEarthTexture = (url: string, uniforms: Array<"dailyMap" | "baseMap">) => {
      const requests = uniforms.map((name) => ({ name, version: ++textureRequestVersion[name] }));
      textureLoader.load(url, (map) => {
        if (cancelled) { map.dispose(); return; }
        tuneTexture(map);
        const currentRequests = requests.filter(({ name, version }) => textureRequestVersion[name] === version);
        if (currentRequests.length === 0) { map.dispose(); return; }
        remoteEarthTextures.add(map);
        currentRequests.forEach(({ name }) => {
          const previous = activeRemoteTexture[name];
          earthMaterial.uniforms[name].value = map;
          activeRemoteTexture[name] = map;
          if (previous && previous !== map && !Object.values(activeRemoteTexture).includes(previous)) {
            previous.dispose();
            remoteEarthTextures.delete(previous);
          }
        });
      }, undefined, () => {
        // Scheme two: live NASA imagery enhances our Earth; it never controls whether the Earth exists.
      });
    };
    const syncEarthTextures = (nextTextureUrl: string, nextBaseTextureUrl: string) => {
      if (nextTextureUrl === nextBaseTextureUrl) bindRemoteEarthTexture(nextBaseTextureUrl, ["dailyMap", "baseMap"]);
      else {
        bindRemoteEarthTexture(nextBaseTextureUrl, ["baseMap"]);
        bindRemoteEarthTexture(nextTextureUrl, ["dailyMap"]);
      }
    };
    let boundTextureUrl = textureUrlRef.current;
    let boundBaseTextureUrl = baseTextureUrlRef.current;
    if (textureUrlRef.current === baseTextureUrlRef.current) bindRemoteEarthTexture(baseTextureUrlRef.current, ["dailyMap", "baseMap"]);
    else {
      bindRemoteEarthTexture(baseTextureUrlRef.current, ["baseMap"]);
      bindRemoteEarthTexture(textureUrlRef.current, ["dailyMap"]);
    }
    const sphereSegments = compactRenderer ? 72 : 104;
    const earth = new THREE.Mesh(
      new THREE.SphereGeometry(2.18, sphereSegments, sphereSegments),
      earthMaterial,
    );
    world.add(earth);

    const atmosphereMaterial = new THREE.ShaderMaterial({
      uniforms: { sunDirection: { value: solarDirection } },
      vertexShader: `
        varying vec3 vViewNormal;
        varying float vSolar;
        uniform vec3 sunDirection;
        void main() {
          vViewNormal = normalize(normalMatrix * normal);
          vSolar = dot(normalize(normal), normalize(sunDirection));
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        varying vec3 vViewNormal;
        varying float vSolar;
        void main() {
          float fresnel = pow(1.0 - min(1.0, abs(vViewNormal.z)), 2.6);
          float daySide = smoothstep(-.3, .38, vSolar);
          vec3 sky = mix(vec3(.18, .25, .52), vec3(.34, .66, .96), daySide);
          float alpha = fresnel * (.08 + daySide * .29);
          gl_FragColor = vec4(sky * alpha, alpha);
        }
      `,
      transparent: true,
      side: THREE.BackSide,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const atmosphere = new THREE.Mesh(
      new THREE.SphereGeometry(2.235, compactRenderer ? 56 : 80, compactRenderer ? 56 : 80),
      atmosphereMaterial,
    );
    world.add(atmosphere);

    scene.add(new THREE.AmbientLight(0x9ca8d6, .72));
    scene.add(new THREE.HemisphereLight(0xa9c2ff, 0x304267, 1.05));
    const sun = new THREE.DirectionalLight(0xfff2d2, 2.7);
    const firstSunPoint = subsolarPoint();
    sun.position.copy(latLonVector(THREE, firstSunPoint.lat, firstSunPoint.lon, 7));
    scene.add(sun);
    const syncSolarLight = () => {
      const solarPoint = subsolarPoint();
      const objectDirection = latLonVector(THREE, solarPoint.lat, solarPoint.lon, 1).normalize();
      earthMaterial.uniforms.sunDirection.value.copy(objectDirection);
      sun.position.copy(objectDirection.clone().applyQuaternion(world.quaternion).multiplyScalar(7));
    };
    syncSolarLight();
    const rim = new THREE.PointLight(0x6f83ff, 15, 18);
    rim.position.set(4, -1, -3);
    scene.add(rim);

    const starsGeometry = new THREE.BufferGeometry();
    const backgroundStarCount = compactRenderer ? 720 : 1500;
    const positions = new Float32Array(backgroundStarCount * 3);
    for (let i = 0; i < backgroundStarCount; i++) {
      const radius = 14 + Math.random() * 36;
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);
      positions[i * 3] = radius * Math.sin(phi) * Math.cos(theta);
      positions[i * 3 + 1] = radius * Math.cos(phi);
      positions[i * 3 + 2] = radius * Math.sin(phi) * Math.sin(theta);
    }
    starsGeometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    scene.add(new THREE.Points(starsGeometry, new THREE.PointsMaterial({ color: 0xe8efff, size: 0.027, transparent: true, opacity: 0.78, sizeAttenuation: true })));

    const activityPointMaterial = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      vertexColors: true,
      transparent: true,
      opacity: .68,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const activityPoints = new THREE.InstancedMesh(new THREE.SphereGeometry(.028, 12, 12), activityPointMaterial, 128);
    activityPoints.count = 0;
    activityPoints.frustumCulled = false;
    world.add(activityPoints);
    const observationPointMaterial = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      vertexColors: true,
      transparent: true,
      opacity: .8,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const observationPoints = new THREE.InstancedMesh(new THREE.SphereGeometry(.034, 12, 12), observationPointMaterial, 128);
    observationPoints.count = 0;
    observationPoints.frustumCulled = false;
    world.add(observationPoints);
    const observationHaloMaterial = new THREE.MeshBasicMaterial({
      color: 0xffb869,
      transparent: true,
      opacity: .34,
      side: THREE.DoubleSide,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const observationHalos = new THREE.InstancedMesh(new THREE.RingGeometry(.052, .078, 26), observationHaloMaterial, 128);
    observationHalos.count = 0;
    observationHalos.frustumCulled = false;
    world.add(observationHalos);
    const observationDummy = new THREE.Object3D();
    const updateObservationVisuals = (nextObservations: EarthObservationPoint[], layer: EarthDataLayer) => {
      nextObservations.slice(0, 128).forEach((point, index) => {
        const position = latLonVector(THREE, point.lat, point.lon, 2.258);
        const scale = layer === "aurora" ? .55 + point.intensity * 1.9 : .8 + point.intensity * 1.2;
        observationDummy.position.copy(position);
        observationDummy.quaternion.identity();
        observationDummy.scale.setScalar(scale);
        observationDummy.updateMatrix();
        observationPoints.setMatrixAt(index, observationDummy.matrix);
        const color = layer === "aurora"
          ? new THREE.Color(0x63e9c4).lerp(new THREE.Color(0xb69cff), Math.min(1, point.intensity * .72))
          : point.category.toLowerCase().includes("wildfire")
            ? new THREE.Color(0xff8b5e)
            : point.category.toLowerCase().includes("volcano")
              ? new THREE.Color(0xffc06d)
              : new THREE.Color(0x8dd9ea);
        observationPoints.setColorAt(index, color);
        if (layer === "events") {
          observationDummy.position.copy(position.clone().multiplyScalar(1.003));
          observationDummy.lookAt(position.clone().multiplyScalar(2));
          observationDummy.scale.setScalar(scale);
          observationDummy.updateMatrix();
          observationHalos.setMatrixAt(index, observationDummy.matrix);
        }
      });
      observationPoints.count = Math.min(128, nextObservations.length);
      observationHalos.count = layer === "events" ? Math.min(128, nextObservations.length) : 0;
      observationPoints.instanceMatrix.needsUpdate = true;
      observationHalos.instanceMatrix.needsUpdate = true;
      if (observationPoints.instanceColor) observationPoints.instanceColor.needsUpdate = true;
    };
    updateObservationVisuals(observationsRef.current, earthDataLayerRef.current);
    const activityBridgeMaterial = new THREE.LineDashedMaterial({
      color: 0xa4f4db,
      transparent: true,
      opacity: .18,
      dashSize: .045,
      gapSize: .038,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const activityBridge = new THREE.Line(new THREE.BufferGeometry(), activityBridgeMaterial);
    activityBridge.visible = false;
    world.add(activityBridge);
    const activityDummy = new THREE.Object3D();
    let activityCellCount = 0;
    let activityRecentStrength = 0;

    const updateActivityVisuals = (snapshot: DailyActivitySnapshot) => {
      const visibleCells = snapshot.cells.filter((cell) => cell.intensity > 0).slice(0, 128);
      activityCellCount = visibleCells.length;
      activityRecentStrength = visibleCells.reduce((sum, cell) => sum + cell.recentCount, 0) / Math.max(1, visibleCells.length * 3);
      visibleCells.forEach((cell, index) => {
        activityDummy.position.copy(latLonVector(THREE, cell.centroidLat, cell.centroidLon, 2.247));
        const scale = .7 + cell.intensity * 2.05;
        activityDummy.scale.setScalar(scale);
        activityDummy.updateMatrix();
        activityPoints.setMatrixAt(index, activityDummy.matrix);
        const color = new THREE.Color(0x8b70ff);
        const total = Math.max(1, cell.textCount);
        color.lerp(new THREE.Color(0x63e7c8), Math.min(.42, cell.replyCount / total));
        color.lerp(new THREE.Color(0xffc46b), Math.min(.38, cell.wishCount / total));
        activityPoints.setColorAt(index, color);
      });
      activityPoints.count = activityCellCount;
      activityPoints.instanceMatrix.needsUpdate = true;
      if (activityPoints.instanceColor) activityPoints.instanceColor.needsUpdate = true;

      const dayCells = visibleCells.filter((cell) => ["day", "dawn"].includes(solarPhaseAt(cell.centroidLat, cell.centroidLon)));
      const nightCells = visibleCells.filter((cell) => ["night", "dusk"].includes(solarPhaseAt(cell.centroidLat, cell.centroidLon)));
      const from = dayCells[0];
      const to = nightCells[0];
      if (from && to && from.cellId !== to.cellId) {
        const start = latLonVector(THREE, from.centroidLat, from.centroidLon, 2.258);
        const end = latLonVector(THREE, to.centroidLat, to.centroidLon, 2.258);
        const angle = start.angleTo(end);
        const middle = start.clone().add(end);
        if (middle.lengthSq() < .001) middle.copy(start).cross(new THREE.Vector3(0, 1, 0));
        middle.normalize().multiplyScalar(2.7 + Math.min(.55, angle * .18));
        const curve = new THREE.QuadraticBezierCurve3(start, middle, end);
        activityBridge.geometry.dispose();
        activityBridge.geometry = new THREE.BufferGeometry().setFromPoints(curve.getPoints(72));
        activityBridge.computeLineDistances();
        activityBridge.visible = true;
      } else {
        activityBridge.visible = false;
      }
    };

    const setActivitySnapshot = (snapshot: DailyActivitySnapshot) => {
      const nextTexture = createActivityTexture(THREE, snapshot, activityTextureSize);
      activityTextures.add(nextTexture);
      if (activityTextureToDispose && activityTextureToDispose !== activityToTexture) {
        activityTextureToDispose.dispose();
        activityTextures.delete(activityTextureToDispose);
      }
      if (activityFromTexture !== activityToTexture && activityFromTexture !== activityTextureToDispose) {
        activityFromTexture.dispose();
        activityTextures.delete(activityFromTexture);
      }
      activityFromTexture = activityToTexture;
      activityToTexture = nextTexture;
      activityTextureToDispose = activityFromTexture;
      earthMaterial.uniforms.activityMapFrom.value = activityFromTexture;
      earthMaterial.uniforms.activityMapTo.value = activityToTexture;
      earthMaterial.uniforms.activityMix.value = 0;
      activityBlendStartedAt = performance.now();
      updateActivityVisuals(snapshot);
    };
    updateActivityVisuals(activityRef.current);

    const storyLayer = new THREE.Group();
    world.add(storyLayer);
    let markerMeshes: import("three").Mesh[] = [];
    let haloMeshes: import("three").Mesh[] = [];
    let lifeMaterials: { expiresAt: number; baseOpacity: number; material: import("three").Material & { opacity: number } }[] = [];
    let chainLineVisuals: { chain: string; expiresAt?: number; material: import("three").LineDashedMaterial }[] = [];
    const disposeObjectLayer = (layer: import("three").Group) => {
      layer.traverse((object) => {
        if (object === layer) return;
        const mesh = object as import("three").Mesh;
        mesh.geometry?.dispose?.();
        if (Array.isArray(mesh.material)) mesh.material.forEach((material) => material.dispose());
        else mesh.material?.dispose?.();
      });
      layer.clear();
    };
    const updateStoryVisuals = (nextStories: Story[]) => {
      disposeObjectLayer(storyLayer);
      markerMeshes = [];
      haloMeshes = [];
      lifeMaterials = [];
      chainLineVisuals = [];
      const chainGroups = Object.groupBy(nextStories, (story) => story.chain);
      const selectedChain = nextStories.find((story) => story.id === selectedRef.current)?.chain;

      Object.entries(chainGroups).forEach(([chain, chainStories]) => {
        const list = chainStories ?? [];
        if (list.length < 2) return;
        for (let i = 1; i < list.length; i++) {
          const start = latLonVector(THREE, list[i - 1].lat, list[i - 1].lon, 2.235);
          const end = latLonVector(THREE, list[i].lat, list[i].lon, 2.235);
          const edgeHash = stableHash(`${chain}-${list[i - 1].id}-${list[i].id}`);
          const lane = (stableHash(chain) % 9) - 4;
          const angle = start.angleTo(end);
          const axis = start.clone().cross(end);
          if (axis.lengthSq() < .0001) axis.crossVectors(start, new THREE.Vector3(0, 1, 0));
          if (axis.lengthSq() < .0001) axis.crossVectors(start, new THREE.Vector3(1, 0, 0));
          axis.normalize();
          const side = axis.multiplyScalar(lane * .035 + ((edgeHash % 5) - 2) * .012);
          const lift = 2.43 + Math.abs(lane) * .045 + Math.min(.36, angle * .18);
          const controlA = start.clone().lerp(end, .34).normalize().multiplyScalar(lift).add(side);
          const controlB = start.clone().lerp(end, .66).normalize().multiplyScalar(lift).add(side);
          const curve = new THREE.CubicBezierCurve3(start, controlA, controlB, end);
          const geometry = new THREE.BufferGeometry().setFromPoints(curve.getPoints(64));
          const baseOpacity = selectedChain === chain ? .68 : selectedChain ? .075 : .22;
          const material = new THREE.LineDashedMaterial({
            color: chainColor(chain), transparent: true, opacity: baseOpacity,
            dashSize: .035 + (edgeHash % 3) * .012, gapSize: .022 + (edgeHash % 4) * .009,
            blending: THREE.AdditiveBlending,
          });
          const line = new THREE.Line(geometry, material);
          line.computeLineDistances();
          storyLayer.add(line);
          const deadlines = list.map((story) => story.expiresAt).filter((value): value is number => typeof value === "number");
          chainLineVisuals.push({ chain, expiresAt: deadlines.length ? Math.max(...deadlines) : undefined, material });
        }
      });

      nextStories.forEach((story) => {
        const color = story.kind === "support" ? 0x9fe8dc : chainColor(story.chain);
        const markerSize = story.kind === "support" ? .055 : story.kind === "wish" ? .048 : .035;
        const markerMaterial = new THREE.MeshBasicMaterial({ color, transparent: true });
        const marker = new THREE.Mesh(new THREE.SphereGeometry(markerSize, 18, 18), markerMaterial);
        marker.position.copy(latLonVector(THREE, story.lat, story.lon, 2.235));
        marker.userData.storyId = story.id;
        marker.userData.expiresAt = story.expiresAt;
        storyLayer.add(marker);
        markerMeshes.push(marker);
        if (story.expiresAt) lifeMaterials.push({ expiresAt: story.expiresAt, baseOpacity: 1, material: markerMaterial });

        const halo = new THREE.Mesh(
          new THREE.RingGeometry(story.kind === "support" ? .086 : .065, story.kind === "support" ? .108 : .082, 28),
          new THREE.MeshBasicMaterial({ color, transparent: true, opacity: .42, side: THREE.DoubleSide, blending: THREE.AdditiveBlending }),
        );
        halo.position.copy(marker.position.clone().normalize().multiplyScalar(2.242));
        halo.lookAt(halo.position.clone().multiplyScalar(2));
        halo.userData.storyId = story.id;
        halo.userData.expiresAt = story.expiresAt;
        halo.userData.support = story.kind === "support";
        storyLayer.add(halo);
        haloMeshes.push(halo);

        story.replies.forEach((reply, replyIndex) => {
          const hash = stableHash(`${story.id}-${reply.id}`);
          const bearing = (hash % 360) * Math.PI / 180;
          const distance = .42 + (replyIndex % 3) * .17;
          const replyLat = reply.lat ?? Math.max(-88, Math.min(88, story.lat + Math.sin(bearing) * distance));
          const lonScale = Math.max(.3, Math.cos(story.lat * Math.PI / 180));
          const replyLon = reply.lon ?? story.lon + Math.cos(bearing) * distance / lonScale;
          const replyPoint = latLonVector(THREE, replyLat, replyLon, 2.244 + (replyIndex % 2) * .008);
          const microMaterial = new THREE.MeshBasicMaterial({ color, transparent: true });
          const micro = new THREE.Mesh(new THREE.SphereGeometry(.018 + Math.min(.012, reply.text.length / 12000), 12, 12), microMaterial);
          micro.position.copy(replyPoint);
          storyLayer.add(micro);
          const bend = marker.position.clone().add(replyPoint).normalize().multiplyScalar(2.31 + replyIndex * .012);
          const threadCurve = new THREE.QuadraticBezierCurve3(marker.position, bend, replyPoint);
          const thread = new THREE.Line(
            new THREE.BufferGeometry().setFromPoints(threadCurve.getPoints(18)),
            new THREE.LineBasicMaterial({ color, transparent: true, opacity: selectedChain === story.chain ? .52 : .16, blending: THREE.AdditiveBlending }),
          );
          storyLayer.add(thread);
          if (story.expiresAt) {
            lifeMaterials.push({ expiresAt: story.expiresAt, baseOpacity: 1, material: microMaterial });
            lifeMaterials.push({ expiresAt: story.expiresAt, baseOpacity: (thread.material as import("three").LineBasicMaterial).opacity, material: thread.material as import("three").LineBasicMaterial });
          }
        });
      });
    };
    updateStoryVisuals(storiesRef.current);

    const home = new THREE.Group();
    const homeCore = new THREE.Mesh(
      new THREE.SphereGeometry(.043, 20, 20),
      new THREE.MeshBasicMaterial({ color: 0x9fffe4 }),
    );
    const homeRing = new THREE.Mesh(
      new THREE.RingGeometry(.075, .087, 32),
      new THREE.MeshBasicMaterial({ color: 0x7ff2db, transparent: true, opacity: .72, side: THREE.DoubleSide, blending: THREE.AdditiveBlending }),
    );
    homeRing.position.z = .004;
    home.add(homeCore, homeRing);
    world.add(home);
    const updateHomePoint = (point: { lat: number; lon: number } | null) => {
      home.visible = Boolean(point);
      if (!point) return;
      home.position.copy(latLonVector(THREE, point.lat, point.lon, 2.25));
      home.lookAt(home.position.clone().multiplyScalar(2));
    };
    updateHomePoint(homePointRef.current);

    // A place choice must be visible before weather or reverse-geocoding finishes.
    // The marker uses light rather than a conventional map pin so it belongs to
    // KindChain's visual language while remaining legible on day, night and snow.
    const selectionGroup = new THREE.Group();
    selectionGroup.visible = false;
    const selectionRingMaterial = new THREE.MeshBasicMaterial({ color: 0xb9ffe8, transparent: true, opacity: .95, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false });
    const selectionHaloMaterial = new THREE.MeshBasicMaterial({ color: 0xc3a6ff, transparent: true, opacity: .58, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false });
    const selectionCoreMaterial = new THREE.MeshBasicMaterial({ color: 0xf7fff9, transparent: true, opacity: 1, blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false });
    const selectionBeamMaterial = new THREE.MeshBasicMaterial({ color: 0x9fffe1, transparent: true, opacity: .48, blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false });
    const selectionRing = new THREE.Mesh(new THREE.RingGeometry(.074, .099, 48), selectionRingMaterial);
    const selectionHalo = new THREE.Mesh(new THREE.RingGeometry(.124, .138, 64), selectionHaloMaterial);
    const selectionCore = new THREE.Mesh(new THREE.SphereGeometry(.037, 18, 18), selectionCoreMaterial);
    const selectionBeam = new THREE.Mesh(new THREE.CylinderGeometry(.003, .015, .38, 12, 1, true), selectionBeamMaterial);
    selectionBeam.rotation.x = Math.PI / 2;
    selectionBeam.position.z = .19;
    selectionCore.position.z = .38;
    selectionRing.renderOrder = 30;
    selectionHalo.renderOrder = 29;
    selectionCore.renderOrder = 31;
    selectionBeam.renderOrder = 28;
    selectionGroup.add(selectionRing, selectionHalo, selectionCore, selectionBeam);
    world.add(selectionGroup);

    const arrivalBloomGroup = new THREE.Group();
    arrivalBloomGroup.visible = false;
    const arrivalBloomMaterials = [
      new THREE.MeshBasicMaterial({ color: 0x80e9ff, transparent: true, opacity: 0, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false }),
      new THREE.MeshBasicMaterial({ color: 0xc99bff, transparent: true, opacity: 0, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false }),
      new THREE.MeshBasicMaterial({ color: 0xffd18c, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false }),
    ];
    const arrivalBloomRings = [
      new THREE.Mesh(new THREE.RingGeometry(.1, .122, 72), arrivalBloomMaterials[0]),
      new THREE.Mesh(new THREE.RingGeometry(.15, .17, 72), arrivalBloomMaterials[1]),
    ];
    const arrivalBloomCore = new THREE.Mesh(new THREE.SphereGeometry(.068, 24, 24), arrivalBloomMaterials[2]);
    arrivalBloomCore.position.z = .012;
    arrivalBloomRings.forEach((ring, index) => { ring.position.z = index * .004; ring.renderOrder = 41 + index; });
    arrivalBloomCore.renderOrder = 43;
    arrivalBloomGroup.add(...arrivalBloomRings, arrivalBloomCore);
    world.add(arrivalBloomGroup);
    let arrivalBloomStartedAt = -1;
    const bloomAt = (lat: number, lon: number) => {
      const radial = latLonVector(THREE, lat, lon, 1).normalize();
      arrivalBloomGroup.position.copy(radial.clone().multiplyScalar(2.262));
      arrivalBloomGroup.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), radial);
      arrivalBloomGroup.visible = true;
      arrivalBloomStartedAt = performance.now();
    };

    const journeyLayer = new THREE.Group();
    world.add(journeyLayer);
    let journeyVisuals: { journey: Journey; curve: import("three").QuadraticBezierCurve3; model: import("three").Group; trail: import("three").Line; mailRelay: boolean }[] = [];
    const assetMixers: import("three").AnimationMixer[] = [];
    const updateJourneyVisuals = (nextJourneys: Journey[]) => {
      assetMixers.forEach((mixer) => mixer.stopAllAction());
      assetMixers.length = 0;
      disposeObjectLayer(journeyLayer);
      journeyVisuals = [];
      nextJourneys.forEach((journey) => {
        const spec = TRANSPORTS[journey.mode];
        const start = latLonVector(THREE, journey.from.lat, journey.from.lon, 2.255);
        const end = latLonVector(THREE, journey.to.lat, journey.to.lon, 2.255);
        const angle = start.angleTo(end);
        const altitude = courierAltitudeFor(journey.mode);
        const middle = start.clone().add(end).normalize().multiplyScalar(altitude + angle * .22);
        const curve = new THREE.QuadraticBezierCurve3(start, middle, end);
        const trailGeometry = new THREE.BufferGeometry().setFromPoints(curve.getPoints(96));
        const trailMaterial = new THREE.LineDashedMaterial({ color: 0x8ce7e1, transparent: true, opacity: .62, dashSize: .055, gapSize: .035, blending: THREE.AdditiveBlending });
        const trail = new THREE.Line(trailGeometry, trailMaterial);
        trail.computeLineDistances();
        journeyLayer.add(trail);
        const model = createCourierModel(THREE, journey.mode, spec.color);
        model.scale.setScalar(journey.id === activeJourneyRef.current ? .42 : .31);
        // Couriers render at ~12px on the world stage — far too small to tap.
        // An invisible proxy sphere gives every courier a finger-sized hit
        // area (raycast sees it; the renderer never draws it).
        model.add(new THREE.Mesh(new THREE.SphereGeometry(.55, 8, 8), new THREE.MeshBasicMaterial({ visible: false })));
        journeyLayer.add(model);
        journeyVisuals.push({ journey, curve, model, trail, mailRelay: needsMailRelay(journey.mode, journey.distance) });
      });
    };
    updateJourneyVisuals(journeysRef.current);

    // First-contact coach mark: once per device, when a courier model is
    // actually on stage, point at it and say it can be tapped.
    let courierCoachPoll: number | null = null;
    const courierCoachDelay = window.setTimeout(() => {
      try { if (window.localStorage.getItem(COURIER_COACH_KEY)) return; } catch { return; }
      const tryShowCoach = () => {
        if (cancelled) return;
        if (journeyVisuals.some((visual) => visual.model.visible)) setCourierCoachVisible(true);
        else courierCoachPoll = window.setTimeout(tryShowCoach, 2600);
      };
      tryShowCoach();
    }, 9000);
    let coachFrame = 0;
    const coachWorldVector = new THREE.Vector3();
    const coachProjectVector = new THREE.Vector3();
    const positionCourierCoach = () => {
      if (coachFrame++ % 5 !== 0) return;
      const coachElement = coachRef.current;
      if (!coachElement) return;
      const anchor = journeyVisuals.find((visual) => visual.model.visible);
      if (!anchor) { coachElement.style.opacity = "0"; return; }
      anchor.model.getWorldPosition(coachWorldVector);
      const nearSide = coachWorldVector.angleTo(camera.position) < Math.PI / 2 - .12;
      coachProjectVector.copy(coachWorldVector).project(camera);
      const onScreen = nearSide && coachProjectVector.z < 1 && Math.abs(coachProjectVector.x) < .92 && Math.abs(coachProjectVector.y) < .86;
      if (!onScreen) { coachElement.style.opacity = "0"; return; }
      coachElement.style.opacity = "1";
      coachElement.style.left = `${(coachProjectVector.x * .5 + .5) * host.clientWidth}px`;
      coachElement.style.top = `${(-coachProjectVector.y * .5 + .5) * host.clientHeight}px`;
    };

    const courierAssetTimer = window.setTimeout(() => {
      if (cancelled || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
      void import("three/examples/jsm/loaders/GLTFLoader.js").then(({ GLTFLoader }) => {
        if (cancelled) return;
        const loader = new GLTFLoader();
        const fitAsset = (root: import("three").Object3D) => {
          const box = new THREE.Box3().setFromObject(root);
          const size = box.getSize(new THREE.Vector3());
          const maxSize = Math.max(size.x, size.y, size.z) || 1;
          const center = box.getCenter(new THREE.Vector3());
          root.position.sub(center);
          root.scale.setScalar(1 / maxSize);
        };
        journeyVisuals.forEach(({ journey, model }) => {
          if (journey.id.startsWith("journey-demo-world-") && journey.id !== activeJourneyRef.current) return;
          const urls = COURIER_ASSETS[journey.mode];
          if (!urls) return;
          void Promise.all(urls.map((url) => loader.loadAsync(url))).then((assets) => {
            if (cancelled) return;
            const assembly = new THREE.Group();
            assets.forEach((asset, index) => {
              const root = asset.scene;
              fitAsset(root);
              if (journey.mode === "carriage" && assets.length > 1) {
                root.position.x = index === 0 ? .28 : -.3;
                root.scale.multiplyScalar(index === 0 ? .8 : .7);
              }
              root.traverse((object) => {
                const mesh = object as import("three").Mesh;
                if (mesh.isMesh) {
                  mesh.castShadow = false;
                  mesh.receiveShadow = false;
                }
              });
              assembly.add(root);
              if (asset.animations.length) {
                const mixer = new THREE.AnimationMixer(root);
                const wanted = COURIER_CLIPS[journey.mode];
                const clips = wanted ? asset.animations.filter((clip) => wanted.includes(clip.name)) : [];
                (clips.length ? clips : [asset.animations[0]]).forEach((clip) => mixer.clipAction(clip).play());
                assetMixers.push(mixer);
              }
            });
            if (!journeyLayer.children.includes(model)) return;
            model.clear();
            model.add(assembly);
            model.add(new THREE.Mesh(new THREE.SphereGeometry(.55, 8, 8), new THREE.MeshBasicMaterial({ visible: false })));
          }).catch(() => { /* Procedural courier remains as the offline fallback. */ });
        });
      }).catch(() => { /* Procedural couriers remain available if the model loader cannot be fetched. */ });
    }, 2200);

    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    let pointerDown = false;
    let dragged = false;
    let lastX = 0;
    let lastY = 0;
    let startX = 0;
    let startY = 0;
    let gestureThreshold = 7;
    let gestureHadMultiplePointers = false;
    const activePointers = new Map<number, { x: number; y: number }>();
    let pinchDistance = 0;
    let cameraTarget = restoredView ? viewStateRef.current.cameraTarget : CAMERA_NEAR + (1 - INITIAL_EARTH_ZOOM) * (CAMERA_FAR - CAMERA_NEAR);
    let targetQuaternion: import("three").Quaternion | null = null;
    let focusLocked = restoredView ? viewStateRef.current.focusLocked : false;
    let autoRotateResumeAt = 0;
    let nearTriggered = false;
    const cameraNear = CAMERA_NEAR;
    const cameraFar = CAMERA_FAR;

    const updateCameraZoom = (delta: number) => {
      cameraTarget = THREE.MathUtils.clamp(cameraTarget + delta, cameraNear, cameraFar);
      const nextZoom = 1 - (cameraTarget - cameraNear) / (cameraFar - cameraNear);
      onZoomRef.current(nextZoom);
      if (delta < 0 && nextZoom >= LOCAL_HANDOFF_ZOOM && !nearTriggered) {
        nearTriggered = true;
        onNearRef.current();
      }
      if (nextZoom < MAP_MOUNT_DEPTH) nearTriggered = false;
    };
    const setCameraZoom = (targetZoom: number) => {
      const clamped = THREE.MathUtils.clamp(targetZoom, 0, 1);
      cameraTarget = cameraNear + (1 - clamped) * (cameraFar - cameraNear);
      onZoomRef.current(clamped);
      if (clamped >= LOCAL_HANDOFF_ZOOM && !nearTriggered) {
        nearTriggered = true;
        onNearRef.current();
      }
      if (clamped < MAP_MOUNT_DEPTH) nearTriggered = false;
    };

    const focusOn = (lat: number, lon: number, lock = true) => {
      const local = latLonVector(THREE, lat, lon, 1).normalize();
      const currentNormal = local.clone().applyQuaternion(world.quaternion).normalize();
      const delta = new THREE.Quaternion().setFromUnitVectors(currentNormal, new THREE.Vector3(0, 0, 1));
      targetQuaternion = delta.multiply(world.quaternion.clone()).normalize();
      focusLocked = lock;
    };
    const setSelection = (lat: number, lon: number) => {
      const radial = latLonVector(THREE, lat, lon, 1).normalize();
      selectionGroup.position.copy(radial.clone().multiplyScalar(2.215));
      selectionGroup.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), radial);
      selectionGroup.visible = true;
      const phase = solarPhaseAt(lat, lon);
      const phaseColor = phase === "day" ? 0xffd694 : phase === "dawn" ? 0xffaaa0 : phase === "dusk" ? 0xdca7ff : 0xaacaff;
      selectionRingMaterial.color.setHex(phaseColor);
      selectionCoreMaterial.color.setHex(phaseColor);
      selectionBeamMaterial.color.setHex(phaseColor);
    };
    const clearSelection = () => { selectionGroup.visible = false; };
    const setEarthAppearance = (appearance: { textureUrl: string; baseTextureUrl: string; lens: EarthLens; dataLayer: EarthDataLayer }) => {
      earthMaterial.uniforms.lensMode.value = appearance.lens === "night" ? 2 : appearance.lens === "daily" ? 1 : 0;
      earthMaterial.uniforms.kindnessVisibility.value = appearance.dataLayer === "kindness" ? 1 : .08;
      earthLensRef.current = appearance.lens;
      earthDataLayerRef.current = appearance.dataLayer;
      updateObservationVisuals(observationsRef.current, appearance.dataLayer);
      if (appearance.textureUrl !== boundTextureUrl || appearance.baseTextureUrl !== boundBaseTextureUrl) {
        boundTextureUrl = appearance.textureUrl;
        boundBaseTextureUrl = appearance.baseTextureUrl;
        syncEarthTextures(boundTextureUrl, boundBaseTextureUrl);
      }
    };
    apiRef.current = {
      focus: (lat, lon) => focusOn(lat, lon, true),
      zoom: updateCameraZoom,
      zoomTo: setCameraZoom,
      setActivity: setActivitySnapshot,
      setSelection,
      clearSelection,
      setStories: updateStoryVisuals,
      setJourneys: updateJourneyVisuals,
      setObservations: updateObservationVisuals,
      setHomePoint: updateHomePoint,
      setEarthAppearance,
      setLocale: updateGeoLabelLocale,
      bloomAt,
    };
    if (activePointRef.current) setSelection(activePointRef.current.lat, activePointRef.current.lon);
    if (arrivalBloomRef.current) bloomAt(arrivalBloomRef.current.lat, arrivalBloomRef.current.lon);
    if (!restoredView || focusRef.current.nonce !== lastAppliedFocusNonceRef.current) {
      focusOn(focusRef.current.lat, focusRef.current.lon, focusRef.current.nonce > 0);
      lastAppliedFocusNonceRef.current = focusRef.current.nonce;
    }
    if (zoomCommandRef.current.nonce > lastZoomNonceRef.current) {
      if (zoomCommandRef.current.targetZoom === undefined) updateCameraZoom(zoomCommandRef.current.delta);
      else setCameraZoom(zoomCommandRef.current.targetZoom);
      lastZoomNonceRef.current = zoomCommandRef.current.nonce;
    }

    const setPointer = (event: PointerEvent | WheelEvent) => {
      const rect = renderer.domElement.getBoundingClientRect();
      pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    };
    // Hover affordance: stars and couriers announce their tappability with a
    // pointer cursor (and couriers with a glow-scale in the animate loop),
    // instead of leaving discovery to luck.
    let hoveredCourierId: string | null = null;
    let lastHoverProbe = 0;
    const hoverProbe = (event: PointerEvent) => {
      const nowMs = performance.now();
      if (nowMs - lastHoverProbe < 90) return;
      lastHoverProbe = nowMs;
      setPointer(event);
      raycaster.setFromCamera(pointer, camera);
      let cursor = "";
      let nextHovered: string | null = null;
      if (!pickingPlaceRef.current) {
        if (raycaster.intersectObjects(markerMeshes, false).length > 0) cursor = "pointer";
        else {
          const visibleModels = journeyVisuals.filter((visual) => visual.model.visible).map((visual) => visual.model);
          const hit = raycaster.intersectObjects(visibleModels, true)[0];
          if (hit) {
            let node: import("three").Object3D | null = hit.object;
            while (node && !visibleModels.includes(node as import("three").Group)) node = node.parent;
            const visual = journeyVisuals.find((item) => item.model === node);
            if (visual) {
              nextHovered = visual.journey.id;
              cursor = "pointer";
            }
          }
        }
      }
      hoveredCourierId = nextHovered;
      renderer.domElement.style.cursor = cursor;
    };
    const down = (event: PointerEvent) => {
      if (event.pointerType === "mouse" && event.button !== 0) return;
      activePointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
      pointerDown = true;
      if (activePointers.size === 1) {
        dragged = false;
        gestureHadMultiplePointers = false;
        gestureThreshold = event.pointerType === "touch" ? 14 : 7;
        startX = event.clientX;
        startY = event.clientY;
        lastX = event.clientX;
        lastY = event.clientY;
      } else if (activePointers.size === 2) {
        const [a, b] = [...activePointers.values()];
        pinchDistance = Math.hypot(a.x - b.x, a.y - b.y);
        dragged = true;
        gestureHadMultiplePointers = true;
      }
      renderer.domElement.setPointerCapture(event.pointerId);
    };
    const move = (event: PointerEvent) => {
      if (!pointerDown && event.pointerType === "mouse") hoverProbe(event);
      if (!activePointers.has(event.pointerId)) return;
      activePointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
      if (activePointers.size >= 2) {
        const [a, b] = [...activePointers.values()];
        const nextDistance = Math.hypot(a.x - b.x, a.y - b.y);
        if (pinchDistance > 0) updateCameraZoom((pinchDistance - nextDistance) * .008);
        onInteractRef.current();
        pinchDistance = nextDistance;
        dragged = true;
        gestureHadMultiplePointers = true;
        return;
      }
      if (!pointerDown) return;
      const dx = event.clientX - lastX;
      const dy = event.clientY - lastY;
      const totalDistance = Math.hypot(event.clientX - startX, event.clientY - startY);
      if (!dragged && totalDistance >= gestureThreshold) {
        dragged = true;
        targetQuaternion = null;
        focusLocked = false;
        onInteractRef.current();
      }
      if (dragged) {
        world.rotation.y += dx * 0.006;
        world.rotation.x += dy * 0.0055;
      }
      lastX = event.clientX; lastY = event.clientY;
    };
    const cancelPointer = () => {
      if (dragged) autoRotateResumeAt = performance.now() + 4200;
      activePointers.clear(); pointerDown = false; dragged = false; pinchDistance = 0; gestureHadMultiplePointers = false;
    };
    const up = (event: PointerEvent) => {
      const wasSinglePointer = activePointers.size === 1;
      const wasTap = wasSinglePointer && !dragged && !gestureHadMultiplePointers
        && Math.hypot(event.clientX - startX, event.clientY - startY) < gestureThreshold;
      activePointers.delete(event.pointerId);
      pointerDown = activePointers.size > 0;
      if (activePointers.size === 1) {
        const remaining = [...activePointers.values()][0];
        lastX = remaining.x;
        lastY = remaining.y;
      }
      if (!wasTap && activePointers.size === 0) autoRotateResumeAt = performance.now() + 4200;
      if (!wasTap) return;
      onInteractRef.current();
      setPointer(event);
      raycaster.setFromCamera(pointer, camera);
      if (!pickingPlaceRef.current) {
        const hitMarker = raycaster.intersectObjects(markerMeshes, false)[0];
        if (hitMarker) {
          const story = storiesRef.current.find((item) => item.id === hitMarker.object.userData.storyId);
          if (story) onSelectRef.current(story);
          return;
        }
        // Couriers are tappable while their model presentation is on stage:
        // opening the cargo card answers "what is this messenger carrying?".
        const visibleCourierModels = journeyVisuals.filter((visual) => visual.model.visible).map((visual) => visual.model);
        const hitCourier = raycaster.intersectObjects(visibleCourierModels, true)[0];
        if (hitCourier) {
          let node: import("three").Object3D | null = hitCourier.object;
          while (node && !visibleCourierModels.includes(node as import("three").Group)) node = node.parent;
          const visual = journeyVisuals.find((item) => item.model === node);
          if (visual) {
            try { window.localStorage.setItem(COURIER_COACH_KEY, "1"); } catch { /* private mode */ }
            setCourierCoachVisible(false);
            onSelectJourneyRef.current(visual.journey);
            return;
          }
        }
      }
      const hitEarth = raycaster.intersectObject(earth, false)[0];
      if (hitEarth) {
        const local = earth.worldToLocal(hitEarth.point.clone());
        const point = vectorLatLon(local);
        onPickRef.current(point.lat, point.lon);
      }
    };
    const wheel = (event: WheelEvent) => {
      event.preventDefault();
      onInteractRef.current();
      updateCameraZoom(event.deltaY * 0.0034);
    };
    renderer.domElement.addEventListener("pointerdown", down);
    renderer.domElement.addEventListener("pointermove", move);
    renderer.domElement.addEventListener("pointerup", up);
    renderer.domElement.addEventListener("pointercancel", cancelPointer);
    renderer.domElement.addEventListener("lostpointercapture", cancelPointer);
    renderer.domElement.addEventListener("wheel", wheel, { passive: false });

    const resize = () => {
      if (!host) return;
      camera.aspect = host.clientWidth / host.clientHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(host.clientWidth, host.clientHeight);
    };
    window.addEventListener("resize", resize);

    let solarFrame = 0;
    const clock = new THREE.Clock();
    const animate = () => {
      frame = requestAnimationFrame(animate);
      const dt = Math.min(clock.getDelta(), .05);
      const t = clock.elapsedTime;
      if (activityBlendStartedAt > 0) {
        const blend = Math.min(1, (performance.now() - activityBlendStartedAt) / 2200);
        earthMaterial.uniforms.activityMix.value = blend * blend * (3 - 2 * blend);
        if (blend >= 1) {
          activityBlendStartedAt = 0;
          if (activityTextureToDispose && activityTextureToDispose !== activityToTexture) {
            activityTextureToDispose.dispose();
            activityTextures.delete(activityTextureToDispose);
          }
          activityTextureToDispose = null;
          activityFromTexture = activityToTexture;
          earthMaterial.uniforms.activityMapFrom.value = activityToTexture;
          earthMaterial.uniforms.activityMapTo.value = activityToTexture;
        }
      }
      if (solarFrame++ % 240 === 0) syncSolarLight();
      positionCourierCoach();
      assetMixers.forEach((mixer) => mixer.update(dt));
      if (!pointerDown && !targetQuaternion && !focusLocked && performance.now() >= autoRotateResumeAt) world.rotation.y += dt * .0168;
      if (targetQuaternion) {
        world.quaternion.slerp(targetQuaternion, 1 - Math.exp(-dt * 3.4));
        if (world.quaternion.angleTo(targetQuaternion) < 0.008) targetQuaternion = null;
      }
      sun.position.copy(earthMaterial.uniforms.sunDirection.value.clone().applyQuaternion(world.quaternion).multiplyScalar(7));
      camera.position.z += (cameraTarget - camera.position.z) * (1 - Math.exp(-dt * 3.7));
      world.quaternion.toArray(viewStateRef.current.quaternion);
      viewStateRef.current.cameraZ = camera.position.z;
      viewStateRef.current.cameraTarget = cameraTarget;
      viewStateRef.current.focusLocked = focusLocked;
      viewStateRef.current.initialized = true;
      atmosphere.scale.setScalar(1 + Math.sin(t * 0.42) * 0.004);
      const activityLimit = camera.position.z > 7.3 ? 48 : camera.position.z > 5.95 ? 96 : 128;
      activityPoints.count = Math.min(activityCellCount, activityLimit);
      activityPointMaterial.opacity = .58 + Math.sin(t * (1.35 + Math.min(1, activityRecentStrength) * 1.8)) * (.055 + Math.min(1, activityRecentStrength) * .09);
      observationPointMaterial.opacity = earthDataLayerRef.current === "aurora" ? .48 + Math.sin(t * .74) * .14 : .72 + Math.sin(t * 1.4) * .12;
      observationHaloMaterial.opacity = .2 + Math.sin(t * 1.15) * .09;
      activityBridgeMaterial.opacity = .13 + Math.sin(t * .8) * .035;
      activityBridgeMaterial.dashOffset -= dt * .075;
      const labelStage = zoomStageRef.current;
      geoLabelVisuals.forEach(({ definition, sprite }) => {
        sprite.visible = definition.kind === "ocean"
          ? labelStage === "EARTH" || labelStage === "CONTINENT"
          : definition.kind === "continent"
            ? labelStage === "CONTINENT" || labelStage === "COUNTRY"
            : labelStage === "COUNTRY" || labelStage === "REGION";
      });
      const frameNow = Date.now();
      lifeMaterials.forEach(({ expiresAt, baseOpacity, material }) => { material.opacity = baseOpacity * lifeAlpha(expiresAt, frameNow); });
      const selectedChain = storiesRef.current.find((story) => story.id === selectedRef.current)?.chain;
      chainLineVisuals.forEach(({ chain, expiresAt, material }) => {
        const baseOpacity = selectedChain ? (chain === selectedChain ? .68 : .075) : .22;
        material.opacity = baseOpacity * lifeAlpha(expiresAt, frameNow);
      });
      haloMeshes.forEach((halo, index) => {
        const active = halo.userData.storyId === selectedRef.current;
        const held = heldRef.current.has(halo.userData.storyId as string);
        const supportSignal = Boolean(halo.userData.support);
        const lifetime = lifeAlpha(halo.userData.expiresAt as number | undefined, frameNow);
        const pulse = 1 + Math.sin(t * (supportSignal ? 1.08 : 2.2) + index) * (supportSignal ? .23 : .16);
        halo.scale.setScalar(active ? pulse * 1.7 : held ? pulse * 1.28 : supportSignal ? pulse * 1.18 : pulse);
        (halo.material as import("three").MeshBasicMaterial).opacity = (active ? 0.95 : held ? .62 : supportSignal ? .52 : 0.32) * lifetime;
      });
      if (selectionGroup.visible) {
        const breathe = 1 + Math.sin(t * 2.35) * .075;
        const wave = 1.05 + ((t * .42) % 1) * .82;
        selectionRing.scale.setScalar(breathe);
        selectionHalo.scale.setScalar(wave);
        selectionHaloMaterial.opacity = .68 * (1 - ((t * .42) % 1));
        selectionCoreMaterial.opacity = .88 + Math.sin(t * 3.1) * .12;
      }
      homeRing.scale.setScalar(1 + Math.sin(t * 1.2) * .11);
      (homeRing.material as import("three").MeshBasicMaterial).opacity = .58 + Math.sin(t * 1.2) * .12;
      if (arrivalBloomStartedAt >= 0) {
        const duration = reducedMotion ? 900 : 3400;
        const progress = Math.min(1, (performance.now() - arrivalBloomStartedAt) / duration);
        const eased = 1 - Math.pow(1 - progress, 3);
        const fade = progress < .22 ? progress / .22 : Math.max(0, 1 - (progress - .22) / .78);
        arrivalBloomRings[0].scale.setScalar(.72 + eased * 2.75);
        arrivalBloomRings[1].scale.setScalar(.58 + eased * 4.1);
        arrivalBloomCore.scale.setScalar(.8 + Math.sin(progress * Math.PI) * 2.2);
        arrivalBloomMaterials[0].opacity = fade * .72;
        arrivalBloomMaterials[1].opacity = fade * .46;
        arrivalBloomMaterials[2].opacity = fade * .88;
        if (progress >= 1) {
          arrivalBloomStartedAt = -1;
          arrivalBloomGroup.visible = false;
        }
      }
      markerMeshes.forEach((marker) => marker.scale.setScalar(marker.userData.storyId === selectedRef.current ? 1.8 : heldRef.current.has(marker.userData.storyId as string) ? 1.3 : 1));
      journeyVisuals.forEach(({ journey, curve, model, trail, mailRelay }, index) => {
        const presentation = courierPresentationAtZoom(journey.mode, zoomStageRef.current);
        const progress = journeyProgress(journey);
        const arrived = !journey.id.startsWith("journey-demo-world-") && progress >= 1;
        const onLandLeg = !mailRelay || progress <= .1 || progress >= .9;
        model.visible = !arrived && presentation === "model" && onLandLeg;
        trail.visible = !arrived && presentation !== "hidden" && !mailRelay;
        const point = curve.getPoint(progress);
        const tangent = curve.getTangent(progress).normalize();
        model.position.copy(point);
        model.lookAt(point.clone().add(tangent));
        const flutter = journey.mode === "pigeon" ? Math.sin(t * 13) : 0;
        model.children.forEach((child) => {
          if (child.userData.wing) child.rotation.x = child.userData.wing * (1.05 + flutter * .52);
        });
        const active = journey.id === activeJourneyRef.current;
        const hovered = journey.id === hoveredCourierId;
        const nearScale = THREE.MathUtils.mapLinear(camera.position.z, cameraNear, cameraFar, active ? .25 : .18, active ? .44 : .31);
        model.scale.setScalar(nearScale * (hovered ? 1.38 : 1) * (1 + Math.sin(t * 2 + index) * .025));
        const trailMaterial = trail.material as import("three").LineDashedMaterial;
        trailMaterial.opacity = presentation === "trace" ? (active ? .32 : .14) : hovered ? .95 : active ? .86 : .34;
        trailMaterial.dashOffset -= dt * (active ? .18 : .09);
      });
      try {
        renderer.render(scene, camera);
        if (!firstFrameReady) {
          firstFrameReady = true;
          host.classList.remove("no-webgl");
          host.classList.add("has-webgl");
          setRenderMode("webgl");
        }
      } catch {
        showStaticFallback();
      }
    };
    animate();

    cleanup = () => {
      world.quaternion.toArray(viewStateRef.current.quaternion);
      viewStateRef.current.cameraZ = camera.position.z;
      viewStateRef.current.cameraTarget = cameraTarget;
      viewStateRef.current.focusLocked = focusLocked;
      viewStateRef.current.initialized = true;
      cancelAnimationFrame(frame);
      window.clearTimeout(courierAssetTimer);
      window.clearTimeout(courierCoachDelay);
      if (courierCoachPoll !== null) window.clearTimeout(courierCoachPoll);
      window.removeEventListener("resize", resize);
      renderer.domElement.removeEventListener("pointerdown", down);
      renderer.domElement.removeEventListener("pointermove", move);
      renderer.domElement.removeEventListener("pointerup", up);
      renderer.domElement.removeEventListener("pointercancel", cancelPointer);
      renderer.domElement.removeEventListener("lostpointercapture", cancelPointer);
      renderer.domElement.removeEventListener("wheel", wheel);
      renderer.domElement.removeEventListener("webglcontextlost", onWebglContextLost);
      localEarthTexture.dispose();
      remoteEarthTextures.forEach((texture) => texture.dispose());
      remoteEarthTextures.clear();
      activityTextures.forEach((texture) => texture.dispose());
      activityTextures.clear();
      geoLabelVisuals.forEach(({ texture }) => texture.dispose());
      earthMaterial.dispose();
      atmosphereMaterial.dispose();
      scene.traverse((object) => {
        const mesh = object as import("three").Mesh;
        mesh.geometry?.dispose?.();
        if (Array.isArray(mesh.material)) mesh.material.forEach((material) => material.dispose());
        else mesh.material?.dispose?.();
      });
      renderer.dispose();
      renderer.domElement.remove();
      host.classList.remove("has-webgl");
      apiRef.current = null;
    };
    }).catch(() => {
      if (!cancelled) {
        host.classList.add("no-webgl");
        setRenderMode("fallback");
      }
    });

    return () => {
      cancelled = true;
      cleanup?.();
    };
  // The renderer and physical Earth intentionally mount once. Live messages,
  // journeys, NASA layers and textures are reconciled through WorldApi so a
  // data refresh can never tear down the canvas or recenter the planet.
  }, []);

  const fallbackBackgroundPosition = `${fallbackBackgroundX(focus.lon)}% center`;

  return <div className={`world-canvas lens-${earthLens} data-${earthDataLayer} ${renderMode === "webgl" ? "has-webgl" : renderMode === "fallback" ? "no-webgl" : ""} ${pickingPlace ? "is-picking-place" : ""}`} ref={mountRef} aria-label="Draggable 3D Earth with KindChain stars">
    {courierCoachVisible && renderMode === "webgl" && <div className="courier-coach" ref={coachRef} role="status">
      <span>{locale === "zh" ? "点点看这位信使 · 看它驮着什么" : "Tap this courier — see what it carries"}</span>
      <button type="button" onClick={dismissCourierCoach} aria-label={locale === "zh" ? "知道了" : "Got it"}>×</button>
      <b aria-hidden="true" />
    </div>}
    <div className="world-fallback">
      <div className="fallback-orbit orbit-a" /><div className="fallback-orbit orbit-b" />
      <div className="fallback-globe" style={{ backgroundImage: `url(${baseTextureUrl})`, backgroundPosition: fallbackBackgroundPosition }}>
        <div className="fallback-daily" style={{ backgroundImage: `url(${textureUrl})`, backgroundPosition: fallbackBackgroundPosition }} />
        <div className="fallback-night" />
        <div className="fallback-atmosphere" />
        {activity.cells.slice(0, 32).map((cell) => {
          const point = fallbackProjectedPoint(cell.centroidLat, cell.centroidLon, focus.lon);
          return point.visible ? <span
            key={cell.cellId}
            className={`fallback-activity band-${cell.band}`}
            style={{ left: `${point.x}%`, top: `${point.y}%`, "--activity": String(cell.intensity) } as CSSProperties}
            aria-hidden="true"
          /> : null;
        })}
        {observations.slice(0, 48).map((observation) => {
          const point = fallbackProjectedPoint(observation.lat, observation.lon, focus.lon);
          return point.visible ? <span
            key={observation.id}
            className={`fallback-observation observation-${earthDataLayer}`}
            style={{ left: `${point.x}%`, top: `${point.y}%`, "--observation": String(observation.intensity) } as CSSProperties}
            title={observation.title}
            aria-hidden="true"
          /> : null;
        })}
        <div className="fallback-chain-lines" />
        {activePoint && (() => {
          const point = fallbackProjectedPoint(activePoint.lat, activePoint.lon, focus.lon);
          return point.visible ? <span className="fallback-selection" style={{ left: `${point.x}%`, top: `${point.y}%` }}><i /></span> : null;
        })()}
        {arrivalBloom && (() => {
          const point = fallbackProjectedPoint(arrivalBloom.lat, arrivalBloom.lon, focus.lon);
          return point.visible ? <span key={arrivalBloom.nonce} className="fallback-arrival-bloom" style={{ left: `${point.x}%`, top: `${point.y}%` }}><i /><i /><b /></span> : null;
        })()}
        {stories.map((story, index) => {
          const point = fallbackProjectedPoint(story.lat, story.lon, focus.lon);
          return point.visible ? <button key={story.id} disabled={pickingPlace} className={`fallback-star chain-${index % 3} ${story.kind === "support" ? "support" : ""} ${story.id === selectedId ? "active" : ""} ${heldStoryIds.includes(story.id) ? "held" : ""}`} style={{ left: `${Math.max(7, Math.min(93, point.x))}%`, top: `${Math.max(9, Math.min(91, point.y))}%` }} onClick={(event) => { event.stopPropagation(); onSelect(story); }} aria-label={`${story.kind === "support" ? "Companion signal — " : ""}${story.region}: ${story.text}`}><i /></button> : null;
        })}
        {journeys.filter((journey) => courierPresentationAtZoom(journey.mode, zoomStage) !== "hidden").map((journey) => {
          const start = fallbackProjectedPoint(journey.from.lat, journey.from.lon, focus.lon);
          const end = fallbackProjectedPoint(journey.to.lat, journey.to.lon, focus.lon);
          if (!start.visible && !end.visible) return null;
          const startX = Math.max(5, Math.min(95, start.x));
          const startY = Math.max(7, Math.min(93, start.y));
          const endX = Math.max(5, Math.min(95, end.x));
          const endY = Math.max(7, Math.min(93, end.y));
          const presentation = courierPresentationAtZoom(journey.mode, zoomStage);
          const mailRelay = needsMailRelay(journey.mode, journey.distance);
          return <button key={journey.id} type="button" className={`fallback-courier courier-${journey.mode} presentation-${presentation} ${journey.id.startsWith("journey-demo-world-") ? "demo-loop" : ""} ${mailRelay ? "mail-relay" : ""} ${journey.id === activeJourneyId ? "active" : ""}`} title={mailRelay ? (locale === "zh" ? "多段邮路：在海岸交给下一位信使" : "Multi-stage mail relay with a coastal handoff") : undefined} style={{ "--sx": `${startX}%`, "--sy": `${startY}%`, "--ex": `${endX}%`, "--ey": `${endY}%`, "--duration": `${Math.max(18, journey.demoDurationMs / 1000)}s` } as CSSProperties} onClick={(event) => { event.stopPropagation(); onSelectJourney(journey); }} aria-label={`${TRANSPORTS[journey.mode].names[locale]} · ${journey.from.label} → ${journey.to.label}`}><i>{TRANSPORTS[journey.mode].glyph}</i></button>;
        })}
      </div>
    </div>
  </div>;
}

function WeatherWall({ environment, weather, identity, profile, strength, point, sceneSeed }: { environment: Environment; weather: Weather; identity: BackgroundIdentity; profile: PlaceProfile; strength: number; point: { lat: number; lon: number }; sceneSeed: number }) {
  const rain = environment.weather === "rain" || environment.weather === "storm";
  const snow = environment.weather === "snow";
  const dusty = environment.hazard === "dust";
  const heated = environment.hazard === "heat" || environment.hazard === "dry";
  const composition = stableHash(`${profile.id}:${Math.round(point.lat * 2)}:${Math.round(point.lon * 2)}:${sceneSeed}`);
  const wallStyle = {
    "--wall-strength": String(strength),
    "--sky-zenith": profile.palette.zenith,
    "--sky-horizon": profile.palette.horizon,
    "--terrain-far": profile.palette.far,
    "--terrain-near": profile.palette.near,
    "--water-glint": profile.palette.water,
    "--settlement-glow": profile.palette.glow,
    "--place-focus-x": `${28 + composition % 45}%`,
    "--terrain-shift": `${(composition % 5) - 2}vh`,
    "--terrain-tilt": `${((composition >>> 4) % 5) - 2}deg`,
    "--scene-pan": `${(composition % 27) - 13}%`,
    "--scene-lift": `${((composition >>> 3) % 9) - 4}vh`,
    "--scene-stretch": String(.88 + ((composition >>> 7) % 26) / 100),
    "--scene-depth": String(.72 + ((composition >>> 11) % 29) / 100),
    "--scene-light-x": `${12 + ((composition >>> 14) % 76)}%`,
    "--scene-grain": `${34 + ((composition >>> 18) % 42)}px`,
    "--humidity": String(Math.max(0, Math.min(1, weather.humidity / 100))),
    "--cloud-cover": String(Math.max(0, Math.min(1, weather.cloud / 100))),
    "--wind-force": String(Math.max(0, Math.min(1, weather.wind / 55))),
    "--wind-angle": `${(composition % 52) - 26}deg`,
    "--celestial-x": `${identity.celestialX}%`,
  } as CSSProperties;
  return (
    <div className={`weather-wall place-${profile.id} composition-${composition % 3} scene-layout-${composition % 8} scene-light-${(composition >>> 5) % 5} time-${environment.time} weather-${environment.weather} biome-${environment.biome} hazard-${environment.hazard} season-${identity.season} latitude-${identity.latitude} air-${identity.air} wind-${identity.wind} settlement-${identity.settlement} material-${identity.material} ${environment.aurora ? "aurora-active" : ""}`} style={wallStyle} aria-hidden="true">
      <div className="cosmic-nebula"><i /><i /><i /></div>
      <div className="sky-depth">{Array.from({ length: 9 }, (_, i) => <i key={i} />)}</div>
      <div className="aurora-field"><i /><i /><i /></div>
      <div className="horizon-light"><i /></div>
      <div className="celestial-clock"><i /><b /><em /></div>
      <div className="air-current">{Array.from({ length: 8 }, (_, i) => <i key={i} />)}</div>
      <div className="season-field">{Array.from({ length: 12 }, (_, i) => <i key={i} />)}</div>
      <div className="scene-weave"><i /><i /><i /><i /><i /></div>
      <div className="cinematic-landscape"><i /><i /><i /><b /><em /><span /></div>
      {environment.weather !== "clear" && <div className="cloud-volume"><i /><i /><i /></div>}
      {rain && <div className="rain-field">{Array.from({ length: 18 }, (_, i) => <i key={i} style={{ left: `${(i * 31) % 100}%`, animationDelay: `${-(i % 9) * 0.18}s`, animationDuration: `${0.7 + (i % 5) * 0.15}s` }} />)}</div>}
      {snow && <div className="snow-field">{Array.from({ length: 16 }, (_, i) => <i key={i} style={{ left: `${(i * 43) % 100}%`, animationDelay: `${-(i % 11) * 0.7}s`, animationDuration: `${5 + (i % 6)}s` }}>·</i>)}</div>}
      {heated && <div className="heat-field"><i /><i /></div>}
      {dusty && <div className="dust-field">{Array.from({ length: 18 }, (_, i) => <i key={i} style={{ left: `${(i * 47) % 104 - 2}%`, top: `${(i * 29) % 86 + 5}%`, animationDelay: `${-(i % 13) * .43}s` }} />)}</div>}
      {environment.weather === "fog" && <div className="fog-field"><i /><i /></div>}
      <div className="landscape-field"><i /><i /><i /></div>
      <div className="place-wall">
        <div className="place-air"><i /><i /></div>
        <div className="regional-texture"><i /><i /><i /><i /></div>
        <div className="place-signature"><i /><i /><i /></div>
        <div className="place-terrain terrain-far"><i /><i /></div>
        <div className="place-terrain terrain-near"><i /><i /></div>
        <div className="place-water"><i /><i /></div>
        <div className="place-lights">{Array.from({ length: 9 }, (_, index) => <i key={index} />)}</div>
      </div>
      {environment.weather === "storm" && <div className="lightning" />}
    </div>
  );
}

function NeighborhoodMap({ point, label, hierarchy, locale, globeZoom, interactive, blend, zoomCommand, stories, activity, journeys, activeJourneyId, onZoomChange, onExitZoom, onPick, onSelectStory, onSelectJourney, onIlluminate, onCenterChange }: {
  point: { lat: number; lon: number };
  label: string;
  hierarchy: PlaceHierarchy;
  locale: Locale;
  globeZoom: number;
  interactive: boolean;
  blend: number;
  zoomCommand: ZoomCommand;
  stories: Story[];
  activity: DailyActivitySnapshot;
  journeys: Journey[];
  activeJourneyId: string | null;
  onZoomChange: (zoom: number) => void;
  onExitZoom: () => void;
  onPick: (lat: number, lon: number) => void;
  onSelectStory: (story: Story) => void;
  onSelectJourney: (journey: Journey) => void;
  onIlluminate: (center: { lat: number; lon: number }) => void;
  onCenterChange: (center: { lat: number; lon: number }) => void;
}) {
  const viewLat = Math.round(point.lat * 100) / 100;
  const viewLon = Math.round(point.lon * 100) / 100;
  const initialMapZoom = interactive ? MAP_ENTRY_ZOOM : 3.65 + Math.max(0, Math.min(1, (globeZoom - MAP_MOUNT_DEPTH) / (MAP_HANDOFF_DEPTH - MAP_MOUNT_DEPTH))) * (MAP_ENTRY_ZOOM - 3.65);
  const hostRef = useRef<HTMLDivElement>(null);
  const initialMapZoomRef = useRef(initialMapZoom);
  const initialViewRef = useRef({ lat: viewLat, lon: viewLon });
  const mapRef = useRef<import("maplibre-gl").Map | null>(null);
  const markerRef = useRef<import("maplibre-gl").Marker | null>(null);
  const descentLabelElementsRef = useRef<Array<{ element: HTMLDivElement; definition: DescentGeoLabel }>>([]);
  const pickRef = useRef(onPick);
  const zoomCommandRef = useRef(zoomCommand);
  const lastZoomNonceRef = useRef(0);
  const interactiveRef = useRef(interactive);
  const onZoomChangeRef = useRef(onZoomChange);
  const onExitZoomRef = useRef(onExitZoom);
  const [mapZoom, setMapZoom] = useState(initialMapZoom);
  const mapZoomRef = useRef(initialMapZoom);
  const [mapError, setMapError] = useState(false);
  const [mapReady, setMapReady] = useState(false);
  const [surfaceState, setSurfaceState] = useState<"loading" | "satellite" | "standard" | "community">("loading");
  const surfaceStateRef = useRef<"loading" | "satellite" | "standard" | "community">("loading");
  useEffect(() => { surfaceStateRef.current = surfaceState; }, [surfaceState]);
  const mapCenterRef = useRef<{ lat: number; lon: number } | null>(null);
  const vectorUpgradeTimerRef = useRef<number | null>(null);
  const hostResizeObserverRef = useRef<ResizeObserver | null>(null);
  const fallbackGeography = useMemo(() => {
    // The bundled atlas is an always-available geographic safety net. We cap
    // its visual zoom because it is a country atlas, while the raster map takes
    // over for province/city detail when network tiles arrive.
    const atlasZoom = Math.min(5.8, Math.round(mapZoom * 4) / 4);
    const projection = geoMercator()
      .center([viewLon, viewLat])
      .translate([500, 320])
      .scale((512 * Math.pow(2, atlasZoom)) / (2 * Math.PI))
      .clipExtent([[0, 0], [1000, 640]]);
    const path = geoPath(projection);
    const countries = landFeatures.map((country, index) => ({
      key: String(country.id ?? index),
      d: path(country) ?? "",
    })).filter((country) => country.d);
    const labels = landFeatures.map((country, index) => {
      const name = String(((country.properties ?? {}) as { name?: string }).name ?? "");
      if (!name) return null;
      const projected = projection(geoCentroid(country));
      if (!projected) return null;
      return { key: `${country.id ?? index}-${name}`, name: locale === "zh" ? COUNTRY_ZH[name] ?? name : name, x: projected[0], y: projected[1] };
    }).filter((definition): definition is { key: string; name: string; x: number; y: number } => Boolean(definition && definition.x >= -40 && definition.x <= 1040 && definition.y >= -30 && definition.y <= 670));
    return { countries, labels };
  }, [locale, mapZoom, viewLat, viewLon]);
  useEffect(() => { pickRef.current = onPick; }, [onPick]);
  useEffect(() => { onZoomChangeRef.current = onZoomChange; }, [onZoomChange]);
  useEffect(() => { onExitZoomRef.current = onExitZoom; }, [onExitZoom]);
  useEffect(() => { interactiveRef.current = interactive; }, [interactive]);
  const onIlluminateRef = useRef(onIlluminate);
  useEffect(() => { onIlluminateRef.current = onIlluminate; }, [onIlluminate]);
  const onCenterChangeRef = useRef(onCenterChange);
  useEffect(() => { onCenterChangeRef.current = onCenterChange; }, [onCenterChange]);
  useEffect(() => {
    descentLabelElementsRef.current.forEach(({ element, definition }) => {
      const text = element.querySelector("b");
      if (text) text.textContent = locale === "zh" ? definition.zh : definition.en;
    });
  }, [locale]);
  useEffect(() => {
    markerRef.current?.setLngLat([viewLon, viewLat]);
    const map = mapRef.current;
    if (!map) return;
    // Skip the recenter echo when the point update *came from* panning this
    // map (destination sync); only genuinely new destinations move the camera.
    const center = map.getCenter();
    if (Math.abs(center.lat - viewLat) < .02 && Math.abs(center.lng - viewLon) < .02) return;
    map.easeTo({ center: [viewLon, viewLat], duration: 650 });
  }, [viewLat, viewLon]);
  useEffect(() => {
    zoomCommandRef.current = zoomCommand;
    const map = mapRef.current;
    if (zoomCommand.nonce <= lastZoomNonceRef.current) return;
    lastZoomNonceRef.current = zoomCommand.nonce;
    const target = (map?.getZoom() ?? mapZoomRef.current) - zoomCommand.delta * .92;
    if (zoomCommand.delta > 0 && target <= MAP_EXIT_ZOOM) {
      onExitZoomRef.current();
      return;
    }
    const nextZoom = Math.max(MAP_MIN_ZOOM, Math.min(MAP_MAX_ZOOM, target));
    if (map) map.easeTo({ zoom: nextZoom, duration: 420 });
    else {
      mapZoomRef.current = nextZoom;
      setMapZoom(nextZoom);
      onZoomChangeRef.current(nextZoom);
    }
  }, [zoomCommand]);
  useEffect(() => {
    // Entering or leaving the interactive descent changes the effective
    // layout; make sure the GL canvas re-measures either way.
    const timer = window.setTimeout(() => { try { mapRef.current?.resize(); } catch { /* not ready */ } }, 900);
    return () => window.clearTimeout(timer);
  }, [interactive]);
  useEffect(() => {
    const map = mapRef.current;
    if (interactive) return;
    const previewDepth = Math.max(0, Math.min(1, (globeZoom - MAP_MOUNT_DEPTH) / (MAP_HANDOFF_DEPTH - MAP_MOUNT_DEPTH)));
    const nextZoom = 3.65 + previewDepth * (MAP_ENTRY_ZOOM - 3.65);
    if (map) map.easeTo({ zoom: nextZoom, duration: 180 });
    else {
      mapZoomRef.current = nextZoom;
      setMapZoom(nextZoom);
      onZoomChangeRef.current(nextZoom);
    }
  }, [globeZoom, interactive]);
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let cancelled = false;
    let leaving = false;
    let satelliteReady = false;
    let map: import("maplibre-gl").Map | undefined;
    const readinessTimer = window.setTimeout(() => {
      if (!cancelled) setMapError(true);
    }, 6500);
    void Promise.all([import("maplibre-gl"), import("maplibre-gl/dist/maplibre-gl.css")]).then(([maplibre]) => {
      if (cancelled) return;
      try {
        let hasUsableMap = false;
        map = new maplibre.Map({
          container: host,
          style: LOCAL_MAP_STYLE,
          center: [initialViewRef.current.lon, initialViewRef.current.lat],
          zoom: initialMapZoomRef.current,
          pitch: initialMapZoomRef.current < 5.4 ? 34 : 24,
          bearing: 0,
          minZoom: MAP_MIN_ZOOM,
          maxZoom: MAP_MAX_ZOOM,
          maxPitch: 45,
          attributionControl: true,
          antialias: !isCompactDevice(),
          // MapLibre defaults to the full devicePixelRatio (3× on modern
          // phones — a 9× framebuffer memory bill). Cap it.
          pixelRatio: Math.min(typeof window === "undefined" ? 1 : window.devicePixelRatio, isCompactDevice() ? 1.6 : 2),
        });
        mapRef.current = map;
        // The descent container is born mid-transition (it can measure a
        // fraction of its final size) and MapLibre only tracks WINDOW
        // resizes. Without this observer the canvas keeps its birth size
        // forever and the whole descent renders into a squashed strip —
        // which reads as an empty dark map at every layer.
        const hostResizeObserver = new ResizeObserver(() => {
          try { map?.resize(); } catch { /* mid-teardown */ }
        });
        hostResizeObserver.observe(host);
        hostResizeObserverRef.current = hostResizeObserver;
        map.dragRotate.disable();
        map.touchZoomRotate.disableRotation();
        const areaMarker = document.createElement("div");
        areaMarker.className = "coarse-arrival-marker";
        areaMarker.setAttribute("aria-label", locale === "zh" ? "所选模糊区域" : "Selected coarse area");
        areaMarker.append(document.createElement("i"), document.createElement("b"), document.createElement("span"));
        markerRef.current = new maplibre.Marker({ element: areaMarker, anchor: "center" }).setLngLat([initialViewRef.current.lon, initialViewRef.current.lat]).addTo(map);

        const descentMarkers: import("maplibre-gl").Marker[] = [];
        const nearbyDescentLabels = PEARL_RIVER_DESCENT_LABELS.filter((definition) => distanceKm(initialViewRef.current, definition) <= 1_200);
        descentLabelElementsRef.current = nearbyDescentLabels.map((definition) => {
          const element = document.createElement("div");
          element.className = `geo-place-label geo-place-${definition.kind}`;
          element.dataset.minZoom = String(definition.minZoom);
          element.dataset.maxZoom = String(definition.maxZoom ?? MAP_MAX_ZOOM + 1);
          const dot = document.createElement("i");
          const text = document.createElement("b");
          text.textContent = locale === "zh" ? definition.zh : definition.en;
          element.append(dot, text);
          descentMarkers.push(new maplibre.Marker({ element, anchor: "center" }).setLngLat([definition.lon, definition.lat]).addTo(map!));
          return { element, definition };
        });
        const refreshDescentLabels = (zoomLevel: number) => {
          descentLabelElementsRef.current.forEach(({ element, definition }) => {
            const visible = zoomLevel >= definition.minZoom && zoomLevel <= (definition.maxZoom ?? MAP_MAX_ZOOM + 1);
            element.classList.toggle("is-visible", visible);
          });
        };
        refreshDescentLabels(initialMapZoomRef.current);
        const updateZoom = () => {
          const nextZoom = map?.getZoom() ?? MAP_ENTRY_ZOOM;
          mapZoomRef.current = nextZoom;
          setMapZoom(nextZoom);
          onZoomChangeRef.current(nextZoom);
          refreshDescentLabels(nextZoom);
          const cinematicPitch = nextZoom < 5.4 ? 34 : nextZoom < 7.2 ? 25 : nextZoom < 9 ? 16 : 8;
          if (map && Math.abs(map.getPitch() - cinematicPitch) > .5) map.setPitch(cinematicPitch);
          if (interactiveRef.current && !leaving && nextZoom <= MAP_EXIT_ZOOM) {
            leaving = true;
            onExitZoomRef.current();
          }
        };
        map.on("zoom", updateZoom);
        map.on("moveend", () => {
          const center = map?.getCenter();
          if (!center) return;
          mapCenterRef.current = { lat: Math.round(center.lat * 100) / 100, lon: Math.round(center.lng * 100) / 100 };
          // While the user is actually inside the descent, let the app follow
          // the explored destination (background identity, weather, hierarchy).
          if (interactiveRef.current) onCenterChangeRef.current({ lat: center.lat, lon: center.lng });
        });
        map.on("click", (event) => pickRef.current(Math.round(event.lngLat.lat * 100) / 100, Math.round(event.lngLat.lng * 100) / 100));
        const revealMap = () => {
          if (!map) return;
          hasUsableMap = true;
          window.clearTimeout(readinessTimer);
          setMapReady(true);
          setMapError(false);
        };
        // Deterministic reachability probe on the same channel MapLibre uses.
        // The map's own load/idle events treat errored tiles as finished, so
        // they cannot distinguish "rendered" from "every tile failed" — which
        // previously let the descent claim readiness over an empty layer.
        let osmProbe: boolean | null = null;
        const tryReveal = () => { if (osmProbe === true) revealMap(); };
        void fetch("https://tile.openstreetmap.org/3/4/2.png", { mode: "cors" })
          .then((response) => {
            osmProbe = response.ok;
            if (!response.ok) throw new Error("osm probe failed");
            if (!cancelled) tryReveal();
          })
          .catch(() => {
            osmProbe = false;
            if (!cancelled) {
              window.clearTimeout(readinessTimer);
              setSurfaceState("standard");
              setMapError(true);
            }
          });
        // Community-map enhancement (free OpenFreeMap vector tiles, no key):
        // adopted only after its style JSON actually arrives. Satellite stays
        // an overlay for province/city scales and fades out by community
        // scale, revealing crisp roads, names and boundaries. Any failure
        // leaves the raster composite exactly as it was.
        let vectorErrors = 0;
        // Community upgrade is a three-gate process. Gate 1: the style JSON
        // itself. Gate 2: one REAL vector tile fetched end-to-end (a style
        // whose tiles are unreachable must never replace a working map — a
        // partially blocked network can otherwise leave the canvas empty
        // while the UI still claims readiness). Gate 3: a post-adoption
        // watchdog that reverts to the raster composite if the swapped style
        // fails to reach a fully loaded, tile-rendered state in time.
        const fetchWithTimeout = (url: string, ms: number) => {
          const controller = new AbortController();
          const timer = window.setTimeout(() => controller.abort(), ms);
          return fetch(url, { signal: controller.signal, mode: "cors" }).finally(() => window.clearTimeout(timer));
        };
        const probeVectorTile = async (styleJson: import("maplibre-gl").StyleSpecification): Promise<boolean> => {
          try {
            const sources = styleJson.sources ?? {};
            let template: string | null = null;
            for (const source of Object.values(sources)) {
              if ((source as { type?: string }).type !== "vector") continue;
              const direct = (source as { tiles?: string[] }).tiles;
              if (direct && direct[0]) { template = direct[0]; break; }
              const tilejsonUrl = (source as { url?: string }).url;
              if (tilejsonUrl) {
                const response = await fetchWithTimeout(tilejsonUrl, 4000);
                if (!response.ok) return false;
                const tilejson = await response.json() as { tiles?: string[] };
                if (tilejson.tiles && tilejson.tiles[0]) { template = tilejson.tiles[0]; break; }
              }
            }
            if (!template) return false;
            const center = mapCenterRef.current ?? initialViewRef.current;
            const zoomLevel = 4;
            const scale = 2 ** zoomLevel;
            const tileX = Math.max(0, Math.min(scale - 1, Math.floor(((center.lon + 180) / 360) * scale)));
            const latRad = (Math.max(-85, Math.min(85, center.lat)) * Math.PI) / 180;
            const tileY = Math.max(0, Math.min(scale - 1, Math.floor(((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * scale)));
            const tileUrl = template.replace("{z}", String(zoomLevel)).replace("{x}", String(tileX)).replace("{y}", String(tileY));
            const tileResponse = await fetchWithTimeout(tileUrl, 4500);
            return tileResponse.ok;
          } catch {
            return false;
          }
        };
        vectorUpgradeTimerRef.current = window.setTimeout(() => {
          fetchWithTimeout("https://tiles.openfreemap.org/styles/liberty", 4500)
            .then((response) => (response.ok ? response.json() : Promise.reject(new Error("style unavailable"))))
            .then(async (styleJson: import("maplibre-gl").StyleSpecification) => {
              if (cancelled || !map) return;
              // Gate 2: prove real tile data flows before touching the map.
              const tilesFlow = await probeVectorTile(styleJson);
              if (!tilesFlow || cancelled || !map) return;
              const augmented: import("maplibre-gl").StyleSpecification = {
                ...styleJson,
                sources: {
                  ...styleJson.sources,
                  "kindchain-satellite": {
                    type: "raster",
                    tiles: ["https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"],
                    tileSize: 256,
                    maxzoom: 18,
                    attribution: "Tiles © Esri — Esri, Maxar, Earthstar Geographics",
                  },
                },
                layers: [...(styleJson.layers ?? [])],
              };
              const satelliteVeil: (typeof augmented.layers)[number] = {
                id: "kindchain-satellite-veil",
                type: "raster",
                source: "kindchain-satellite",
                paint: {
                  // Province/city keep the real surface; community reveals the
                  // vector streets underneath (GPT proposal, whitepaper §27).
                  "raster-opacity": ["interpolate", ["linear"], ["zoom"], 4, .85, 6.5, .55, 8.2, 0] as unknown as number,
                  "raster-fade-duration": 320,
                  "raster-saturation": -.12,
                },
              };
              const firstSymbolIndex = augmented.layers.findIndex((layer) => layer.type === "symbol");
              if (firstSymbolIndex >= 0) augmented.layers.splice(firstSymbolIndex, 0, satelliteVeil);
              else augmented.layers.push(satelliteVeil);
              map.setStyle(augmented);
              map.once("styledata", () => {
                if (!map || cancelled) return;
                try {
                  // Privacy floor: never render building footprints, house
                  // numbers or POI detail even where the style provides them.
                  const privateDetail = /(building|house.?number|address|parcel|poi|shop|amenity)/i;
                  for (const layer of map.getStyle().layers ?? []) {
                    const sourceLayer = "source-layer" in layer ? String(layer["source-layer"] ?? "") : "";
                    if (layer.type === "fill-extrusion" || privateDetail.test(`${layer.id} ${sourceLayer}`)) {
                      map.setLayoutProperty(layer.id, "visibility", "none");
                    }
                  }
                } catch { /* keep whatever rendered */ }
              });
              // Gate 3: watchdog. The swap must reach "style loaded, tiles
              // loaded, veil layer live" within 12s or we put the raster
              // composite back exactly as it was. No half-alive canvas, ever.
              const adoptionStartedAt = Date.now();
              let vectorSettled = false;
              const stopVectorWatch = () => {
                if (watchdogInterval !== null) { window.clearInterval(watchdogInterval); watchdogInterval = null; }
                if (map) {
                  map.off("idle", confirmVector);
                  map.off("styledata", confirmVector);
                }
              };
              const revertVector = () => {
                if (vectorSettled || cancelled || !map) return;
                vectorSettled = true;
                stopVectorWatch();
                try {
                  map.setStyle(LOCAL_MAP_STYLE);
                  setSurfaceState(osmProbe === true ? "standard" : "loading");
                } catch { /* keep whatever is on screen */ }
              };
              const confirmVector = () => {
                if (vectorSettled || cancelled || !map) return;
                try {
                  if (map.isStyleLoaded() && map.areTilesLoaded() && map.getLayer("kindchain-satellite-veil")) {
                    vectorSettled = true;
                    stopVectorWatch();
                    setSurfaceState("community");
                    revealMap();
                    return;
                  }
                } catch { /* try again on the next tick */ }
                if (Date.now() - adoptionStartedAt > 12_000) revertVector();
              };
              let watchdogInterval: number | null = window.setInterval(confirmVector, 1000);
              map.on("idle", confirmVector);
              map.on("styledata", confirmVector);
            })
            .catch(() => {
              /* raster composite stays — the enhancement is optional by design */
            });
        }, 1500);
        void vectorUpgradeTimerRef; // timer cleared in effect cleanup
        map.on("error", (event) => {
          // Backstop: a vector adoption that starts failing wholesale reverts
          // to the raster composite instead of degrading silently.
          if (surfaceStateRef.current !== "community") return;
          vectorErrors += 1;
          if (vectorErrors >= 10 && map) {
            vectorErrors = -1000;
            try {
              map.setStyle(LOCAL_MAP_STYLE);
              setSurfaceState(osmProbe === true ? "standard" : "loading");
            } catch { /* keep current view */ }
          }
        });
        const confirmSatellite = () => {
          if (!map || satelliteReady) return;
          try {
            if (map.isSourceLoaded("world-imagery")) {
              satelliteReady = true;
              setSurfaceState("satellite");
            }
          } catch { /* The standard map remains available. */ }
        };
        map.on("sourcedata", (event) => {
          if (event.sourceId === "world-imagery" && event.isSourceLoaded) confirmSatellite();
        });
        map.on("error", (event) => {
          // A remote satellite/reference tile may be unavailable in a browser
          // or region. It must never hide the OSM base map or trap the user in
          // the abstract atlas fallback.
          const message = String(event.error?.message ?? "");
          // Once the community vector style is live, stale raster-source
          // errors from the replaced composite must not downgrade the badge.
          if (surfaceStateRef.current !== "community" && !satelliteReady
            && /arcgis|world[_ -]?imagery|world[_ -]?boundaries|world[_ -]?transport/i.test(message)) {
            setSurfaceState("standard");
          }
        });
        map.on("load", () => {
          tryReveal();
          confirmSatellite();
        });
        map.on("idle", () => { tryReveal(); confirmSatellite(); });
        // MapLibre's load event can be held open indefinitely by one optional
        // remote raster source. Reveal its canvas early so OSM can still be
        // used while satellite imagery finishes or fails independently — but
        // only once the base-tile probe has confirmed OSM is reachable.
        window.setTimeout(() => {
          if (cancelled) return;
          tryReveal();
          confirmSatellite();
          if (!satelliteReady) setSurfaceState("standard");
        }, 900);
        const pending = zoomCommandRef.current;
        if (pending.nonce > lastZoomNonceRef.current) {
          lastZoomNonceRef.current = pending.nonce;
          const target = map.getZoom() - pending.delta * .92;
          if (pending.delta > 0 && target <= MAP_EXIT_ZOOM) onExitZoomRef.current();
          else map.easeTo({ zoom: Math.max(MAP_MIN_ZOOM, Math.min(MAP_MAX_ZOOM, target)), duration: 420 });
        }
      } catch {
        setMapError(true);
      }
    }).catch(() => { if (!cancelled) setMapError(true); });
    return () => {
      cancelled = true;
      window.clearTimeout(readinessTimer);
      if (typeof vectorUpgradeTimerRef.current === "number") window.clearTimeout(vectorUpgradeTimerRef.current);
      hostResizeObserverRef.current?.disconnect();
      hostResizeObserverRef.current = null;
      mapRef.current = null;
      markerRef.current = null;
      descentLabelElementsRef.current = [];
      map?.remove();
    };
  }, []);
  const localStage: ZoomStage = mapZoom >= 10 ? "COMMUNITY" : mapZoom >= 8.1 ? "DISTRICT" : mapZoom >= 6.2 ? "CITY" : "REGION";
  const localRangeKm = localStage === "COMMUNITY" ? 12 : localStage === "DISTRICT" ? 55 : localStage === "CITY" ? 220 : 900;
  const stageLabel = locale === "zh"
    ? { REGION: "省级范围", CITY: "城市范围", DISTRICT: "区县级片区", COMMUNITY: "模糊社区范围" }[localStage]
    : { REGION: "PROVINCE / STATE", CITY: "CITY AREA", DISTRICT: "COARSE DISTRICT", COMMUNITY: "COARSE COMMUNITY" }[localStage];
  const activeAreaName = localStage === "COMMUNITY" ? hierarchy.locality : localStage === "DISTRICT" ? hierarchy.district : localStage === "CITY" ? hierarchy.city : hierarchy.region;
  const hierarchyTrail = [hierarchy.country, hierarchy.region];
  if (localStage !== "REGION") hierarchyTrail.push(hierarchy.city);
  if (localStage === "DISTRICT" || localStage === "COMMUNITY") hierarchyTrail.push(hierarchy.district);
  if (localStage === "COMMUNITY") hierarchyTrail.push(hierarchy.locality);
  const uniqueHierarchyTrail = hierarchyTrail.filter((name, index, names) => name && names.indexOf(name) === index);
  const localProjection = (target: { lat: number; lon: number }, identity: string) => {
    const latKm = (target.lat - point.lat) * 111;
    const lonKm = (target.lon - point.lon) * 111 * Math.max(.22, Math.cos(point.lat * Math.PI / 180));
    const seed = stableHash(identity);
    const nearCenter = Math.hypot(latKm, lonKm) < 3;
    const jitterX = nearCenter ? ((seed % 17) - 8) * .82 : 0;
    const jitterY = nearCenter ? (((seed >>> 5) % 15) - 7) * .74 : 0;
    return {
      x: Math.max(8, Math.min(92, 50 + lonKm / localRangeKm * 39 + jitterX)),
      y: Math.max(17, Math.min(84, 53 - latKm / localRangeKm * 34 + jitterY)),
    };
  };
  const localStories = stories
    .filter((story) => distanceKm(point, story) <= localRangeKm)
    .sort((a, b) => distanceKm(point, a) - distanceKm(point, b))
    .slice(0, localStage === "REGION" ? 6 : 4);
  const localActivity = activity.cells
    .filter((cell) => distanceKm(point, { lat: cell.centroidLat, lon: cell.centroidLon }) <= localRangeKm)
    .sort((a, b) => b.textCount - a.textCount)
    .slice(0, localStage === "REGION" ? 5 : 3);
  const localCouriers = journeys.filter((journey) => {
    if (journeyProgress(journey) >= 1 || courierPresentationAtZoom(journey.mode, localStage) === "hidden") return false;
    return Math.min(distanceKm(point, journey.from), distanceKm(point, journey.to)) <= 850;
  }).slice(0, 5);
  const zoomOutHint = locale === "zh" ? "缩小返回地球" : locale === "es" ? "Aleja para volver" : locale === "fr" ? "Dézoomez pour revenir" : locale === "ja" ? "縮小して地球へ" : "Zoom out to Earth";
  return (
    <section className={`neighborhood-map map-satellite-surface surface-${surfaceState} ${interactive ? "map-interactive" : ""} ${mapReady ? "map-ready" : "map-waiting"} ${mapError ? "map-error-state" : ""}`} style={{ opacity: blend, transform: `translateY(${(1 - blend) * 2.5}%) scale(${.91 + blend * .09})`, clipPath: `ellipse(${42 + blend * 58}% ${48 + blend * 52}% at 50% 52%)`, "--descent": String(blend) } as CSSProperties} aria-label={`Progressive local view of ${label}`} onWheel={(event) => {
      if (!interactive || mapReady) return;
      event.preventDefault();
      const nextZoom = Math.max(MAP_MIN_ZOOM, Math.min(MAP_MAX_ZOOM, mapZoom - event.deltaY * .0034));
      if (event.deltaY > 0 && nextZoom <= MAP_EXIT_ZOOM) onExitZoom();
      else {
        mapZoomRef.current = nextZoom;
        setMapZoom(nextZoom);
        onZoomChange(nextZoom);
      }
    }}>
      <div className="map-depth-fallback" aria-hidden="true">
        <svg className="fallback-geography" viewBox="0 0 1000 640" preserveAspectRatio="xMidYMid slice">
          <g className="fallback-countries">{fallbackGeography.countries.map((country) => <path key={country.key} d={country.d} />)}</g>
          <g className="fallback-country-labels">{fallbackGeography.labels.map((definition) => <text key={definition.key} x={definition.x} y={definition.y}>{definition.name}</text>)}</g>
          <g className="fallback-map-center"><circle cx="500" cy="320" r="7" /><circle cx="500" cy="320" r="18" /></g>
        </svg>
      </div>
      <div className="map-host" ref={hostRef} />
      <div className="map-atmosphere" />
      <div className="map-curvature" aria-hidden="true"><i /><i /><i /></div>
      <div className={`map-hierarchy-field hierarchy-${localStage.toLowerCase()}`} aria-hidden="true">
        <i /><i /><i /><i />
        <span className="hierarchy-region">{hierarchy.region}</span>
        <span className="hierarchy-city">{hierarchy.city}</span>
        <span className="hierarchy-district">{hierarchy.district}</span>
        <span className="hierarchy-community">{hierarchy.locality}</span>
      </div>
      <div className={`map-kindness-layer stage-${localStage.toLowerCase()}`} aria-label={locale === "zh" ? `${label} 的善意信号` : `Kindness signals around ${label}`}>
        {localActivity.map((cell) => {
          const projected = localProjection({ lat: cell.centroidLat, lon: cell.centroidLon }, cell.cellId);
          return <span key={cell.cellId} className={`local-activity band-${cell.band}`} style={{ left: `${projected.x}%`, top: `${projected.y}%`, "--local-intensity": String(cell.intensity) } as CSSProperties}><i /><b>{cell.textCount}</b><small>{locale === "zh" ? "束文字" : "TEXTS"}</small></span>;
        })}
        {localStories.map((story, storyIndex) => {
          const projected = localProjection(story, story.id);
          return <button key={story.id} type="button" className={`local-story-signal kind-${story.kind ?? "light"} ${storyIndex === 0 ? "primary" : ""}`} style={{ left: `${projected.x}%`, top: `${projected.y}%` }} onClick={(event) => { event.stopPropagation(); onSelectStory(story); }} aria-label={`${story.region}: ${storyText(story, locale, false)}`}><i><b /></i><span><small>{story.region} · {story.kind === "wish" ? (locale === "zh" ? "愿望" : "WISH") : story.kind === "support" ? (locale === "zh" ? "陪伴信号" : "COMPANION") : (locale === "zh" ? "一束光" : "A LIGHT")}</small><strong>“{storyText(story, locale, false)}”</strong><em>{story.replies.length} {locale === "zh" ? "个回应" : "REPLIES"}</em></span></button>;
        })}
      </div>
      {localCouriers.length > 0 && <div className="map-courier-layer" aria-label={locale === "zh" ? "模糊地域中的信使" : "Couriers in this coarse area"}>
        {localCouriers.map((journey, index) => {
          const progress = journeyProgress(journey);
          const presentation = courierPresentationAtZoom(journey.mode, localStage);
          return <button key={journey.id} type="button" className={`mode-${journey.mode} presentation-${presentation} ${journey.id === activeJourneyId ? "active" : ""}`} style={{ left: `${18 + ((index * 23 + progress * 31) % 66)}%`, top: `${34 + (index % 3) * 17}%` }} title={`${TRANSPORTS[journey.mode].names[locale]} · ${locale === "zh" ? "模糊地域，不是实时个人轨迹" : "Coarse area, not a live personal trail"}`} onClick={(event) => { event.stopPropagation(); onSelectJourney(journey); }} aria-label={`${TRANSPORTS[journey.mode].names[locale]} · ${journey.from.label} → ${journey.to.label}`}><i>{TRANSPORTS[journey.mode].glyph}</i><b className="courier-progress-ring" style={{ "--ring": `${Math.round(progress * 100)}%` } as CSSProperties} aria-hidden="true" /></button>;
        })}
      </div>}
      <header className="map-lens">
        <span className="map-scale-icon" aria-hidden="true">◎</span>
        <div><small>{stageLabel} · Z{mapZoom.toFixed(1)} <b className={`surface-badge badge-${surfaceState}`}>{surfaceState === "community" ? (locale === "zh" ? "社区地图 · 道路与地名" : "COMMUNITY MAP · STREETS & NAMES") : surfaceState === "satellite" ? (locale === "zh" ? "卫星地表" : "SATELLITE SURFACE") : surfaceState === "standard" ? (locale === "zh" ? "地名地图已接管" : "STANDARD MAP ACTIVE") : (locale === "zh" ? "真实地图载入中" : "LOADING REAL MAP")}</b></small><strong>{activeAreaName || label}</strong><nav className="map-breadcrumb" aria-label={locale === "zh" ? "当前行政层级" : "Current place hierarchy"}>{uniqueHierarchyTrail.map((name, index) => <span key={`${name}-${index}`}>{index > 0 && <b>›</b>}{name}</span>)}</nav></div>
        <em>{locale === "zh" ? `约 ${localRangeKm} km 范围` : `ABOUT ${localRangeKm} KM`}<br />{locale === "zh" ? "不显示住宅与门牌" : "NO HOMES OR ADDRESSES"}<br />{zoomOutHint}</em>
      </header>
      <div className="map-content-readout"><span><b>{localStories.length}</b><small>{locale === "zh" ? "可读文字" : "READABLE LIGHTS"}</small></span><i /><span><b>{localCouriers.length}</b><small>{locale === "zh" ? "本地邮路" : "LOCAL ROUTES"}</small></span><i /><span><b>{localActivity.reduce((sum, cell) => sum + cell.textCount, 0)}</b><small>{locale === "zh" ? "聚合流动" : "AGGREGATED"}</small></span></div>
      <div className="map-coordinate">≈ {Math.abs(viewLat).toFixed(1)}°{viewLat >= 0 ? "N" : "S"} · {Math.abs(viewLon).toFixed(1)}°{viewLon >= 0 ? "E" : "W"} · {locale === "zh" ? "模糊区域" : "COARSE AREA"}</div>
      <div className="map-toolbar">
        <button type="button" onClick={() => mapRef.current?.zoomIn({ duration: 300 })} aria-label={locale === "zh" ? "放大" : "Zoom in"}>+</button>
        <button type="button" onClick={() => {
          const liveMap = mapRef.current;
          const target = (liveMap?.getZoom() ?? mapZoomRef.current) - 1;
          if (target <= MAP_EXIT_ZOOM) onExitZoomRef.current();
          else liveMap?.zoomOut({ duration: 300 });
        }} aria-label={locale === "zh" ? "缩小" : "Zoom out"}>−</button>
        <button type="button" className="map-exit" onClick={() => onExitZoomRef.current()}>⤴ {locale === "zh" ? "返回地球" : "Back to Earth"}</button>
        <button type="button" className="map-illuminate" onClick={() => onIlluminateRef.current(mapCenterRef.current ?? { lat: viewLat, lon: viewLon })}>✦ {locale === "zh" ? "照亮这片社区" : "Light this community"}</button>
      </div>
      <small className="place-source">{surfaceState === "community" && <><a href="https://openfreemap.org" target="_blank" rel="noreferrer">OpenFreeMap</a> · </>}{surfaceState === "satellite" && <><a href="https://www.esri.com" target="_blank" rel="noreferrer">Esri / Maxar</a> {locale === "zh" ? "卫星地表" : "SATELLITE"} · </>}{hierarchy.source === "openstreetmap" ? <><a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a> {locale === "zh" ? "地名地图" : "PLACE MAP"} · {locale === "zh" ? "仅模糊范围" : "COARSE ONLY"}</> : (locale === "zh" ? "内置国界与海岸线 · 模糊层级" : "BUILT-IN BORDERS · COARSE HIERARCHY")}</small>
      {mapError && <div className="map-error"><b>◎</b><span><strong>{locale === "zh" ? "在线地图暂未抵达" : "ONLINE MAP IS STILL ARRIVING"}</strong><small>{locale === "zh" ? "内置真实国界与海岸线已接管；可继续缩放，也可随时回到地球。" : "Built-in real borders and coastlines are active. Keep zooming or return to Earth."}</small></span></div>}
    </section>
  );
}

function LocationGate({ locale, onAllow, onLater }: { locale: Locale; onAllow: () => void; onLater: () => void }) {
  const zh = locale === "zh";
  return (
    <section className="location-gate" role="dialog" aria-modal="true" aria-label={zh ? "位置选择" : "Location choice"}>
      <div className="location-orb"><i /><i /><b>⌖</b></div>
      <small>YOUR SKY · PRIVATE BY DESIGN</small>
      <h2>{zh ? "让地球从你此刻的天空醒来？" : "Wake the Earth from your sky?"}</h2>
      <p>{zh ? "允许后，我们只用位置生成当地天气、晨昏与回家坐标；公开的光仍会模糊位置。" : "Your location shapes local weather, daylight and the home beacon. Public lights remain blurred."}</p>
      <div><button onClick={onLater}>{zh ? "先看看地球" : "Explore first"}</button><button onClick={onAllow}>⌖ {zh ? "使用我的位置" : "Use my location"}</button></div>
    </section>
  );
}

function KindnessOnboarding({ locale, stage, onReceive, onSkip }: { locale: Locale; stage: OnboardingStage; onReceive: () => void; onSkip: () => void }) {
  if (stage === "done" || stage === "boot") return null;
  const zh = locale === "zh";
  return (
    <section className={`kindness-onboarding stage-${stage}`} role="dialog" aria-modal="true" aria-label={zh ? "接住一束光" : "Receive a light"}>
      <div className="onboarding-sky" aria-hidden="true"><i /><i /><i /><b>✦</b></div>
      <small>{stage === "seeking" ? (zh ? "正在穿过晨昏线" : "CROSSING THE TERMINATOR") : (zh ? "一束尚未被回应的光" : "AN UNANSWERED LIGHT")}</small>
      <h1>{stage === "seeking" ? (zh ? "地球正在寻找一束光……" : "The Earth is finding a light…") : (zh ? "接住它，不需要先介绍自己。" : "Receive it. No introduction needed.")}</h1>
      <p>{zh ? "你可以只读、回一句，或只留一盏灯。这里不要求建议，不需要点赞，只让一个人知道：世界听见了。" : "Read it, reply, or simply leave a lamp. No advice or likes required—only a quiet sign that the world heard."}</p>
      <div className="onboarding-gestures" aria-label={zh ? "地球操作方式" : "Earth gestures"}>
        <span><i aria-hidden="true">↔</i><b>{zh ? "拖动" : "DRAG"}</b><small>{zh ? "转动地球" : "turn Earth"}</small></span>
        <span><i aria-hidden="true">⌁</i><b>{zh ? "双指" : "PINCH"}</b><small>{zh ? "进入不同尺度" : "change scale"}</small></span>
        <span><i aria-hidden="true">◎</i><b>{zh ? "轻点" : "TAP"}</b><small>{zh ? "落下一枚光针" : "place a light pin"}</small></span>
      </div>
      <div className="onboarding-actions">
        <button type="button" onClick={onSkip}>{zh ? "先自由看看" : "Explore freely"}</button>
        <button type="button" disabled={stage !== "ready"} onClick={onReceive}><i>✦</i>{zh ? "接住一束光" : "Receive this light"}</button>
      </div>
      <em>{zh ? "不需要定位 · 可随时跳过 · 演示内容" : "No location needed · always skippable · experience content"}</em>
    </section>
  );
}

function ReplyArrivalCeremony({ locale, ceremony, onClose, onSave }: { locale: Locale; ceremony: ReplyCeremony; onClose: () => void; onSave: () => void }) {
  const zh = locale === "zh";
  return (
    <section className="reply-ceremony" role="status" aria-live="polite">
      <div className="ceremony-orbit" aria-hidden="true"><i /><i /><b>✦</b><em>✦</em></div>
      <small>{zh ? "你的回应正在成为星链的一部分" : "YOUR REPLY IS JOINING THE CONSTELLATION"}</small>
      <h2>{zh ? "这一刻，世界多了一处被看见的地方。" : "For this moment, one place in the world feels seen."}</h2>
      <p>“{ceremony.message}”</p>
      <div><span>{ceremony.region}</span><i>·</i><span>{ceremony.weather}</span><i>·</i><span>{ceremony.localTime}</span></div>
      <div className="ceremony-actions"><button type="button" onClick={onSave}>◉ {zh ? "保存抵达明信片" : "Save arrival postcard"}</button><button type="button" onClick={onClose}>{zh ? "回到地球" : "Return to Earth"} →</button></div>
    </section>
  );
}

function QuietWatch({ locale, story, sound, onToggleSound, onReply, onClose }: {
  locale: Locale; story: Story; sound: boolean; onToggleSound: () => void; onReply: () => void; onClose: () => void;
}) {
  const zh = locale === "zh";
  return (
    <section className="quiet-watch" role="dialog" aria-modal="true" aria-label={zh ? "守夜片刻" : "Quiet watch"}>
      <div className="watch-lamp" aria-hidden="true"><i /><b /></div>
      <small>{zh ? "守夜片刻 · 不记录姓名，不公开数字" : "QUIET WATCH · NO NAMES, NO PUBLIC COUNTS"}</small>
      <p>{zh ? "不用说什么。让这束光先亮着。" : "Nothing needs to be said. Let this light stay on for a while."}</p>
      <blockquote>“{storyText(story, locale, false)}”</blockquote>
      <span>{story.region} · {story.country}</span>
      <div className="quiet-watch-actions">
        <button type="button" onClick={onToggleSound}>{sound ? (zh ? "Ⅱ 让夜安静" : "Ⅱ Silence") : (zh ? "▶ 听见这片夜" : "▶ Hear this night")}</button>
        <button type="button" onClick={onReply}>{zh ? "想回一句" : "Leave a gentle line"}</button>
        <button type="button" onClick={onClose}>{zh ? "回到地球" : "Return to Earth"} →</button>
      </div>
    </section>
  );
}

function DepartureTicketCard({ locale, ticket, onFollow, onSave, onClose }: {
  locale: Locale; ticket: DepartureTicket; onFollow: () => void; onSave: () => void; onClose: () => void;
}) {
  const zh = locale === "zh";
  return (
    <section className="departure-ticket" role="status" aria-live="polite">
      <button className="ticket-close" type="button" onClick={onClose} aria-label={zh ? "收起票根" : "Close ticket"}>×</button>
      <div className="ticket-stub"><small>KINDCHAIN · DEPARTURE</small><b>{new Date(ticket.createdAt).toLocaleDateString(zh ? "zh-CN" : "en-CA")}</b><i>✦</i></div>
      <div className="ticket-route"><span><small>{zh ? "从" : "FROM"}</small>{ticket.from}</span><i>⌁</i><span><small>{zh ? "去往" : "TO"}</small>{ticket.to}</span></div>
      <p>“{ticket.message}”</p>
      <div className="ticket-meta"><span>{ticket.messenger}</span><span>{Math.round(ticket.distance).toLocaleString()} km</span><span>{zh ? "模糊地点" : "COARSE PLACE"}</span></div>
      <div className="ticket-actions"><button type="button" onClick={onSave}>◉ {zh ? "收好票根" : "Keep ticket"}</button><button type="button" onClick={onFollow}>{zh ? "跟随旅程" : "Follow journey"} →</button></div>
    </section>
  );
}

function CourierHero3D({ mode, variant = 0 }: { mode: CourierMode; variant?: number }) {
  const hostRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const host = hostRef.current;
    const urls = COURIER_ASSETS[mode];
    if (!host || !urls) return;
    let cancelled = false;
    let cleanup: (() => void) | undefined;
    void Promise.all([import("three"), import("three/examples/jsm/loaders/GLTFLoader.js")]).then(async ([THREE, { GLTFLoader }]) => {
      if (cancelled) return;
      if (!canUseWebGL()) { host.classList.remove("has-model"); return; }
      const scene = new THREE.Scene();
      const camera = new THREE.PerspectiveCamera(36, host.clientWidth / host.clientHeight, .1, 30);
      const frameCamera = () => {
        const portrait = host.clientWidth < 540 || host.clientHeight > host.clientWidth * 1.18;
        camera.fov = portrait ? 41 : 34;
        camera.position.set(0, mode === "carriage" || mode === "rail" ? .02 : .16, portrait ? 4.15 : 3.18);
        camera.updateProjectionMatrix();
      };
      frameCamera();
      const compactHero = isCompactDevice();
      const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: !compactHero, powerPreference: compactHero ? "default" : "high-performance" });
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, compactHero || host.clientWidth < 620 ? 1.15 : 1.7));
      renderer.setSize(host.clientWidth, host.clientHeight);
      renderer.outputColorSpace = THREE.SRGBColorSpace;
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.toneMappingExposure = 1.25;
      host.appendChild(renderer.domElement);
      scene.add(new THREE.HemisphereLight(0xcbd7f4, 0x222233, .86));
      const key = new THREE.DirectionalLight(0xffddb1, 2.8);
      key.position.set(2, 4, 5);
      scene.add(key);
      const rim = new THREE.PointLight(0x91a9ff, 8.5, 12);
      rim.position.set(-3, 1, -2);
      scene.add(rim);
      const loader = new GLTFLoader();
      const mixers: import("three").AnimationMixer[] = [];
      try {
        const assets = await Promise.all(urls.map((url) => loader.loadAsync(url)));
        if (cancelled) { renderer.dispose(); renderer.domElement.remove(); return; }
        const assembly = new THREE.Group();
        assets.forEach((asset, index) => {
          const root = asset.scene;
          const box = new THREE.Box3().setFromObject(root);
          const size = box.getSize(new THREE.Vector3());
          const maxSize = Math.max(size.x, size.y, size.z) || 1;
          const center = box.getCenter(new THREE.Vector3());
          root.position.sub(center);
          root.scale.setScalar(1 / maxSize);
          if (mode === "carriage" && assets.length > 1) {
            root.position.x = index === 0 ? .48 : -.36;
            root.scale.multiplyScalar(index === 0 ? .92 : .82);
          }
          if (mode === "pigeon" && variant > 0) {
            root.traverse((object) => {
              const mesh = object as import("three").Mesh;
              if (!mesh.isMesh || !mesh.material) return;
              const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
              const recolored = materials.map((material) => {
                const next = material.clone() as import("three").MeshStandardMaterial;
                if ("color" in next && next.color) {
                  const palette = [0xe9edf1, 0x8fa6c9, 0xc7b1e8, 0xe0c176];
                  next.color.lerp(new THREE.Color(palette[Math.min(3, variant)]), .46);
                }
                return next;
              });
              mesh.material = Array.isArray(mesh.material) ? recolored : recolored[0];
            });
          }
          assembly.add(root);
          if (asset.animations.length) {
            const mixer = new THREE.AnimationMixer(root);
            const wanted = COURIER_CLIPS[mode];
            const named = wanted ? asset.animations.filter((clip) => wanted.includes(clip.name)) : [];
            const clips = named.length ? named
              : [asset.animations.find((clip) => /fly|flight|gallop|run|walk/i.test(clip.name)) ?? asset.animations[0]];
            clips.forEach((clip, clipIndex) => {
              const action = mixer.clipAction(clip);
              if (clipIndex === 0) action.timeScale = mode === "pigeon" ? 1.15 : mode === "carriage" ? .9 : 1;
              action.play();
            });
            mixers.push(mixer);
          }
        });
        const display = new THREE.Group();
        display.add(assembly);
        const assembledBox = new THREE.Box3().setFromObject(assembly);
        const assembledSize = assembledBox.getSize(new THREE.Vector3());
        const assembledCenter = assembledBox.getCenter(new THREE.Vector3());
        assembly.position.sub(assembledCenter);
        display.scale.setScalar(1.65 / (Math.max(assembledSize.x, assembledSize.y, assembledSize.z) || 1));
        display.rotation.y = mode === "rocket" || mode === "starship" ? -.82 : -.48;
        display.rotation.x = mode === "carriage" || mode === "rail" ? -.04 : .03;
        scene.add(display);
        if (mode === "carriage") {
          const lantern = new THREE.PointLight(0xffa852, 2.6, 4.2);
          lantern.position.set(.48, -.16, .6);
          display.add(lantern);
        }
        host.classList.add("has-model");
        const clock = new THREE.Clock();
        let frame = 0;
        const render = () => {
          frame = requestAnimationFrame(render);
          const dt = Math.min(clock.getDelta(), .05);
          mixers.forEach((mixer) => mixer.update(dt));
          const pulse = Math.sin(clock.elapsedTime * (mode === "pigeon" ? 2.4 : 4.2));
          display.position.y = pulse * (mode === "carriage" || mode === "rail" ? .014 : .045);
          display.rotation.z = pulse * (mode === "pigeon" ? .018 : .006);
          display.rotation.y = (mode === "rocket" || mode === "starship" ? -.82 : -.48) + Math.sin(clock.elapsedTime * .42) * (mode === "pigeon" ? .045 : .008);
          renderer.render(scene, camera);
        };
        render();
        const resize = () => {
          camera.aspect = host.clientWidth / host.clientHeight;
          frameCamera();
          renderer.setSize(host.clientWidth, host.clientHeight);
        };
        window.addEventListener("resize", resize);
        cleanup = () => {
          cancelAnimationFrame(frame);
          window.removeEventListener("resize", resize);
          scene.traverse((object) => {
            const mesh = object as import("three").Mesh;
            mesh.geometry?.dispose?.();
            if (Array.isArray(mesh.material)) mesh.material.forEach((material) => material.dispose());
            else mesh.material?.dispose?.();
          });
          renderer.dispose();
          renderer.domElement.remove();
          host.classList.remove("has-model");
        };
      } catch {
        renderer.dispose();
        renderer.domElement.remove();
      }
    }).catch(() => { host.classList.remove("has-model"); });
    return () => { cancelled = true; cleanup?.(); };
  }, [mode, variant]);
  return <div className={`courier-hero courier-hero-${mode}`} ref={hostRef} aria-hidden="true" />;
}

function JourneyStage({ journey, locale, earthHidden, onToggleEarth, onExit }: {
  journey: Journey; locale: Locale; earthHidden: boolean; onToggleEarth: () => void; onExit: () => void;
}) {
  const [, setTick] = useState(0);
  useEffect(() => {
    const timer = window.setInterval(() => setTick((value) => value + 1), 1000);
    return () => window.clearInterval(timer);
  }, []);
  const spec = TRANSPORTS[journey.mode];
  const progress = journeyProgress(journey);
  const c = UI[locale];
  const scene = routeScene(journey, progress);
  const mailRelay = needsMailRelay(journey.mode, journey.distance);
  const shot = progress < .12 ? "departure" : progress < .72 ? "cruise" : progress < .94 ? "approach" : "arrival";
  const daylightArc = Math.max(0, Math.min(1, (scene.localHour - 5.5) / 14.5));
  const sceneStyle = {
    "--route-progress": progress,
    "--sun-x": `${8 + daylightArc * 84}%`,
    "--sun-y": `${46 - Math.sin(daylightArc * Math.PI) * 34}%`,
  } as CSSProperties;
  const localClock = `${String(Math.floor(scene.localHour)).padStart(2, "0")}:${String(Math.floor((scene.localHour % 1) * 60)).padStart(2, "0")}`;
  return (
    <section className={`journey-stage stage-${journey.mode} shot-${shot} scene-${scene.time} biome-${scene.biome} route-zone-${scene.zone} weather-${scene.weather} hazard-${scene.hazard}`} style={sceneStyle} aria-label={`${spec.names[locale]} journey`}>
      <div className="cinema-sky"><i className="sun" /><i className="moon" /><i className="atmosphere-band" /></div>
      <div className="cinema-stars">{Array.from({ length: 18 }, (_, index) => <i key={index} style={{ left: `${(index * 37) % 96}%`, top: `${6 + (index * 23) % 56}%`, animationDelay: `${-(index % 7) * .7}s` }} />)}</div>
      <div className="cinema-clouds"><i /><i /><i /><i /></div>
      <div className="cinema-mountains"><i /><i /><i /></div>
      <div className="cinema-region"><i /><i /><i /><i /><i /></div>
      <div className="cinema-ground"><i /><i /><i /></div>
      <div className="cinema-track"><i /><i /></div>
      <div className="cinema-weather-pass"><i /><i /><i /></div>
      <div className="cinema-depth-streaks" aria-hidden="true">{Array.from({ length: 9 }, (_, index) => <i key={index} style={{ top: `${13 + (index * 17) % 72}%`, animationDelay: `${-(index % 5) * .44}s`, animationDuration: `${1.8 + (index % 4) * .37}s` }} />)}</div>
      <CourierHero3D mode={journey.mode} variant={journey.courierVariant} />
      <div className={`cinema-courier vehicle-${journey.mode}`} aria-hidden="true">
        <i className="vehicle-glow" /><i className="vehicle-body" /><i className="vehicle-wing wing-a" /><i className="vehicle-wing wing-b" />
        <i className="vehicle-wheel wheel-a" /><i className="vehicle-wheel wheel-b" /><i className="vehicle-light" />
      </div>
      {journey.mode === "pigeon" && (journey.flockSize ?? 1) > 1 && <div className={`cinema-flock flock-${Math.min(3, journey.flockSize ?? 1)}`}><i>◇</i><i>◇</i></div>}
      <div className="cinema-light-sweep" />
      {progress >= 1 && <div className="journey-arrived"><i>✦</i><small>{locale === "zh" ? "旅程抵达 · 新的连线已点亮" : "JOURNEY ARRIVED · A NEW LINK IS LIT"}</small></div>}
      <div className="cinema-vignette" /><div className="cinema-grain" />
      <header className="journey-hud">
        <button className="journey-back" onClick={onExit}>← <span>EARTH</span></button>
        <div><small>{c.inFlight.toUpperCase()} · {scene.zone.replaceAll("-", " ")} · {localClock} SOLAR</small><strong>{spec.names[locale]}</strong><em>{mailRelay ? (locale === "zh" ? "多段邮路接力 · 海岸交接" : "MULTI-STAGE MAIL RELAY · COASTAL HANDOFF") : (locale === "zh" ? "艺术化路线环境 · 非实时路线天气" : "ARTISTIC ROUTE ENVIRONMENT · NOT LIVE ROUTE WEATHER")} · {Math.abs(scene.lat).toFixed(1)}°{scene.lat >= 0 ? "N" : "S"} · {Math.abs(scene.lon).toFixed(1)}°{scene.lon >= 0 ? "E" : "W"}</em></div>
        <button className="earth-toggle" onClick={onToggleEarth}>{earthHidden ? c.earthOn : c.earthOff}</button>
      </header>
      <footer className="journey-telemetry">
        <div className="route-names"><span><i />{journey.from.label}</span><b>{Math.round(progress * 100)}%</b><span>{journey.to.label}<i /></span></div>
        <div className="journey-progress"><i style={{ width: `${progress * 100}%` }}><b /></i></div>
        <div className="journey-numbers">
          <span><small>{c.distance.toUpperCase()}</small><b>{Math.round(journey.distance).toLocaleString()} km</b></span>
          <span><small>{c.arrival.toUpperCase()}</small><b>{formatDuration(journey.etaHours, locale)}</b></span>
          <span><small>{mailRelay ? "MAIL RELAY" : "ROUTE MODEL"}</small><b>{mailRelay ? (locale === "zh" ? "两岸接棒" : "COAST HANDOFF") : `${Math.round(journey.routeDistance).toLocaleString()} km`}</b></span>
        </div>
      </footer>
    </section>
  );
}

const ZOOM_STAGE_ORDER: ZoomStage[] = ["ORBIT", "EARTH", "CONTINENT", "COUNTRY", "REGION", "CITY", "DISTRICT", "COMMUNITY"];
const ZOOM_STAGE_NAMES: Record<ZoomStage, { zh: string; en: string }> = {
  ORBIT: { zh: "轨道", en: "Orbit" },
  EARTH: { zh: "整个地球", en: "Whole Earth" },
  CONTINENT: { zh: "大洲", en: "Continent" },
  COUNTRY: { zh: "国家", en: "Country" },
  REGION: { zh: "省/州", en: "Province" },
  CITY: { zh: "城市", en: "City" },
  DISTRICT: { zh: "区县", en: "District" },
  COMMUNITY: { zh: "社区", en: "Community" },
};

// Where a courier lives on the zoom ladder, and how to reach it from here.
// This surfaces the courierPresentationAtZoom matrix to people instead of
// leaving it as an invisible rule they bump into.
function courierAppearanceGuide(mode: CourierMode, stage: ZoomStage, locale: Locale): { state: "model" | "trace" | "zoom-in" | "zoom-out"; text: string } {
  const zh = locale === "zh";
  const now = courierPresentationAtZoom(mode, stage);
  if (now === "model") return { state: "model", text: zh ? "此刻在场 · 点它看驮了什么" : "On stage now — tap for its cargo" };
  if (now === "trace") return { state: "trace", text: zh ? "此刻化作一道光迹" : "Now only a light trail" };
  const index = ZOOM_STAGE_ORDER.indexOf(stage);
  let zoomIn: ZoomStage | null = null;
  for (let i = index + 1; i < ZOOM_STAGE_ORDER.length; i += 1) {
    if (courierPresentationAtZoom(mode, ZOOM_STAGE_ORDER[i]) !== "hidden") { zoomIn = ZOOM_STAGE_ORDER[i]; break; }
  }
  let zoomOut: ZoomStage | null = null;
  for (let i = index - 1; i >= 0; i -= 1) {
    if (courierPresentationAtZoom(mode, ZOOM_STAGE_ORDER[i]) !== "hidden") { zoomOut = ZOOM_STAGE_ORDER[i]; break; }
  }
  if (zoomIn && (!zoomOut || ZOOM_STAGE_ORDER.indexOf(zoomIn) - index <= index - ZOOM_STAGE_ORDER.indexOf(zoomOut))) {
    return { state: "zoom-in", text: zh ? `放大到「${ZOOM_STAGE_NAMES[zoomIn].zh}」出现` : `Zoom in to ${ZOOM_STAGE_NAMES[zoomIn].en}` };
  }
  if (zoomOut) return { state: "zoom-out", text: zh ? `缩小到「${ZOOM_STAGE_NAMES[zoomOut].zh}」出现` : `Zoom out to ${ZOOM_STAGE_NAMES[zoomOut].en}` };
  return { state: "zoom-in", text: zh ? "在别的空间层出现" : "Lives at another layer" };
}

function courierStageRangeLabel(mode: CourierMode, locale: Locale) {
  const stages = ZOOM_STAGE_ORDER.filter((stage) => courierPresentationAtZoom(mode, stage) !== "hidden");
  if (!stages.length) return "";
  const zh = locale === "zh";
  const first = ZOOM_STAGE_NAMES[stages[0]][zh ? "zh" : "en"];
  const last = ZOOM_STAGE_NAMES[stages[stages.length - 1]][zh ? "zh" : "en"];
  return first === last ? first : `${first} – ${last}`;
}

function JourneyCargoCard({ journey, story, locale, onFollow, onRead, onClose }: {
  journey: Journey; story: Story | null; locale: Locale; onFollow: () => void; onRead: (() => void) | null; onClose: () => void;
}) {
  const [, setTick] = useState(0);
  useEffect(() => {
    const timer = window.setInterval(() => setTick((value) => value + 1), 1000);
    return () => window.clearInterval(timer);
  }, []);
  const zh = locale === "zh";
  const spec = TRANSPORTS[journey.mode];
  const progress = journeyProgress(journey);
  const demo = journey.id.startsWith("journey-demo-");
  const arrived = !demo && progress >= 1;
  const mailRelay = needsMailRelay(journey.mode, journey.distance);
  const remaining = formatDuration(Math.max(.02, journey.etaHours * (1 - progress)), locale);
  // Fact-labels stay honest: a looping showcase route is never presented as a
  // live personal delivery, and network cargo is labeled as the pilot network.
  const factLabel = demo
    ? (zh ? "演示邮路 · 循环航行" : "DEMO ROUTE · LOOPING")
    : story?.networkState === "shared" ? (zh ? "真实网络 · 试运行" : "REAL NETWORK · PILOT") : (zh ? "本机旅程" : "ON THIS DEVICE");
  const cargoText = story ? storyText(story, locale, false) : (zh ? "一束匿名的光" : "An anonymous light");
  const replyCount = story?.replies.length ?? 0;
  return (
    <aside className={`journey-cargo-card mode-${journey.mode} ${arrived ? "cargo-arrived" : ""}`} role="dialog" aria-label={zh ? `${spec.names[locale]} 的驮货` : `Cargo of ${spec.names[locale]}`}>
      <header>
        <i className="cargo-glyph" aria-hidden="true">{spec.glyph}</i>
        <div>
          <small>{factLabel}</small>
          <strong>{spec.names[locale]}</strong>
          <em>{spec.era[locale]}</em>
        </div>
        <button type="button" className="cargo-close" onClick={onClose} aria-label={zh ? "关闭" : "Close"}>×</button>
      </header>
      <div className="cargo-hold">
        <small>{zh ? "它驮着" : "IT CARRIES"}</small>
        <blockquote>“{cargoText}”</blockquote>
        <em>{story ? `${story.region} · ${replyCount} ${zh ? "个回应同行" : replyCount === 1 ? "reply riding along" : "replies riding along"}` : (zh ? "匿名 · 模糊地域" : "Anonymous · coarse area")}{journey.scenario ? ` · ${journeyScenarioLabel(journey.scenario, locale)}` : ""}</em>
      </div>
      <div className="cargo-route">
        <span><i /><b>{journey.from.label}</b></span>
        <u><b style={{ width: `${Math.min(100, progress * 100)}%` }}><i className="cargo-dot" style={{ left: "100%" }}>{spec.glyph}</i></b></u>
        <span><b>{journey.to.label}</b><i /></span>
      </div>
      <div className="cargo-numbers">
        <span><small>{zh ? "路程" : "DISTANCE"}</small><b>{Math.round(journey.distance).toLocaleString()} km</b></span>
        <span><small>{zh ? "进度" : "PROGRESS"}</small><b>{Math.round(Math.min(100, progress * 100))}%</b></span>
        <span><small>{arrived ? (zh ? "状态" : "STATUS") : (zh ? "剩余" : "REMAINING")}</small><b>{arrived ? (zh ? "已抵达" : "Arrived") : remaining}</b></span>
      </div>
      {mailRelay && <p className="cargo-note">{zh ? "多段邮路：跨海时交给下一位信使接力。" : "Multi-stage mail relay: handed to the next courier at the coast."}</p>}
      <footer>
        <button type="button" className="cargo-follow" onClick={onFollow}><span>◉</span>{zh ? "跟随它旅行" : "Travel with it"}</button>
        {onRead && <button type="button" className="cargo-read" onClick={onRead}>{zh ? "读它驮的光" : "Read its light"} →</button>}
      </footer>
      <small className="cargo-privacy">{zh ? "模糊邮路示意 · 不是实时个人轨迹" : "Coarse route sketch · not a live personal trail"}</small>
    </aside>
  );
}

function CourierLegend({ stage, locale, activeModes, open, onToggle, onPickMode }: {
  stage: ZoomStage; locale: Locale; activeModes: CourierMode[]; open: boolean; onToggle: () => void; onPickMode: (mode: CourierMode) => void;
}) {
  const zh = locale === "zh";
  const visibleCount = TRANSPORT_ORDER.filter((mode) => courierPresentationAtZoom(mode, stage) !== "hidden").length;
  return (
    <div className={`courier-legend ${open ? "legend-open" : ""}`}>
      <button type="button" className="courier-legend-toggle" onClick={onToggle} aria-expanded={open} aria-label={zh ? "信使图例" : "Courier legend"}>
        <i aria-hidden="true">✈</i>
        <span>{zh ? "信使图例" : "COURIERS"}</span>
        <b>{visibleCount}/{TRANSPORT_ORDER.length}</b>
      </button>
      {open && <div className="courier-legend-panel" role="list" aria-label={zh ? "每种信使出现的空间层" : "Where each courier appears"}>
        <header>
          <small>{zh ? "当前镜头" : "CURRENT LAYER"}</small>
          <strong>{ZOOM_STAGE_NAMES[stage][zh ? "zh" : "en"]}</strong>
          <em>{zh ? "每种信使只在属于它的空间层出现" : "Each courier appears only where it belongs"}</em>
        </header>
        {TRANSPORT_ORDER.map((mode) => {
          const guide = courierAppearanceGuide(mode, stage, locale);
          const journeyHere = activeModes.includes(mode);
          const tappable = guide.state === "model" && journeyHere;
          return (
            <button type="button" role="listitem" key={mode} className={`legend-row state-${guide.state} ${journeyHere ? "has-journey" : "no-journey"}`} disabled={!tappable} onClick={() => tappable && onPickMode(mode)}>
              <i className={`legend-glyph mode-${mode}`} aria-hidden="true">{TRANSPORTS[mode].glyph}</i>
              <span>
                <strong>{TRANSPORTS[mode].names[locale]}</strong>
                <small>{courierStageRangeLabel(mode, locale)}</small>
              </span>
              <em>{tappable ? guide.text : guide.state === "model" ? (zh ? "此层可见 · 暂无在途邮路" : "This layer — no route in flight") : guide.text}</em>
            </button>
          );
        })}
      </div>}
    </div>
  );
}

function useSoundscape(on: boolean, environment: Environment) {
  const contextRef = useRef<AudioContext | null>(null);
  const masterRef = useRef<GainNode | null>(null);
  useEffect(() => {
    if (!on) return;
    const AudioCtx = window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const master = ctx.createGain();
    const compressor = ctx.createDynamicsCompressor();
    compressor.threshold.value = -28;
    compressor.knee.value = 18;
    compressor.ratio.value = 3;
    compressor.attack.value = .05;
    compressor.release.value = .65;
    master.gain.value = 0.045;
    master.connect(compressor).connect(ctx.destination);
    contextRef.current = ctx;
    masterRef.current = master;
    const sources: AudioScheduledSourceNode[] = [];
    const toneBed = ctx.createGain();
    const toneFilter = ctx.createBiquadFilter();
    const lfo = ctx.createOscillator();
    const lfoDepth = ctx.createGain();
    toneBed.gain.value = environment.time === "night" ? .48 : environment.time === "dawn" ? .42 : .34;
    toneFilter.type = "lowpass";
    toneFilter.frequency.value = environment.weather === "storm" ? 520 : environment.time === "night" ? 760 : 1050;
    toneFilter.Q.value = .45;
    lfo.type = "sine";
    lfo.frequency.value = .055;
    lfoDepth.gain.value = .075;
    lfo.connect(lfoDepth).connect(toneBed.gain);
    lfo.start();
    sources.push(lfo);
    toneBed.connect(toneFilter).connect(master);
    const tonalShift = environment.time === "night" ? .75 : environment.time === "dawn" ? .9 : 1;
    [55, 82.41, 110, 164.81, 220].forEach((frequency, index) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      const panner = ctx.createStereoPanner();
      osc.type = index < 2 ? "sine" : index === 2 ? "triangle" : "sine";
      osc.frequency.value = frequency * tonalShift;
      gain.gain.value = index === 0 ? .15 : index === 1 ? .09 : index === 2 ? .045 : .018;
      panner.pan.value = (index - 2) * .16;
      osc.connect(gain).connect(panner).connect(toneBed);
      osc.start();
      sources.push(osc);
    });
    if (["rain", "storm", "snow", "cloud"].includes(environment.weather) || environment.hazard === "dust") {
      const buffer = ctx.createBuffer(2, ctx.sampleRate * 4, ctx.sampleRate);
      for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
        const data = buffer.getChannelData(channel);
        let previous = 0;
        for (let i = 0; i < data.length; i++) {
          const white = Math.random() * 2 - 1;
          previous = previous * .985 + white * .015;
          data[i] = environment.weather === "rain" || environment.weather === "storm" ? white * .55 + previous * .45 : previous;
        }
      }
      const source = ctx.createBufferSource();
      source.buffer = buffer;
      source.loop = true;
      const filter = ctx.createBiquadFilter();
      filter.type = environment.weather === "snow" ? "lowpass" : "bandpass";
      filter.frequency.value = environment.weather === "snow" ? 280 : environment.hazard === "dust" ? 460 : environment.weather === "cloud" ? 620 : 1350;
      filter.Q.value = environment.weather === "storm" ? .65 : .4;
      const rainGain = ctx.createGain();
      rainGain.gain.value = environment.weather === "storm" ? .56 : environment.weather === "snow" ? .1 : environment.hazard === "dust" ? .21 : environment.weather === "cloud" ? .055 : .33;
      source.connect(filter).connect(rainGain).connect(master);
      source.start();
      sources.push(source);
    }
    return () => {
      sources.forEach((source) => { try { source.stop(); } catch { /* already stopped */ } });
      contextRef.current = null;
      masterRef.current = null;
      void ctx.close();
    };
  }, [environment, on]);
  return useCallback((cue: "lamp" | "watch" | "reply" | "depart") => {
    const ctx = contextRef.current;
    const master = masterRef.current;
    if (!on || !ctx || !master) return;
    void ctx.resume();
    const palettes = {
      lamp: [196, 293.66, 392],
      watch: [146.83, 220, 293.66],
      reply: [261.63, 329.63, 392, 523.25],
      depart: [174.61, 261.63, 349.23],
    } as const;
    palettes[cue].forEach((frequency, index) => {
      const oscillator = ctx.createOscillator();
      const gain = ctx.createGain();
      const panner = ctx.createStereoPanner();
      const delay = ctx.createDelay(.8);
      const echo = ctx.createGain();
      const start = ctx.currentTime + index * (cue === "reply" ? .12 : .09);
      const duration = cue === "watch" ? 1.75 : cue === "reply" ? 1.35 : cue === "depart" ? 1.15 : .9;
      oscillator.type = cue === "depart" && index === 0 ? "triangle" : "sine";
      oscillator.frequency.setValueAtTime(frequency, start);
      oscillator.frequency.exponentialRampToValueAtTime(frequency * (cue === "depart" ? 1.035 : 1.008), start + duration);
      gain.gain.setValueAtTime(.0001, start);
      gain.gain.exponentialRampToValueAtTime(cue === "reply" ? .095 : cue === "watch" ? .052 : .068, start + .11);
      gain.gain.exponentialRampToValueAtTime(.0001, start + duration);
      panner.pan.value = Math.max(-.45, Math.min(.45, (index - 1.25) * .23));
      delay.delayTime.value = cue === "watch" ? .31 : .22;
      echo.gain.value = cue === "reply" ? .22 : .14;
      oscillator.connect(gain).connect(panner).connect(master);
      panner.connect(delay).connect(echo).connect(master);
      oscillator.start(start);
      oscillator.stop(start + duration + .04);
    });
  }, [on]);
}

export default function Home() {
  const [locale, setLocale] = useState<Locale>("zh");
  const [panel, setPanel] = useState<Panel>(null);
  const [stories, setStories] = useState<Story[]>(INITIAL_STORIES);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showOriginal, setShowOriginal] = useState(false);
  const [weather, setWeather] = useState<Weather>({ temperature: 21, apparent: 20, wind: 12, gust: 18, cloud: 18, precipitation: 0, humidity: 52, visibility: 24000, soilMoisture: .22, code: 1, isDay: true, localHour: 15, timezone: "America/Edmonton" });
  const [location, setLocation] = useState({ lat: 53.55, lon: -113.49, label: "Edmonton" });
  const [focus, setFocus] = useState<FocusPoint>({ lat: 25, lon: -20, nonce: 0 });
  const [userLocation, setUserLocation] = useState<{ lat: number; lon: number } | null>(null);
  const [locationGate, setLocationGate] = useState(false);
  const [locationIntent, setLocationIntent] = useState<LocationIntent>(null);
  const [nearView, setNearView] = useState(false);
  const [zoomCommand, setZoomCommand] = useState<ZoomCommand>({ delta: 0, nonce: 0 });
  const [mapZoomCommand, setMapZoomCommand] = useState<ZoomCommand>({ delta: 0, nonce: 0 });
  const [mapZoom, setMapZoom] = useState(MAP_ENTRY_ZOOM);
  const [placeHierarchy, setPlaceHierarchy] = useState<PlaceHierarchy>({
    country: "加拿大",
    region: "艾伯塔省",
    city: "埃德蒙顿",
    district: "埃德蒙顿都市片区",
    locality: "模糊社区范围",
    source: "fallback",
  });
  const [sound, setSound] = useState(false);
  const [zoom, setZoom] = useState(INITIAL_EARTH_ZOOM);
  const [earthLens, setEarthLens] = useState<EarthLens>("daily");
  const [earthDataLayer, setEarthDataLayer] = useState<EarthDataLayer>("kindness");
  const [naturalEvents, setNaturalEvents] = useState<EarthObservationPoint[]>([]);
  const [naturalEventsStatus, setNaturalEventsStatus] = useState<"loading" | "current" | "unavailable">("loading");
  const [naturalEventsUpdatedAt, setNaturalEventsUpdatedAt] = useState<number | null>(null);
  const [auroraGrid, setAuroraGrid] = useState<[number, number, number][]>([]);
  const [auroraStatus, setAuroraStatus] = useState<"loading" | "current" | "unavailable">("loading");
  const [auroraForecastAt, setAuroraForecastAt] = useState<string | null>(null);
  const [auroraObservedAt, setAuroraObservedAt] = useState<string | null>(null);
  const [nasaObservatoryOpen, setNasaObservatoryOpen] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [myAuthorTag] = useState<string | null>(() => {
    if (typeof window === "undefined") return null;
    try { return deviceTagOf(getAuthorKey()); } catch { return null; }
  });
  const [reportArmFor, setReportArmFor] = useState<string | null>(null);
  const [composeMode, setComposeMode] = useState<ComposeMode>("light");
  const [composeScene, setComposeScene] = useState<ComposeScene>(null);
  const [composeStep, setComposeStep] = useState<1 | 2 | 3>(1);
  const [draftText, setDraftText] = useState("");
  const [supportStep, setSupportStep] = useState<SupportStep>("level");
  const [supportLevel, setSupportLevel] = useState<SupportLevel>("listen");
  const [supportNeed, setSupportNeed] = useState<SupportNeed>("heard");
  const [supportText, setSupportText] = useState("");
  const [supportReceipt, setSupportReceipt] = useState<SupportReceipt | null>(null);
  const [delivery, setDelivery] = useState<Delivery>("random");
  const [courierMode, setCourierMode] = useState<CourierMode>("pigeon");
  const [archiveTab, setArchiveTab] = useState<ArchiveTab>("paths");
  const [worldTab, setWorldTab] = useState<WorldTab>("now");
  const [pickedPlace, setPickedPlace] = useState<{ lat: number; lon: number } | null>(null);
  const [placePickerOpen, setPlacePickerOpen] = useState(false);
  const [journeys, setJourneys] = useState<Journey[]>(() => createExperienceJourneys());
  const [compactDevice] = useState(() => isCompactDevice());
  const [activeJourneyId, setActiveJourneyId] = useState<string | null>("journey-demo-world-rocket");
  const [cargoJourneyId, setCargoJourneyId] = useState<string | null>(null);
  const [courierLegendOpen, setCourierLegendOpen] = useState(false);
  const [stageHint, setStageHint] = useState<{ text: string; nonce: number } | null>(null);
  const [journeyView, setJourneyView] = useState(false);
  const [earthHidden, setEarthHidden] = useState(false);
  const [now, setNow] = useState(0);
  const [onboardingStage, setOnboardingStage] = useState<OnboardingStage>("boot");
  const [replyCeremony, setReplyCeremony] = useState<ReplyCeremony | null>(null);
  const [departureTicket, setDepartureTicket] = useState<DepartureTicket | null>(null);
  const [watchingStoryId, setWatchingStoryId] = useState<string | null>(null);
  const [kindnessActs, setKindnessActs] = useState<string[]>([]);
  const [messengerMemory, setMessengerMemory] = useState<MessengerMemory>(() => sanitizeMessengerMemory(EMPTY_MESSENGER_MEMORY) as MessengerMemory);
  const [keepsakes, setKeepsakes] = useState<KeepsakeRecord[]>([]);
  const [weatherStatus, setWeatherStatus] = useState<WeatherStatus>("sample");
  const [weatherObservedAt, setWeatherObservedAt] = useState<number | null>(null);
  const [localStateReady, setLocalStateReady] = useState(false);
  const [networkStatus, setNetworkStatus] = useState<NetworkStatus>("connecting");
  const [networkSignalCount, setNetworkSignalCount] = useState(0);
  const [networkLastSyncedAt, setNetworkLastSyncedAt] = useState<number | null>(null);
  const [showSpatialGuide, setShowSpatialGuide] = useState(false);
  const [placeMomentNonce, setPlaceMomentNonce] = useState(0);
  const [sceneNonce, setSceneNonce] = useState(1);
  const eventCounterRef = useRef(0);
  const weatherRequestRef = useRef(0);
  const actorDayKeyRef = useRef("local-session");
  const kindnessActRef = useRef(new Set<string>());
  const worldButtonRef = useRef<HTMLButtonElement>(null);
  const worldDrawerRef = useRef<HTMLElement>(null);
  const lightButtonRef = useRef<HTMLButtonElement>(null);
  const lightDialogRef = useRef<HTMLElement>(null);
  const supportReceiptRef = useRef<HTMLElement>(null);
  const composeDialogRef = useRef<HTMLElement>(null);
  const nasaObservatoryRef = useRef<HTMLElement>(null);
  const c = UI[locale];
  const extra = EXTRA_UI[locale];
  const pulse = PULSE_UI[locale];
  const support = SUPPORT_UI[locale];
  useEffect(() => {
    const entropy = new Uint32Array(1);
    window.crypto?.getRandomValues?.(entropy);
    const frame = window.requestAnimationFrame(() => setSceneNonce((entropy[0] || Date.now()) >>> 0));
    return () => window.cancelAnimationFrame(frame);
  }, []);
  const selected = stories.find((story) => story.id === selectedId) ?? null;
  const governanceNotice = useCallback((message: string) => {
    setNotice(message);
    window.setTimeout(() => setNotice(null), 4200);
  }, []);
  const handleReport = useCallback(async (reason: ReportReason) => {
    if (!selected || selected.networkState !== "shared") return;
    setReportArmFor(null);
    const ok = await reportToKeepers("signal", selected.id, reason);
    governanceNotice(ok
      ? (locale === "zh" ? "已收到你的举报，守夜人会尽快查看。" : "Report received — a keeper will look soon.")
      : (locale === "zh" ? "举报暂时没有送达，请稍后再试。" : "The report could not be sent right now."));
  }, [governanceNotice, locale, selected]);
  const handleBlockAuthor = useCallback(async () => {
    if (!selected || selected.networkState !== "shared" || !selected.authorTag) return;
    const tag = selected.authorTag;
    const ok = await blockAuthor(tag, true);
    if (ok) {
      setPanel(null);
      setSelectedId(null);
      // The poll merge only adds; remove this author's shared content locally.
      setStories((items) => items
        .filter((story) => !(story.networkState === "shared" && story.authorTag === tag))
        .map((story) => {
          const replies = story.replies.filter((reply) => reply.authorTag !== tag);
          return replies.length === story.replies.length ? story : { ...story, replies };
        }));
    }
    governanceNotice(ok
      ? (locale === "zh" ? "你将不再看见这位匿名作者的内容。" : "You will no longer see content from this anonymous author.")
      : (locale === "zh" ? "操作暂时失败，请稍后再试。" : "That did not go through — please try again."));
  }, [governanceNotice, locale, selected]);
  const handleRetract = useCallback(async () => {
    if (!selected || selected.networkState !== "shared") return;
    const target = selected.id;
    const ok = await retractFromNetwork("signal", target);
    if (ok) {
      setPanel(null);
      setSelectedId(null);
      setStories((items) => items.filter((story) => story.id !== target));
    }
    governanceNotice(ok
      ? (locale === "zh" ? "这束光已被你撤回。" : "Your light has been withdrawn.")
      : (locale === "zh" ? "撤回失败，请稍后再试。" : "Could not withdraw right now."));
  }, [governanceNotice, locale, selected]);
  const activeJourney = journeys.find((journey) => journey.id === activeJourneyId) ?? journeys[0] ?? null;
  const cargoJourney = cargoJourneyId ? journeys.find((journey) => journey.id === cargoJourneyId) ?? null : null;
  const cargoStory = cargoJourney ? stories.find((story) => story.id === cargoJourney.storyId) ?? null : null;
  const solarMinute = Math.floor(now / 60000);
  const auroraChance = useMemo(() => auroraGrid
    .filter(([lon, lat]) => Math.abs(lat - location.lat) <= 4 && Math.abs(lon - location.lon) <= 7)
    .reduce((value, point) => Math.max(value, Number(point[2]) || 0), 0), [auroraGrid, location.lat, location.lon]);
  const auroraPoints = useMemo<EarthObservationPoint[]>(() => auroraGrid
    .filter((point) => Number(point[2]) >= 8)
    .sort((a, b) => Number(b[2]) - Number(a[2]))
    .slice(0, 128)
    .map(([lon, lat, probability], index) => ({ id: `aurora-${index}-${lat}-${lon}`, lat, lon, intensity: Math.min(1, probability / 100), title: `${Math.round(probability)}% aurora probability`, category: "aurora" })), [auroraGrid]);
  const earthObservations = useMemo(() => earthDataLayer === "events" ? naturalEvents : earthDataLayer === "aurora" ? auroraPoints : [], [auroraPoints, earthDataLayer, naturalEvents]);
  const environment = useMemo(() => ({
    ...resolveEnvironment(weather, location.lat, location.lon, auroraChance),
    time: solarPhaseAt(location.lat, location.lon, new Date(solarMinute * 60000)),
  }), [auroraChance, location.lat, location.lon, solarMinute, weather]);
  const senderOrigin = useMemo(() => userLocation
    ? { lat: userLocation.lat, lon: userLocation.lon, label: locale === "zh" ? "我的天空" : "My sky" }
    : { lat: 53.55, lon: -113.49, label: locale === "zh" ? "私密天空" : "Private sky" }, [locale, userLocation]);
  const pigeonProfile = useMemo(() => messengerProfileFor(messengerMemory, locale), [locale, messengerMemory]);
  const courierProfiles = useMemo(() => Object.fromEntries(TRANSPORT_ORDER.map((mode) => [mode, courierProfileFor(mode, messengerMemory, locale)])) as Record<CourierMode, ReturnType<typeof courierProfileFor>>, [locale, messengerMemory]);
  const familyProfiles = useMemo(() => Object.fromEntries((COURIER_FAMILIES as CourierFamily[]).map((family) => [family, courierFamilyProfileFor(family, messengerMemory, locale)])) as Record<CourierFamily, ReturnType<typeof courierFamilyProfileFor>>, [locale, messengerMemory]);
  const activeFamily = courierFamilyFor(courierMode) as CourierFamily;
  const activePigeonFlights = journeys.filter((journey) => journey.id !== "journey-demo-pigeon" && journey.mode === "pigeon" && journeyProgress(journey) < 1).length;
  const heldStoryIds = useMemo(() => stories.filter((story) => kindnessActs.some((key) => key.endsWith(`|${story.id}`))).map((story) => story.id), [kindnessActs, stories]);
  const watchingStory = stories.find((story) => story.id === watchingStoryId) ?? null;
  const ritual = locale === "zh" ? {
    leaveLamp: "留一盏灯", lampHint: "不知道说什么？留一盏灯就够了。", watch: "守夜片刻",
    lampLit: "这盏灯已经亮着。没有姓名，也不留下数字。", lampNew: "灯已经亮起。对方只会感到温度，不会看见数字。",
    keepsakeSaved: "这一刻已保存到你的设备。",
  } : {
    leaveLamp: "Leave a lamp", lampHint: "Not sure what to say? A lamp is enough.", watch: "Keep watch",
    lampLit: "This lamp is already glowing—without a name or a public count.", lampNew: "The lamp is on. It leaves warmth, not a number.",
    keepsakeSaved: "This moment was saved to your device.",
  };

  const playCue = useSoundscape(sound, environment);

  useEffect(() => {
    if (panel !== "menu") return;
    const focusTimer = window.setTimeout(() => worldDrawerRef.current?.querySelector<HTMLButtonElement>("button")?.focus(), 0);
    const onKeyDown = (event: KeyboardEvent) => {
      keepFocusInside(event, worldDrawerRef.current);
      if (event.key !== "Escape") return;
      setPanel(null);
      window.setTimeout(() => worldButtonRef.current?.focus(), 0);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => { window.clearTimeout(focusTimer); window.removeEventListener("keydown", onKeyDown); };
  }, [panel]);

  useEffect(() => {
    if (panel !== "light-choice" && panel !== "support") return;
    const focusTimer = window.setTimeout(() => {
      const target = lightDialogRef.current?.querySelector<HTMLElement>("[data-dialog-focus]")
        ?? lightDialogRef.current?.querySelector<HTMLButtonElement>("button");
      target?.focus();
    }, 0);
    const onKeyDown = (event: KeyboardEvent) => {
      keepFocusInside(event, lightDialogRef.current);
      if (event.key !== "Escape") return;
      setPanel(null);
      window.setTimeout(() => lightButtonRef.current?.focus(), 0);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => { window.clearTimeout(focusTimer); window.removeEventListener("keydown", onKeyDown); };
  }, [panel, supportStep]);

  useEffect(() => {
    if (!supportReceipt) return;
    const focusTimer = window.setTimeout(() => supportReceiptRef.current?.focus(), 0);
    const onKeyDown = (event: KeyboardEvent) => {
      keepFocusInside(event, supportReceiptRef.current);
      if (event.key !== "Escape") return;
      setSupportReceipt(null);
      window.setTimeout(() => lightButtonRef.current?.focus(), 0);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => { window.clearTimeout(focusTimer); window.removeEventListener("keydown", onKeyDown); };
  }, [supportReceipt]);

  useEffect(() => {
    if (panel !== "compose") return;
    const focusTimer = window.setTimeout(() => composeDialogRef.current?.querySelector<HTMLElement>("textarea, button")?.focus(), 0);
    const onKeyDown = (event: KeyboardEvent) => {
      keepFocusInside(event, composeDialogRef.current);
      if (event.key !== "Escape") return;
      setPlacePickerOpen(false);
      setPanel(null);
      window.setTimeout(() => lightButtonRef.current?.focus(), 0);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => { window.clearTimeout(focusTimer); window.removeEventListener("keydown", onKeyDown); };
  }, [panel]);

  useEffect(() => {
    if (!nasaObservatoryOpen) return;
    const focusTimer = window.setTimeout(() => nasaObservatoryRef.current?.querySelector<HTMLButtonElement>("button")?.focus(), 0);
    const onKeyDown = (event: KeyboardEvent) => {
      keepFocusInside(event, nasaObservatoryRef.current);
      if (event.key !== "Escape") return;
      setNasaObservatoryOpen(false);
      window.setTimeout(() => worldButtonRef.current?.focus(), 0);
    };
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.clearTimeout(focusTimer);
      window.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [nasaObservatoryOpen]);

  useEffect(() => {
    const boot = window.setTimeout(() => {
      setNow(Date.now());
      try {
        const savedMemory = JSON.parse(window.localStorage.getItem("kindchain-messenger-memory-v2") ?? window.localStorage.getItem("kindchain-messenger-memory-v1") ?? "null");
        setMessengerMemory(sanitizeMessengerMemory(savedMemory) as MessengerMemory);
      } catch { setMessengerMemory(sanitizeMessengerMemory(EMPTY_MESSENGER_MEMORY) as MessengerMemory); }
      try {
        const savedKeepsakes = JSON.parse(window.localStorage.getItem("kindchain-keepsakes-v1") ?? "[]");
        if (Array.isArray(savedKeepsakes)) setKeepsakes(savedKeepsakes.filter((item) => item && typeof item === "object" && typeof item.id === "string").slice(-48));
      } catch { setKeepsakes([]); }
      try {
        const savedActs = JSON.parse(window.localStorage.getItem("kindchain-kindness-acts-v1") ?? "[]");
        const safeActs = Array.isArray(savedActs) ? savedActs.filter((value): value is string => typeof value === "string").slice(-80) : [];
        kindnessActRef.current = new Set(safeActs);
        setKindnessActs(safeActs);
      } catch {
        kindnessActRef.current = new Set();
        setKindnessActs([]);
      }
      try {
        const savedState = JSON.parse(window.localStorage.getItem("kindchain-local-state-v1") ?? "null") as StoredLocalState | null;
        if (savedState?.version === 1 && Array.isArray(savedState.stories) && Array.isArray(savedState.journeys)) {
          const current = Date.now();
          const livingStories = savedState.stories.filter((story, index, items) => (!story.expiresAt || story.expiresAt > current) && items.findIndex((candidate) => candidate.id === story.id) === index);
          const uniqueJourneys = savedState.journeys.filter((journey, index, items) => items.findIndex((candidate) => candidate.id === journey.id) === index).slice(0, 30);
          const personalJourneys = uniqueJourneys.filter((journey) => !journey.id.startsWith("journey-demo-"));
          const mergedJourneys = [...personalJourneys, ...createExperienceJourneys(current)].slice(0, 30);
          setStories(livingStories);
          setJourneys(mergedJourneys);
          setActiveJourneyId(personalJourneys[0]?.id ?? "journey-demo-world-rocket");
        }
      } catch { /* Corrupt local experience data falls back to the curated sky. */ }
      setLocalStateReady(true);
      const dayStamp = new Date().toISOString().slice(0, 10);
      const savedActor = window.localStorage.getItem("kindchain-activity-day-key");
      if (savedActor?.startsWith(`${dayStamp}:`)) actorDayKeyRef.current = savedActor;
      else {
        const nextActor = `${dayStamp}:${createLocalId()}`;
        actorDayKeyRef.current = nextActor;
        window.localStorage.setItem("kindchain-activity-day-key", nextActor);
      }
      if (window.localStorage.getItem("kindchain-onboarded") === "1") {
        setOnboardingStage("done");
      } else {
        window.setTimeout(() => {
          const firstLight = INITIAL_STORIES.find((story) => story.id === ONBOARDING_STORY_ID) ?? INITIAL_STORIES.find((story) => story.replies.length === 0) ?? INITIAL_STORIES[0];
          setOnboardingStage("seeking");
          setFocus((current) => ({ lat: firstLight.lat, lon: firstLight.lon, nonce: current.nonce + 1 }));
          window.setTimeout(() => setOnboardingStage("ready"), 1100);
        }, 1500);
      }
    }, 0);
    const timer = window.setInterval(() => {
      const current = Date.now();
      setNow(current);
      setStories((items) => {
        const living = items.filter((story) => !story.expiresAt || story.expiresAt > current);
        return living.length === items.length ? items : living;
      });
    }, 1000);
    return () => { window.clearTimeout(boot); window.clearInterval(timer); };
  }, []);

  useEffect(() => {
    if (onboardingStage === "boot") return;
    window.localStorage.setItem("kindchain-messenger-memory-v2", JSON.stringify(messengerMemory));
  }, [messengerMemory, onboardingStage]);

  useEffect(() => {
    if (!localStateReady) return;
    window.localStorage.setItem("kindchain-keepsakes-v1", JSON.stringify(keepsakes.slice(-48)));
  }, [keepsakes, localStateReady]);

  useEffect(() => {
    if (!localStateReady) return;
    window.localStorage.setItem("kindchain-kindness-acts-v1", JSON.stringify(kindnessActs.slice(-80)));
  }, [kindnessActs, localStateReady]);

  useEffect(() => {
    if (!localStateReady) return;
    const state: StoredLocalState = { version: 1, savedAt: Date.now(), stories, journeys: journeys.filter((journey) => !journey.id.startsWith("journey-demo-")).slice(0, 30) };
    window.localStorage.setItem("kindchain-local-state-v1", JSON.stringify(state));
  }, [journeys, localStateReady, stories]);

  useEffect(() => {
    if (!localStateReady) return;
    let active = true;
    let syncing = false;
    let timer = 0;
    const schedule = () => {
      window.clearTimeout(timer);
      if (!active) return;
      timer = window.setTimeout(() => void syncNetwork(), document.hidden ? 15_000 : 6_000);
    };
    const syncNetwork = async () => {
      if (syncing || !active) return;
      syncing = true;
      try {
        const response = await fetch("/api/network", { cache: "no-store", headers: { Accept: "application/json", "x-kindchain-author": getAuthorKey() } });
        if (!response.ok) throw new Error(`network_${response.status}`);
        const snapshot = await response.json() as NetworkSnapshot;
        if (!Array.isArray(snapshot.signals) || !Array.isArray(snapshot.replies)) throw new Error("network_shape");
        if (!active) return;
        setStories((items) => mergeNetworkSnapshot(items, snapshot));
        setNetworkSignalCount(Math.max(0, Number(snapshot.realCount) || 0));
        setNetworkLastSyncedAt(Number(snapshot.generatedAt) || Date.now());
        setNetworkStatus("live");
      } catch {
        if (active) setNetworkStatus("offline");
      } finally {
        syncing = false;
        schedule();
      }
    };
    const onVisibilityChange = () => {
      window.clearTimeout(timer);
      if (document.hidden) schedule();
      else void syncNetwork();
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    void syncNetwork();
    return () => {
      active = false;
      window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [localStateReady]);

  useEffect(() => {
    if (!localStateReady || now === 0) return;
    const arrived = journeys.filter((journey) => !journey.id.startsWith("journey-demo-")
      && journeyProgress(journey) >= 1
      && !messengerMemory.settledJourneyIds.includes(journey.id));
    if (arrived.length === 0) return;
    const timer = window.setTimeout(() => {
      setMessengerMemory((memory) => arrived.reduce((next, journey) => settleCourierJourney(next, {
        id: journey.id,
        mode: journey.mode,
        distanceKm: journey.distance,
        zones: journey.zones,
        stamps: journey.stamps,
        crossedTerminator: journey.crossedTerminator,
        reply: journey.reply,
      }), memory) as MessengerMemory);
      const stampKeepsakes = arrived.flatMap((journey) => (journey.stamps ?? []).map((stamp) => ({
        id: `stamp-${journey.id}-${stableHash(stamp).toString(36)}`,
        kind: "stamp" as const,
        label: locale === "zh" ? "旅途天气印记" : "Journey weather mark",
        message: stamp.replaceAll(":", " · "),
        meta: `${TRANSPORTS[journey.mode].names[locale]} · ${journey.to.label} · ${locale === "zh" ? "在此设备保存" : "Saved on this device"}`,
        fileStem: `kindchain-${stamp}-${journey.id}`,
        createdAt: Date.now(),
      })));
      if (stampKeepsakes.length > 0) setKeepsakes((items) => [...items, ...stampKeepsakes.filter((record) => !items.some((item) => item.id === record.id))].slice(-48));
    }, 0);
    return () => window.clearTimeout(timer);
  }, [journeys, localStateReady, locale, messengerMemory.settledJourneyIds, now]);

  const nasaDate = useMemo(() => {
    const date = new Date();
    date.setUTCDate(date.getUTCDate() - 1);
    return date.toISOString().slice(0, 10);
  }, []);
  // v47: phones fetch half-size Earth textures — a quarter of the decode
  // memory per layer, indistinguishable on a 6-inch screen. Swapped after
  // hydration so server and client render the same initial markup.
  const [textureSize, setTextureSize] = useState("HEIGHT=768&WIDTH=1536");
  useEffect(() => {
    if (!isCompactDevice()) return;
    const timer = window.setTimeout(() => setTextureSize("HEIGHT=384&WIDTH=768"), 0);
    return () => window.clearTimeout(timer);
  }, []);
  const baseTextureUrl = `https://gibs.earthdata.nasa.gov/wms/epsg4326/best/wms.cgi?SERVICE=WMS&REQUEST=GetMap&VERSION=1.3.0&LAYERS=BlueMarble_ShadedRelief_Bathymetry&STYLES=&FORMAT=image/jpeg&TRANSPARENT=FALSE&${textureSize}&CRS=EPSG:4326&BBOX=-90,-180,90,180`;
  const dailyTextureUrl = useMemo(() => `https://gibs.earthdata.nasa.gov/wms/epsg4326/best/wms.cgi?SERVICE=WMS&REQUEST=GetMap&VERSION=1.3.0&LAYERS=VIIRS_SNPP_CorrectedReflectance_TrueColor&STYLES=&FORMAT=image/jpeg&TRANSPARENT=FALSE&${textureSize}&CRS=EPSG:4326&BBOX=-90,-180,90,180&TIME=${nasaDate}`, [nasaDate, textureSize]);
  const nightTextureUrl = `https://gibs.earthdata.nasa.gov/wms/epsg4326/best/wms.cgi?SERVICE=WMS&REQUEST=GetMap&VERSION=1.3.0&LAYERS=VIIRS_CityLights_2012&STYLES=&FORMAT=image/jpeg&TRANSPARENT=FALSE&${textureSize}&CRS=EPSG:4326&BBOX=-90,-180,90,180`;
  const textureUrl = earthLens === "daily" ? dailyTextureUrl : earthLens === "night" ? nightTextureUrl : baseTextureUrl;

  const fetchWeather = useCallback(async (lat: number, lon: number, label?: string) => {
    const requestId = ++weatherRequestRef.current;
    setWeatherStatus("loading");
    setWeatherObservedAt(null);
    try {
      const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat.toFixed(3)}&longitude=${lon.toFixed(3)}&current=temperature_2m,apparent_temperature,relative_humidity_2m,is_day,precipitation,rain,showers,snowfall,snow_depth,weather_code,cloud_cover,visibility,wind_speed_10m,wind_gusts_10m,soil_moisture_0_to_1cm&timezone=auto`;
      const response = await fetch(url);
      if (!response.ok) throw new Error("weather unavailable");
      const data = await response.json() as { timezone: string; current: Record<string, number | string> };
      if (requestId !== weatherRequestRef.current) return;
      const localHour = Number(String(data.current.time ?? "12:00").slice(11, 13));
      const next: Weather = {
        temperature: Number(data.current.temperature_2m ?? 18),
        apparent: Number(data.current.apparent_temperature ?? 18),
        wind: Number(data.current.wind_speed_10m ?? 0),
        gust: Number(data.current.wind_gusts_10m ?? data.current.wind_speed_10m ?? 0),
        cloud: Number(data.current.cloud_cover ?? 0),
        precipitation: Number(data.current.precipitation ?? 0),
        humidity: Number(data.current.relative_humidity_2m ?? 50),
        visibility: Number(data.current.visibility ?? 20000),
        soilMoisture: Number(data.current.soil_moisture_0_to_1cm ?? .2),
        code: Number(data.current.weather_code ?? 0),
        isDay: data.current.is_day === 1,
        localHour: Number.isFinite(localHour) ? localHour : 12,
        timezone: data.timezone,
      };
      setWeather(next);
      setWeatherStatus("live");
      setWeatherObservedAt(Date.now());
      setLocation({ lat, lon, label: label ?? `${Math.abs(lat).toFixed(1)}°${lat >= 0 ? "N" : "S"} · ${Math.abs(lon).toFixed(1)}°${lon >= 0 ? "E" : "W"}` });
    } catch {
      if (requestId !== weatherRequestRef.current) return;
      const solarHour = (new Date().getUTCHours() + lon / 15 + 24) % 24;
      setWeather({ temperature: 18, apparent: 18, wind: 0, gust: 0, cloud: 0, precipitation: 0, humidity: 50, visibility: 20000, soilMoisture: .2, code: 0, isDay: solarHour >= 6 && solarHour < 18, localHour: solarHour, timezone: "UTC" });
      setWeatherStatus("unavailable");
      setWeatherObservedAt(null);
      setLocation({ lat, lon, label: label ?? `${lat.toFixed(1)}°, ${lon.toFixed(1)}°` });
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => { void fetchWeather(53.55, -113.49, "Edmonton"); }, 0);
    return () => window.clearTimeout(timer);
  }, [fetchWeather]);

  useEffect(() => {
    const controller = new AbortController();
    const roundedLat = Math.round(location.lat * 10) / 10;
    const roundedLon = Math.round(location.lon * 10) / 10;
    const context = geographicContextFor(location);
    const fallbackCountry = locale === "zh" ? context.country.zh : context.country.en;
    const fallbackHierarchy: PlaceHierarchy = {
      country: fallbackCountry,
      region: locale === "zh" ? "省级范围" : "Province / state",
      city: location.label || (locale === "zh" ? "城市范围" : "City area"),
      district: locale === "zh" ? "区县级片区" : "Coarse district",
      locality: locale === "zh" ? "模糊社区范围" : "Coarse community area",
      source: "fallback",
    };
    const fallbackTimer = window.setTimeout(() => setPlaceHierarchy(fallbackHierarchy), 0);
    const query = new URLSearchParams({
      lat: roundedLat.toFixed(1),
      lon: roundedLon.toFixed(1),
      lang: locale === "zh" ? "zh-CN" : locale,
    });
    void fetch(`/api/place?${query}`, { signal: controller.signal })
      .then((response) => response.ok ? response.json() : Promise.reject(new Error("place unavailable")))
      .then((value: Partial<PlaceHierarchy>) => {
        const safe = (candidate: unknown, fallback: string) => typeof candidate === "string" && candidate.trim() ? candidate.trim().slice(0, 80) : fallback;
        setPlaceHierarchy({
          country: safe(value.country, fallbackCountry),
          region: safe(value.region, locale === "zh" ? "省级范围" : "Province / state"),
          city: safe(value.city, location.label || (locale === "zh" ? "城市范围" : "City area")),
          district: safe(value.district, locale === "zh" ? "区县级片区" : "Coarse district"),
          locality: safe(value.locality, locale === "zh" ? "模糊社区范围" : "Coarse community area"),
          source: value.source === "openstreetmap" ? "openstreetmap" : "fallback",
        });
      })
      .catch(() => { /* The visible coarse hierarchy remains available offline. */ });
    return () => {
      window.clearTimeout(fallbackTimer);
      controller.abort();
    };
  }, [locale, location]);

  useEffect(() => {
    const controller = new AbortController();
    void fetch("https://eonet.gsfc.nasa.gov/api/v3/events?status=open&limit=60", { signal: controller.signal })
      .then((response) => response.ok ? response.json() : Promise.reject(new Error("EONET unavailable")))
      .then((data: { events?: { id?: string; title?: string; categories?: { id?: string; title?: string }[]; geometry?: { date?: string; type?: string; coordinates?: unknown }[] }[] }) => {
        const points = (data.events ?? []).flatMap<EarthObservationPoint>((event, index) => {
          const geometry = [...(event.geometry ?? [])].reverse().find((item) => item.type === "Point" && Array.isArray(item.coordinates));
          const coordinates = geometry?.coordinates as unknown[] | undefined;
          const lon = Number(coordinates?.[0]);
          const lat = Number(coordinates?.[1]);
          if (!Number.isFinite(lat) || !Number.isFinite(lon)) return [];
          const category = event.categories?.[0]?.title ?? event.categories?.[0]?.id ?? "Natural event";
          const observedAt = geometry?.date ? Date.parse(geometry.date) : NaN;
          return [{ id: event.id ?? `eonet-${index}`, lat, lon, intensity: .72, title: event.title ?? category, category, observedAt: Number.isFinite(observedAt) ? observedAt : undefined }];
        }).sort((a, b) => (b.observedAt ?? 0) - (a.observedAt ?? 0)).slice(0, 36);
        setNaturalEvents(points);
        setNaturalEventsUpdatedAt(points.reduce<number | null>((latest, point) => point.observedAt && (!latest || point.observedAt > latest) ? point.observedAt : latest, null));
        setNaturalEventsStatus("current");
      })
      .catch(() => { if (!controller.signal.aborted) setNaturalEventsStatus("unavailable"); });
    return () => controller.abort();
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void fetch("https://services.swpc.noaa.gov/json/ovation_aurora_latest.json", { signal: controller.signal })
      .then((response) => response.ok ? response.json() : Promise.reject(new Error("aurora unavailable")))
      .then((data: { coordinates?: [number, number, number][]; "Forecast Time"?: string; "Observation Time"?: string }) => {
        setAuroraGrid((data.coordinates ?? []).filter((point) => point.length >= 3 && point.every(Number.isFinite)));
        setAuroraForecastAt(data["Forecast Time"] ?? null);
        setAuroraObservedAt(data["Observation Time"] ?? null);
        setAuroraStatus("current");
      })
      .catch(() => { if (!controller.signal.aborted) setAuroraStatus("unavailable"); });
    return () => controller.abort();
  }, []);

  const localTime = useMemo(() => {
    if (weatherStatus === "loading" || weatherStatus === "unavailable") return "--:--";
    try { return new Intl.DateTimeFormat(locale === "zh" ? "zh-CN" : locale, { hour: "2-digit", minute: "2-digit", timeZone: weather.timezone }).format(new Date()); }
    catch { return "--:--"; }
  }, [locale, weather.timezone, weatherStatus]);

  const nearbyStories = useMemo(() => [...stories].sort((a, b) => distanceKm(location, a) - distanceKm(location, b)).slice(0, 5), [stories, location]);
  const chains = useMemo(() => Object.entries(Object.groupBy(stories, (story) => story.chain)).map(([name, items]) => {
    const list = items ?? [];
    const countries = new Set(list.flatMap((item) => [item.country, ...item.replies.map((reply) => reply.country).filter(Boolean) as string[]])).size;
    const starCount = list.reduce((count, item) => count + 1 + item.replies.length, 0);
    const rarity = starCount >= 8 && countries >= 3 ? 2 : starCount >= 3 ? 1 : 0;
    const deadlines = list.map((item) => item.expiresAt).filter((value): value is number => typeof value === "number");
    const expiresAt = deadlines.length ? Math.max(...deadlines) : null;
    return { name, list, countries, rarity, starCount, expiresAt };
  }), [stories]);
  const activityClock = Math.floor(now / 60000) * 60000;
  const dailyActivity = useMemo(() => buildDailyActivity(stories, activityClock), [activityClock, stories]);
  const activityTotals = useMemo(() => dailyActivity.cells.reduce((totals, cell) => ({
    uniquePublishers: totals.uniquePublishers + cell.uniquePublishers,
    textCount: totals.textCount + cell.textCount,
    recentCount: totals.recentCount + cell.recentCount,
    regions: totals.regions + 1,
  }), { uniquePublishers: 0, textCount: 0, recentCount: 0, regions: 0 }), [dailyActivity]);
  const currentActivity = useMemo(() => {
    const nearest = dailyActivity.cells.map((cell) => ({ cell, distance: distanceKm(location, { lat: cell.centroidLat, lon: cell.centroidLon }) }))
      .sort((a, b) => a.distance - b.distance)[0];
    return nearest && nearest.distance <= 650 ? nearest.cell : null;
  }, [dailyActivity, location]);
  const terminatorPulse = useMemo(() => dailyActivity.cells.reduce((scores, cell) => {
    const phase = solarPhaseAt(cell.centroidLat, cell.centroidLon, new Date(activityClock));
    if (phase === "day" || phase === "dawn") scores.day += cell.textCount;
    else scores.night += cell.textCount;
    return scores;
  }, { day: 0, night: 0 }), [activityClock, dailyActivity]);
  const watchChain = useMemo(() => [...chains].sort((a, b) => {
    if (a.expiresAt && b.expiresAt) return a.expiresAt - b.expiresAt;
    if (a.expiresAt) return -1;
    if (b.expiresAt) return 1;
    return b.starCount - a.starCount;
  })[0] ?? null, [chains]);
  const choirGoal = currentActivity && currentActivity.uniquePublishers >= 10 ? 7 : currentActivity && currentActivity.uniquePublishers >= 4 ? 5 : 3;
  const choirProgress = Math.min(choirGoal, currentActivity?.textCount ?? 0);
  const shelterProgress = Math.min(3, stories.reduce((count, story) => count + (story.scene === "weather-shelter" ? 1 : 0) + story.replies.filter((reply) => reply.scene === "weather-shelter").length, 0));

  const composeTarget = useMemo(() => {
    if (composeMode === "reply" && selected) return { lat: selected.lat, lon: selected.lon, label: selected.region };
    if (delivery === "place" && pickedPlace) {
      const profile = placeProfileFor(pickedPlace.lat, pickedPlace.lon);
      return { ...pickedPlace, label: profile.title[locale === "zh" ? "zh" : "en"] };
    }
    if (delivery === "place") return { ...senderOrigin, label: locale === "zh" ? "等待地球定点" : "Waiting for an Earth point" };
    if (delivery === "nearby") return { lat: senderOrigin.lat + .18, lon: senderOrigin.lon - .12, label: c.near };
    return { lat: -1.29, lon: 36.82, label: locale === "zh" ? "地球某处" : "Somewhere on Earth" };
  }, [c.near, composeMode, delivery, locale, pickedPlace, selected, senderOrigin]);
  const composeEstimate = useMemo(() => estimateRoute(courierMode, senderOrigin, composeTarget), [composeTarget, courierMode, senderOrigin]);

  const selectStory = useCallback((story: Story) => {
    setPickedPlace({ lat: story.lat, lon: story.lon });
    setPlacePickerOpen(false);
    setLocation({ lat: story.lat, lon: story.lon, label: story.region });
    setSelectedId(story.id);
    setShowOriginal(false);
    setNearView(false);
    setPanel("story");
    setFocus((current) => ({ lat: story.lat, lon: story.lon, nonce: current.nonce + 1 }));
    void fetchWeather(story.lat, story.lon, story.region);
  }, [fetchWeather]);

  const finishOnboarding = useCallback((receive: boolean) => {
    window.localStorage.setItem("kindchain-onboarded", "1");
    setOnboardingStage("done");
    if (!receive) return;
    const firstLight = stories.find((story) => story.id === ONBOARDING_STORY_ID) ?? stories.find((story) => story.replies.length === 0) ?? stories[0];
    if (firstLight) selectStory(firstLight);
  }, [selectStory, stories]);

  const acknowledgeSpatialGuide = useCallback(() => {
    setShowSpatialGuide(false);
    window.localStorage.setItem("kindchain-spatial-guide-v1", "1");
  }, []);

  useEffect(() => {
    if (onboardingStage !== "done" || panel !== null || journeyView || supportReceipt || locationGate || replyCeremony || departureTicket || watchingStoryId) return;
    if (window.localStorage.getItem("kindchain-spatial-guide-v1") === "1") return;
    const timer = window.setTimeout(() => setShowSpatialGuide(true), 900);
    return () => window.clearTimeout(timer);
  }, [departureTicket, journeyView, locationGate, onboardingStage, panel, replyCeremony, supportReceipt, watchingStoryId]);

  useEffect(() => {
    if (placeMomentNonce === 0) return;
    const timer = window.setTimeout(() => setPlaceMomentNonce(0), 7200);
    return () => window.clearTimeout(timer);
  }, [placeMomentNonce]);

  const holdLight = useCallback((act: QuietAct) => {
    if (!selected) return;
    const key = kindnessActKey(selected.id, act, new Date());
    const alreadyHeld = kindnessActRef.current.has(key);
    if (!alreadyHeld) {
      kindnessActRef.current.add(key);
      setKindnessActs((items) => [...items, key].slice(-80));
      setStories((items) => items.map((story) => story.id === selected.id ? extendLightExpiry(story, Date.now(), act === "watch" ? 45 : 20) : story));
      setMessengerMemory((memory) => ({ ...memory, escorts: memory.escorts + 1 }));
      playCue(act);
    }
    if (act === "watch") {
      setWatchingStoryId(selected.id);
      setPanel(null);
      return;
    }
    setNotice(alreadyHeld ? ritual.lampLit : ritual.lampNew);
    window.setTimeout(() => setNotice(null), 3800);
  }, [playCue, ritual.lampLit, ritual.lampNew, selected]);

  const pickEarth = useCallback((lat: number, lon: number) => {
    if (panel === "compose" && (!placePickerOpen || delivery !== "place" || composeStep !== 3)) return;
    const point = coarsePublicPoint({ lat, lon });
    const geography = geographicContextFor(point);
    const label = locale === "zh" ? geography.country.zh : geography.country.en;
    setPickedPlace(point);
    setSceneNonce((value) => (value + 1) >>> 0);
    acknowledgeSpatialGuide();
    setSelectedId(null);
    setFocus((current) => ({ ...point, nonce: current.nonce + 1 }));
    setLocation({ ...point, label });
    void fetchWeather(point.lat, point.lon, label);
    if (panel === "compose") {
      setNotice(`${c.selected}: ${point.lat.toFixed(1)}°, ${point.lon.toFixed(1)}°`);
      window.setTimeout(() => setNotice(null), 2200);
    } else {
      setPlaceMomentNonce((value) => value + 1);
      setPlacePickerOpen(false);
      setPanel(null);
    }
  }, [acknowledgeSpatialGuide, c.selected, composeStep, delivery, fetchWeather, locale, panel, placePickerOpen]);

  const locateUser = useCallback(() => {
    setNotice(c.locating);
    if (!navigator.geolocation) { setNotice(c.denied); return; }
    if (userLocation) {
      setPickedPlace(coarsePublicPoint(userLocation));
      setSceneNonce((value) => (value + 1) >>> 0);
      setPlacePickerOpen(false);
      setLocation({ ...userLocation, label: locale === "zh" ? "我的天空" : "My sky" });
      setNearView(false);
      setFocus((current) => ({ ...userLocation, nonce: current.nonce + 1 }));
      void fetchWeather(userLocation.lat, userLocation.lon, locale === "zh" ? "我的天空" : "My sky");
      setPanel(null);
      setNotice(null);
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const lat = position.coords.latitude;
        const lon = position.coords.longitude;
        setUserLocation({ lat, lon });
        setPickedPlace(coarsePublicPoint({ lat, lon }));
        setSceneNonce((value) => (value + 1) >>> 0);
        setPlacePickerOpen(false);
        setLocation({ lat, lon, label: locale === "zh" ? "我的天空" : "My sky" });
        setNearView(false);
        setFocus((current) => ({ lat, lon, nonce: current.nonce + 1 }));
        void fetchWeather(lat, lon, locale === "zh" ? "我的天空" : "My sky");
        setPanel(null);
        setNotice(null);
      },
      () => setNotice(c.denied),
      { enableHighAccuracy: false, timeout: 9000, maximumAge: 600000 },
    );
  }, [c.denied, c.locating, fetchWeather, locale, userLocation]);

  const requestLocation = useCallback((intent: Exclude<LocationIntent, null> = "locate") => {
    if (userLocation) {
      locateUser();
      return;
    }
    setLocationIntent(intent);
    setLocationGate(true);
  }, [locateUser, userLocation]);

  const allowLocation = () => {
    setLocationGate(false);
    window.sessionStorage.setItem("kindchain-location-choice", "allow");
    locateUser();
    setLocationIntent(null);
  };
  const exploreWithoutLocation = () => {
    setLocationGate(false);
    window.sessionStorage.setItem("kindchain-location-choice", "later");
    if (locationIntent === "nearby") setPanel("nearby");
    setLocationIntent(null);
  };
  const enterNeighborhood = useCallback(() => {
    acknowledgeSpatialGuide();
    setNearView(true);
    setPanel((current) => current === "compose" ? current : null);
    setZoom(1);
    setMapZoom(MAP_ENTRY_ZOOM);
  }, [acknowledgeSpatialGuide]);
  const nudgeEarthZoom = useCallback((delta: number) => {
    acknowledgeSpatialGuide();
    if (nearView) {
      const localStops = [MAP_ENTRY_ZOOM, 6.8, 8.7, 10.4];
      const currentIndex = localStops.reduce((best, stop, index) => Math.abs(stop - mapZoom) < Math.abs(localStops[best] - mapZoom) ? index : best, 0);
      if (delta > 0 && currentIndex === 0) {
        setNearView(false);
        setPanel((current) => current === "compose" ? current : null);
        setMapZoom(MAP_ENTRY_ZOOM);
        setZoom(.76);
        setZoomCommand((current) => ({ delta: 0, targetZoom: .76, nonce: current.nonce + 1 }));
        return;
      }
      const nextIndex = Math.max(0, Math.min(localStops.length - 1, currentIndex + (delta < 0 ? 1 : -1)));
      if (nextIndex === currentIndex) return;
      setMapZoomCommand((current) => ({ delta: (mapZoom - localStops[nextIndex]) / .92, nonce: current.nonce + 1 }));
    } else {
      const stops = GLOBE_ZOOM_STOPS;
      const currentStop = nearestZoomStop(zoom);
      const currentIndex = stops.indexOf(currentStop);
      const nextIndex = Math.max(0, Math.min(stops.length - 1, currentIndex + (delta < 0 ? 1 : -1)));
      if (delta < 0 && stops[nextIndex] >= LOCAL_HANDOFF_ZOOM) {
        enterNeighborhood();
        return;
      }
      setZoomCommand((current) => ({ delta: 0, targetZoom: stops[nextIndex], nonce: current.nonce + 1 }));
    }
  }, [acknowledgeSpatialGuide, enterNeighborhood, mapZoom, nearView, zoom]);
  const returnToEarth = useCallback(() => {
    acknowledgeSpatialGuide();
    setNearView(false);
    setPanel((current) => current === "compose" ? current : null);
    setMapZoom(MAP_ENTRY_ZOOM);
    setZoom(.22);
    setZoomCommand((current) => ({ delta: 0, targetZoom: .22, nonce: current.nonce + 1 }));
  }, [acknowledgeSpatialGuide]);
  const exitNeighborhoodByZoom = useCallback(() => {
    setNearView(false);
    setPanel((current) => current === "compose" ? current : null);
    setMapZoom(MAP_ENTRY_ZOOM);
    setZoom(.76);
    setZoomCommand((current) => ({ delta: 0, targetZoom: .76, nonce: current.nonce + 1 }));
  }, []);
  const handleEarthZoom = useCallback((nextZoom: number) => {
    acknowledgeSpatialGuide();
    setZoom(nextZoom);
    setPanel((current) => current === "region" ? null : current);
  }, [acknowledgeSpatialGuide]);

  const openCompose = (mode: ComposeMode, scene: ComposeScene = null) => {
    setWatchingStoryId(null);
    setDepartureTicket(null);
    setComposeMode(mode);
    setComposeScene(scene);
    setComposeStep(1);
    setDraftText("");
    setDelivery("random");
    setPlacePickerOpen(false);
    if (mode === "reply") setCourierMode("pigeon");
    setPanel("compose");
  };

  const openPinnedCompose = () => {
    setWatchingStoryId(null);
    setDepartureTicket(null);
    setReplyCeremony(null);
    setComposeMode("light");
    setComposeScene(null);
    setComposeStep(1);
    setDraftText("");
    setDelivery("place");
    setPlacePickerOpen(false);
    setPlaceMomentNonce(0);
    setPanel("compose");
  };

  const closeLightDialog = () => {
    setPanel(null);
    window.setTimeout(() => lightButtonRef.current?.focus(), 0);
  };

  const openLightChoice = () => {
    setWatchingStoryId(null);
    setDepartureTicket(null);
    setReplyCeremony(null);
    setPanel("light-choice");
  };

  const openSupport = () => {
    setSupportStep("level");
    setSupportLevel("listen");
    setSupportNeed("heard");
    setSupportText("");
    setPanel("support");
  };

  const chooseSupportLevel = (level: SupportLevel | "unsafe") => {
    if (level === "unsafe") {
      setSupportLevel("urgent");
      setSupportStep("crisis");
      return;
    }
    setSupportLevel(level);
    setSupportStep("safety");
  };

  const submitSupportSignal = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const text = supportText.trim();
    if (!text) return;
    eventCounterRef.current += 1;
    const sequence = eventCounterRef.current;
    const createdAt = Date.now();
    const idSeed = `${createdAt.toString(36)}-${sequence.toString(36)}-${stableHash(text).toString(36)}`;
    const point = coarsePublicPoint(userLocation ?? { lat: location.lat, lon: location.lon });
    const detectedLanguage = detectTextLocale(text);
    const origin = userLocation ? activityOriginFor(userLocation, senderOrigin.label) : undefined;
    const story: Story = {
      id: `support-${idSeed}`,
      chain: `companion-${idSeed}`,
      lat: point.lat,
      lon: point.lon,
      region: locale === "zh" ? "私密天空" : locale === "ja" ? "非公開の空" : locale === "fr" ? "Ciel privé" : locale === "es" ? "Cielo privado" : "Private sky",
      country: locale === "zh" ? "模糊地域" : locale === "ja" ? "おおよその地域" : locale === "fr" ? "Région approximative" : locale === "es" ? "Región aproximada" : "Coarse region",
      lang: detectedLanguage,
      text,
      translations: {},
      replies: [],
      kind: "support",
      supportLevel,
      supportNeed,
      localOnly: true,
      createdAt,
      expiresAt: createdAt + 6 * 3600000,
      origin,
      authorDayKey: actorDayKeyRef.current,
    };
    setStories((items) => [...items, story]);
    setSelectedId(story.id);
    setPickedPlace(point);
    setFocus((current) => ({ ...point, nonce: current.nonce + 1 }));
    setSupportReceipt({ id: `support-receipt-${idSeed}`, storyId: story.id, message: text, level: supportLevel, need: supportNeed });
    setSupportText("");
    setSupportStep("level");
    setPanel(null);
    playCue("lamp");
  };

  const endSupportSignal = (storyId: string) => {
    setStories((items) => items.filter((item) => item.id !== storyId));
    setKindnessActs((items) => items.filter((key) => !key.endsWith(`|${storyId}`)));
    setSelectedId((current) => current === storyId ? null : current);
    setSupportReceipt((current) => current?.storyId === storyId ? null : current);
    setPanel(null);
    setNotice(locale === "zh" ? "这次陪伴信号已经安静熄灭。" : "This companion signal has ended quietly.");
    window.setTimeout(() => setNotice(null), 2600);
  };

  const openActivityScene = (scene: Exclude<ComposeScene, null>) => {
    if (scene === "night-watch" && watchChain?.list[0]) {
      const story = watchChain.list[0];
      setSelectedId(story.id);
      setFocus((current) => ({ lat: story.lat, lon: story.lon, nonce: current.nonce + 1 }));
      void fetchWeather(story.lat, story.lon, story.region);
      openCompose("reply", scene);
      return;
    }
    setComposeMode("light");
    setComposeScene(scene);
    if (scene === "region-choir" || scene === "weather-shelter") {
      setDelivery("place");
      setPickedPlace({ lat: location.lat, lon: location.lon });
    } else {
      setDelivery("random");
    }
    setPanel("compose");
  };

  const openJourney = (journey: Journey, cinematic = false) => {
    setActiveJourneyId(journey.id);
    setJourneyView(cinematic);
    setNearView(false);
    setEarthHidden(false);
    setPanel(cinematic ? null : "journeys");
    setFocus((current) => ({ lat: journey.to.lat, lon: journey.to.lon, nonce: current.nonce + 1 }));
  };

  // v44 ①: tapping a courier — on the globe, the fallback sky or the community
  // map — opens its cargo card instead of leaving people guessing what it is.
  const openCourierCargo = useCallback((journey: Journey) => {
    setActiveJourneyId(journey.id);
    setCargoJourneyId(journey.id);
    setCourierLegendOpen(false);
  }, []);

  const openCourierCargoByMode = useCallback((mode: CourierMode) => {
    setJourneys((current) => {
      const journey = current.find((item) => item.mode === mode && journeyProgress(item) < 1)
        ?? current.find((item) => item.mode === mode);
      if (journey) {
        setActiveJourneyId(journey.id);
        setCargoJourneyId(journey.id);
      }
      return current;
    });
    setCourierLegendOpen(false);
  }, []);

  // v44 ③: while descending, the whole scene follows the destination being
  // explored — weather, place identity and hierarchy re-anchor to the map
  // center once the camera settles, not to where the descent began.
  const locationRef = useRef(location);
  useEffect(() => { locationRef.current = location; }, [location]);
  const descentSyncTimerRef = useRef<number | null>(null);
  useEffect(() => () => { if (descentSyncTimerRef.current) window.clearTimeout(descentSyncTimerRef.current); }, []);
  const syncSceneToMapCenter = useCallback((center: { lat: number; lon: number }) => {
    if (descentSyncTimerRef.current) window.clearTimeout(descentSyncTimerRef.current);
    descentSyncTimerRef.current = window.setTimeout(() => {
      const current = locationRef.current;
      if (distanceKm(center, current) < 45) return;
      const geography = geographicContextFor(center);
      const label = locale === "zh" ? geography.country.zh : geography.country.en;
      const previousProfile = placeProfileFor(current.lat, current.lon, current.label);
      const nextProfile = placeProfileFor(center.lat, center.lon, label);
      void fetchWeather(center.lat, center.lon, label);
      if (nextProfile.id !== previousProfile.id) {
        setNotice(locale === "zh" ? `背景已同步：${nextProfile.title.zh}` : `Scene synced: ${nextProfile.title.en}`);
        window.setTimeout(() => setNotice(null), 2600);
      }
    }, 1150);
  }, [fetchWeather, locale]);

  const networkFailureMessage = (error: string) => {
    if (error === "private_contact_blocked") return locale === "zh" ? "为了安全，这封信没有公开：请删去电话、邮箱、网址或社交账号。它仍留在你的设备上。" : "For safety, this was not made public. Remove phone numbers, email, links or social handles. It remains on this device.";
    if (error === "unsafe_public_content") return locale === "zh" ? "这段内容不适合进入公开地球，已只保存在你的设备上。若你正处在危险中，请使用求助入口。" : "This text was kept off the public Earth and remains on your device. If you are in danger, use the support entrance.";
    if (error === "rate_limited") return locale === "zh" ? "先让这几束光走一会儿吧。网络试运行暂时放慢了连续发送。" : "Let these lights travel for a moment. The network pilot has slowed repeated sending.";
    return locale === "zh" ? "网络暂时没有接住这封信；它已安全留在本机，连接恢复后可以再写一束。" : "The network could not receive this yet. It remains safely on this device.";
  };

  const publishNetworkSignal = async (story: Story) => {
    try {
      const response = await fetch("/api/network", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ action: "signal", payload: { ...story, authorKey: getAuthorKey() } }),
      });
      const result = await response.json() as { error?: string; createdAt?: number; expiresAt?: number };
      if (!response.ok) throw new Error(result.error ?? "network_unavailable");
      setStories((items) => items.map((item) => item.id === story.id ? {
        ...item,
        networkState: "shared",
        createdAt: result.createdAt ?? item.createdAt,
        expiresAt: result.expiresAt ?? item.expiresAt,
      } : item));
      setNetworkStatus("live");
      setNetworkSignalCount((count) => count + 1);
      setNetworkLastSyncedAt(Date.now());
    } catch (error) {
      setStories((items) => items.map((item) => item.id === story.id ? { ...item, networkState: "local" } : item));
      const reason = error instanceof Error ? error.message : "network_unavailable";
      if (reason === "network_unavailable" || reason.startsWith("network_5")) setNetworkStatus("offline");
      setNotice(networkFailureMessage(reason));
      window.setTimeout(() => setNotice(null), 5600);
    }
  };

  const publishNetworkReply = async (signalId: string, reply: Reply) => {
    try {
      const response = await fetch("/api/network", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ action: "reply", payload: { ...reply, signalId, authorKey: getAuthorKey() } }),
      });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error ?? "network_unavailable");
      setNetworkStatus("live");
      setNetworkLastSyncedAt(Date.now());
    } catch (error) {
      const reason = error instanceof Error ? error.message : "network_unavailable";
      if (reason === "network_unavailable" || reason.startsWith("network_5")) setNetworkStatus("offline");
      setNotice(networkFailureMessage(reason));
      window.setTimeout(() => setNotice(null), 5600);
    }
  };

  const submitStory = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const text = draftText.trim();
    if (!text) return;
    if (composeMode !== "reply" && delivery === "place" && !pickedPlace) {
      setPlacePickerOpen(true);
      setNotice(locale === "zh" ? "请先轻点地球，落下一枚目的地光针。" : "Tap the Earth to place a destination light.");
      return;
    }
    const journeyCourier: CourierMode = composeMode === "reply" ? "pigeon" : courierMode;
    const unlock = courierUnlockState(journeyCourier, messengerMemory, locale);
    if (composeMode !== "reply" && !unlock.unlocked) {
      setNotice(unlock.hint);
      return;
    }
    if (composeMode !== "reply" && journeyCourier === "pigeon" && activePigeonFlights >= pigeonProfile.slots) {
      setNotice(extra.pigeonBusy);
      return;
    }
    eventCounterRef.current += 1;
    const sequence = eventCounterRef.current;
    const createdAt = Date.now();
    const idSeed = `${createdAt.toString(36)}-${sequence.toString(36)}-${stableHash(text).toString(36)}`;
    const detectedLanguage = detectTextLocale(text);
    const randomPlaces = [{ lat: 64.1, lon: -21.9 }, { lat: 1.35, lon: 103.82 }, { lat: -33.9, lon: 18.42 }, { lat: 41.9, lon: 12.5 }];
    let target = randomPlaces[sequence % randomPlaces.length];
    if (composeMode === "reply" && selected) target = { lat: selected.lat, lon: selected.lon };
    if (delivery === "nearby") target = { lat: senderOrigin.lat + ((sequence % 7) - 3) * .09, lon: senderOrigin.lon + ((sequence % 5) - 2) * .11 };
    if (delivery === "place" && pickedPlace) target = pickedPlace;
    target = coarsePublicPoint(target);
    const targetProfile = placeProfileFor(target.lat, target.lon);
    const targetPlaceLabel = targetProfile.title[locale === "zh" ? "zh" : "en"];
    const origin = userLocation ? activityOriginFor(userLocation, senderOrigin.label) : undefined;
    const newStory: Story = {
      id: `local-${idSeed}`, chain: composeMode === "reply" && selected ? selected.chain : `path-${idSeed}`, lat: target.lat, lon: target.lon,
      region: delivery === "nearby" ? (locale === "zh" ? "你的附近" : "Near you") : delivery === "place" ? targetPlaceLabel : (locale === "zh" ? "地球某处" : "Somewhere on Earth"),
      country: "Earth", lang: detectedLanguage, text, translations: {}, replies: [], kind: composeMode === "wish" ? "wish" : "light",
      createdAt, expiresAt: createdAt + (composeMode === "wish" ? 48 : 24) * 3600000,
      origin, authorDayKey: actorDayKeyRef.current, scene: composeScene ?? undefined, networkState: "pending",
    };
    let journeyStoryId = newStory.id;
    if (composeMode === "reply" && selected) {
      const reply: Reply = {
        id: `reply-${idSeed}`, lang: detectedLanguage, text, translations: {},
        ...(userLocation ? {
          ...coarsePublicPoint(senderOrigin),
          region: senderOrigin.label,
        } : { region: locale === "zh" ? "私密天空" : "Private sky" }),
        country: "Earth", createdAt, origin, authorDayKey: actorDayKeyRef.current, scene: composeScene ?? undefined,
      };
      setStories((items) => items.map((item) => item.id === selected.id ? {
        ...item,
        replies: [...item.replies, reply],
        expiresAt: item.expiresAt ? Math.min((item.createdAt ?? createdAt) + 72 * 3600000, item.expiresAt + 6 * 3600000) : item.expiresAt,
      } : item));
      if (!selected.localOnly && selected.kind !== "support") void publishNetworkReply(selected.id, reply);
      journeyStoryId = selected.id;
    } else {
      setStories((items) => [...items, newStory]);
      void publishNetworkSignal(newStory);
      setSelectedId(newStory.id);
      setFocus((current) => ({ lat: target.lat, lon: target.lon, nonce: current.nonce + 1 }));
    }
    const route = estimateRoute(journeyCourier, senderOrigin, target);
    const fromPhase = solarPhaseAt(senderOrigin.lat, senderOrigin.lon, new Date(createdAt));
    const toPhase = solarPhaseAt(target.lat, target.lon, new Date(createdAt));
    const crossedTerminator = ["day", "dawn"].includes(fromPhase) !== ["day", "dawn"].includes(toPhase);
    const stampKind = environment.aurora ? "AURORA" : environment.hazard !== "none" ? environment.hazard.toUpperCase() : environment.weather !== "clear" ? environment.weather.toUpperCase() : environment.time.toUpperCase();
    const stamps = weatherStatus === "live" ? [`${stampKind}@${new Date(createdAt).toISOString().slice(0, 10)}@${currentZone}`] : [];
    const newJourney: Journey = {
      id: `journey-${idSeed}`, storyId: journeyStoryId, mode: journeyCourier,
      from: senderOrigin,
      to: { lat: target.lat, lon: target.lon, label: composeMode === "reply" && selected ? selected.region : delivery === "nearby" ? c.near : delivery === "place" ? targetPlaceLabel : (locale === "zh" ? "地球某处" : "Somewhere on Earth") },
      ...route, startedAt: Date.now(), demoDurationMs: Math.max(45000, Math.min(150000, (48000 + route.distance * 5) * (journeyCourier === "pigeon" ? 1.18 - pigeonProfile.variant * .13 : 1))),
      courierVariant: courierProfiles[journeyCourier].variant,
      flockSize: journeyCourier === "pigeon" ? pigeonProfile.flock : 1,
      zones: [zoneFor(senderOrigin.lat, senderOrigin.lon), zoneFor(target.lat, target.lon)],
      stamps,
      crossedTerminator,
      reply: composeMode === "reply",
    };
    setJourneys((items) => [newJourney, ...items]);
    setActiveJourneyId(newJourney.id);
    event.currentTarget.reset();
    setDraftText("");
    setComposeStep(1);
    setComposeScene(null);
    setPlacePickerOpen(false);
    setPanel(null);
    if (composeMode === "reply" && selected) {
      playCue("reply");
      const ceremony = { id: `arrival-${idSeed}`, region: selected.region, weather: weatherStatus === "live" ? `${weatherIcon(environment)} ${Math.round(weather.temperature)}°` : (locale === "zh" ? "天气暂不可用" : "Weather unavailable"), localTime, message: text };
      setReplyCeremony(ceremony);
      setKeepsakes((items) => [...items, { id: ceremony.id, kind: "arrival", label: ceremony.region, message: ceremony.message, meta: `${ceremony.weather} · ${ceremony.localTime} · ${locale === "zh" ? "抵达明信片 · 在此设备保存" : "Arrival postcard · saved on this device"}`, fileStem: ceremony.id, createdAt }].slice(-48));
    } else {
      playCue("depart");
      const ticket = {
        id: `ticket-${idSeed}`, journeyId: newJourney.id, from: newJourney.from.label, to: newJourney.to.label,
        messenger: TRANSPORTS[journeyCourier].names[locale], distance: route.distance, message: text, createdAt,
      };
      setDepartureTicket(ticket);
      setKeepsakes((items) => [...items, { id: ticket.id, kind: "departure", label: `${ticket.from} → ${ticket.to}`, message: ticket.message, meta: `${ticket.messenger} · ${Math.round(ticket.distance).toLocaleString()} km · ${locale === "zh" ? "启程票根 · 在此设备保存" : "Departure ticket · saved on this device"}`, fileStem: ticket.id, createdAt }].slice(-48));
    }
  };

  const requestRelay = async (chain: (typeof chains)[number]) => {
    const shareUrl = `${window.location.origin}${window.location.pathname}#star-path-${encodeURIComponent(chain.name)}`;
    const shareText = locale === "zh"
      ? `这条限时星链正在等待下一句文字接力：${chain.starCount} 颗星，${chain.countries} 个地区。`
      : `This fading KindChain constellation is waiting for one more text relay: ${chain.starCount} stars across ${chain.countries} places.`;
    try {
      if (navigator.share) await navigator.share({ title: "KindChain · Star Relay", text: shareText, url: shareUrl });
      else await navigator.clipboard.writeText(`${shareText} ${shareUrl}`);
      setNotice(extra.shared);
    } catch {
      setNotice(locale === "zh" ? "分享已取消，星链仍在等待真实接力。" : "Sharing was cancelled; the constellation is still waiting for a real relay.");
    }
  };

  const captureStarPath = (chain: (typeof chains)[number]) => {
    const canvas = document.createElement("canvas");
    canvas.width = 1600;
    canvas.height = 1000;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const seed = stableHash(`${chain.name}-${chain.starCount}-${nasaDate}`);
    const proof = `STAR-PATH-${seed.toString(16).padStart(8, "0").toUpperCase()}${stableHash(`${seed}-${chain.countries}`).toString(16).slice(0, 8).toUpperCase()}`;
    const sky = ctx.createRadialGradient(820, 520, 40, 800, 500, 940);
    sky.addColorStop(0, environment.time === "day" ? "#244a68" : environment.time === "dawn" ? "#6a415d" : "#19183d");
    sky.addColorStop(.46, "#0a0d24");
    sky.addColorStop(1, "#02030a");
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    for (let i = 0; i < 180; i++) {
      const h = stableHash(`${seed}-star-${i}`);
      const x = h % canvas.width;
      const y = (h >>> 11) % 720;
      const radius = .6 + ((h >>> 20) % 16) / 10;
      ctx.globalAlpha = .18 + ((h >>> 7) % 58) / 100;
      ctx.fillStyle = i % 11 === 0 ? "#d8c3ff" : "#eef5ff";
      ctx.beginPath(); ctx.arc(x, y, radius, 0, Math.PI * 2); ctx.fill();
    }
    ctx.globalAlpha = 1;
    const earth = ctx.createRadialGradient(700, 760, 40, 800, 930, 520);
    earth.addColorStop(0, "#557fab"); earth.addColorStop(.45, "#1d4f6a"); earth.addColorStop(.78, "#102940"); earth.addColorStop(1, "#030813");
    ctx.save();
    ctx.beginPath(); ctx.arc(800, 1085, 520, 0, Math.PI * 2); ctx.clip();
    ctx.fillStyle = earth; ctx.fillRect(250, 550, 1100, 520);
    ctx.globalAlpha = .25; ctx.strokeStyle = "#9ed6e4"; ctx.lineWidth = 10;
    for (let i = 0; i < 7; i++) { ctx.beginPath(); ctx.ellipse(800, 930 + i * 42, 470 - i * 34, 75, -.08, 0, Math.PI * 2); ctx.stroke(); }
    const solar = subsolarPoint(new Date(now));
    ctx.globalAlpha = .82; ctx.fillStyle = "#01030a";
    ctx.beginPath(); ctx.ellipse(800 - solar.lon * 2.2, 875 - solar.lat * 1.3, 360, 620, -.1, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
    ctx.globalAlpha = 1; ctx.strokeStyle = "rgba(141,219,238,.48)"; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.arc(800, 1085, 520, Math.PI, Math.PI * 2); ctx.stroke();

    const nodes = chain.list.flatMap((story) => [{ id: story.id, lat: story.lat, lon: story.lon, parent: null as string | null }, ...story.replies.map((reply) => ({
      id: reply.id, lat: reply.lat ?? story.lat + ((stableHash(reply.id) % 9) - 4) * .3,
      lon: reply.lon ?? story.lon + ((stableHash(`${reply.id}-lon`) % 9) - 4) * .4, parent: story.id,
    }))]);
    const points = new Map(nodes.map((node, index) => {
      const angle = (stableHash(node.id) % 628) / 100 + index * .61;
      const ring = 90 + (index % 4) * 62;
      return [node.id, { x: 800 + Math.cos(angle) * ring * (1 + index / Math.max(8, nodes.length * 2)), y: 390 + Math.sin(angle) * ring * .58 }] as const;
    }));
    ctx.lineWidth = 3;
    chain.list.forEach((story, storyIndex) => {
      const point = points.get(story.id);
      const previous = storyIndex ? points.get(chain.list[storyIndex - 1].id) : null;
      if (point && previous) {
        ctx.strokeStyle = "rgba(194,166,255,.42)"; ctx.setLineDash([14, 10]);
        ctx.beginPath(); ctx.moveTo(previous.x, previous.y); ctx.quadraticCurveTo(800 + (storyIndex % 2 ? 130 : -130), 280 - storyIndex * 10, point.x, point.y); ctx.stroke();
      }
      story.replies.forEach((reply) => {
        const child = points.get(reply.id); if (!point || !child) return;
        ctx.strokeStyle = "rgba(126,232,205,.5)"; ctx.setLineDash([]);
        ctx.beginPath(); ctx.moveTo(point.x, point.y); ctx.quadraticCurveTo((point.x + child.x) / 2, Math.min(point.y, child.y) - 28, child.x, child.y); ctx.stroke();
      });
    });
    ctx.setLineDash([]);
    nodes.forEach((node, index) => {
      const point = points.get(node.id); if (!point) return;
      const glow = ctx.createRadialGradient(point.x, point.y, 0, point.x, point.y, 22);
      glow.addColorStop(0, index % 3 === 0 ? "#fff0bd" : "#e4d7ff"); glow.addColorStop(.2, "rgba(190,158,255,.9)"); glow.addColorStop(1, "rgba(145,105,255,0)");
      ctx.fillStyle = glow; ctx.beginPath(); ctx.arc(point.x, point.y, 22, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = "#fff"; ctx.beginPath(); ctx.arc(point.x, point.y, 3.2, 0, Math.PI * 2); ctx.fill();
    });
    ctx.fillStyle = "rgba(245,241,255,.92)"; ctx.font = "52px Georgia, serif"; ctx.textAlign = "center";
    ctx.fillText(constellationName(chain.name, locale).toUpperCase(), 800, 105);
    ctx.fillStyle = "rgba(208,201,221,.62)"; ctx.font = "18px monospace";
    ctx.fillText(`${chain.starCount} STARS · ${chain.countries} REGIONS · NASA ${nasaDate}`, 800, 145);
    ctx.fillStyle = "rgba(215,199,255,.72)"; ctx.font = "21px monospace"; ctx.fillText(proof, 800, 680);
    ctx.fillStyle = "rgba(255,255,255,.32)"; ctx.font = "15px monospace"; ctx.fillText(extra.notOnChain.toUpperCase(), 800, 713);
    ctx.save(); ctx.translate(1390, 560); ctx.rotate(-Math.PI / 2); ctx.fillStyle = "rgba(255,255,255,.08)"; ctx.font = "42px monospace"; ctx.fillText("NOT ON-CHAIN", 0, 0); ctx.restore();
    canvas.toBlob((blob) => {
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url; link.download = `${proof}.png`; link.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      setNotice(extra.saved);
    }, "image/png");
  };

  const saveMomentCard = (payload: KeepsakePayload) => {
    const canvas = document.createElement("canvas");
    canvas.width = 1200;
    canvas.height = 1600;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const seed = stableHash(`${payload.fileStem}-${payload.message}-${nasaDate}`);
    const sky = ctx.createLinearGradient(0, 0, 0, 1600);
    sky.addColorStop(0, "#02040a");
    sky.addColorStop(.55, "#0a1428");
    sky.addColorStop(.72, "#17152a");
    sky.addColorStop(1, "#f5efe2");
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, 1200, 1600);
    const glow = ctx.createRadialGradient(790, 640, 12, 790, 640, 410);
    glow.addColorStop(0, "rgba(255,217,157,.82)");
    glow.addColorStop(.08, "rgba(201,168,106,.26)");
    glow.addColorStop(.38, "rgba(189,162,255,.08)");
    glow.addColorStop(1, "rgba(2,4,10,0)");
    ctx.fillStyle = glow;
    ctx.fillRect(0, 160, 1200, 920);
    for (let index = 0; index < 76; index++) {
      const hash = stableHash(`${seed}-${index}`);
      const x = 70 + hash % 1060;
      const y = 95 + (hash >>> 11) % 730;
      const size = .8 + ((hash >>> 21) % 18) / 10;
      ctx.globalAlpha = .2 + ((hash >>> 5) % 45) / 100;
      ctx.fillStyle = index % 13 === 0 ? "#ffd99d" : index % 7 === 0 ? "#bda2ff" : "#eef4ff";
      ctx.beginPath(); ctx.arc(x, y, size, 0, Math.PI * 2); ctx.fill();
    }
    ctx.globalAlpha = 1;
    ctx.strokeStyle = "rgba(201,168,106,.62)";
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(790, 640, 112, Math.PI * .18, Math.PI * 1.72); ctx.stroke();
    ctx.fillStyle = "#fff4d2";
    ctx.shadowColor = "rgba(255,217,157,.95)";
    ctx.shadowBlur = 30;
    ctx.beginPath(); ctx.arc(790, 640, 6, 0, Math.PI * 2); ctx.fill();
    ctx.shadowBlur = 0;

    ctx.fillStyle = "rgba(245,239,226,.92)";
    ctx.font = "22px monospace";
    ctx.letterSpacing = "4px";
    ctx.fillText(payload.kind === "departure" ? "KINDCHAIN · DEPARTURE TICKET" : payload.kind === "stamp" ? "KINDCHAIN · JOURNEY WEATHER MARK" : "KINDCHAIN · ARRIVAL POSTCARD", 84, 112);
    ctx.fillStyle = "rgba(245,239,226,.58)";
    ctx.font = "16px monospace";
    ctx.fillText("PRIVATE LOCAL KEEPSAKE · NO PUBLIC COUNT", 84, 150);

    const wrap = (text: string, maxWidth: number, maxLines: number) => {
      const lines: string[] = [];
      let line = "";
      const cjk = /[\u3000-\u9fff\uf900-\ufaff]/.test(text);
      const units = cjk ? Array.from(text) : text.split(/(\s+)/);
      for (const unit of units) {
        const next = line + unit;
        if (line && ctx.measureText(next).width > maxWidth) {
          if (cjk && /^[，。！？、；：）》】”’]/.test(unit)) {
            lines.push(line + unit);
            line = "";
          } else {
            lines.push(line.trimEnd());
            line = unit.trimStart();
          }
          if (lines.length === maxLines) break;
        } else line = next;
      }
      if (lines.length < maxLines && line) lines.push(line);
      return lines;
    };
    ctx.fillStyle = "#f5efe2";
    ctx.font = locale === "zh" ? "46px serif" : "45px Georgia, serif";
    const messageLines = wrap(payload.message, 820, 7);
    ctx.fillStyle = "rgba(201,168,106,.86)";
    ctx.font = "72px Georgia, serif";
    ctx.fillText("“", 84, 298);
    ctx.fillStyle = "#f5efe2";
    ctx.font = locale === "zh" ? "46px serif" : "45px Georgia, serif";
    messageLines.forEach((line, index) => ctx.fillText(index === messageLines.length - 1 ? `${line}”` : line, 130, 296 + index * 68));

    ctx.fillStyle = "#171827";
    ctx.fillRect(0, 1100, 1200, 500);
    ctx.fillStyle = "#f5efe2";
    ctx.font = "48px Georgia, serif";
    ctx.fillText(payload.label, 84, 1212);
    ctx.fillStyle = "rgba(245,239,226,.58)";
    ctx.font = "20px monospace";
    wrap(payload.meta.toUpperCase(), 780, 3).forEach((line, index) => ctx.fillText(line, 84, 1270 + index * 34));
    ctx.strokeStyle = "rgba(199,62,58,.72)";
    ctx.lineWidth = 4;
    ctx.beginPath(); ctx.arc(1000, 1365, 92, 0, Math.PI * 2); ctx.stroke();
    ctx.beginPath(); ctx.arc(1000, 1365, 76, 0, Math.PI * 2); ctx.stroke();
    ctx.fillStyle = "rgba(199,62,58,.86)";
    ctx.textAlign = "center";
    ctx.font = "18px monospace";
    ctx.fillText(payload.kind === "departure" ? "DEPARTED" : payload.kind === "stamp" ? "MARKED" : "RECEIVED", 1000, 1358);
    ctx.font = "15px monospace";
    ctx.fillText(new Date().toISOString().slice(0, 10), 1000, 1388);
    ctx.textAlign = "left";
    ctx.fillStyle = "rgba(245,239,226,.34)";
    ctx.font = "17px monospace";
    ctx.fillText(`KINDCHAIN / ${seed.toString(16).toUpperCase().padStart(8, "0")}`, 84, 1514);
    canvas.toBlob((blob) => {
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `${payload.fileStem.replace(/[^a-z0-9-]+/gi, "-")}.png`;
      link.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      setNotice(ritual.keepsakeSaved);
      window.setTimeout(() => setNotice(null), 3200);
    }, "image/png");
  };

  const drift = () => {
    eventCounterRef.current += 1;
    selectStory(stories[eventCounterRef.current % stories.length]);
  };
  const openWorld = (tab: WorldTab = worldTab) => {
    if (panel === "compose") return;
    setWorldTab(tab);
    setPanel((current) => current === "menu" && tab === worldTab ? null : "menu");
  };
  const selectEarthDataLayer = (layer: EarthDataLayer) => {
    setEarthDataLayer(layer);
    if (layer === "events") setEarthLens("daily");
    if (layer === "aurora") setEarthLens("night");
  };
  const openNasaObservatory = () => {
    setPanel(null);
    setNasaObservatoryOpen(true);
  };
  const sceneLabel = environmentLabel(environment);
  // Preload the real map invisibly at regional depth, but never expose its
  // half-ready raster/fallback canvas on top of the globe. The visible handoff
  // begins only when the user actually enters the map; CSS then animates the
  // already-mounted surface from a curved aperture to the full viewport.
  const mapBlend = nearView ? 1 : 0;
  const sceneReveal = Math.max(0, Math.min(1, (zoom - .5) / .32));
  const earthOpacity = Math.max(0, 1 - sceneReveal * .16 - mapBlend * .84);
  // v47: desktops pre-mount the real map during approach for a seamless
  // handoff; phones cannot afford a second live GL context while browsing
  // the globe (that is what crashed the tab), so they mount it only when
  // the descent actually begins. The built-in atlas covers the first beat.
  const mapVisible = nearView || (zoom >= MAP_MOUNT_DEPTH && !compactDevice);
  const localProgress = Math.max(0, Math.min(1, (mapZoom - MAP_ENTRY_ZOOM) / (MAP_MAX_ZOOM - MAP_ENTRY_ZOOM)));
  const depthProgress = nearView ? .78 + localProgress * .22 : Math.min(.78, zoom * .78);
  const zoomStage: ZoomStage = nearView
    ? mapZoom >= 10 ? "COMMUNITY" : mapZoom >= 8.1 ? "DISTRICT" : mapZoom >= 6.2 ? "CITY" : "REGION"
    : zoom >= .74 ? "REGION" : zoom >= .56 ? "COUNTRY" : zoom >= .36 ? "CONTINENT" : zoom >= .18 ? "EARTH" : "ORBIT";
  const courierScale = Math.max(.4, .98 - depthProgress * .58);
  const placeProfile = placeProfileFor(location.lat, location.lon, location.label);
  const backgroundIdentity = backgroundIdentityFor(location, placeProfile, weather, environment);
  const geographicContext = geographicContextFor(location);
  const continentName = locale === "zh" ? geographicContext.continent.zh : geographicContext.continent.en;
  const countryName = locale === "zh" ? geographicContext.country.zh : geographicContext.country.en;
  const geoPrimary = zoomStage === "CONTINENT" ? continentName : zoomStage === "COUNTRY" ? countryName : location.label;
  const destinationSceneCode = stableHash(`${placeProfile.id}:${Math.round(location.lat * 2)}:${Math.round(location.lon * 2)}:${sceneNonce}`).toString(16).slice(-4).toUpperCase().padStart(4, "0");
  const localMinutes = Math.floor((weather.localHour % 1) * 60);
  const localTimeLabel = `${String(Math.floor(weather.localHour) % 24).padStart(2, "0")}:${String(localMinutes).padStart(2, "0")}`;
  const currentZone = placeProfile.zone;
  const solarPoint = subsolarPoint(new Date(now));
  const solarX = ((solarPoint.lon + 180) / 360) * 100;
  const terminatorMax = Math.max(1, terminatorPulse.day, terminatorPulse.night);
  const dayBridgeProgress = Math.max(8, (terminatorPulse.day / terminatorMax) * 100);
  const nightBridgeProgress = Math.max(8, (terminatorPulse.night / terminatorMax) * 100);
  const currentBandLabel = currentActivity ? pulse.bands[currentActivity.band] : pulse.ordinary;
  const watchCountdown = watchChain?.expiresAt ? formatCountdown(watchChain.expiresAt - now) : "∞";
  const isEncountering = panel === "story" || (panel === "compose" && composeMode === "reply") || Boolean(replyCeremony) || Boolean(watchingStory);
  const isPickingPlace = placePickerOpen && panel === "compose" && composeStep === 3 && delivery === "place";
  const isMemorySky = (panel === "menu" && worldTab === "memories") || (panel === "archive" && archiveTab === "keepsakes") || (journeyView && activeJourney?.scenario === "memorial");
  const arrivalBloom = useMemo(() => {
    if (replyCeremony && selected) return { lat: selected.lat, lon: selected.lon, nonce: stableHash(replyCeremony.id) };
    if (pickedPlace && placeMomentNonce > 0) return { lat: pickedPlace.lat, lon: pickedPlace.lon, nonce: placeMomentNonce };
    return null;
  }, [pickedPlace, placeMomentNonce, replyCeremony, selected]);
  // v44 ②: announce couriers the moment a zoom layer brings them on stage, so
  // "when do I see the pigeon / the plane?" is answered by the scene itself.
  const visibleCourierSignature = TRANSPORT_ORDER.filter((mode) => courierPresentationAtZoom(mode, zoomStage) !== "hidden").join("|");
  const previousCourierSignatureRef = useRef<string | null>(null);
  useEffect(() => {
    const previous = previousCourierSignatureRef.current;
    previousCourierSignatureRef.current = visibleCourierSignature;
    if (previous === null || previous === visibleCourierSignature) return;
    const before = new Set(previous.split("|").filter(Boolean));
    const arrivedModes = visibleCourierSignature.split("|").filter(Boolean).filter((mode) => !before.has(mode)) as CourierMode[];
    if (!arrivedModes.length) return;
    const names = arrivedModes.map((mode) => TRANSPORTS[mode].names[locale]).join(" · ");
    const stageName = ZOOM_STAGE_NAMES[zoomStage][locale === "zh" ? "zh" : "en"];
    const timer = window.setTimeout(() => setStageHint({ text: locale === "zh" ? `进入「${stageName}」镜头 · ${names} 出现了` : `${stageName} layer · ${names} appeared`, nonce: (Date.now() % 1e9) }), 30);
    return () => window.clearTimeout(timer);
  }, [locale, visibleCourierSignature, zoomStage]);
  useEffect(() => {
    if (!stageHint) return;
    const timer = window.setTimeout(() => setStageHint(null), 4600);
    return () => window.clearTimeout(timer);
  }, [stageHint]);
  const wallStrengthByStage: Record<ZoomStage, number> = { ORBIT: .08, EARTH: pickedPlace ? .38 : .22, CONTINENT: .55, COUNTRY: .82, REGION: .96, CITY: .94, DISTRICT: .9, COMMUNITY: .86 };
  const wallBaseStrength = wallStrengthByStage[zoomStage];
  const placeWallStrength = isEncountering ? Math.max(.56, wallBaseStrength) : isPickingPlace ? Math.max(.42, wallBaseStrength) : wallBaseStrength;
  const placeForegroundStrength = nearView ? 0 : zoomStage === "REGION" ? .94 : zoomStage === "CITY" ? .9 : zoomStage === "DISTRICT" ? .86 : zoomStage === "COMMUNITY" ? .8 : zoomStage === "COUNTRY" ? .78 : zoomStage === "CONTINENT" ? .38 : isEncountering ? .52 : zoomStage === "EARTH" && pickedPlace ? .24 : 0;
  const earthTruth = earthDataLayer === "events" ? {
    source: "NASA EONET",
    title: locale === "zh" ? `${naturalEvents.length} 个开放自然事件` : `${naturalEvents.length} open natural events`,
    detail: naturalEventsStatus === "current"
      ? `${naturalEventsUpdatedAt ? new Date(naturalEventsUpdatedAt).toLocaleDateString(locale === "zh" ? "zh-CN" : locale, { month: "short", day: "numeric", timeZone: "UTC" }) : (locale === "zh" ? "最新可用" : "latest available")} · ${locale === "zh" ? "近实时元数据，不是直播画面" : "near-real-time metadata, not live video"}`
      : naturalEventsStatus === "loading" ? (locale === "zh" ? "正在读取近实时事件…" : "Reading near-real-time events…") : (locale === "zh" ? "数据暂不可用，没有伪造替代点" : "Data unavailable; no simulated replacement"),
  } : earthDataLayer === "aurora" ? {
    source: "NOAA SWPC",
    title: locale === "zh" ? "极光 · 30 分钟预报" : "Aurora · 30-minute forecast",
    detail: auroraStatus === "current"
      ? `${auroraForecastAt ?? (locale === "zh" ? "最新可用" : "latest available")}${auroraObservedAt ? ` · OBS ${auroraObservedAt}` : ""} · ${locale === "zh" ? "预报，不是卫星直播" : "forecast, not satellite livestream"}`
      : auroraStatus === "loading" ? (locale === "zh" ? "正在读取最新预报…" : "Reading latest forecast…") : (locale === "zh" ? "预报暂不可用，没有伪造替代光带" : "Forecast unavailable; no simulated replacement"),
  } : earthLens === "daily" ? {
    source: "NASA GIBS / ESDIS",
    title: locale === "zh" ? "最近日期真彩地球" : "Recent-date true-color Earth",
    detail: `${nasaDate} · ${locale === "zh" ? "请求日期影像，非实时视频" : "requested-date imagery, not live video"}`,
  } : null;

  return (
    <main className={`world-app time-${environment.time} weather-${environment.weather} biome-${environment.biome} hazard-${environment.hazard} zone-${currentZone} place-${placeProfile.id} season-${backgroundIdentity.season} latitude-${backgroundIdentity.latitude} air-${backgroundIdentity.air} wind-${backgroundIdentity.wind} settlement-${backgroundIdentity.settlement} material-${backgroundIdentity.material} zoom-${zoomStage.toLowerCase()} ${environment.aurora ? "aurora-active" : ""} ${zoom > .65 ? "is-near" : ""} ${nearView ? "near-map-open" : ""} ${panel === "menu" ? "is-world-open" : ""} ${panel === "light-choice" || panel === "support" || supportReceipt ? "is-support-open" : ""} ${journeyView ? `journey-view journey-${activeJourney?.mode ?? "pigeon"}` : ""} ${earthHidden ? "earth-hidden" : ""} ${isEncountering ? "is-encountering" : ""} ${isPickingPlace ? "is-picking-place" : ""} ${watchingStory ? "is-watching" : ""} ${isMemorySky ? "is-memory-sky" : ""} ${cargoJourney && !journeyView ? "is-cargo-open" : ""}`} style={{ "--earth-zoom": String(zoom), "--earth-opacity": String(earthOpacity), "--scene-reveal": String(sceneReveal), "--courier-scale": String(courierScale), "--solar-x": `${solarX}%`, "--map-blend": String(mapBlend), "--place-foreground": String(placeForegroundStrength), "--place-zenith": placeProfile.palette.zenith, "--place-horizon": placeProfile.palette.horizon, "--place-far": placeProfile.palette.far, "--place-near": placeProfile.palette.near, "--place-water": placeProfile.palette.water, "--place-glow": placeProfile.palette.glow } as CSSProperties}>
      <WeatherWall key={`${placeProfile.id}-${Math.round(location.lat * 2)}-${Math.round(location.lon * 2)}-${sceneNonce}`} environment={environment} weather={weather} identity={backgroundIdentity} profile={placeProfile} strength={placeWallStrength} point={location} sceneSeed={sceneNonce} />
      <div className="emotional-atmosphere" aria-hidden="true"><i /><i /><i /><b /></div>
      <div className="memory-sky" aria-hidden="true"><i /><i /><i /><i /><i /><i /><b /><em /></div>
      <div className="living-current-ambience" aria-hidden="true"><i /><i /><i /></div>
      {journeyView && activeJourney && <JourneyStage journey={activeJourney} locale={locale} earthHidden={earthHidden} onToggleEarth={() => setEarthHidden((value) => !value)} onExit={() => { setJourneyView(false); setEarthHidden(false); setPanel("journeys"); }} />}
      <LivingWorld locale={locale} stories={stories} activity={dailyActivity} journeys={journeys} activeJourneyId={activeJourneyId} textureUrl={textureUrl} baseTextureUrl={baseTextureUrl} earthLens={earthLens} earthDataLayer={earthDataLayer} observations={earthObservations} zoomStage={zoomStage} homePoint={userLocation} activePoint={pickedPlace} arrivalBloom={arrivalBloom} pickingPlace={isPickingPlace} selectedId={selectedId} heldStoryIds={heldStoryIds} focus={focus} zoomCommand={zoomCommand} onSelect={selectStory} onSelectJourney={openCourierCargo} onPick={pickEarth} onZoom={handleEarthZoom} onNear={enterNeighborhood} onInteract={acknowledgeSpatialGuide} />
      <div className="ambient-memories" aria-hidden="true">
        {EXPERIENCE_MEMORIES.map((memory) => <span key={memory.id} className={`ambient-memory ${memory.className}`}><i /><i /><i /><i /><i /><b>{memory.year} · {locale === "zh" ? memory.zh : memory.en}</b></span>)}
      </div>
      <div className="place-foreground" aria-hidden="true"><i /><i /><i /><b /></div>
      {mapVisible && <NeighborhoodMap point={isPickingPlace && pickedPlace ? pickedPlace : location} label={location.label} hierarchy={placeHierarchy} locale={locale} globeZoom={zoom} interactive={nearView} blend={mapBlend} zoomCommand={mapZoomCommand} stories={stories} activity={dailyActivity} journeys={journeys} activeJourneyId={activeJourneyId} onZoomChange={setMapZoom} onExitZoom={exitNeighborhoodByZoom} onPick={pickEarth} onSelectStory={selectStory} onSelectJourney={openCourierCargo} onCenterChange={syncSceneToMapCenter} onIlluminate={(center) => { const point = coarsePublicPoint(center); setPickedPlace(point); setLocation((current) => ({ ...point, label: current.label })); openPinnedCompose(); }} />}
      {mapVisible && <div className="map-place-frame" aria-hidden="true"><i /><i /><i /></div>}

      {!nearView && ["CONTINENT", "COUNTRY", "REGION"].includes(zoomStage) && !journeyView && !watchingStory && <div className={`geo-lens geo-lens-${zoomStage.toLowerCase()}`} role="status" aria-label={locale === "zh" ? `当前空间层级：${continentName}，${countryName}` : `Current spatial level: ${continentName}, ${countryName}`}>
        <small>{zoomStage === "CONTINENT" ? (locale === "zh" ? "洲际尺度" : "CONTINENT SCALE") : zoomStage === "COUNTRY" ? (locale === "zh" ? "国家尺度" : "COUNTRY SCALE") : (locale === "zh" ? "区域尺度" : "REGIONAL SCALE")}</small>
        <strong>{geoPrimary}</strong>
        <span><i>{continentName}</i><b>›</b><i>{countryName}</i>{zoomStage === "REGION" && <><b>›</b><i>{placeProfile.title[locale === "zh" ? "zh" : "en"]}</i></>}</span>
      </div>}

      {!nearView && zoomStage === "REGION" && !journeyView && !watchingStory && <aside className="destination-moment" aria-label={locale === "zh" ? `此刻抵达${countryName}` : `Arriving in ${countryName}`}>
        <small>{locale === "zh" ? `此刻抵达 · ${countryName}` : `ARRIVING NOW · ${countryName.toUpperCase()}`}</small>
        <strong>{placeProfile.title[locale === "zh" ? "zh" : "en"]}</strong>
        <p>{placeProfile.signature[locale === "zh" ? "zh" : "en"]}</p>
        <div><span>{Math.abs(location.lat).toFixed(1)}°{location.lat >= 0 ? "N" : "S"} · {Math.abs(location.lon).toFixed(1)}°{location.lon >= 0 ? "E" : "W"}</span><span>{Math.round(weather.temperature)}° · {localTimeLabel}</span></div>
        <footer><em>{locale === "zh" ? "再放大一步 · 省州 → 城市 → 区域" : "ONE MORE STEP · REGION → CITY → AREA"}</em><button type="button" onClick={enterNeighborhood}>{locale === "zh" ? "进入真实地图" : "Enter real map"}<b aria-hidden="true">→</b></button></footer>
      </aside>}

      {!journeyView && !watchingStory && <aside className={`scale-control ${nearView ? "is-local" : ""}`} aria-label={locale === "zh" ? "世界尺度" : "World scale"}>
        <div className="scale-stepper">
          <button type="button" onClick={() => nudgeEarthZoom(1.3)} aria-label={nearView ? (locale === "zh" ? "缩小，返回上一层" : "Zoom out one level") : (locale === "zh" ? "缩小地球" : "Zoom Earth out")}>−</button>
          <span><small>{nearView ? (locale === "zh" ? "正在靠近" : "MOVING CLOSER") : (locale === "zh" ? "世界尺度" : "WORLD SCALE")}</small><strong>{zoomStage}</strong><i><b style={{ height: `${Math.max(8, Math.round((nearView ? .78 + localProgress * .22 : zoom) * 100))}%` }} /></i></span>
          <button type="button" onClick={() => nudgeEarthZoom(-1.3)} aria-label={locale === "zh" ? "放大一层" : "Zoom in one level"}>＋</button>
        </div>
        {nearView && <button type="button" className="return-earth" onClick={returnToEarth}><i>◎</i><span><small>{locale === "zh" ? "随时退出" : "ALWAYS AVAILABLE"}</small><strong>{locale === "zh" ? "回到地球" : "Return to Earth"}</strong></span></button>}
      </aside>}

      {!journeyView && !watchingStory && onboardingStage === "done" && <CourierLegend stage={zoomStage} locale={locale} activeModes={journeys.filter((journey) => journeyProgress(journey) < 1 || journey.id.startsWith("journey-demo-world-")).map((journey) => journey.mode)} open={courierLegendOpen} onToggle={() => setCourierLegendOpen((value) => !value)} onPickMode={openCourierCargoByMode} />}

      {stageHint && !journeyView && !watchingStory && !notice && !isPickingPlace && !replyCeremony && !supportReceipt && <div key={stageHint.nonce} className="stage-hint" role="status"><i aria-hidden="true">◈</i><span>{stageHint.text}</span></div>}

      {cargoJourney && !journeyView && <JourneyCargoCard journey={cargoJourney} story={cargoStory} locale={locale} onFollow={() => { setCargoJourneyId(null); openJourney(cargoJourney, true); }} onRead={cargoStory ? () => { setCargoJourneyId(null); selectStory(cargoStory); } : null} onClose={() => setCargoJourneyId(null)} />}

      <header className="world-header">
        <div className="kc-brand" aria-label="KindChain">
          <span className="kc-orbit"><i /><i /><b>✦</b></span>
          <span><strong>KindChain</strong><small>{locale === "zh" ? "让世界充满爱" : "A LIVING WORLD OF KINDNESS"}</small></span>
        </div>
        <div className="world-presence" role="status"><strong>{activityTotals.uniquePublishers.toLocaleString()} {locale === "zh" ? "份善意正在流动" : "acts of kindness in motion"}</strong><small>{locale === "zh" ? `万人体验模拟 · 不代表实时在线 · 真实网络${networkStatus === "live" ? "已连接" : networkStatus === "offline" ? "待重连" : "连接中"}` : `10K SIMULATION · NOT LIVE ONLINE · NETWORK ${networkStatus === "live" ? "CONNECTED" : networkStatus === "offline" ? "RECONNECTING" : "CONNECTING"}`}</small></div>
        <button ref={worldButtonRef} type="button" className="world-trigger" disabled={panel === "compose" || panel === "light-choice" || panel === "support" || Boolean(supportReceipt)} aria-expanded={panel === "menu"} aria-controls="world-drawer" onClick={() => openWorld()}><i aria-hidden="true">◎</i><span>{locale === "zh" ? "世界" : "World"}</span><small>{location.label}</small></button>
      </header>
      <p className="drag-hint">{environment.time === "night" ? (locale === "zh" ? "今晚不必说什么 · 可以先接住一束光" : "Nothing must be said tonight · receive a light first") : c.drag}</p>
      {earthTruth && !showSpatialGuide && !nasaObservatoryOpen && <button type="button" className={`earth-truth-bar truth-${earthDataLayer}`} onClick={() => openWorld("lenses")} aria-label={`${earthTruth.source}: ${earthTruth.title}. ${earthTruth.detail}`}>
        <i aria-hidden="true" />
        <span><small>{earthTruth.source}</small><strong>{earthTruth.title}</strong></span>
        <em>{earthTruth.detail}</em><b aria-hidden="true">⌄</b>
      </button>}
      {showSpatialGuide && panel === null && !journeyView && !supportReceipt && !locationGate && !replyCeremony && !departureTicket && !watchingStory && <aside className="spatial-guide" aria-label={locale === "zh" ? "地球操作提示" : "Earth controls"}>
        <button type="button" onClick={acknowledgeSpatialGuide} aria-label={locale === "zh" ? "知道了" : "Dismiss"}>×</button>
        <small>{locale === "zh" ? "这颗地球可以触摸" : "THIS EARTH RESPONDS TO YOU"}</small>
        <div>
          <span><i aria-hidden="true">↔</i><b>{locale === "zh" ? "拖动" : "Drag"}</b><em>{locale === "zh" ? "转动" : "turn"}</em></span>
          <span><i aria-hidden="true">⌁</i><b>{locale === "zh" ? "双指 / 滚轮" : "Pinch / wheel"}</b><em>{locale === "zh" ? "改变尺度" : "change scale"}</em></span>
          <span><i aria-hidden="true">◎</i><b>{locale === "zh" ? "轻点" : "Tap"}</b><em>{locale === "zh" ? "落下光针" : "place a light pin"}</em></span>
        </div>
      </aside>}
      {pickedPlace && placeMomentNonce > 0 && <div key={`arrival-${placeMomentNonce}`} className="place-awakening" role="status"><i>◎</i><span><small>{locale === "zh" ? "光针已经落下 · 背景正在苏醒" : "LIGHT PIN PLACED · THE SCENE IS AWAKENING"}</small><strong>{placeProfile.title[locale === "zh" ? "zh" : "en"]}</strong><em>{placeProfile.signature[locale === "zh" ? "zh" : "en"]}</em></span><button type="button" onClick={openPinnedCompose}>{locale === "zh" ? "写到这里" : "Write here"}<b aria-hidden="true">→</b></button></div>}

      {panel === "story" && selected && (
        <section className={`story-panel floating-panel ${selected.kind === "support" ? "support-story-panel" : ""}`}>
          <div className="panel-head">
            <span className={`signal-type ${selected.kind === "wish" ? "wish" : selected.kind === "support" ? "support" : ""}`}>{selected.kind === "wish" ? "♡ WISH SIGNAL" : selected.kind === "support" ? `⌁ ${support.storyLabel}` : "✦ HUMAN SIGNAL"}</span>
            <button onClick={() => setPanel(null)} aria-label={c.close}>×</button>
          </div>
          <div className="story-place"><i />{selected.region} · {selected.country}<span>{selected.lang.toUpperCase()}</span></div>
          <small className={`fact-label ${selected.networkState === "shared" ? "live" : "demo"}`}>
            {selected.networkState === "shared"
              ? (selected.reviewStatus === "pending_review"
                ? (locale === "zh" ? "真实网络 · 审核中 · 目前仅你可见" : "LIVE NETWORK · IN REVIEW · VISIBLE ONLY TO YOU")
                : (locale === "zh" ? "真实网络 · 试运行" : "LIVE NETWORK · TRIAL"))
              : selected.networkState === "pending"
                ? (locale === "zh" ? "正在送往真实网络…" : "SENDING TO THE LIVE NETWORK…")
                : (locale === "zh" ? "演示内容 · 非真实用户" : "DEMO CONTENT · NOT A REAL USER")}
          </small>
          {selected.kind === "support" && <div className="support-story-context"><div className="support-breath" aria-hidden="true"><i /><i /><b>⌁</b></div><span><small>{selected.supportLevel === "urgent" ? support.urgentTitle : support.listenTitle}</small><strong>{support[selected.supportNeed ?? "heard"]}</strong><em>{selected.localOnly ? support.localOnly : support.privacy}</em></span></div>}
          <div className={`story-lamp ${heldStoryIds.includes(selected.id) ? "lit" : ""}`} aria-hidden="true"><i /><b /></div>
          <blockquote>“{storyText(selected, locale, showOriginal)}”</blockquote>
          <div className="translation-switch">
            <button className={showOriginal ? "active" : ""} onClick={() => setShowOriginal(true)}>{c.original}</button>
            <button className={!showOriginal ? "active" : ""} onClick={() => setShowOriginal(false)}>✦ {c.translate}</button>
          </div>
          {selected.replies.length > 0 && <div className="reply-thread">
            {selected.replies.map((reply) => <div key={reply.id}><span>{reply.lang.toUpperCase()}</span><p>{replyText(reply, locale, showOriginal)}</p></div>)}
          </div>}
          <div className="story-actions">
            <button className="soft-button" onClick={() => openCompose("reply")}>↳ {selected.kind === "support" ? (locale === "zh" ? "我可以陪你说几句" : "I can stay for a few words") : c.reply}</button>
            <button className={`lamp-button ${heldStoryIds.includes(selected.id) ? "lit" : ""}`} onClick={() => holdLight("lamp")}><i />{ritual.leaveLamp}</button>
          </div>
          {selected.kind === "support" && <div className="support-responder-rules"><i>◇</i><span>{support.companionRules}</span></div>}
          <div className="quiet-choice"><span>{ritual.lampHint}</span><button type="button" onClick={() => holdLight("watch")}>◔ {ritual.watch}</button></div>
          {selected.kind === "support" && selected.localOnly && <button type="button" className="end-support-button" onClick={() => endSupportSignal(selected.id)}>{support.closeSignal}</button>}
          {selected.networkState === "shared" && (
            <div className="story-governance">
              {myAuthorTag && selected.authorTag === myAuthorTag ? (
                <button className="quiet-button" onClick={handleRetract}>✕ {locale === "zh" ? "撤回这束光" : "Withdraw this light"}</button>
              ) : (
                <>
                  <button className="quiet-button" onClick={() => setReportArmFor((value) => (value === selected.id ? null : selected.id))}>⚑ {locale === "zh" ? "举报" : "Report"}</button>
                  <button className="quiet-button" onClick={handleBlockAuthor}>⦸ {locale === "zh" ? "不再看见此人" : "Hide this author"}</button>
                </>
              )}
              {reportArmFor === selected.id && (
                <div className="report-reasons" role="group" aria-label={locale === "zh" ? "举报原因" : "Report reason"}>
                  <button onClick={() => handleReport("harassment")}>{locale === "zh" ? "骚扰 / 攻击" : "Harassment"}</button>
                  <button onClick={() => handleReport("self_harm_risk")}>{locale === "zh" ? "可能自伤风险" : "Self-harm risk"}</button>
                  <button onClick={() => handleReport("privacy")}>{locale === "zh" ? "泄露隐私" : "Privacy"}</button>
                  <button onClick={() => handleReport("spam")}>{locale === "zh" ? "垃圾信息" : "Spam"}</button>
                  <button onClick={() => handleReport("other")}>{locale === "zh" ? "其他" : "Other"}</button>
                </div>
              )}
            </div>
          )}
        </section>
      )}

      {panel === "region" && (
        <section className="region-panel floating-panel">
          <div className="panel-head"><span>{weatherIcon(environment)} {c.region}</span><button onClick={() => setPanel(null)} aria-label={c.close}>×</button></div>
          <div className="region-sigil"><i /><i /><b>{weatherIcon(environment)}</b></div>
          <h2>{location.label}</h2>
          <p>{Math.abs(location.lat).toFixed(1)}°{location.lat >= 0 ? "N" : "S"} · {Math.abs(location.lon).toFixed(1)}°{location.lon >= 0 ? "E" : "W"}</p>
          <div className={`place-identity-card confidence-${placeProfile.confidence}`}>
            <i><b /><b /><b /></i>
            <span><small>{placeProfile.confidence === "curated" ? (locale === "zh" ? "地点身份 · 精校" : "PLACE IDENTITY · CURATED") : (locale === "zh" ? "地域身份 · 自然地理推断" : "REGIONAL IDENTITY · GEOGRAPHIC INFERENCE")}</small><strong>{placeProfile.title[locale === "zh" ? "zh" : "en"]}</strong><em>{placeProfile.signature[locale === "zh" ? "zh" : "en"]}</em></span>
          </div>
          <div className="environment-tags"><span>{seasonFor(location.lat)}</span><span>{environment.biome.toUpperCase()}</span><span>{sceneLabel}</span>{environment.aurora && <span>NOAA {Math.round(environment.auroraChance)}%</span>}</div>
          <div className="weather-grid">
            <span><small>TEMP</small><b>{weatherStatus === "live" || weatherStatus === "sample" ? `${Math.round(weather.temperature)}°` : "—"}</b></span>
            <span><small>FEELS</small><b>{weatherStatus === "live" || weatherStatus === "sample" ? `${Math.round(weather.apparent)}°` : "—"}</b></span>
            <span><small>WIND</small><b>{weatherStatus === "live" || weatherStatus === "sample" ? Math.round(weather.wind) : "—"}</b></span>
            <span><small>HUMID</small><b>{weatherStatus === "live" || weatherStatus === "sample" ? `${Math.round(weather.humidity)}%` : "—"}</b></span>
          </div>
          <p className={`weather-truth status-${weatherStatus}`}><i />{weatherStatus === "live" ? (locale === "zh" ? `实时天气已更新 · ${weatherObservedAt ? new Date(weatherObservedAt).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" }) : ""}` : "LIVE WEATHER UPDATED") : weatherStatus === "loading" ? (locale === "zh" ? "正在读取这个地点的天气……" : "Reading this place's weather…") : weatherStatus === "unavailable" ? (locale === "zh" ? "天气暂不可用 · 已停止显示上一个地点的数据" : "Weather unavailable · previous-place data cleared") : (locale === "zh" ? "体验天气 · 正在连接实况" : "SAMPLE WEATHER · CONNECTING")}</p>
          <button className={`region-resonance band-${currentActivity?.band ?? "quiet"}`} onClick={() => setPanel("pulse")}>
            <i><b /></i>
            <span><small>{pulse.title} · 24H</small><strong>{currentBandLabel}</strong></span>
            <em>{currentActivity?.textCount ?? 0}<small>{locale === "zh" ? "束" : "TEXTS"}</small></em>
          </button>
          <div className="earth-lens-card">
            <div><span><small>NASA EARTH LENS</small><strong>{earthLens === "atlas" ? (locale === "zh" ? "稳定地球底图" : "Stable Earth atlas") : earthLens === "daily" ? (locale === "zh" ? "最近日期真彩影像" : "Recent-date true color") : (locale === "zh" ? "城市夜光合成" : "City-lights composite")}</strong></span><em>{earthLens === "atlas" ? "BLUE MARBLE" : earthLens === "night" ? (locale === "zh" ? "2012 合成参考 · 非实时" : "2012 COMPOSITE · NOT LIVE") : `${nasaDate} · ${locale === "zh" ? "请求日期，非实时" : "REQUESTED DATE · NOT LIVE"}`}</em></div>
            <nav aria-label="NASA Earth observation lens">
              <button className={earthLens === "atlas" ? "active" : ""} onClick={() => setEarthLens("atlas")}>{locale === "zh" ? "地球" : "ATLAS"}</button>
              <button className={earthLens === "daily" ? "active" : ""} onClick={() => setEarthLens("daily")}>{locale === "zh" ? "真彩" : "TRUE COLOR"}</button>
              <button className={earthLens === "night" ? "active" : ""} onClick={() => setEarthLens("night")}>{locale === "zh" ? "夜光" : "NIGHT"}</button>
            </nav>
            <button type="button" onClick={openNasaObservatory}>{locale === "zh" ? "进入 NASA 官方地球观察舱" : "Enter the official NASA Earth observatory"} <b>→</b></button>
            <small>{locale === "zh" ? "影像由 NASA GIBS / ESDIS 提供；NASA 不为 KindChain 背书。图像不会进入链上纪念物。" : "Imagery provided by NASA GIBS / ESDIS. NASA does not endorse KindChain; imagery never enters on-chain keepsakes."}</small>
          </div>
          <div className="sound-line"><i className={sound ? "playing" : ""} /><span>{environment.weather === "rain" ? "Rain · distant ambient" : environment.weather === "snow" ? "Snow hush · soft wind" : environment.weather === "storm" ? "Storm · deep air" : environment.hazard === "dust" ? "Desert wind · warm air" : environment.time === "night" ? "Night air · low ambient" : "Open sky · warm ambient"}</span><button onClick={() => setSound(!sound)}>{sound ? "Ⅱ" : "▶"}</button></div>
          <small className="data-source">{c.source} · NOAA SWPC · NASA {nasaDate} {locale === "zh" ? "请求日期" : "requested date"}</small>
        </section>
      )}

      {panel === "pulse" && (
        <section className="pulse-panel floating-panel wide-panel">
          <div className="panel-head"><span>✦ {pulse.title}</span><button onClick={() => setPanel(null)} aria-label={c.close}>×</button></div>
          <div className={`pulse-overview band-${currentActivity?.band ?? "quiet"}`}>
            <div className="pulse-orbit"><i /><i /><b>✦</b></div>
            <span><small>{location.label}</small><strong>{currentBandLabel}</strong><em>{currentActivity ? `${currentActivity.textCount} ${pulse.signals}` : pulse.ordinary}</em></span>
            <div><b>{activityTotals.textCount}</b><small>{pulse.global}</small><em>+{activityTotals.recentCount} {pulse.recent}</em></div>
          </div>
          <div className="density-scale" aria-label="Activity brightness scale">
            {(["quiet", "glimmer", "radiant", "surge"] as ActivityBand[]).map((band) => <span key={band} className={`band-${band}`}><i />{pulse.bands[band]}</span>)}
          </div>
          <div className="light-scenes">
            <article className="scene-card terminator-scene">
              <div><i>☼↝☾</i><span><small>01 · LIGHT MATCH</small><strong>{pulse.terminator}</strong></span></div>
              <p>{pulse.terminatorCopy}</p>
              <div className="duet-meter">
                <span><small>DAY · {terminatorPulse.day}</small><i><b style={{ width: `${dayBridgeProgress}%` }} /></i></span>
                <span><small>NIGHT · {terminatorPulse.night}</small><i><b style={{ width: `${nightBridgeProgress}%` }} /></i></span>
              </div>
              <button onClick={() => openActivityScene("terminator")}>{pulse.sendAcross}<b>→</b></button>
            </article>
            <article className="scene-card choir-scene">
              <div><i>✣</i><span><small>02 · CO-OP SHAPE</small><strong>{pulse.choir}</strong></span></div>
              <p>{pulse.choirCopy}</p>
              <div className="scene-count"><span>{choirProgress}</span><i>{Array.from({ length: choirGoal }, (_, index) => <b key={index} className={index < choirProgress ? "lit" : ""} />)}</i><em>/ {choirGoal}</em></div>
              <button onClick={() => openActivityScene("region-choir")}>{pulse.addVoice}<b>→</b></button>
            </article>
            <article className="scene-card watch-scene">
              <div><i>◔</i><span><small>03 · AGAINST TIME</small><strong>{pulse.watch}</strong></span></div>
              <p>{pulse.watchCopy}</p>
              <div className="watch-clock"><span>{watchCountdown}</span><small>{watchChain ? constellationName(watchChain.name, locale) : "—"}</small></div>
              <button disabled={!watchChain} onClick={() => openActivityScene("night-watch")}>{pulse.relayNow}<b>→</b></button>
            </article>
            <article className={`scene-card shelter-scene weather-${environment.weather} hazard-${environment.hazard}`}>
              <div><i>{weatherIcon(environment)}</i><span><small>04 · WEATHER CO-OP</small><strong>{pulse.shelter}</strong></span></div>
              <p>{pulse.shelterCopy}</p>
              <div className="shelter-dome"><i /><span>{shelterProgress} / 3</span>{Array.from({ length: 3 }, (_, index) => <b key={index} className={index < shelterProgress ? "lit" : ""} />)}</div>
              <button onClick={() => openActivityScene("weather-shelter")}>{pulse.shelterAction}<b>→</b></button>
            </article>
          </div>
          <p className="pulse-ethic">◇ {pulse.noRank}</p>
          <small className="pulse-source">{pulse.sample} · NASA {nasaDate} · {dailyActivity.version.toUpperCase()}</small>
        </section>
      )}

      {panel === "nearby" && (
        <section className="nearby-panel floating-panel">
          <div className="panel-head"><span>⌁ {c.nearbyTitle}</span><button onClick={() => setPanel(null)} aria-label={c.close}>×</button></div>
          <div className="near-list">
            {nearbyStories.map((story) => <button key={story.id} onClick={() => selectStory(story)}><i className={story.kind === "wish" ? "wish" : ""}>{story.kind === "wish" ? "♡" : "✦"}</i><span><small>{story.region} · {Math.round(distanceKm(location, story)).toLocaleString()} km</small>{storyText(story, locale, false)}</span><b>→</b></button>)}
          </div>
          <p className="privacy-line">⌁ {c.privacy}</p>
        </section>
      )}

      {panel === "archive" && (
        <section className="archive-panel floating-panel wide-panel">
          <div className="panel-head"><span>⌘ {c.archiveTitle}</span><button onClick={() => setPanel(null)} aria-label={c.close}>×</button></div>
          <p className="archive-intro">{extra.relay} · {locale === "zh" ? "真实留言与回复会成为真实星点；新的文字接力才会延长限时星系。" : "Real messages and replies become real stars; only a new text relay extends a fading constellation."}</p>
          <nav className="archive-tabs" aria-label={locale === "zh" ? "星辰档案分类" : "Star archive sections"}>
            {(["paths", "passport", "stamps", "keepsakes"] as ArchiveTab[]).map((tab) => <button key={tab} className={archiveTab === tab ? "active" : ""} onClick={() => setArchiveTab(tab)}>{tab === "paths" ? (locale === "zh" ? "星途" : "STAR PATHS") : tab === "passport" ? (locale === "zh" ? "护照" : "PASSPORTS") : tab === "stamps" ? (locale === "zh" ? "印记" : "MARKS") : (locale === "zh" ? "纪念物" : "KEEPSAKES")}</button>)}
          </nav>
          {archiveTab === "paths" && <div className="chain-list">
            {chains.map((chain) => {
              const mini = miniConstellationLayout(chain.list);
              return <article key={chain.name} className={`chain-card rarity-${chain.rarity}`}>
                <button className="chain-open" onClick={() => selectStory(chain.list[0])} aria-label={chain.name}>
                  <svg className="mini-constellation" viewBox="0 0 100 100" role="img" aria-label={`${chain.starCount} connected stars`}>
                    {mini.edges.map((edge, index) => <path key={`${edge.from.id}-${edge.to.id}-${index}`} className={edge.reply ? "reply-edge" : "relay-edge"} d={`M ${edge.from.x} ${edge.from.y} Q 50 ${Math.max(7, Math.min(edge.from.y, edge.to.y) - 13)} ${edge.to.x} ${edge.to.y}`} />)}
                    {mini.points.map((point) => <circle key={point.id} className={point.root ? "root-star" : "reply-star"} cx={point.x} cy={point.y} r={point.root ? 2.5 : 1.7} />)}
                  </svg>
                  <span><small>{c.rarity[chain.rarity].toUpperCase()} · {constellationName(chain.name, locale)}</small><strong>{chain.starCount} {c.stars} · {chain.countries} {c.countries}</strong></span><b>↗</b>
                </button>
                <div className="chain-life"><span className={chain.expiresAt && chain.expiresAt - now < 3600000 ? "fading" : ""}><i />{chain.expiresAt ? `${formatCountdown(chain.expiresAt - now)} ${extra.expiring}` : "DEMO CONSTELLATION · ∞"}</span><small>{extra.proof} · {stableHash(`${chain.name}-${chain.starCount}`).toString(16).toUpperCase()}</small></div>
                <div className="chain-actions">
                  <button onClick={() => captureStarPath(chain)}>◉ {extra.capture}</button>
                  <button onClick={() => void requestRelay(chain)}>↗ {extra.share}</button>
                  <button onClick={() => setNotice(extra.chainLater)}>◇ {extra.preserve}<small>{extra.notOnChain}</small></button>
                </div>
              </article>;
            })}
          </div>}
          {archiveTab === "passport" && <div className="passport-archive">
            <div className="passport-books">{(COURIER_FAMILIES as CourierFamily[]).map((family) => {
              const profile = familyProfiles[family];
              return <article key={family} className={`family-${family}`}><i>✦</i><span><small>BOOK 0{(COURIER_FAMILIES as CourierFamily[]).indexOf(family) + 1} · LV.0{profile.level}</small><strong>{profile.title}</strong><em>{profile.note}</em></span><b>{profile.trips}<small>{locale === "zh" ? "次抵达" : "ARRIVALS"}</small></b></article>;
            })}</div>
            <div className="passport-tools">{TRANSPORT_ORDER.map((mode) => {
              const profile = courierProfiles[mode];
              return <article key={mode} className={`${profile.unlocked ? "met" : "unmet"} mode-${mode}`}><i>{TRANSPORTS[mode].glyph}</i><span><small>{familyProfiles[profile.family as CourierFamily].title} · {profile.unlocked ? `LV.0${profile.level}` : (locale === "zh" ? "尚未相遇" : "NOT YET MET")}</small><strong>{profile.unlocked ? profile.name : TRANSPORTS[mode].names[locale]}</strong><em>{profile.unlocked ? `${profile.score} ${locale === "zh" ? "枚经历印记" : "experience marks"}` : profile.hint}</em></span><u><i style={{ width: `${profile.unlocked ? Math.min(100, profile.score / profile.nextAt * 100) : profile.progress * 100}%` }} /></u></article>;
            })}</div>
            <p className="local-archive-note">◇ {locale === "zh" ? "护照只保存在这台设备；分享、点赞与排名都不会让它成长。" : "Passports stay on this device. Shares, likes and rankings never grow them."}</p>
          </div>}
          {archiveTab === "stamps" && <div className="stamp-archive">
            {messengerMemory.stamps.length === 0 ? <p>{locale === "zh" ? "信使抵达后，真实的出发天气会成为一枚印记。" : "After a courier arrives, verified departure weather becomes a private mark."}</p> : messengerMemory.stamps.map((stamp) => {
              const [kind, date, zone] = stamp.split("@");
              return <article key={stamp} className={`stamp-${kind.toLowerCase()}`}><i>{kind === "RAIN" ? "╱" : kind === "SNOW" ? "❄" : kind === "AURORA" ? "⌁" : kind === "NIGHT" ? "☾" : kind === "DAY" ? "☼" : "◌"}</i><span><small>{date || "—"} · {(zone || "EARTH").replaceAll("-", " ")}</small><strong>{kind.replaceAll("-", " ")}</strong><em>{locale === "zh" ? "真实出发天气 · 非路线预警" : "Verified departure weather · not a route alert"}</em></span><b>KIND<br />CHAIN</b></article>;
            })}
            <p className="local-archive-note">◇ {locale === "zh" ? "天气印记只记录文字事实，不保存 NASA 影像，也不用于灾害预警。" : "Weather marks keep text facts only—no NASA imagery and no hazard alerting."}</p>
          </div>}
          {archiveTab === "keepsakes" && <div className="keepsake-archive">
            {keepsakes.length === 0 ? <p>{locale === "zh" ? "启程票根、抵达明信片与旅途印记会安静地收藏在这里。" : "Departure tickets, arrival postcards and journey marks will rest here."}</p> : [...keepsakes].reverse().map((record) => <article key={record.id} className={`keepsake-${record.kind}`}><small>{record.kind === "departure" ? "DEPARTURE TICKET" : record.kind === "stamp" ? "WEATHER MARK" : "ARRIVAL POSTCARD"} · {new Date(record.createdAt).toLocaleDateString(locale === "zh" ? "zh-CN" : "en-CA")}</small><strong>{record.label}</strong><p>“{record.message}”</p><span>{record.meta}</span><button onClick={() => saveMomentCard(record)}>◉ {locale === "zh" ? "保存为图片" : "Save image"}</button></article>)}
            <p className="local-archive-note">◇ {locale === "zh" ? "只保存在此设备，不假装云同步或已经上链。" : "Saved only on this device—never presented as cloud-synced or on-chain."}</p>
          </div>}
        </section>
      )}

      {panel === "journeys" && (
        <section className="journeys-panel floating-panel wide-panel">
          <div className="panel-head"><span>⌁ {locale === "zh" ? "旅程观测站" : "JOURNEY OBSERVATORY"}</span><button onClick={() => setPanel(null)} aria-label={c.close}>×</button></div>
          <div className="trajectory-lens"><i>{zoomStage}</i><span><small>{locale === "zh" ? "当前缩放镜头" : "CURRENT CAMERA LAYER"}</small><strong>{TRANSPORT_ORDER.filter((mode) => courierPresentationAtZoom(mode, zoomStage) !== "hidden").map((mode) => TRANSPORTS[mode].names[locale]).join(" · ") || (locale === "zh" ? "信使化为地表微光" : "Couriers become surface glimmers")}</strong></span><em>{locale === "zh" ? "工具只在符合它的空间层出现" : "Each courier appears only where it belongs"}</em></div>
          {journeys.length === 0 ? <p className="empty-journeys">{c.noJourneys}</p> : <div className="journey-list">
            {journeys.map((journey) => {
              const spec = TRANSPORTS[journey.mode];
              const progress = journeyProgress(journey);
              const presentation = courierPresentationAtZoom(journey.mode, zoomStage);
              return <button key={journey.id} className={`${journey.id === activeJourneyId ? "active" : ""} presentation-${presentation}`} onClick={() => openJourney(journey)}>
                <i className={`courier-medallion mode-${journey.mode}`}>{spec.glyph}</i>
                <span><small>{spec.names[locale]} · {progress >= 1 ? (locale === "zh" ? "已抵达并点亮" : "ARRIVED · STAR LIT") : c.inFlight} · {presentation === "hidden" ? (locale === "zh" ? "此镜头化为微光" : "GLIMMER AT THIS LAYER") : presentation === "trace" ? (locale === "zh" ? "只见轨迹" : "TRACE ONLY") : (locale === "zh" ? "信使可见" : "COURIER VISIBLE")}</small><strong>{journey.from.label} <em>→</em> {journey.to.label}</strong><u><i style={{ width: `${progress * 100}%` }} /></u></span>
                <b>{Math.round(journey.distance).toLocaleString()}<small>KM</small></b>
              </button>;
            })}
          </div>}
          {activeJourney && <button className="cinema-button" onClick={() => openJourney(activeJourney, true)}><span>◉</span>{c.cinema}<b>→</b></button>}
        </section>
      )}

      {panel === "menu" && (
        <section ref={worldDrawerRef} id="world-drawer" className={`world-drawer world-tab-${worldTab}`} role="dialog" aria-modal="true" aria-labelledby="world-drawer-title">
          <div className="world-drawer-head"><span><small>{locale === "zh" ? "同一颗地球上" : "ON THE SAME EARTH"}</small><strong id="world-drawer-title">{locale === "zh" ? "世界" : "World"}</strong></span><button onClick={() => { setPanel(null); window.setTimeout(() => worldButtonRef.current?.focus(), 0); }} aria-label={c.close}>×</button></div>
          <nav className="world-drawer-tabs" role="tablist" aria-label={locale === "zh" ? "世界视图" : "World views"}>
            {([
              ["now", locale === "zh" ? "正在发生" : "Now"],
              ["messengers", locale === "zh" ? "信使" : "Messengers"],
              ["memories", locale === "zh" ? "纪念" : "Memories"],
              ["lenses", locale === "zh" ? "镜片" : "Lenses"],
            ] as [WorldTab, string][]).map(([tab, label]) => <button key={tab} role="tab" aria-selected={worldTab === tab} onClick={() => setWorldTab(tab)}>{label}</button>)}
          </nav>
          <div className="world-drawer-body">
            {worldTab === "now" && <div className="world-now-view">
              <div className="network-pilot-card" data-status={networkStatus} aria-live="polite"><i /><span><small>{locale === "zh" ? "真实网络试运行 · 匿名共享 · 约 6 秒同步" : "REAL NETWORK PILOT · ANONYMOUS · ~6S SYNC"}</small><strong>{networkStatus === "live" ? (networkSignalCount > 0 ? (locale === "zh" ? `${networkSignalCount} 束真实公开信号仍在发光` : `${networkSignalCount} real public signals are glowing`) : (locale === "zh" ? "连接正常 · 等待第一束真实的光" : "Connected · waiting for the first real light")) : networkStatus === "offline" ? (locale === "zh" ? "暂时离线 · 本机内容不会丢失" : "Temporarily offline · local writing is safe") : (locale === "zh" ? "正在连接共享地球" : "Connecting to the shared Earth")}</strong></span><b>{networkStatus === "live" ? (locale === "zh" ? "已连接" : "LIVE") : networkStatus === "offline" ? (locale === "zh" ? "重连中" : "RETRYING") : "…"}<small>{networkLastSyncedAt ? new Date(networkLastSyncedAt).toLocaleTimeString(locale === "zh" ? "zh-CN" : "en", { hour: "2-digit", minute: "2-digit" }) : ""}</small></b></div>
              <div className="world-simulation-card"><div className="simulation-orbit"><i /><i /><b>✦</b></div><span><small>{locale === "zh" ? "万人体验模拟" : "10K EXPERIENCE SIMULATION"}</small><strong>{Math.max(WORLD_EXPERIENCE_PEOPLE, activityTotals.uniquePublishers).toLocaleString()}</strong><em>{locale === "zh" ? "个人光点在远景被聚合为区域呼吸；放大后才逐层展开。" : "Individual lights become regional breaths from afar, then unfold as you move closer."}</em></span><b>{activityTotals.regions}<small>{locale === "zh" ? "片天空" : "SKIES"}</small></b></div>
              <div className="current-regions" aria-label={locale === "zh" ? "此刻较明亮的天空" : "Brighter skies right now"}>{dailyActivity.cells.slice(0, 4).map((cell) => <button key={cell.cellId} onClick={() => { const point = coarsePublicPoint({ lat: cell.centroidLat, lon: cell.centroidLon }); setPickedPlace(point); setLocation({ ...point, label: cell.regionLabel }); setFocus((current) => ({ ...point, nonce: current.nonce + 1 })); setPanel(null); void fetchWeather(point.lat, point.lon, cell.regionLabel); }}><i className={`band-${cell.band}`} /><span><strong>{cell.regionLabel}</strong><small>{cell.uniquePublishers.toLocaleString()} {locale === "zh" ? "人在这片模拟天空" : "in this simulated sky"}</small></span><em style={{ "--region-intensity": String(cell.intensity) } as CSSProperties} /></button>)}</div>
              <div className="world-quick-actions">
                <button onClick={drift}><i>✣</i><span>{c.drift}<small>{locale === "zh" ? "读一束陌生人的光" : "Meet a stranger's light"}</small></span></button>
                <button onClick={() => userLocation || window.sessionStorage.getItem("kindchain-location-choice") ? setPanel("nearby") : requestLocation("nearby")}><i>⌁</i><span>{c.nearby}<small>{c.privacy}</small></span></button>
                <button onClick={() => setPanel("pulse")}><i>☼</i><span>{pulse.title}<small>{locale === "zh" ? "晨昏、合奏、守夜与风雨避光港" : "Relays, chorus, watch and weather shelter"}</small></span></button>
                <button onClick={() => openCompose("wish")}><i>♡</i><span>{c.wish}<small>{locale === "zh" ? "具体、适度、可以安全实现" : "Small, specific and safe to grant"}</small></span></button>
              </div>
              <p className="simulation-truth">◇ {locale === "zh" ? "这是用于体验万人共处的模拟世界，不伪装成实时在线人数；真实留言仍以匿名、模糊地域进入。" : "This is an experience simulation, not a claim of live users. Real messages still enter anonymously with coarse locations."}</p>
            </div>}
            {worldTab === "messengers" && <div className="world-messenger-view">
              <p className="drawer-intro">{locale === "zh" ? "远景只看见善意洋流；靠近地球，信使才以符合它的尺度出现。成长只来自抵达、回应与共同经历。" : "From afar, journeys merge into kindness currents. Couriers appear only at the scale where they belong, and grow through arrivals, replies and shared experience."}</p>
              <div className="world-messenger-list">{journeys.filter((journey) => journey.id.startsWith("journey-demo-world-")).map((journey) => <button key={journey.id} onClick={() => openJourney(journey, true)}><i className={`mode-${journey.mode}`}>{TRANSPORTS[journey.mode].glyph}</i><span><small>{WORLD_MESSENGER_COUNTS[journey.mode]} {locale === "zh" ? "束代表性邮路" : "AGGREGATED ROUTES"} · {zoomStage}</small><strong>{TRANSPORTS[journey.mode].names[locale]}</strong><em>{journeyScenarioLabel(journey.scenario, locale)}</em><u><b style={{ width: `${journeyProgress(journey) * 100}%` }} /></u></span><b>{Math.round(journeyProgress(journey) * 100)}%</b></button>)}</div>
              <button className="drawer-wide-action" onClick={() => setPanel("journeys")}>{locale === "zh" ? "打开旅程观测站" : "Open journey observatory"}<b>→</b></button>
            </div>}
            {worldTab === "memories" && <div className="world-memory-view">
              <p className="drawer-intro">{locale === "zh" ? "青色会移动，是仍在路上的通信；香槟金保持安静，是被人主动留下的纪念。" : "Cyan moves because it is still travelling. Champagne gold rests because someone chose to keep the moment."}</p>
              <div className="memory-preview-list">{EXPERIENCE_MEMORIES.map((memory, index) => <article key={memory.id}><div className={`drawer-constellation constellation-${index + 1}`}><i /><i /><i /><i /><i /><b /></div><span><small>{memory.year} · {locale === "zh" ? "世界纪念星座 · 体验" : "WORLD MEMORY · EXPERIENCE"}</small><strong>{locale === "zh" ? memory.zh : memory.en}</strong><em>{locale === "zh" ? "静态星点 · 不与正在传递的路线混淆" : "Still stars, visually distinct from moving routes"}</em></span></article>)}</div>
              <div className="memory-local-summary"><i>⌘</i><span><small>{locale === "zh" ? "只在这台设备" : "ON THIS DEVICE"}</small><strong>{keepsakes.length} {locale === "zh" ? "件私人纪念物" : "private keepsakes"}</strong></span></div>
              <button className="drawer-wide-action memory-action" onClick={() => { setArchiveTab("keepsakes"); setPanel("archive"); }}>{locale === "zh" ? "进入星辰档案" : "Open star archive"}<b>→</b></button>
            </div>}
            {worldTab === "lenses" && <div className="world-lens-view">
              <button className="current-sky-row" onClick={() => setPanel("region")}><i>{weatherIcon(environment)}</i><span><small>{weatherStatus === "live" ? c.live : locale === "zh" ? "天空采样" : "SKY SAMPLE"}</small><strong>{location.label} · {weatherStatus === "live" || weatherStatus === "sample" ? `${Math.round(weather.temperature)}°` : "—"} · {localTime}</strong></span><b>→</b></button>
              <div className="drawer-section live-earth-section">
                <span className="drawer-section-title">{locale === "zh" ? "此刻地球 · 数据层" : "LIVE EARTH · DATA LAYERS"}</span>
                <div className="live-layer-grid">
                  <button className={earthDataLayer === "kindness" ? "active" : ""} onClick={() => selectEarthDataLayer("kindness")}><i>✦</i><span><strong>{locale === "zh" ? "善意流动" : "Kindness"}</strong><small>{locale === "zh" ? "万人体验模拟" : "10K SIMULATION"}</small></span></button>
                  <button className={earthDataLayer === "events" ? "active events" : "events"} onClick={() => selectEarthDataLayer("events")}><i>◉</i><span><strong>{locale === "zh" ? "自然事件" : "Earth events"}</strong><small>NASA EONET · {naturalEventsStatus === "current" ? naturalEvents.length : naturalEventsStatus === "loading" ? "…" : "—"}</small></span></button>
                  <button className={earthDataLayer === "aurora" ? "active aurora" : "aurora"} onClick={() => selectEarthDataLayer("aurora")}><i>⌁</i><span><strong>{locale === "zh" ? "极光预报" : "Aurora"}</strong><small>NOAA · 30 MIN</small></span></button>
                  <button className="observatory" onClick={openNasaObservatory}><i>◎</i><span><strong>{locale === "zh" ? "NASA 观察舱" : "NASA observatory"}</strong><small>{locale === "zh" ? "官方交互视图" : "OFFICIAL EXPERIENCE"}</small></span><b>↗</b></button>
                </div>
                <small>{locale === "zh" ? "每一层都显示来源与时间；近实时不等于直播。自然事件与极光不会被写进纪念物。" : "Every layer shows source and time. Near-real-time is not livestreaming; Earth data never enters keepsakes."}</small>
              </div>
              <div className="drawer-section"><span className="drawer-section-title">NASA EARTH LENS</span><div className="lens-choice">{(["atlas", "daily", "night"] as EarthLens[]).map((lens) => <button key={lens} className={earthLens === lens ? "active" : ""} onClick={() => setEarthLens(lens)}>{lens === "atlas" ? (locale === "zh" ? "稳定地球" : "Atlas") : lens === "daily" ? (locale === "zh" ? "最近真彩" : "True color") : (locale === "zh" ? "夜光合成" : "Night")}</button>)}</div><small>{locale === "zh" ? "NASA 影像不会进入纪念物；最近真彩是请求日期，不宣称实时。" : "NASA imagery is never stored in keepsakes; recent true color is dated, not claimed live."}</small></div>
              <div className="drawer-section drawer-zoom"><span className="drawer-section-title">{locale === "zh" ? "地球尺度" : "EARTH SCALE"}</span><button onClick={() => nudgeEarthZoom(1.3)} aria-label={locale === "zh" ? "缩小地球" : "Zoom Earth out"}>−</button><span><strong>{zoomStage}</strong><small>{locale === "zh" ? "也可滚轮或双指缩放" : "Wheel or pinch also works"}</small></span><button onClick={() => nudgeEarthZoom(-1.3)} aria-label={locale === "zh" ? "放大地球" : "Zoom Earth in"}>＋</button></div>
              <div className="drawer-settings">
                <button className={userLocation ? "active" : ""} onClick={() => requestLocation("locate")}><i>⌖</i><span>{c.locate}</span><b>{userLocation ? (locale === "zh" ? "已模糊" : "COARSE") : "→"}</b></button>
                <button aria-pressed={sound} onClick={() => setSound(!sound)}><i>{sound ? "◖))" : "◖×"}</i><span>{sound ? c.soundOff : c.soundOn}</span><b>{sound ? "ON" : "OFF"}</b></button>
              </div>
              <div className="drawer-language" role="radiogroup" aria-label={c.choose}>{Object.entries(LOCALE_NAMES).map(([code, name]) => <button key={code} role="radio" aria-checked={locale === code} onClick={() => setLocale(code as Locale)}>{name}<small>{code.toUpperCase()}</small></button>)}</div>
            </div>}
          </div>
        </section>
      )}

      {panel === "light-choice" && (
        <section ref={lightDialogRef} className="light-choice-panel floating-panel" role="dialog" aria-modal="true" aria-labelledby="light-choice-title">
          <div className="panel-head"><span>✦ {support.gateKicker}</span><button type="button" onClick={closeLightDialog} aria-label={support.close}>×</button></div>
          <div className="light-choice-orbit" aria-hidden="true"><i /><i /><b>✦</b><em>⌁</em></div>
          <div className="light-choice-copy">
            <small>{support.gateKicker}</small>
            <h2 id="light-choice-title" data-dialog-focus tabIndex={-1}>{support.gateTitle}</h2>
            <p>{support.gateCopy}</p>
          </div>
          <div className="light-directions">
            <button type="button" className="give-light" onClick={() => openCompose("light")}>
              <i aria-hidden="true">↗</i><span><strong>{support.giveTitle}</strong><small>{support.giveCopy}</small></span><b aria-hidden="true">→</b>
            </button>
            <button type="button" className="receive-light" onClick={openSupport}>
              <i aria-hidden="true">⌁</i><span><strong>{support.needTitle}</strong><small>{support.needCopy}</small></span><b aria-hidden="true">→</b>
            </button>
          </div>
          <p className="light-choice-privacy">◇ {support.privacy}</p>
        </section>
      )}

      {panel === "support" && (
        <section ref={lightDialogRef} className={`support-panel floating-panel support-step-${supportStep}`} role="dialog" aria-modal="true" aria-labelledby="support-title">
          <div className="panel-head"><span>⌁ {support.supportKicker}</span><button type="button" onClick={closeLightDialog} aria-label={support.close}>×</button></div>
          {supportStep === "level" && <>
            <div className="support-opening">
              <div className="support-breath support-breath-large" aria-hidden="true"><i /><i /><b>⌁</b></div>
              <span><small>{support.supportKicker}</small><h2 id="support-title" data-dialog-focus tabIndex={-1}>{support.supportTitle}</h2><p>{support.supportIntro}</p></span>
            </div>
            <div className="support-level-list">
              <button type="button" onClick={() => chooseSupportLevel("listen")}><i aria-hidden="true">◌</i><span><strong>{support.listenTitle}</strong><small>{support.listenCopy}</small></span><b aria-hidden="true">→</b></button>
              <button type="button" className="urgent" onClick={() => chooseSupportLevel("urgent")}><i aria-hidden="true">⌁</i><span><strong>{support.urgentTitle}</strong><small>{support.urgentCopy}</small></span><b aria-hidden="true">→</b></button>
              <button type="button" className="unsafe" onClick={() => chooseSupportLevel("unsafe")}><i aria-hidden="true">◇</i><span><strong>{support.unsafeTitle}</strong><small>{support.unsafeCopy}</small></span><b aria-hidden="true">→</b></button>
            </div>
            <button type="button" className="support-back-link" onClick={() => setPanel("light-choice")}>← {support.back}</button>
          </>}

          {supportStep === "safety" && <div className="support-safety">
            <div className="support-breath" aria-hidden="true"><i /><i /><b>⌁</b></div>
            <small>{supportLevel === "urgent" ? support.urgentTitle : support.listenTitle}</small>
            <h2 id="support-title" data-dialog-focus tabIndex={-1}>{support.safetyTitle}</h2>
            <p>{support.safetyCopy}</p>
            <div className="support-safety-actions">
              <button type="button" className="safe-now" onClick={() => setSupportStep("write")}><i aria-hidden="true">✓</i><span>{support.safe}</span></button>
              <button type="button" className="not-safe" onClick={() => setSupportStep("crisis")}><i aria-hidden="true">◇</i><span>{support.notSafe}</span></button>
            </div>
            <button type="button" className="support-back-link" onClick={() => setSupportStep("level")}>← {support.back}</button>
          </div>}

          {supportStep === "crisis" && <div className="support-crisis">
            <div className="crisis-beacon" aria-hidden="true"><i /><i /><b>⌁</b></div>
            <small>{support.supportKicker}</small>
            <h2 id="support-title" data-dialog-focus tabIndex={-1}>{support.crisisTitle}</h2>
            <p>{support.crisisCopy}</p>
            <div className="canada-support-card">
              <span>{support.canada}</span>
              <div className="crisis-actions">
                <a href="tel:988"><i aria-hidden="true">☎</i>{support.call988}</a>
                <a href="sms:988"><i aria-hidden="true">✉</i>{support.text988}</a>
              </div>
              <a className="danger-call" href="tel:911">{support.danger911}</a>
            </div>
            <p className="outside-canada">◇ {support.outside}</p>
            <a className="what-to-expect" href="https://988.ca/get-help/what-to-expect" target="_blank" rel="noreferrer">{support.visit988}</a>
            <button type="button" className="after-help-button" onClick={() => { setSupportLevel("urgent"); setSupportStep("write"); }}>{support.afterHelp}<b aria-hidden="true">→</b></button>
            <button type="button" className="support-back-link" onClick={() => setSupportStep("level")}>← {support.back}</button>
          </div>}

          {supportStep === "write" && <form className="support-write" onSubmit={submitSupportSignal}>
            <small>{support.supportKicker}</small>
            <h2 id="support-title" data-dialog-focus tabIndex={-1}>{support.writeTitle}</h2>
            <p>{support.writeCopy}</p>
            <span className="support-safe-chip"><i aria-hidden="true">✓</i>{support.safeChip}</span>
            <textarea required maxLength={600} value={supportText} onChange={(event) => setSupportText(event.target.value)} placeholder={support.placeholder} />
            <div className="support-needs" role="group" aria-label={support.writeTitle}>
              {(["heard", "reply", "next"] as SupportNeed[]).map((need) => <button key={need} type="button" aria-pressed={supportNeed === need} onClick={() => setSupportNeed(need)}><i aria-hidden="true">{need === "heard" ? "◌" : need === "reply" ? "↳" : "→"}</i>{support[need]}</button>)}
            </div>
            <p className="support-local-truth">◇ {support.localOnly}</p>
            <div className="support-write-actions"><button type="button" onClick={() => setSupportStep("safety")}>← {support.back}</button><button type="submit" disabled={!supportText.trim()}>{support.submit}<b aria-hidden="true">⌁</b></button></div>
          </form>}
        </section>
      )}

      {panel === "compose" && (
        <section ref={composeDialogRef} className="compose-panel floating-panel" role="dialog" aria-modal="true" aria-label={composeMode === "wish" ? (locale === "zh" ? "写下愿望" : "Write a wish") : composeMode === "reply" ? (locale === "zh" ? "写下回应" : "Write a reply") : (locale === "zh" ? "写一束光" : "Write a light") }>
          <div className="panel-head"><span>{composeMode === "wish" ? "♡ WISH" : composeMode === "reply" ? "↳ REPLY" : "✦ NEW LIGHT"}</span><button onClick={() => setPanel(null)} aria-label={c.close}>×</button></div>
          <div className="compose-progress" aria-label={locale === "zh" ? `写信步骤 ${composeStep}` : `Compose step ${composeStep}`}>
            <span className={composeStep >= 1 ? "active" : ""}><i>1</i>{locale === "zh" ? "写一句" : "WRITE"}</span>
            {composeMode !== "reply" && <><b /><span className={composeStep >= 2 ? "active" : ""}><i>2</i>{locale === "zh" ? "选信使" : "MESSENGER"}</span><b /><span className={composeStep >= 3 ? "active" : ""}><i>3</i>{locale === "zh" ? "去哪里" : "DESTINATION"}</span></>}
          </div>
          {composeScene && <div className={`compose-scene scene-${composeScene}`}><i>✦</i><span><small>{locale === "zh" ? "共同瞬间镜头" : "SHARED MOMENT SCENE"}</small><strong>{pulse.compose[composeScene]}</strong></span></div>}
          {composeMode === "reply" && selected && <blockquote>“{storyText(selected, locale, false)}”</blockquote>}
          {composeMode === "reply" && selected?.kind === "support" && <div className="support-reply-guidance"><i aria-hidden="true">◇</i><span>{support.companionRules}</span></div>}
          <form onSubmit={submitStory}>
            {composeStep === 1 && <div className="compose-step compose-write-step">
              <textarea name="message" required autoFocus maxLength={600} value={draftText} onChange={(event) => setDraftText(event.target.value)} placeholder={composeMode === "wish" ? c.wishText : composeMode === "reply" ? c.response : c.message} />
              <p className="auto-translate"><b>{extra.textOnly}</b><span>{draftText.length} / 600 · {c.auto}</span></p>
              <p className="network-publish-note">◇ {composeMode === "reply" && (selected?.localOnly || selected?.kind === "support") ? (locale === "zh" ? "这条陪伴回应只留在你的设备，不会公开。" : "This companion reply stays only on your device.") : (locale === "zh" ? "公开内容会匿名进入共享地球，位置再次模糊处理，约 6 秒同步；不开放私聊和联系方式。" : "Public writing enters the shared Earth anonymously, with location blurred again and about six-second sync. No private chat or contact details.")}</p>
              <div className="compose-actions"><button type="button" onClick={() => setPanel(null)}>{c.cancel}</button>{composeMode === "reply" ? <button type="submit" disabled={!draftText.trim()}>{locale === "zh" ? "让回应发光" : "Let it glow"} <b>→</b></button> : <button type="button" disabled={!draftText.trim()} onClick={() => setComposeStep(2)}>{locale === "zh" ? "选择信使" : "Choose a messenger"} <b>→</b></button>}</div>
            </div>}
            {composeMode !== "reply" && composeStep === 2 && <div className="compose-step">
              <div className={`courier-passport family-${activeFamily}`}>
                <div className="passport-emblem"><i>{TRANSPORTS[courierMode].glyph}</i><b>LV.0{courierProfiles[courierMode].level}</b></div>
                <div className="passport-copy"><small>{locale === "zh" ? "私人信使护照 · 只在抵达后成长" : "PRIVATE COURIER PASSPORT · GROWS AFTER ARRIVAL"}</small><strong>{familyProfiles[activeFamily].title} · {courierProfiles[courierMode].name}</strong><span>{familyProfiles[activeFamily].note}</span><u><i style={{ width: `${Math.min(100, (courierProfiles[courierMode].score / courierProfiles[courierMode].nextAt) * 100)}%` }} /></u></div>
                <div className="passport-families">{(COURIER_FAMILIES as CourierFamily[]).map((family) => <span key={family} className={family === activeFamily ? "active" : ""}><i />{familyProfiles[family].title}<b>0{familyProfiles[family].level}</b></span>)}</div>
              </div>
              <div className="courier-chooser">
                <div className="courier-title"><span>{c.courier}</span><small>{locale === "zh" ? "成长不靠分享 · 不改变善意价值" : "NO SHARE XP · NO KINDNESS RANK"}<br />{c.estimate} · {formatDuration(composeEstimate.etaHours, locale)}</small></div>
                <div className="courier-strip">
                  {TRANSPORT_ORDER.map((mode) => {
                    const spec = TRANSPORTS[mode];
                    const profile = courierProfiles[mode];
                    return <button key={mode} type="button" disabled={!profile.unlocked} className={`${courierMode === mode ? "active" : ""} ${profile.unlocked ? "met" : "unmet"}`} onClick={() => setCourierMode(mode)} title={profile.unlocked ? `${spec.names[locale]} · ${profile.name}` : profile.hint}><i>{spec.glyph}</i><span>{spec.names[locale]}</span><small>{profile.unlocked ? `${profile.name} · LV.0${profile.level}` : (locale === "zh" ? "还未相遇" : "NOT YET MET")}</small>{!profile.unlocked && <em>{profile.hint}</em>}</button>;
                  })}
                </div>
              </div>
              <div className="compose-actions"><button type="button" onClick={() => setComposeStep(1)}>← {locale === "zh" ? "返回" : "Back"}</button><button type="button" onClick={() => setComposeStep(3)}>{locale === "zh" ? "选择目的地" : "Choose destination"} <b>→</b></button></div>
            </div>}
            {composeMode !== "reply" && composeStep === 3 && <div className="compose-step">
              <div className="delivery-tabs">
                <button type="button" className={delivery === "random" ? "active" : ""} onClick={() => { setDelivery("random"); setPlacePickerOpen(false); }}><i>⌁</i>{c.random}</button>
                <button type="button" className={delivery === "nearby" ? "active" : ""} onClick={() => { setDelivery("nearby"); setPlacePickerOpen(false); }}><i>⌖</i>{c.near}</button>
                <button type="button" className={delivery === "place" ? "active" : ""} onClick={() => { setDelivery("place"); setPickedPlace(null); setPlacePickerOpen(true); }}><i>◎</i>{c.place}</button>
              </div>
              {delivery === "place" && <div className={`place-prompt ${pickedPlace ? "has-point" : "awaiting-point"}`}><i>◎</i><span><small>{placePickerOpen ? (locale === "zh" ? "轻点地球落下光针 · 拖动转动 · 双指缩放" : "Tap to place light · drag to turn · pinch to zoom") : c.selected}</small><strong>{pickedPlace ? `${composeTarget.label} · ${pickedPlace.lat.toFixed(1)}°, ${pickedPlace.lon.toFixed(1)}°` : (locale === "zh" ? "还没有选择目的地" : "No destination selected yet")}</strong><em>{locale === "zh" ? "公开内容只保留约 0.1° 的模糊地域" : "Public content keeps only an approximate 0.1° region"}</em></span><button type="button" disabled={placePickerOpen && !pickedPlace} onClick={() => setPlacePickerOpen((value) => !value)}>{placePickerOpen ? (locale === "zh" ? "确认此处" : "Use this place") : (locale === "zh" ? "重新定点" : "Pick again")}</button></div>}
              {(delivery !== "place" || pickedPlace) && <div className="route-estimate"><span>{senderOrigin.label}</span><i><b /></i><span>{composeTarget.label}</span><strong>{Math.round(composeEstimate.routeDistance).toLocaleString()} km</strong></div>}
              <p className="departure-promise">{needsMailRelay(courierMode, composeEstimate.distance)
                ? (locale === "zh" ? "这是多段邮路接力：陆路信使到海岸会熄灯交棒，在另一岸继续，不会画成穿海而行。全程只显示模糊地域。" : "This becomes a multi-stage mail relay: the ground courier hands off at the coast and resumes on the far shore. No one is drawn crossing the sea; only coarse regions appear.")
                : (locale === "zh" ? "默认随缘去往地球某处。没有精确住址，也不会显示实时轨迹。" : "By default, it drifts somewhere on Earth. No exact address or live personal trail is shown.")}</p>
              <div className="compose-actions"><button type="button" onClick={() => { setPlacePickerOpen(false); setComposeStep(2); }}>← {locale === "zh" ? "返回" : "Back"}</button><button type="submit" disabled={delivery === "place" && (!pickedPlace || placePickerOpen)}>{locale === "zh" ? "让它启程" : "Let it depart"} <b>→</b></button></div>
            </div>}
          </form>
        </section>
      )}

      {panel !== "compose" && panel !== "light-choice" && panel !== "support" && !journeyView && !supportReceipt && <button ref={lightButtonRef} className="write-light-trigger" onClick={openLightChoice} aria-label={`${support.oneLight}: ${support.oneLightHint}`}><i aria-hidden="true">✦</i><span>{support.oneLight}<small>{support.oneLightHint}</small></span></button>}
      {supportReceipt && <section ref={supportReceiptRef} className="support-receipt" role="dialog" aria-modal="true" aria-labelledby="support-receipt-title" aria-describedby="support-receipt-truth" tabIndex={-1}>
        <button type="button" className="receipt-close" onClick={() => { setSupportReceipt(null); window.setTimeout(() => lightButtonRef.current?.focus(), 0); }} aria-label={support.close}>×</button>
        <div className="receipt-sky" aria-hidden="true"><i /><i /><i /><b>⌁</b></div>
        <small>{support[supportReceipt.need]} · {supportReceipt.level === "urgent" ? support.urgentTitle : support.listenTitle}</small>
        <h2 id="support-receipt-title">{support.receiptTitle}</h2>
        <p>{support.receiptCopy}</p>
        <blockquote>“{supportReceipt.message}”</blockquote>
        <p id="support-receipt-truth" className="receipt-truth">◇ {support.receiptTruth}</p>
        <div className="receipt-actions">
          <button type="button" onClick={() => { const story = stories.find((item) => item.id === supportReceipt.storyId); setSupportReceipt(null); if (story) selectStory(story); }}>{support.view}<b aria-hidden="true">→</b></button>
          <button type="button" onClick={() => { setSupportReceipt(null); window.setTimeout(() => lightButtonRef.current?.focus(), 0); }}>{support.done}</button>
        </div>
        <button type="button" className="receipt-end" onClick={() => endSupportSignal(supportReceipt.storyId)}>{support.closeSignal}</button>
      </section>}
      {nasaObservatoryOpen && <section ref={nasaObservatoryRef} className="nasa-observatory" role="dialog" aria-modal="true" aria-labelledby="nasa-observatory-title">
        <header>
          <span><small>NASA EYES · OFFICIAL EXPERIENCE</small><strong id="nasa-observatory-title">{locale === "zh" ? "地球观察舱" : "Earth observatory"}</strong></span>
          <div><a href="https://eyes.nasa.gov/apps/earth/#/satellites?rate=1" target="_blank" rel="noreferrer">{locale === "zh" ? "在新窗口打开" : "Open in new window"} ↗</a><button type="button" onClick={() => { setNasaObservatoryOpen(false); window.setTimeout(() => worldButtonRef.current?.focus(), 0); }} aria-label={c.close}>×</button></div>
        </header>
        <div className="nasa-observatory-stage">
          <iframe
            src="https://eyes.nasa.gov/apps/earth/#/satellites?rate=1"
            title={locale === "zh" ? "NASA Eyes 官方地球交互" : "Official NASA Eyes Earth interactive"}
            loading="lazy"
            allow="accelerometer; fullscreen"
            allowFullScreen
          />
          <div className="nasa-observatory-loading" aria-hidden="true"><i /><span>NASA EYES</span></div>
        </div>
        <footer><i aria-hidden="true">◇</i><span>{locale === "zh" ? "NASA 官方独立视图 · NASA/JPL-Caltech。观察舱不会读取 KindChain 的留言、位置或纪念物；数据时效以 NASA 界面标注为准。" : "Official independent NASA view · NASA/JPL-Caltech. The observatory does not read KindChain messages, location or keepsakes; freshness follows NASA labels."}</span></footer>
      </section>}
      <KindnessOnboarding locale={locale} stage={onboardingStage} onReceive={() => finishOnboarding(true)} onSkip={() => finishOnboarding(false)} />
      {departureTicket && <DepartureTicketCard locale={locale} ticket={departureTicket} onClose={() => setDepartureTicket(null)} onFollow={() => {
        const journey = journeys.find((item) => item.id === departureTicket.journeyId);
        setDepartureTicket(null);
        if (journey) openJourney(journey, true);
      }} onSave={() => saveMomentCard({ kind: "departure", label: `${departureTicket.from} → ${departureTicket.to}`, message: departureTicket.message, meta: `${departureTicket.messenger} · ${Math.round(departureTicket.distance).toLocaleString()} km · ${locale === "zh" ? "模糊地点，不显示实时个人轨迹" : "Coarse place · no live personal trail"}`, fileStem: departureTicket.id })} />}
      {replyCeremony && <ReplyArrivalCeremony locale={locale} ceremony={replyCeremony} onClose={() => setReplyCeremony(null)} onSave={() => saveMomentCard({ kind: "arrival", label: replyCeremony.region, message: replyCeremony.message, meta: `${replyCeremony.weather} · ${replyCeremony.localTime} · ${locale === "zh" ? "一束回应已经抵达" : "A reply arrived"}`, fileStem: replyCeremony.id })} />}
      {watchingStory && <QuietWatch locale={locale} story={watchingStory} sound={sound} onToggleSound={() => setSound((value) => !value)} onReply={() => openCompose("reply")} onClose={() => setWatchingStoryId(null)} />}
      {locationGate && <LocationGate locale={locale} onAllow={allowLocation} onLater={exploreWithoutLocation} />}
      {notice && <div className="notice" role="status"><i>✦</i>{notice}<button onClick={() => setNotice(null)}>×</button></div>}
    </main>
  );
}
