import { business } from "./models.js";
// Static JSON import so esbuild inlines the demo data into the function bundle
// (createRequire + a relative path is NOT bundle-safe on Netlify).
import demoRaw from "../public/demo_places.json" with { type: "json" };

export const PLACES_URL = "https://places.googleapis.com/v1/places:searchNearby";

export const PRICE_LEVELS = {
  PRICE_LEVEL_FREE: 0, PRICE_LEVEL_INEXPENSIVE: 1,
  PRICE_LEVEL_MODERATE: 2, PRICE_LEVEL_EXPENSIVE: 3,
  PRICE_LEVEL_VERY_EXPENSIVE: 4,
};

export const FIELD_MASK = [
  "places.id", "places.displayName", "places.primaryType",
  "places.formattedAddress", "places.nationalPhoneNumber",
  "places.websiteUri", "places.rating", "places.userRatingCount",
  "places.priceLevel", "places.businessStatus", "places.reviews",
].join(",");

const TYPE_NORMALIZATION = {
  hair_salon: "salon", beauty_salon: "salon", nail_salon: "salon",
  barber_shop: "salon", spa: "spa", day_spa: "spa",
  restaurant: "restaurant", meal_takeaway: "restaurant",
  meal_delivery: "restaurant", pizza_restaurant: "restaurant",
  mexican_restaurant: "restaurant", cafe: "cafe", coffee_shop: "cafe",
  bar: "bar", pub: "bar", night_club: "bar",
  clothing_store: "retail", store: "retail", shoe_store: "retail",
  gift_shop: "retail", furniture_store: "retail", boutique: "retail",
  car_repair: "auto", car_wash: "auto", auto_parts_store: "auto",
  dentist: "professional", doctor: "professional", lawyer: "professional",
  accounting: "professional", veterinary_care: "professional",
};

export function normalizeCategory(primaryType) {
  return TYPE_NORMALIZATION[primaryType] ?? primaryType;
}

// Nearby Search (New) rejects maxResultCount > 20.
export const PLACES_MAX_RESULTS = 20;

// ICP vertical → valid Google Place types (Table A). Inverse of
// TYPE_NORMALIZATION, minus types the API rejects (store, day_spa, boutique).
// The API 400s on unknown types, so only verified Table A types belong here.
export const VERTICAL_PLACE_TYPES = {
  restaurant: ["restaurant", "meal_takeaway", "meal_delivery", "pizza_restaurant", "mexican_restaurant"],
  bar: ["bar", "pub", "night_club"],
  cafe: ["cafe", "coffee_shop"],
  retail: ["clothing_store", "shoe_store", "gift_shop", "furniture_store"],
  salon: ["hair_salon", "beauty_salon", "nail_salon", "barber_shop"],
  spa: ["spa"],
  auto: ["car_repair", "car_wash", "auto_parts_store"],
  professional: ["dentist", "doctor", "lawyer", "accounting", "veterinary_care"],
};

// Expand ICP verticals into the deduped set of Google Place types for
// includedTypes. Unknown values pass through so a raw Google type still works.
export function verticalsToPlaceTypes(verticals) {
  const out = [];
  for (const v of verticals) {
    for (const t of VERTICAL_PLACE_TYPES[v] ?? [v]) {
      if (!out.includes(t)) out.push(t);
    }
  }
  return out;
}

export function parsePlacesResponse(raw) {
  const out = [];
  for (const p of raw.places ?? []) {
    const reviews = (p.reviews ?? [])
      .filter((r) => r.text)
      .map((r) => (r.text && r.text.text) || "");
    out.push(business({
      place_id: p.id,
      name: (p.displayName && p.displayName.text) || "",
      category: normalizeCategory(p.primaryType ?? ""),
      address: p.formattedAddress ?? "",
      phone: p.nationalPhoneNumber ?? null,
      website: p.websiteUri ?? null,
      rating: p.rating ?? null,
      review_count: p.userRatingCount ?? 0,
      price_level: PRICE_LEVELS[p.priceLevel] ?? null,
      business_status: p.businessStatus ?? "",
      review_texts: reviews.filter((t) => t),
    }));
  }
  return out;
}

export function dedupe(businesses, seenIds) {
  return businesses.filter((b) => !seenIds.has(b.place_id));
}

export function loadDemoBusinesses() {
  return parsePlacesResponse(demoRaw);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// backoffMs is injectable so tests don't actually wait between retries.
export async function fetchNearby({ apiKey, location, radiusMeters, includedTypes,
  maxResults = 20, retries = 3, backoffMs = 1000 }) {
  const [lat, lng] = location.split(",").map(Number);
  const body = {
    includedTypes: verticalsToPlaceTypes(includedTypes),
    maxResultCount: Math.min(maxResults, PLACES_MAX_RESULTS),
    locationRestriction: { circle: { center: { latitude: lat, longitude: lng }, radius: Number(radiusMeters) } },
  };
  const headers = {
    "Content-Type": "application/json",
    "X-Goog-Api-Key": apiKey,
    "X-Goog-FieldMask": FIELD_MASK,
  };
  for (let attempt = 0; attempt < retries; attempt++) {
    const resp = await fetch(PLACES_URL, { method: "POST", headers, body: JSON.stringify(body) });
    if (resp.status === 429) {
      await sleep(2 ** attempt * backoffMs);
      continue;
    }
    if (!resp.ok) {
      const detail = await resp.text().catch(() => "");
      throw new Error(`Places API error ${resp.status}${detail ? `: ${detail}` : ""}`);
    }
    return parsePlacesResponse(await resp.json());
  }
  throw new Error("Places API rate limit: exhausted retries");
}
