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
