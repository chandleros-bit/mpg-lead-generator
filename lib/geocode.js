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
