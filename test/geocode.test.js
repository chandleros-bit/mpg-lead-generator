import test from "node:test";
import assert from "node:assert/strict";
import { geocodeAddress, looksLikeCoords } from "../lib/geocode.js";

test("looksLikeCoords detects coordinate strings", () => {
  assert.equal(looksLikeCoords("29.9691,-95.6972"), true);
  assert.equal(looksLikeCoords("40, -70"), true);
  assert.equal(looksLikeCoords("77433"), false);
  assert.equal(looksLikeCoords("Cypress, TX"), false);
});

test("geocodeAddress returns lat,lng on success", async () => {
  const orig = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response(JSON.stringify({ status: "OK", results: [{ geometry: { location: { lat: 29.5, lng: -95.5 } } }] }), { status: 200 });
  try {
    assert.equal(await geocodeAddress("k", "77433"), "29.5,-95.5");
  } finally { globalThis.fetch = orig; }
});

test("geocodeAddress returns null on ZERO_RESULTS", async () => {
  const orig = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response(JSON.stringify({ status: "ZERO_RESULTS", results: [] }), { status: 200 });
  try {
    assert.equal(await geocodeAddress("k", "zzzzz"), null);
  } finally { globalThis.fetch = orig; }
});

test("geocodeAddress throws on HTTP error", async () => {
  const orig = globalThis.fetch;
  globalThis.fetch = async () => new Response("nope", { status: 500 });
  try {
    await assert.rejects(() => geocodeAddress("k", "x"), /Geocoding API error 500/);
  } finally { globalThis.fetch = orig; }
});

// The Geocoding API returns HTTP 200 with an in-body status like REQUEST_DENIED
// when the key isn't authorized for it. That must surface the real reason, not be
// masked as a "not found" null (which the caller would turn into a misleading 400).
test("geocodeAddress throws with the real status/message on REQUEST_DENIED", async () => {
  const orig = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response(JSON.stringify({
      status: "REQUEST_DENIED",
      error_message: "This API project is not authorized to use this API.",
    }), { status: 200 });
  try {
    await assert.rejects(
      () => geocodeAddress("k", "77433"),
      /REQUEST_DENIED.*not authorized to use this API/,
    );
  } finally { globalThis.fetch = orig; }
});

test("geocodeAddress still returns null when status is OK but results are empty", async () => {
  const orig = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response(JSON.stringify({ status: "OK", results: [] }), { status: 200 });
  try {
    assert.equal(await geocodeAddress("k", "nowhere"), null);
  } finally { globalThis.fetch = orig; }
});

test("geocodeMarket resolves through Places Text Search: center, city, state, county", async () => {
  const { geocodeMarket } = await import("../lib/geocode.js");
  const orig = globalThis.fetch;
  let call = null;
  globalThis.fetch = async (url, opts) => {
    call = { url: String(url), opts };
    return new Response(JSON.stringify({ places: [{
      location: { latitude: 29.78, longitude: -95.82 },
      addressComponents: [
        { longText: "77494", shortText: "77494", types: ["postal_code"] },
        { longText: "Katy", shortText: "Katy", types: ["locality", "political"] },
        { longText: "Fort Bend County", shortText: "Fort Bend County", types: ["administrative_area_level_2"] },
        { longText: "Texas", shortText: "TX", types: ["administrative_area_level_1"] },
      ],
    }] }), { status: 200 });
  };
  try {
    const m = await geocodeMarket("k", "77494", "TX");
    assert.deepEqual(m, { location: "29.78,-95.82", city: "Katy", state: "TX", county: "Fort Bend" });
    assert.ok(call.url.includes("places:searchText"), "uses Places, not the Geocoding API");
    assert.ok(!call.url.includes("maps/api/geocode"));
    assert.equal(JSON.parse(call.opts.body).textQuery, "77494, TX");
    assert.ok(call.opts.headers["X-Goog-FieldMask"].includes("addressComponents"));
  } finally { globalThis.fetch = orig; }
});

test("geocodeMarket returns null when nothing matches and throws on an API error", async () => {
  const { geocodeMarket } = await import("../lib/geocode.js");
  const orig = globalThis.fetch;
  try {
    globalThis.fetch = async () => new Response(JSON.stringify({}), { status: 200 });
    assert.equal(await geocodeMarket("k", "Nowhere", "TX"), null);
    globalThis.fetch = async () => new Response("PERMISSION_DENIED", { status: 403 });
    await assert.rejects(() => geocodeMarket("k", "Katy", "TX"), /403/);
  } finally { globalThis.fetch = orig; }
});
