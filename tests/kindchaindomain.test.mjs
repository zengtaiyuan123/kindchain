import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  EMPTY_MESSENGER_MEMORY,
  GLOBE_ZOOM_STOPS,
  coarsePublicPoint,
  courierPresentationAtZoom,
  courierProfileFor,
  courierUnlockState,
  extendLightExpiry,
  kindnessActKey,
  messengerGrowthScore,
  messengerProfileFor,
  nearestZoomStop,
  sanitizeMessengerMemory,
  settleCourierJourney,
} from "../app/kindchain-domain.mjs";

test("pigeon growth comes from its own arrivals and real replies, never shared distance", () => {
  const memory = sanitizeMessengerMemory({ replies: 2, distanceKm: 5200, weatherMarks: 1, escorts: 2, modeTrips: { pigeon: 1, rocket: 20 } });
  assert.equal(messengerGrowthScore(memory), 6);
  assert.equal(messengerProfileFor(memory, "zh").level, 3);
  assert.equal(courierProfileFor("rocket", memory, "zh").score, 40);
  assert.equal("shares" in memory, false);
});

test("invalid stored messenger data is made safe", () => {
  const memory = sanitizeMessengerMemory({ replies: -3, distanceKm: "2500", weatherMarks: null, escorts: 1, stamps: ["RAIN@2026-08-03@northern-lakes", "RAIN@2026-08-03@northern-lakes", 9] });
  assert.equal(memory.replies, 0);
  assert.equal(memory.distanceKm, 2500);
  assert.equal(memory.escorts, 1);
  assert.equal(memory.modeTrips.pigeon, 0);
  assert.deepEqual(memory.stamps, ["RAIN@2026-08-03@northern-lakes"]);
});

test("journeys grow only after arrival and settle exactly once", () => {
  const journey = { id: "arrival-1", mode: "carriage", distanceKm: 4200, zones: ["northern-lakes", "mediterranean"], stamps: ["RAIN@2026-08-03@northern-lakes"], crossedTerminator: true, reply: false };
  const once = settleCourierJourney(EMPTY_MESSENGER_MEMORY, journey);
  const twice = settleCourierJourney(once, journey);
  assert.equal(once.arrivals, 1);
  assert.equal(once.modeTrips.carriage, 1);
  assert.equal(once.modeTrips.pigeon, 0);
  assert.equal(once.familyDistanceKm.postal, 4200);
  assert.deepEqual(twice, once);
});

test("courier encounters are earned gently without blocking first letters", () => {
  const fresh = sanitizeMessengerMemory(null);
  assert.equal(courierUnlockState("hand", fresh, "zh").unlocked, true);
  assert.equal(courierUnlockState("pigeon", fresh, "zh").unlocked, true);
  assert.equal(courierUnlockState("carriage", fresh, "zh").unlocked, false);
  const metCarriage = sanitizeMessengerMemory({ ...fresh, arrivals: 1 });
  assert.equal(courierUnlockState("carriage", metCarriage, "zh").unlocked, true);
});

test("couriers appear only in spatially coherent camera layers", () => {
  assert.equal(courierPresentationAtZoom("rocket", "ORBIT"), "model");
  assert.equal(courierPresentationAtZoom("rocket", "COMMUNITY"), "hidden");
  assert.equal(courierPresentationAtZoom("hand", "ORBIT"), "hidden");
  assert.equal(courierPresentationAtZoom("hand", "COMMUNITY"), "model");
  assert.equal(courierPresentationAtZoom("plane", "COUNTRY"), "trace");
});

test("globe zoom settles onto the nearest narrative layer", () => {
  assert.equal(nearestZoomStop(0.51), 0.58);
  assert.equal(nearestZoomStop(0.08), GLOBE_ZOOM_STOPS[0]);
});

test("direct wheel and pinch zoom stay continuous while buttons use narrative layers", async () => {
  const source = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  const earthBlock = source.slice(source.indexOf("function LivingWorld"), source.indexOf("function NeighborhoodMap"));
  assert.match(source, /const CAMERA_NEAR = 4\.15/);
  assert.match(earthBlock, /updateCameraZoom\(event\.deltaY \* 0\.0034\)/);
  assert.doesNotMatch(earthBlock, /snapCameraZoom/);
  assert.match(source, /const currentStop = nearestZoomStop\(zoom\)/);
  assert.match(source, /delta < 0 && stops\[nextIndex\] >= LOCAL_HANDOFF_ZOOM/);
});

test("public points are rounded before they become visible", () => {
  assert.deepEqual(coarsePublicPoint({ lat: 53.546123, lon: -113.493822 }), { lat: 53.5, lon: -113.5 });
});

test("quiet kindness is private, repeat-safe by day and never creates fear countdowns", () => {
  const now = Date.parse("2026-08-02T23:00:00.000Z");
  assert.equal(kindnessActKey("light-1", "lamp", new Date(now)), "2026-08-02|lamp|light-1");
  const story = { id: "light-1", createdAt: now - 71 * 3600000, expiresAt: now + 20 * 60000 };
  const extended = extendLightExpiry(story, now, 90);
  assert.equal(extended.expiresAt, story.createdAt + 72 * 3600000);
  assert.equal("publicCount" in extended, false);
});

test("sharing cannot mutate messenger growth and community zoom stays bounded", async () => {
  const source = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  const shareFlow = source.slice(source.indexOf("const requestRelay"), source.indexOf("const captureStarPath"));
  assert.equal(source.includes("kindchain-pigeon-shares"), false);
  assert.equal(shareFlow.includes("setMessengerMemory"), false);
  assert.match(source, /const MAP_MAX_ZOOM = 10\.8/);
  assert.match(source, /NASA GIBS/);
  assert.match(source, /NOT LIVE ROUTE WEATHER/);
  assert.doesNotMatch(source, /LIVE CO-OP SCENE/);
  assert.doesNotMatch(source, /Edmonton · sample/);
  assert.match(source, /多段邮路接力/);
  assert.match(source, /kind: "stamp" as const/);
});

test("the experience sky aggregates exactly ten thousand people without ten thousand render objects", async () => {
  const source = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  const seedBlock = source.slice(source.indexOf("const DEMO_ACTIVITY_SEED"), source.indexOf("const WORLD_MESSENGER_COUNTS"));
  const publishers = [...seedBlock.matchAll(/uniquePublishers:\s*(\d+)/g)].map((match) => Number(match[1]));
  assert.equal(publishers.length, 19);
  assert.equal(publishers.reduce((sum, value) => sum + value, 0), 10_000);
  assert.match(source, /new THREE\.InstancedMesh/);
  assert.match(source, /snapshot\.cells\.filter\(\(cell\) => cell\.intensity > 0\)\.slice\(0, 128\)/);
  assert.doesNotMatch(source, /for \(let i = 0; i < seed\.uniquePublishers/);
});

test("all seven courier families run as non-persistent representative journeys", async () => {
  const source = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  const journeyBlock = source.slice(source.indexOf("function createExperienceJourneys"), source.indexOf("function needsMailRelay"));
  for (const mode of ["hand", "pigeon", "carriage", "rail", "plane", "rocket", "starship"]) {
    assert.match(journeyBlock, new RegExp(`mode: "${mode}"`));
  }
  assert.match(source, /journeys\.filter\(\(journey\) => !journey\.id\.startsWith\("journey-demo-"\)\)/);
});

test("the idle shell exposes only the world and write-light entrances", async () => {
  const source = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  assert.match(source, /className="world-trigger"/);
  assert.match(source, /className="write-light-trigger"/);
  assert.doesNotMatch(source, /className="world-dock"/);
  assert.doesNotMatch(source, /className="journey-peek"/);
});

test("the Earth teaches direct manipulation and turns every tap into an actionable place", async () => {
  const source = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  const styles = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");
  assert.match(source, /kindchain-spatial-guide-v1/);
  assert.match(source, /onInteract=\{acknowledgeSpatialGuide\}/);
  assert.match(source, /const openPinnedCompose/);
  assert.match(source, /onClick=\{openPinnedCompose\}/);
  assert.match(source, /ORBIT: \.08, EARTH: pickedPlace \? \.38 : \.22, CONTINENT: \.55, COUNTRY: \.82, REGION: \.96/);
  assert.match(styles, /\.spatial-guide\{/);
  assert.match(styles, /\.place-awakening>button\{/);
});

test("heavy map styling and courier models wait until the experience needs them", async () => {
  const source = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  const styles = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");
  assert.doesNotMatch(styles, /@import\s+["']maplibre-gl/);
  assert.match(source, /import\("maplibre-gl\/dist\/maplibre-gl\.css"\)/);
  assert.match(source, /window\.setTimeout\(\(\) => \{/);
  assert.match(source, /prefers-reduced-motion: reduce/);
});

test("local depth always has an escape path and readable KindChain content", async () => {
  const source = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  const styles = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");
  assert.match(source, /className="map-depth-fallback"/);
  assert.match(source, /className="fallback-geography"/);
  assert.match(source, /geoMercator\(\)/);
  assert.match(source, /className=\{`map-kindness-layer stage-\$\{localStage\.toLowerCase\(\)\}`\}/);
  assert.match(source, /localStories\.map/);
  assert.match(source, /localActivity\.map/);
  assert.match(source, /className="return-earth" onClick=\{returnToEarth\}/);
  assert.match(source, /setZoomCommand\(\(current\) => \(\{ delta: 0, targetZoom: \.22/);
  assert.match(styles, /\.scale-control\{position:absolute;z-index:46/);
  assert.match(styles, /\.map-error-state \.map-depth-fallback\{opacity:1\}/);
});

test("place depth names country province city district and only a coarse community area", async () => {
  const source = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  const route = await readFile(new URL("../app/api/place/route.ts", import.meta.url), "utf8");
  const styles = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");
  assert.match(source, /country: string;\s+region: string;\s+city: string;\s+district: string;\s+locality: string;/);
  assert.match(source, /省级范围/);
  assert.match(source, /城市范围/);
  assert.match(source, /区县级片区/);
  assert.match(source, /模糊社区范围/);
  assert.match(source, /mapZoom >= 10 \? "COMMUNITY" : mapZoom >= 8\.1 \? "DISTRICT" : mapZoom >= 6\.2 \? "CITY"/);
  assert.match(source, /className="map-breadcrumb"/);
  assert.match(source, /map-hierarchy-field hierarchy-/);
  assert.match(source, /const localStops = \[MAP_ENTRY_ZOOM, 6\.8, 8\.7, 10\.4\]/);
  assert.match(source, /targetZoom: \.76/);
  assert.match(route, /Math\.round\(Math\.max\(min, Math\.min\(max, number\)\) \* 10\) \/ 10/);
  assert.match(route, /endpoint\.searchParams\.set\("zoom", "12"\)/);
  assert.doesNotMatch(route, /\["road"|"house_number"|"postcode"\]/);
  assert.match(styles, /\.map-host \{[^}]+brightness\(1\.02\)/);
  assert.match(styles, /\.map-hierarchy-field\{/);
});

test("real geography survives network delays and public zoom never reaches an address", async () => {
  const source = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  const styles = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");
  assert.match(source, /style: LOCAL_MAP_STYLE/);
  assert.match(source, /https:\/\/tile\.openstreetmap\.org\/\{z\}\/\{x\}\/\{y\}\.png/);
  assert.match(source, /maxzoom: 11/);
  // The OpenFreeMap community layer is allowed ONLY as a post-load enhancement:
  // the raster composite must stay the initial style, the vector style may be
  // adopted only after its JSON has actually arrived, and a failing adoption
  // must revert to the raster composite. (v40 banned this host outright after
  // it once gated first paint; v42 reintroduces it behind those guarantees.)
  assert.match(source, /fetchWithTimeout\("https:\/\/tiles\.openfreemap\.org\/styles\/liberty"/);
  assert.match(source, /response\.ok \? response\.json\(\) : Promise\.reject/);
  assert.match(source, /probeVectorTile/); // a real tile must flow before the style may be adopted
  assert.match(source, /revertVector/); // a stalled adoption puts the raster composite back
  assert.match(source, /map\.setStyle\(LOCAL_MAP_STYLE\)/);
  assert.match(source, /kindchain-satellite-veil/);
  assert.match(source, /8\.2, 0\]/); // satellite fades out by community scale
  assert.match(source, /new ResizeObserver/); // the GL canvas must track its container
  assert.match(styles, /\.neighborhood-map \.map-host\{position:absolute/); // beats maplibregl-map's position:relative
  assert.match(source, /landFeatures\.map/);
  assert.match(source, /fallback-country-labels/);
  assert.match(styles, /\.map-host \{[^}]+opacity:\.3/);
  assert.match(styles, /\.fallback-countries path\{/);
});

test("satellite descent adds real surface detail without replacing Earth or its fallbacks", async () => {
  const source = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  const styles = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");
  assert.match(source, /World_Imagery\/MapServer\/tile\/\{z\}\/\{y\}\/\{x\}/);
  assert.match(source, /World_Boundaries_and_Places\/MapServer\/tile/);
  assert.match(source, /World_Transportation\/MapServer\/tile/);
  assert.match(source, /id: "kindchain-real-surface"/);
  assert.match(source, /PEARL_RIVER_DESCENT_LABELS/);
  for (const label of ["广东省", "广州市", "佛山市", "深圳市", "珠江口", "南海"]) assert.match(source, new RegExp(label));
  assert.match(source, /className="map-curvature"/);
  assert.match(source, /surface-badge badge-\$\{surfaceState\}/);
  assert.match(source, /map\.isSourceLoaded\("world-imagery"\)/);
  assert.match(source, /setSurfaceState\("standard"\)/);
  assert.match(source, /revealMap\(\);[\s\S]+setSurfaceState\("standard"\);[\s\S]+}, 900\)/);
  assert.match(source, /const mapBlend = nearView \? 1 : 0/);
  // v47: desktops still pre-mount the map during approach; compact devices
  // mount it only on actual descent (a second live GL context while browsing
  // the globe is what crashed mobile tabs).
  assert.match(source, /const mapVisible = nearView \|\| \(zoom >= MAP_MOUNT_DEPTH && !compactDevice\)/);
  assert.match(source, /function isCompactDevice\(\)/);
  assert.match(source, /className = "coarse-arrival-marker"/);
  assert.match(styles, /\.geo-place-label\.is-visible/);
  assert.match(styles, /\.map-curvature/);
  assert.match(styles, /\.coarse-arrival-marker/);
  assert.match(source, /https:\/\/tile\.openstreetmap\.org/);
  assert.match(source, /className="map-depth-fallback"/);
});

test("ocean continent and country names stay attached to geographic coordinates", async () => {
  const source = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  assert.match(source, /type GeoLabelKind = "ocean" \| "continent" \| "country"/);
  for (const ocean of ["太平洋", "大西洋", "印度洋", "北冰洋", "南冰洋"]) assert.match(source, new RegExp(ocean));
  assert.match(source, /sprite\.position\.copy\(latLonVector\(THREE, definition\.lat, definition\.lon, 2\.31\)\)/);
  assert.match(source, /labelStage === "EARTH" \|\| labelStage === "CONTINENT"/);
  assert.match(source, /labelStage === "COUNTRY" \|\| labelStage === "REGION"/);
});

test("fallback Earth keeps visual focus and tap coordinates on the same longitude", async () => {
  const source = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  assert.match(source, /const FALLBACK_LONGITUDE_SPAN = 360 \/ FALLBACK_MAP_SCALE_X/);
  assert.match(source, /focusRef\.current\.lon \+ \(x - \.5\) \* FALLBACK_LONGITUDE_SPAN/);
  assert.match(source, /backgroundPosition: fallbackBackgroundPosition/);
  assert.match(source, /setPickedPlace\(point\); setLocation\(\{ \.\.\.point, label: cell\.regionLabel \}\)/);
});

test("companion signals ask about immediate safety before accepting a message", async () => {
  const source = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  assert.match(source, /你现在是否有伤害自己或他人的想法/);
  assert.match(source, /KindChain 可以陪在旁边，但不能提供紧急救援/);
  assert.match(source, /href="tel:988"/);
  assert.match(source, /href="sms:988"/);
  assert.match(source, /href="tel:911"/);
  assert.match(source, /https:\/\/988\.ca\/get-help\/what-to-expect/);
});

test("the experience version never pretends a live responder was notified", async () => {
  const source = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  const supportFlow = source.slice(source.indexOf("const submitSupportSignal"), source.indexOf("const endSupportSignal"));
  assert.match(supportFlow, /localOnly: true/);
  assert.match(supportFlow, /createdAt \+ 6 \* 3600000/);
  assert.doesNotMatch(supportFlow, /setJourneys|fetch\(|WebSocket|EventSource/);
  assert.match(source, /体验版尚未通知真人回应者/);
  assert.match(source, /不开放私聊/);
  assert.match(source, /不索要联系方式/);
});

test("live Earth layers disclose their real sources, freshness and limits", async () => {
  const source = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  assert.match(source, /https:\/\/eonet\.gsfc\.nasa\.gov\/api\/v3\/events\?status=open&limit=60/);
  assert.match(source, /https:\/\/services\.swpc\.noaa\.gov\/json\/ovation_aurora_latest\.json/);
  assert.match(source, /近实时元数据，不是直播画面/);
  assert.match(source, /极光 · 30 分钟预报/);
  assert.match(source, /Forecast Time/);
  assert.match(source, /Data unavailable; no simulated replacement/);
});

test("NASA Eyes opens lazily as an isolated official observatory", async () => {
  const source = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  const observatory = source.slice(source.indexOf("{nasaObservatoryOpen &&"), source.indexOf("<KindnessOnboarding"));
  assert.match(observatory, /https:\/\/eyes\.nasa\.gov\/apps\/earth\/#\/satellites\?rate=1/);
  assert.match(observatory, /<iframe/);
  assert.match(observatory, /loading="lazy"/);
  assert.match(observatory, /allowFullScreen/);
  assert.match(observatory, /不会读取 KindChain 的留言、位置或纪念物/);
  assert.match(source, /keepFocusInside\(event, nasaObservatoryRef\.current\)/);
});

test("the scheme-two Earth stays mounted, turns by elapsed time and survives NASA or WebGL failure", async () => {
  const source = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  const styles = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");
  assert.match(source, /useState<EarthLens>\("daily"\)/);
  assert.match(source, /const earthObservations = useMemo\(/);
  assert.match(source, /world\.rotation\.y \+= dt \* \.0168/);
  assert.match(source, /function createLocalEarthTexture/);
  assert.match(source, /live NASA imagery enhances our Earth; it never controls whether the Earth exists/);
  assert.match(source, /webglcontextlost/);
  assert.doesNotMatch(source, /WEBGL_lose_context|loseContext\(/);
  assert.match(styles, /\.world-canvas:not\(\.has-webgl\):not\(\.no-webgl\) \.world-fallback/);
  assert.match(styles, /\.world-canvas\.no-webgl canvas \{ display:none; \}/);
});

test("the network pilot uses durable shared storage without relabeling the 10K simulation", async () => {
  const source = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  const route = await readFile(new URL("../app/api/network/route.ts", import.meta.url), "utf8");
  const schema = await readFile(new URL("../db/schema.ts", import.meta.url), "utf8");
  const hosting = JSON.parse(await readFile(new URL("../.openai/hosting.json", import.meta.url), "utf8"));
  assert.equal(hosting.d1, "DB");
  assert.match(schema, /networkSignals/);
  assert.match(schema, /networkReplies/);
  assert.match(route, /PUBLIC_KINDS = new Set\(\["light", "wish"\]\)/);
  assert.doesNotMatch(route, /PUBLIC_KINDS[^\n]+support/);
  assert.match(route, /Math\.round\(Math\.max\(min, Math\.min\(max, number\)\) \* 10\) \/ 10/);
  assert.match(route, /private_contact_blocked/);
  assert.match(route, /rate_limited/);
  assert.match(source, /fetch\("\/api\/network"/);
  assert.match(source, /document\.hidden \? 15_000 : 6_000/);
  assert.match(source, /万人体验模拟 · 不代表实时在线/);
  assert.match(source, /真实网络试运行/);
});

test("no live data update can restart or recenter the physical Earth", async () => {
  const source = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  const mergeStart = source.indexOf("function mergeNetworkSnapshot");
  const mergeBlock = source.slice(mergeStart, source.indexOf("type Weather", mergeStart));
  const earthBlock = source.slice(source.indexOf("function LivingWorld"), source.indexOf("function NeighborhoodMap"));
  assert.match(mergeBlock, /return changed \? merged : current/);
  assert.match(mergeBlock, /visual stability guarantee/);
  assert.match(earthBlock, /const viewStateRef = useRef<WorldViewState>/);
  assert.match(earthBlock, /world\.quaternion\.fromArray\(viewStateRef\.current\.quaternion\)/);
  assert.match(earthBlock, /camera\.position\.z \+= \(cameraTarget - camera\.position\.z\) \* \(1 - Math\.exp\(-dt \* 3\.7\)\)/);
  assert.match(earthBlock, /world\.quaternion\.slerp\(targetQuaternion, 1 - Math\.exp\(-dt \* 3\.4\)\)/);
  assert.match(earthBlock, /!focusLocked && performance\.now\(\) >= autoRotateResumeAt/);
  assert.match(earthBlock, /setStories: updateStoryVisuals/);
  assert.match(earthBlock, /setJourneys: updateJourneyVisuals/);
  assert.match(earthBlock, /setObservations: updateObservationVisuals/);
  assert.match(earthBlock, /setEarthAppearance/);
  assert.match(earthBlock, /data refresh can never tear down the canvas or recenter the planet/);
  assert.match(earthBlock, /\}, \[\]\);/);
  assert.doesNotMatch(earthBlock, /\}, \[baseTextureUrl, earthDataLayer, earthLens, homePoint, journeys, observations, stories, textureUrl\]\);/);
});

test("nebula emotion belongs to atmosphere, arrivals and memories without replacing Earth", async () => {
  const source = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  const styles = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");
  assert.match(source, /className="emotional-atmosphere"/);
  assert.match(source, /className="memory-sky"/);
  assert.match(source, /arrivalBloom=\{arrivalBloom\}/);
  assert.match(source, /arrivalBloomGroup/);
  assert.match(styles, /\.emotional-atmosphere\{position:absolute;z-index:2/);
  assert.match(styles, /\.world-canvas \{ position: absolute; z-index: 3/);
  assert.match(styles, /\.is-support-open \.emotional-atmosphere\{opacity:\.27;filter:saturate\(\.58\)/);
  assert.match(styles, /\.is-memory-sky \.memory-sky\{opacity:\.82\}/);
  assert.match(styles, /prefers-reduced-motion:reduce/);
});

test("regional backgrounds vary by natural systems and reveal detail with camera depth", async () => {
  const source = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  const styles = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");
  assert.match(source, /function backgroundIdentityFor/);
  for (const layer of ["celestial-clock", "air-current", "season-field", "landscape-field", "regional-texture"]) {
    assert.match(source, new RegExp(`className="${layer}"`));
  }
  assert.match(source, /season-\$\{identity\.season\}/);
  assert.match(source, /latitude-\$\{identity\.latitude\}/);
  assert.match(source, /air-\$\{identity\.air\}/);
  assert.match(source, /wind-\$\{identity\.wind\}/);
  assert.match(source, /settlement-\$\{identity\.settlement\}/);
  assert.match(source, /material-\$\{identity\.material\}/);
  assert.match(styles, /\.zoom-orbit \.landscape-field,\.zoom-earth \.landscape-field\{opacity:0\}/);
  assert.match(styles, /\.zoom-region \.regional-texture\{opacity:\.54\}/);
  assert.match(styles, /\.time-night \.place-lights\{opacity:\.92\}/);
  assert.match(styles, /\.settlement-dense \.regional-texture/);
});

test("continent and country scale is legible while every arrival gets a fresh scene recipe", async () => {
  const source = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  const styles = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");
  assert.match(source, /kind: "continent", lat: 43, lon: 88, en: "Asia", zh: "亚洲"/);
  assert.match(source, /kind: "country", lat: 35, lon: 104, en: "China", zh: "中国"/);
  assert.match(source, /function geographicContextFor/);
  assert.match(source, /geoContains\(country, \[point\.lon, point\.lat\]\)/);
  assert.match(source, /labelStage === "CONTINENT"/);
  assert.match(source, /labelStage === "COUNTRY"/);
  assert.match(source, /className=\{`geo-lens geo-lens-/);
  assert.match(source, /setSceneNonce\(\(value\) => \(value \+ 1\) >>> 0\)/);
  assert.match(source, /scene-layout-\$\{composition % 8\}/);
  assert.match(source, /className="scene-weave"/);
  assert.match(styles, /\.scene-layout-7 \.scene-weave/);
  assert.match(styles, /\.geo-lens\{/);
});

test("China opens into distinct regional scenes before the local map takes over", async () => {
  const source = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  const styles = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");
  for (const profile of ["china-western-plateau", "china-northern-rivers", "china-central-riverlands", "china-southern-mists", "china-eastern-coast"]) {
    assert.match(source, new RegExp(profile));
    assert.match(styles, new RegExp(`\\.place-${profile}`));
  }
  assert.match(source, /const MAP_MOUNT_DEPTH = \.74/);
  assert.match(source, /const MAP_HANDOFF_DEPTH = \.92/);
  assert.match(source, /className="cinematic-landscape"/);
  assert.match(source, /className="destination-moment"/);
  assert.match(styles, /\.cinematic-landscape\{/);
  assert.match(styles, /\.destination-moment\{/);
});
