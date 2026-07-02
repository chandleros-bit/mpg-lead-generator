import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import {
  parsePlacesResponse, dedupe, normalizeCategory, loadDemoBusinesses,
  fetchNearby, PRICE_LEVELS, verticalsToPlaceTypes,
} from "../lib/fetcher.js";

const require = createRequire(import.meta.url);
const DEMO_RAW = require("../public/demo_places.json");

test("parse and normalize demo response", () => {
  const businesses = parsePlacesResponse(DEMO_RAW);
  assert.equal(businesses.length, 10);
  const barber = businesses.find((b) => b.place_id === "DEMO_A");
  assert.equal(barber.category, "salon"); // barber_shop → salon
  assert.equal(barber.price_level, PRICE_LEVELS.PRICE_LEVEL_MODERATE);
  assert.ok(barber.review_texts.some((t) => t.toLowerCase().includes("cash only")));
});

test("normalize category passthrough", () => {
  assert.equal(normalizeCategory("restaurant"), "restaurant");
  assert.equal(normalizeCategory("unknown_type"), "unknown_type");
});

test("dedupe removes seen ids", () => {
  const businesses = parsePlacesResponse(DEMO_RAW);
  const fresh = dedupe(businesses, new Set(["DEMO_A"]));
  assert.ok(fresh.every((b) => b.place_id !== "DEMO_A"));
});

test("loadDemoBusinesses returns parsed businesses", () => {
  const businesses = loadDemoBusinesses();
  assert.equal(businesses.length, 10);
});

test("fetchNearby posts to Places and parses response (stubbed fetch)", async () => {
  const orig = globalThis.fetch;
  let sawUrl, sawHeaders;
  globalThis.fetch = async (url, opts) => {
    sawUrl = url;
    sawHeaders = opts.headers;
    return new Response(JSON.stringify(DEMO_RAW), { status: 200 });
  };
  try {
    const businesses = await fetchNearby({
      apiKey: "k", location: "29.9,-95.6", radiusMeters: 15000,
      includedTypes: ["restaurant"], maxResults: 10,
    });
    assert.equal(businesses.length, 10);
    assert.equal(sawUrl, "https://places.googleapis.com/v1/places:searchNearby");
    assert.equal(sawHeaders["X-Goog-Api-Key"], "k");
  } finally {
    globalThis.fetch = orig;
  }
});

test("verticalsToPlaceTypes expands ICP verticals to valid Google types", () => {
  const types = verticalsToPlaceTypes(["salon", "restaurant"]);
  assert.ok(types.includes("hair_salon"));
  assert.ok(types.includes("barber_shop"));
  assert.ok(types.includes("restaurant"));
  assert.ok(!types.includes("salon")); // ICP token must not leak through
  // never emit the types Google's API rejects
  assert.ok(!types.includes("store") && !types.includes("day_spa") && !types.includes("boutique"));
});

test("verticalsToPlaceTypes passes through unknown/raw types", () => {
  assert.deepEqual(verticalsToPlaceTypes(["some_raw_type"]), ["some_raw_type"]);
});

test("fetchNearby clamps maxResultCount to 20 and expands includedTypes", async () => {
  const orig = globalThis.fetch;
  let sentBody;
  globalThis.fetch = async (url, opts) => {
    sentBody = JSON.parse(opts.body);
    return new Response(JSON.stringify({ places: [] }), { status: 200 });
  };
  try {
    await fetchNearby({ apiKey: "k", location: "29.9,-95.6", radiusMeters: 15000, includedTypes: ["salon"], maxResults: 60 });
    assert.equal(sentBody.maxResultCount, 20);
    assert.ok(sentBody.includedTypes.includes("hair_salon"));
    assert.ok(!sentBody.includedTypes.includes("salon"));
  } finally {
    globalThis.fetch = orig;
  }
});

test("fetchNearby includes the API error body in the thrown error", async () => {
  const orig = globalThis.fetch;
  globalThis.fetch = async () => new Response("maxResultCount must be <= 20", { status: 400 });
  try {
    await assert.rejects(
      () => fetchNearby({ apiKey: "k", location: "1,2", radiusMeters: 1, includedTypes: ["restaurant"] }),
      /Places API error 400: maxResultCount/,
    );
  } finally {
    globalThis.fetch = orig;
  }
});

test("fetchNearby throws after exhausting 429 retries", async () => {
  const orig = globalThis.fetch;
  globalThis.fetch = async () => new Response("", { status: 429 });
  try {
    await assert.rejects(
      () => fetchNearby({ apiKey: "k", location: "1,2", radiusMeters: 1, includedTypes: ["restaurant"], retries: 2, backoffMs: 0 }),
      /rate limit/i,
    );
  } finally {
    globalThis.fetch = orig;
  }
});
