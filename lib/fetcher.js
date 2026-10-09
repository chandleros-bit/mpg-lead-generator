import { business } from "./models.js";
import { VERTICALS, getVertical } from "./verticals/index.js";
import { anyKeyword } from "./verticals/match.js";
// Static JSON import so esbuild inlines the demo data into the function bundle
// (createRequire + a relative path is NOT bundle-safe in a serverless bundle).
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
  // Opening hours, for the desk's "open now". Same billing tier as reviews,
  // which this mask already asks for, so it adds no cost.
  "places.regularOpeningHours", "places.utcOffsetMinutes",
].join(",");

// Keep only what "open now" needs: the weekly periods and the offset to the
// business's local time.
export function parseHours(p) {
  const periods = p.regularOpeningHours && p.regularOpeningHours.periods;
  if (!Array.isArray(periods) || !periods.length) return null;
  return {
    periods: periods.map((x) => ({
      open: x.open ? { day: x.open.day, hour: x.open.hour ?? 0, minute: x.open.minute ?? 0 } : null,
      close: x.close ? { day: x.close.day, hour: x.close.hour ?? 0, minute: x.close.minute ?? 0 } : null,
    })),
    utc_offset: typeof p.utcOffsetMinutes === "number" ? p.utcOffsetMinutes : null,
  };
}

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

// ICP vertical → valid Google Place types (Table A), read from the vertical
// packs in lib/verticals/. The API 400s on unknown types, so only verified
// Table A types belong in a pack's place_types. A text-search-only niche (HVAC,
// pest control, remodeling: Google has no type for them) maps to [].
export const VERTICAL_PLACE_TYPES = Object.freeze(Object.fromEntries(
  Object.values(VERTICALS).map((p) => [p.id, p.search.place_types])
));

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
      hours: parseHours(p),
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

// Specialty phrasings per vertical, from the packs. Ordered roughly by ticket
// size, because the plan sizes the dual-pricing prize off the ticket.
export const VERTICAL_TEXT_QUERIES = Object.freeze(Object.fromEntries(
  Object.values(VERTICALS)
    .filter((p) => p.search.text_queries.length)
    .map((p) => [p.id, p.search.text_queries])
));

export function textQueriesFor(vertical) {
  return VERTICAL_TEXT_QUERIES[vertical] ?? [];
}

// Does a Google result actually belong to the vertical it was searched under?
//
//   1. A primaryType on the pack's reject list disqualifies it outright.
//   2. A pack that requires a name match (med spa: Google files them under spa,
//      beauty salon, medical clinic, anything) keeps only named results.
//   3. Otherwise a Table A type match or a name keyword is enough.
//
// Auto repair has no name keywords, so it stays type-only and a result with no
// primaryType is rejected rather than assumed in-ICP. A text-only niche has no
// type to match and leans entirely on its name keywords.
export function placeMatchesVertical(primaryType, vertical, name = "") {
  const pack = getVertical(vertical);
  if (!pack) return !!primaryType && primaryType === vertical;
  const s = pack.search;
  if (primaryType && s.reject_types.includes(primaryType)) return false;
  const named = anyKeyword(s.name_keywords, name);
  if (s.require_name_match) return named;
  const typed = !!primaryType && s.place_types.includes(primaryType);
  return typed || named;
}

// Text Search can narrow to one Table A type. Only worth doing when that type
// is how the pack verifies results; a name-matched pack would lose the very
// listings Google files under some other type.
function includedTypeFor(pack) {
  if (!pack || pack.search.require_name_match) return null;
  return pack.search.place_types[0] ?? null;
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
//
// `strict` is for text-only niches, where this sweep is the whole search: if
// every query failed, that is a broken search (bad key, quota), not an empty
// market, and it throws so the dashboard says so instead of showing zero leads.
export async function fetchTextForVertical({ apiKey, vertical, location, radiusMeters,
  maxResults = 20, strict = false }) {
  const queries = textQueriesFor(vertical);
  if (!queries.length) return [];
  const primary = includedTypeFor(getVertical(vertical));
  const seen = new Set();
  const out = [];
  let failed = 0;
  let lastErr = null;
  for (const textQuery of queries) {
    let found;
    try {
      found = await fetchTextSearch({
        apiKey, textQuery, location, radiusMeters, includedType: primary, maxResults,
      });
    } catch (e) {
      failed++;
      lastErr = e;
      continue;
    }
    for (const b of found) {
      if (seen.has(b.place_id)) continue;
      if (!placeMatchesVertical(b.primary_type, vertical, b.name)) continue;
      seen.add(b.place_id);
      b.category = vertical;
      b.source = "places_text";
      b.matched_query = textQuery;
      out.push(b);
    }
  }
  if (strict && failed === queries.length) {
    throw new Error(`All ${vertical} searches failed: ${lastErr && lastErr.message}`);
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
  let attempted = 0;
  let lastErr = null;
  for (const vertical of verticals) {
    const pack = getVertical(vertical);
    // No Google type for this niche: it is found by Text Search alone below.
    if (pack && !pack.search.place_types.length) continue;
    attempted++;
    try {
      const found = await fetchNearby({
        apiKey, location, radiusMeters, includedTypes: [vertical], maxResults,
      });
      for (const b of found) {
        if (seen.has(b.place_id)) continue;
        if (pack && pack.search.require_name_match &&
            !placeMatchesVertical(b.primary_type, vertical, b.name)) continue;
        seen.add(b.place_id);
        b.category = vertical;
        out.push(b);
      }
    } catch (e) {
      failures++;
      lastErr = e;
    }
  }
  if (attempted > 0 && failures === attempted) {
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
      const pack = getVertical(vertical);
      const textOnly = !!pack && !pack.search.place_types.length;
      let extra;
      try {
        extra = await fetchTextForVertical({
          apiKey, vertical, location, radiusMeters, maxResults, strict: textOnly,
        });
      } catch (e) {
        // Only a text-only niche throws here. If it was the only search in the
        // run, the run failed.
        if (attempted === 0 && verticals.length === 1) throw e;
        continue;
      }
      for (const b of extra) {
        if (seen.has(b.place_id)) continue;
        seen.add(b.place_id);
        out.push(b);
      }
    }
  }

  return out;
}
