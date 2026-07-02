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
