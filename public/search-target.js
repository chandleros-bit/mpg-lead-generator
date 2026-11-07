// public/search-target.js — what the place box means, and the query it builds.
//
// The box takes a city, a ZIP, or a raw "lat,lng" pair. Coordinates are the
// tightest targeting the tool has: a city or ZIP resolves to the centroid of
// something large, while a pasted pair is the exact corner you intend to work.
// api/leads.js has always accepted `location=lat,lng` and short-circuits the
// geocoder for it — the dashboard simply stopped offering a way to send one.
//
// Browser-loaded from public/ (the static output dir) and unit-tested with
// node --test. No DOM here.

// Two decimal numbers separated by a comma, and both of them on Earth.
//
// Stricter than lib/geocode.js's version of this check, which only matches the
// shape. A mistyped "299691,-956972" has the shape, and sending it would centre
// a Places search on nowhere and come back empty — indistinguishable from a
// street with no businesses on it. Rejecting it here sends the value down the
// city path instead, where the server answers "Couldn't find that city".
//
// Whatever this accepts, lib/geocode.js must also accept, or api/leads.js would
// treat the pair as an address and hand it to the geocoder. A test asserts it.
const PAIR = /^\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*$/;

export function looksLikeCoords(s) {
  const m = PAIR.exec(String(s == null ? "" : s));
  if (!m) return false;
  const lat = Number(m[1]);
  const lng = Number(m[2]);
  return lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180;
}

// "  29.9691 , -95.6972  " → "29.9691,-95.6972". A Google Maps right-click
// copies the pair with a space in it, and the server splits on the comma and
// runs Number() over each half; padding survives that, but a clean pair keeps
// the URL readable and leaves nothing to reason about.
export function normalizeCoords(s) {
  const m = PAIR.exec(String(s == null ? "" : s));
  return m ? `${m[1]},${m[2]}` : String(s == null ? "" : s).trim();
}

// The query string for a search, as an array of already-encoded `key=value`
// parts. Coordinates and a city are mutually exclusive: api/leads.js checks
// `city` first and never looks at `location` when one is present, so sending
// both would silently ignore the precise half.
export function searchParams({ vertical, place, state, miles }) {
  const qs = ["vertical=" + encodeURIComponent(vertical)];
  const typed = String(place == null ? "" : place).trim();
  if (typed) {
    if (looksLikeCoords(typed)) {
      qs.push("location=" + encodeURIComponent(normalizeCoords(typed)));
    } else {
      qs.push("city=" + encodeURIComponent(typed));
      qs.push("state=" + encodeURIComponent(state == null ? "" : state));
    }
  }
  if (miles) qs.push("miles=" + encodeURIComponent(miles));
  return qs;
}
