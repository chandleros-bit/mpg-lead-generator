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
  // Auto repair is its own vertical, not part of the generic "auto" bucket.
  // A repair order runs several hundred dollars; a car wash runs ten. They do
  // not share a volume profile, a decision-maker, or a pitch.
  car_repair: "auto_repair",
  car_wash: "auto", auto_parts_store: "auto",
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
  auto_repair: ["car_repair"],
  auto: ["car_wash", "auto_parts_store"],
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
      primary_type: p.primaryType ?? null,
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

// ---------------------------------------------------------------------------
// Text Search
//
// Nearby Search only accepts Table A types, and Google has exactly one type for
// the whole repair trade: `car_repair`. That single type under-returns the shops
// worth the most — transmission specialists, European and diesel independents,
// collision shops — because Google ranks a generic "car repair" nearby query on
// prominence, and the highest-ticket independents are rarely the most prominent.
// Text Search reaches them by name for the work they do.
//
// Text Search is NOT type-constrained the way Nearby Search is, so every result
// is checked against the vertical's own type list before it is tagged in-ICP.
// Without that check a "brake shop" query tags a car dealership as a repair
// lead and the whole pitch lands wrong.
// ---------------------------------------------------------------------------

export const PLACES_TEXT_URL = "https://places.googleapis.com/v1/places:searchText";

// Specialty phrasings per vertical. Ordered roughly by ticket size — a
// transmission or diesel job dwarfs a lube change, and the plan sizes the
// dual-pricing prize off the ticket.
export const VERTICAL_TEXT_QUERIES = {
  auto_repair: [
    "transmission repair shop",
    "European auto repair",
    "diesel repair shop",
    "collision repair shop",
    "brake and suspension shop",
    "auto repair shop",
    "tire and lube shop",
  ],
};

export function textQueriesFor(vertical) {
  return VERTICAL_TEXT_QUERIES[vertical] ?? [];
}

// Does a Google result actually belong to the vertical it was searched under?
// Checks the raw primaryType against the vertical's Table A type list. Results
// with no primaryType at all are rejected rather than assumed in-ICP — an
// unverifiable result is not a qualified one.
export function placeMatchesVertical(primaryType, vertical) {
  if (!primaryType) return false;
  const allowed = VERTICAL_PLACE_TYPES[vertical];
  if (!allowed) return primaryType === vertical;
  return allowed.includes(primaryType);
}

// One searchText call. locationBias (not locationRestriction) takes a circle;
// searchText's locationRestriction only accepts a rectangle, so bias plus the
// vertical check above is how results are kept local and on-type.
export async function fetchTextSearch({ apiKey, textQuery, location, radiusMeters,
  includedType = null, maxResults = 20, retries = 3, backoffMs = 1000 }) {
  const [lat, lng] = location.split(",").map(Number);
  const body = {
    textQuery,
    maxResultCount: Math.min(maxResults, PLACES_MAX_RESULTS),
    locationBias: { circle: { center: { latitude: lat, longitude: lng }, radius: Number(radiusMeters) } },
  };
  if (includedType) body.includedType = includedType;
  const headers = {
    "Content-Type": "application/json",
    "X-Goog-Api-Key": apiKey,
    "X-Goog-FieldMask": FIELD_MASK,
  };
  for (let attempt = 0; attempt < retries; attempt++) {
    const resp = await fetch(PLACES_TEXT_URL, { method: "POST", headers, body: JSON.stringify(body) });
    if (resp.status === 429) {
      await sleep(2 ** attempt * backoffMs);
      continue;
    }
    if (!resp.ok) {
      const detail = await resp.text().catch(() => "");
      throw new Error(`Places Text Search error ${resp.status}${detail ? `: ${detail}` : ""}`);
    }
    return parsePlacesResponse(await resp.json());
  }
  throw new Error("Places Text Search rate limit: exhausted retries");
}

// Run every specialty query for one vertical, dropping off-type results. A
// single failing query is tolerated — a partial specialty sweep still beats the
// bare type search it supplements.
export async function fetchTextForVertical({ apiKey, vertical, location, radiusMeters, maxResults = 20 }) {
  const queries = textQueriesFor(vertical);
  if (!queries.length) return [];
  const primary = (VERTICAL_PLACE_TYPES[vertical] ?? [])[0] ?? null;
  const seen = new Set();
  const out = [];
  for (const textQuery of queries) {
    let found;
    try {
      found = await fetchTextSearch({
        apiKey, textQuery, location, radiusMeters, includedType: primary, maxResults,
      });
    } catch {
      continue;
    }
    for (const b of found) {
      if (seen.has(b.place_id)) continue;
      if (!placeMatchesVertical(b.primary_type, vertical)) continue;
      seen.add(b.place_id);
      b.category = vertical;
      b.source = "places_text";
      b.matched_query = textQuery;
      out.push(b);
    }
  }
  return out;
}

// Fan out one searchNearby call per vertical, dedupe by place_id, and tag each
// result's category to the vertical it was found under. Tagging guarantees the
// business is in the ICP set (which equals the vertical list), so pipeline's
// low_fit filter can't silently discard real matches. A single vertical's
// failure is tolerated; only an all-fail run throws.
export async function fetchAllVerticals({ apiKey, location, radiusMeters, verticals,
  maxResults = 20, textSearch = true }) {
  const seen = new Set();
  const out = [];
  let failures = 0;
  let lastErr = null;
  for (const vertical of verticals) {
    try {
      const found = await fetchNearby({
        apiKey, location, radiusMeters, includedTypes: [vertical], maxResults,
      });
      for (const b of found) {
        if (seen.has(b.place_id)) continue;
        seen.add(b.place_id);
        b.category = vertical;
        out.push(b);
      }
    } catch (e) {
      failures++;
      lastErr = e;
    }
  }
  if (verticals.length > 0 && failures === verticals.length) {
    throw new Error(`All vertical searches failed: ${lastErr && lastErr.message}`);
  }

  // Specialty sweep. Runs after the type search so a shop found both ways keeps
  // its Nearby record, and only supplements verticals that define queries — no
  // extra API spend for verticals that don't. Failures here are already
  // swallowed per-query inside fetchTextForVertical: the specialty sweep is an
  // addition to the type search, never a precondition for it.
  if (textSearch) {
    for (const vertical of verticals) {
      if (!textQueriesFor(vertical).length) continue;
      const extra = await fetchTextForVertical({
        apiKey, vertical, location, radiusMeters, maxResults,
      });
      for (const b of extra) {
        if (seen.has(b.place_id)) continue;
        seen.add(b.place_id);
        out.push(b);
      }
    }
  }

  return out;
}
