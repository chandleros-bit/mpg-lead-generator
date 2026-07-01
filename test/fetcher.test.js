import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import {
  parsePlacesResponse, dedupe, normalizeCategory, loadDemoBusinesses,
  fetchNearby, PRICE_LEVELS,
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
