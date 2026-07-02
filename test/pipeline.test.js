import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { parsePlacesResponse } from "../lib/fetcher.js";
import { buildLeads, summarize } from "../lib/pipeline.js";
import { CFG } from "./helpers.js";

const require = createRequire(import.meta.url);
const DEMO_RAW = require("../public/demo_places.json");

test("buildLeads excludes low-fit and sorts by score desc", () => {
  const { rows } = buildLeads(CFG, parsePlacesResponse(DEMO_RAW));
  // DEMO_I is a laundromat (low-fit) named "Cypress Discount Vapes" → excluded
  assert.ok(rows.every((r) => r.name !== "Cypress Discount Vapes"));
  const scores = rows.map((r) => r.score);
  assert.deepEqual(scores, [...scores].sort((a, b) => b - a));
  assert.ok(rows.every((r) => r.campaign.email1_body));
});

test("buildLeads returns a chainsFiltered count (0 when no list)", () => {
  const { chainsFiltered } = buildLeads(CFG, parsePlacesResponse(DEMO_RAW));
  assert.equal(chainsFiltered, 0);
});

test("buildLeads drops businesses whose name matches a brand, and counts them", () => {
  const businesses = parsePlacesResponse(DEMO_RAW);
  // Rename the first demo business (an in-ICP barber shop) to a chain name.
  const withChain = businesses.map((b, i) => (i === 0 ? { ...b, name: "Starbucks Coffee" } : b));
  const cfg = { ...CFG, search: { ...CFG.search, exclude_chains: ["Starbucks"] } };
  const { rows, chainsFiltered } = buildLeads(cfg, withChain);
  assert.equal(chainsFiltered, 1);
  assert.ok(rows.every((r) => r.name !== "Starbucks Coffee"));
  assert.ok(rows.length > 0);
});

test("summarize counts add up", () => {
  const { rows } = buildLeads(CFG, parsePlacesResponse(DEMO_RAW));
  const s = summarize(rows);
  assert.equal(s.total, rows.length);
  assert.equal(s.displacement + s.greenfield, s.total);
});
