export const GEOCODE_URL = "https://maps.googleapis.com/maps/api/geocode/json";

// True when the string is already a "lat,lng" pair (so we can skip geocoding).
// "Cypress, TX" has a comma but non-numeric parts, so it returns false.
export function looksLikeCoords(s) {
  return /^-?\d+(\.\d+)?\s*,\s*-?\d+(\.\d+)?$/.test(String(s).trim());
}

// Returns "lat,lng" on success, or null when the address can't be resolved.
// Throws on real failures (HTTP error, or an in-body error status like
// REQUEST_DENIED) so the caller can distinguish "not found" (400 to the user)
// from "upstream broke / misconfigured" (502). NOTE: the Geocoding API returns
// HTTP 200 even for REQUEST_DENIED / OVER_QUERY_LIMIT / INVALID_REQUEST — the
// real outcome is in data.status, so we must NOT treat every non-OK as "not found".
export async function geocodeAddress(apiKey, query) {
  const url = `${GEOCODE_URL}?address=${encodeURIComponent(query)}&key=${apiKey}`;
  const resp = await fetch(url);
  if (!resp.ok) {
    const detail = await resp.text().catch(() => "");
    throw new Error(`Geocoding API error ${resp.status}${detail ? `: ${detail}` : ""}`);
  }
  const data = await resp.json();
  const results = data.results || [];
  if (data.status === "OK" && results.length) {
    const loc = results[0].geometry.location;
    return `${loc.lat},${loc.lng}`;
  }
  // A valid request that simply matched nothing → null; caller shows a friendly 400.
  if (data.status === "ZERO_RESULTS" || data.status === "OK") {
    return null;
  }
  // Any other status (REQUEST_DENIED, OVER_QUERY_LIMIT, INVALID_REQUEST, …) is a real
  // failure — surface Google's status + message instead of masking it as "not found".
  const detail = data.error_message ? `: ${data.error_message}` : "";
  throw new Error(`Geocoding failed (${data.status || "UNKNOWN"})${detail}`);
}

// ---------------------------------------------------------------------------
// Markets
//
// A run targets one market: a city (or ZIP) and a state. Resolving it gives us
// the search center, and also the pieces the rest of the run keys off: the
// city name the copy speaks to, the state whose card rules apply, and the
// county that state-record sources like TABC filter on.
//
// This goes through Places Text Search, not the Geocoding API. The key already
// has Places enabled for the lead search itself; Geocoding is a separate API
// that has to be switched on in Google Cloud, and requiring it broke the first
// live run.
// ---------------------------------------------------------------------------

export const PLACES_TEXT_URL = "https://places.googleapis.com/v1/places:searchText";
export const MARKET_FIELD_MASK = "places.location,places.addressComponents";

function component(place, type, short = false) {
  const c = (place.addressComponents || []).find((x) => (x.types || []).includes(type));
  if (!c) return null;
  return short ? c.shortText : c.longText;
}

// null for "no such place"; throws for a broken request (bad key, API off) so
// the caller can tell "not found" (400) from "misconfigured" (502).
// Returns { location, city, state, county }.
export async function geocodeMarket(apiKey, city, state) {
  const query = [String(city || "").trim(), String(state || "").trim()].filter(Boolean).join(", ");
  const resp = await fetch(PLACES_TEXT_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": apiKey,
      "X-Goog-FieldMask": MARKET_FIELD_MASK,
    },
    body: JSON.stringify({ textQuery: query, regionCode: "US", maxResultCount: 1 }),
  });
  if (!resp.ok) {
    const detail = await resp.text().catch(() => "");
    throw new Error(`Market lookup failed (${resp.status})${detail ? `: ${detail}` : ""}`);
  }
  const data = await resp.json();
  const p = (data.places || [])[0];
  if (!p || !p.location) return null;
  const county = component(p, "administrative_area_level_2");
  return {
    location: `${p.location.latitude},${p.location.longitude}`,
    // A ZIP resolves to a postal code whose locality is the real city name,
    // which is what the copy should say. Fall back to what was typed.
    city: component(p, "locality") || component(p, "sublocality") || String(city || "").trim() || null,
    state: component(p, "administrative_area_level_1", true) || String(state || "").trim().toUpperCase() || null,
    county: county ? county.replace(/\s+County$/i, "") : null,
  };
}
