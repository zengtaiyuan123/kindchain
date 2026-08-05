import { ensureGovernanceSchema, type SqlDatabase } from "../../../lib/governance";
import { fallbackPlace } from "../../../lib/place-fallback";

type NominatimAddress = Record<string, unknown>;

type PlaceResponse = {
  country: string;
  region: string;
  city: string;
  district: string;
  locality: string;
  source: "openstreetmap" | "builtin";
  precision: "coarse";
};

const CACHE_TTL_MS = 30 * 86_400_000; // a 0.1° cell's reverse geocode is stable

async function placeDatabase(): Promise<SqlDatabase | null> {
  try {
    const { env } = await import("cloudflare:workers");
    if (!env.DB) return null;
    const db = env.DB as unknown as SqlDatabase;
    await ensureGovernanceSchema(db);
    return db;
  } catch {
    return null;
  }
}

/** Named continent/ocean fallback — a failed geocoder must never blank the hierarchy. */
function builtinPlace(lat: number, lon: number): PlaceResponse {
  const broad = fallbackPlace(lat, lon);
  return {
    country: broad.country || "Earth",
    region: broad.region || "Regional area",
    city: broad.label,
    district: "Coarse district",
    locality: broad.locality,
    source: "builtin",
    precision: "coarse",
  };
}

let publicApiQueue: Promise<void> = Promise.resolve();
let lastPublicRequestAt = 0;

function compact(value: unknown) {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, 80) : "";
}

function coordinate(value: string | null, min: number, max: number) {
  const number = Number(value);
  if (!Number.isFinite(number)) return null;
  return Math.round(Math.max(min, Math.min(max, number)) * 10) / 10;
}

function first(address: NominatimAddress, keys: string[]) {
  for (const key of keys) {
    const value = compact(address[key]);
    if (value) return value;
  }
  return "";
}

async function waitForPublicApiTurn() {
  const previous = publicApiQueue;
  let release = () => {};
  publicApiQueue = new Promise<void>((resolve) => { release = resolve; });
  await previous;
  const delay = Math.max(0, 1050 - (Date.now() - lastPublicRequestAt));
  if (delay) await new Promise((resolve) => setTimeout(resolve, delay));
  lastPublicRequestAt = Date.now();
  return release;
}

function json(payload: unknown, status = 200) {
  return Response.json(payload, {
    status,
    headers: {
      "Cache-Control": status === 200 ? "public, max-age=86400, s-maxage=604800" : "no-store",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
    },
  });
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const lat = coordinate(url.searchParams.get("lat"), -90, 90);
  const lon = coordinate(url.searchParams.get("lon"), -180, 180);
  const language = /^[a-z]{2}(?:-[A-Z]{2})?$/.test(url.searchParams.get("lang") ?? "") ? String(url.searchParams.get("lang")) : "en";
  if (lat === null || lon === null) return json({ error: "invalid_coordinate" }, 400);

  const db = await placeDatabase();
  const cacheKey = `${lat}:${lon}:${language}`;
  if (db) {
    try {
      const cached = await db
        .prepare("SELECT payload, created_at FROM place_cache WHERE cell_id = ?")
        .bind(cacheKey)
        .first<{ payload: string; created_at: number }>();
      if (cached && Date.now() - cached.created_at < CACHE_TTL_MS) {
        return json(JSON.parse(cached.payload) as PlaceResponse);
      }
    } catch { /* cache is best-effort */ }
  }

  const release = await waitForPublicApiTurn();
  try {
    const endpoint = new URL("https://nominatim.openstreetmap.org/reverse");
    endpoint.searchParams.set("format", "jsonv2");
    endpoint.searchParams.set("lat", String(lat));
    endpoint.searchParams.set("lon", String(lon));
    endpoint.searchParams.set("zoom", "12");
    endpoint.searchParams.set("addressdetails", "1");
    endpoint.searchParams.set("accept-language", language);
    const response = await fetch(endpoint, {
      headers: {
        Accept: "application/json",
        "User-Agent": "KindChain-Living-Earth/0.1 (+https://kindchain.net)",
      },
    });
    if (!response.ok) return json(builtinPlace(lat, lon));
    const result = await response.json() as { address?: NominatimAddress };
    const address = result.address ?? {};
    const country = first(address, ["country"]);
    const region = first(address, ["state", "province", "region", "state_district"]);
    const city = first(address, ["city", "municipality", "town", "county"]);
    const district = first(address, ["city_district", "district", "borough", "county"]);
    const locality = first(address, ["suburb", "quarter", "neighbourhood", "locality", "village"]);
    const payload: PlaceResponse = {
      country: country || "Earth",
      region: region || city || country || "Regional area",
      city: city || district || region || "City area",
      district: district || city || "Coarse district",
      locality: locality || district || "Coarse community area",
      source: "openstreetmap",
      precision: "coarse",
    };
    if (db) {
      try {
        await db
          .prepare("INSERT OR REPLACE INTO place_cache (cell_id, payload, created_at) VALUES (?, ?, ?)")
          .bind(cacheKey, JSON.stringify(payload), Date.now())
          .run();
      } catch { /* cache is best-effort */ }
    }
    return json(payload);
  } catch {
    // A blocked or slow geocoder still answers with the built-in hierarchy.
    return json(builtinPlace(lat, lon));
  } finally {
    release();
  }
}
