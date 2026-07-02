export const GEOCODE_URL = "https://maps.googleapis.com/maps/api/geocode/json";

// True when the string is already a "lat,lng" pair (so we can skip geocoding).
// "Cypress, TX" has a comma but non-numeric parts, so it returns false.
export function looksLikeCoords(s) {
  return /^-?\d+(\.\d+)?\s*,\s*-?\d+(\.\d+)?$/.test(String(s).trim());
}

// Returns "lat,lng" on success, or null when the address can't be resolved.
// Throws on HTTP/network failure so the caller can distinguish "not found"
// (400 to the user) from "upstream broke" (502).
export async function geocodeAddress(apiKey, query) {
  const url = `${GEOCODE_URL}?address=${encodeURIComponent(query)}&key=${apiKey}`;
  const resp = await fetch(url);
  if (!resp.ok) {
    const detail = await resp.text().catch(() => "");
    throw new Error(`Geocoding API error ${resp.status}${detail ? `: ${detail}` : ""}`);
  }
  const data = await resp.json();
  if (data.status !== "OK" || !data.results || !data.results.length) {
    return null;
  }
  const loc = data.results[0].geometry.location;
  return `${loc.lat},${loc.lng}`;
}
