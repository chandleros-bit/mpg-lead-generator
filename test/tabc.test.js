// test/tabc.test.js
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { parseTabcRows, fetchTabcNew } from "../lib/tabc.js";

const require = createRequire(import.meta.url);
const SAMPLE = require("./fixtures/tabc_sample.json");

test("parseTabcRows maps rows into greenfield-shaped businesses", () => {
  const out = parseTabcRows(SAMPLE);
  assert.equal(out.length, 2); // off-premise BQ + the no-name row are skipped
  const first = out[0];
  assert.equal(first.name, "Bayou Craft Taproom");
  assert.equal(first.category, "bar");
  assert.equal(first.source, "tabc");
  assert.equal(first.review_count, 0);
  assert.equal(first.website, null);
  assert.equal(first.licensed_on, "2026-06-15"); // ISO timestamp trimmed to date
  assert.ok(first.place_id.startsWith("tabc:"));
  assert.ok(first.address.includes("77433")); // ZIP+4 trimmed to 5 digits
});

test("parseTabcRows maps on-premise codes and drops off-premise retail", () => {
  const out = parseTabcRows(SAMPLE);
  assert.equal(out[0].category, "bar"); // MB — mixed beverage, on-premise
  assert.equal(out[1].category, "restaurant"); // BG — wine & malt retailer
  // BQ (off-premise convenience/grocery) is not ICP and must be excluded.
  assert.ok(!out.some((b) => b.name.includes("Shop n Go")));
});

test("parseTabcRows tolerates a non-array input", () => {
  assert.deepEqual(parseTabcRows(null), []);
  assert.deepEqual(parseTabcRows({ error: "bad" }), []);
});

test("fetchTabcNew returns [] with no counties", async () => {
  assert.deepEqual(await fetchTabcNew({ counties: [], sinceDays: 90, fetchImpl: async () => ({ ok: true, json: async () => [] }) }), []);
});

test("fetchTabcNew returns parsed rows on success", async () => {
  const fetchImpl = async () => ({ ok: true, json: async () => SAMPLE });
  const out = await fetchTabcNew({ counties: ["Harris"], sinceDays: 90, fetchImpl });
  assert.equal(out.length, 2);
});

test("fetchTabcNew swallows a fetch error and returns []", async () => {
  const fetchImpl = async () => { throw new Error("socrata down"); };
  assert.deepEqual(await fetchTabcNew({ counties: ["Harris"], sinceDays: 90, fetchImpl }), []);
});
