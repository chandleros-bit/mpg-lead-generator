// test/tabc.test.js
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { parseTabcRows, fetchTabcNew } from "../lib/tabc.js";

const require = createRequire(import.meta.url);
const SAMPLE = require("./fixtures/tabc_sample.json");

test("parseTabcRows maps rows into greenfield-shaped businesses", () => {
  const out = parseTabcRows(SAMPLE);
  assert.equal(out.length, 2); // the third row has no name → skipped
  const first = out[0];
  assert.equal(first.name, "Bayou Craft Taproom");
  assert.equal(first.category, "bar");
  assert.equal(first.source, "tabc");
  assert.equal(first.review_count, 0);
  assert.equal(first.website, null);
  assert.equal(first.licensed_on, "2026-06-15");
  assert.ok(first.place_id.startsWith("tabc:"));
  assert.ok(first.address.includes("77433"));
});

test("parseTabcRows categorizes wine/beer as bar and others as restaurant", () => {
  const out = parseTabcRows(SAMPLE);
  assert.equal(out[1].category, "bar");
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
