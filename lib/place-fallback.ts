/**
 * Built-in offline place hierarchy.
 *
 * Whenever Nominatim is unreachable, rate-limited or slow, the place API must
 * still answer with a readable "where am I" — the whitepaper's rule is that a
 * failed external service can never produce a blank world. This module gives
 * continent / ocean / broad-region names purely from coordinates.
 */

export type PlaceInfo = {
  country: string;
  region: string; // province / state
  city: string;
  district: string;
  locality: string; // coarse neighbourhood-scale label
  label: string; // best single display label
  source: "nominatim" | "fallback";
};

type NamedBox = {
  name: string;
  south: number;
  north: number;
  west: number;
  east: number;
};

const LAND_REGIONS: NamedBox[] = [
  { name: "East Asia", south: 18, north: 54, west: 95, east: 146 },
  { name: "Southeast Asia", south: -11, north: 18, west: 92, east: 141 },
  { name: "South Asia", south: 5, north: 36, west: 60, east: 92 },
  { name: "Central Asia", south: 36, north: 55, west: 46, east: 88 },
  { name: "West Asia", south: 12, north: 42, west: 26, east: 60 },
  { name: "Europe", south: 36, north: 71, west: -11, east: 40 },
  { name: "North Africa", south: 15, north: 37, west: -18, east: 35 },
  { name: "Sub-Saharan Africa", south: -35, north: 15, west: -18, east: 51 },
  { name: "North America", south: 15, north: 72, west: -168, east: -52 },
  { name: "Central America & Caribbean", south: 7, north: 23, west: -118, east: -59 },
  { name: "South America", south: -56, north: 13, west: -82, east: -34 },
  { name: "Australia & Oceania", south: -47, north: -10, west: 112, east: 180 },
  { name: "Arctic", south: 66, north: 90, west: -180, east: 180 },
  { name: "Antarctica", south: -90, north: -60, west: -180, east: 180 },
];

const OCEANS: NamedBox[] = [
  { name: "Arctic Ocean", south: 66, north: 90, west: -180, east: 180 },
  { name: "Southern Ocean", south: -90, north: -60, west: -180, east: 180 },
  { name: "North Atlantic", south: 0, north: 66, west: -70, east: -8 },
  { name: "South Atlantic", south: -60, north: 0, west: -60, east: 15 },
  { name: "Indian Ocean", south: -60, north: 25, west: 40, east: 110 },
  { name: "North Pacific", south: 0, north: 66, west: 140, east: -110 },
  { name: "South Pacific", south: -60, north: 0, west: 150, east: -75 },
];

function inBox(lat: number, lon: number, box: NamedBox): boolean {
  if (lat < box.south || lat > box.north) return false;
  if (box.west <= box.east) return lon >= box.west && lon <= box.east;
  return lon >= box.west || lon <= box.east; // dateline wrap
}

export function fallbackPlace(lat: number, lon: number): PlaceInfo {
  const land = LAND_REGIONS.find((box) => inBox(lat, lon, box));
  const ocean = OCEANS.find((box) => inBox(lat, lon, box));
  const broad = land?.name ?? ocean?.name ?? "Open Ocean";
  const grid = `${Math.abs(lat).toFixed(1)}°${lat >= 0 ? "N" : "S"} · ${Math.abs(lon).toFixed(1)}°${lon >= 0 ? "E" : "W"}`;
  return {
    country: land ? broad : "",
    region: broad,
    city: "",
    district: "",
    locality: grid,
    label: `${broad} · ${grid}`,
    source: "fallback",
  };
}

/** Normalize a raw Nominatim reverse-geocode response into PlaceInfo. */
export function normalizeNominatim(payload: unknown, lat: number, lon: number): PlaceInfo {
  const fallback = fallbackPlace(lat, lon);
  if (!payload || typeof payload !== "object") return fallback;
  const address = (payload as { address?: Record<string, string> }).address;
  if (!address) return fallback;
  const country = address.country ?? fallback.country;
  const region = address.state ?? address.province ?? address.region ?? address.county ?? "";
  const city = address.city ?? address.town ?? address.village ?? address.municipality ?? "";
  const district = address.city_district ?? address.district ?? address.borough ?? address.county ?? "";
  const locality = address.suburb ?? address.neighbourhood ?? address.quarter ?? address.hamlet ?? "";
  const parts = [country, region, city, district || locality].filter(Boolean);
  return {
    country,
    region,
    city,
    district,
    locality,
    label: parts.length > 0 ? parts.join(" · ") : fallback.label,
    source: "nominatim",
  };
}
