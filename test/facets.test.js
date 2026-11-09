import test from "node:test";
import assert from "node:assert/strict";
import {
  FACETS, applyFacets, facetCounts, optionsFor, setFacet, toggleValue,
  activeChips, clearChip, countActive, isSet, sanitize,
} from "../public/facets.js";

const NOW = Date.UTC(2026, 10, 9, 15, 0);
const daysAgo = (n) => new Date(NOW - n * 86400000).toISOString();

let nextId = 1;
function lead(o = {}) {
  return {
    id: o.id ?? nextId++, name: "Shop", track: "displacement", bucket: "warm", score: 50,
    status: "to_call", last_outcome: null, last_touch_at: null, confidence: "medium",
    processor: [], financing: [], phone: "(281) 555-0100", website: "https://x.co",
    market_city: "Houston", source: "places", ...o,
  };
}
const ids = (rows) => rows.map((r) => r.id);

test("no facets set changes nothing", () => {
  const rows = [lead({ id: 1 }), lead({ id: 2 })];
  assert.equal(applyFacets(rows, {}, NOW), rows, "the same array comes back untouched");
  assert.deepEqual(ids(applyFacets(rows, { track: [] }, NOW)), [1, 2]);
  assert.deepEqual(ids(applyFacets(rows, { processor: false }, NOW)), [1, 2]);
  assert.deepEqual(ids(applyFacets(rows, { score: [0, 100] }, NOW)), [1, 2]);
});

test("each facet filters on its own field", () => {
  const rows = [
    lead({ id: 1, track: "greenfield" }),
    lead({ id: 2, processor: ["Clover"] }),
    lead({ id: 3, financing: ["Wisetack"] }),
    lead({ id: 4, confidence: "high" }),
    lead({ id: 5, status: "worked", last_outcome: "talked" }),
    lead({ id: 6, phone: "" }),
    lead({ id: 7, website: "" }),
    lead({ id: 8, score: 90 }),
    lead({ id: 9, market_city: "Katy" }),
    lead({ id: 10, source: "tabc" }),
    lead({ id: 11, last_touch_at: daysAgo(20), last_outcome: "no_answer" }),
  ];
  const only = (f) => ids(applyFacets(rows, f, NOW));
  assert.deepEqual(only({ track: ["greenfield"] }), [1]);
  assert.deepEqual(only({ processor: true }), [2]);
  assert.deepEqual(only({ financing: true }), [3]);
  assert.deepEqual(only({ confidence: ["high"] }), [4]);
  assert.deepEqual(only({ no_website: true }), [7]);
  assert.deepEqual(only({ score: [80, 100] }), [8]);
  assert.deepEqual(only({ city: ["Katy"] }), [9]);
  assert.deepEqual(only({ source: ["tabc"] }), [10]);
  assert.deepEqual(only({ stale_days: 14 }), [11]);
  assert.ok(!only({ has_phone: true }).includes(6), "the one with no phone drops out");
  assert.ok(!only({ never_called: true }).includes(5), "a worked lead is not never-called");
  assert.ok(!only({ never_called: true }).includes(11), "nor is one with an outcome logged");
});

test("a lead never touched at all is not stale", () => {
  const rows = [lead({ id: 1, last_touch_at: null }), lead({ id: 2, last_touch_at: daysAgo(30) })];
  assert.deepEqual(ids(applyFacets(rows, { stale_days: 7 }, NOW)), [2]);
});

test("values inside one facet are ORed, facets are ANDed", () => {
  const rows = [
    lead({ id: 1, track: "displacement", confidence: "high" }),
    lead({ id: 2, track: "greenfield", confidence: "high" }),
    lead({ id: 3, track: "greenfield", confidence: "low" }),
  ];
  assert.deepEqual(ids(applyFacets(rows, { track: ["displacement", "greenfield"] }, NOW)), [1, 2, 3]);
  assert.deepEqual(ids(applyFacets(rows, { track: ["greenfield"], confidence: ["high"] }, NOW)), [2]);
});

test("a stacked set narrows the way the chips read", () => {
  const rows = [
    lead({ id: 1, track: "displacement", score: 80, processor: ["Square"], website: "" }),
    lead({ id: 2, track: "displacement", score: 80, processor: ["Square"] }),       // has a site
    lead({ id: 3, track: "greenfield", score: 80, processor: ["Square"], website: "" }),
    lead({ id: 4, track: "displacement", score: 30, processor: ["Square"], website: "" }),
  ];
  const f = { track: ["displacement"], processor: true, no_website: true, score: [70, 100] };
  assert.deepEqual(ids(applyFacets(rows, f, NOW)), [1]);
});

test("counts are computed with their own facet relaxed", () => {
  const rows = [
    lead({ id: 1, track: "displacement", confidence: "high" }),
    lead({ id: 2, track: "greenfield", confidence: "high" }),
    lead({ id: 3, track: "greenfield", confidence: "low" }),
  ];
  // Track is already narrowed to displacement; its own counts ignore that...
  const counts = facetCounts(rows, { track: ["displacement"] }, "track", NOW);
  assert.deepEqual(counts, { displacement: 1, greenfield: 2 });
  // ...while another facet's counts respect it.
  assert.deepEqual(facetCounts(rows, { track: ["displacement"] }, "confidence", NOW),
    { high: 1, medium: 0, low: 0 });
});

test("toggle counts report how many would survive turning it on", () => {
  const rows = [lead({ id: 1, processor: ["Clover"] }), lead({ id: 2 })];
  assert.deepEqual(facetCounts(rows, {}, "processor", NOW), { true: 1 });
});

test("enum options come from the rows when they are not fixed", () => {
  const rows = [lead({ market_city: "Katy" }), lead({ market_city: "Houston" }), lead({ market_city: "Katy" })];
  assert.deepEqual(optionsFor("city", rows), [["Houston", "Houston"], ["Katy", "Katy"]]);
  assert.deepEqual(optionsFor("track", rows), [["displacement", "Displacement"], ["greenfield", "Greenfield"]]);
});

test("turning a facet off deletes it rather than leaving it empty", () => {
  let f = toggleValue({}, "track", "greenfield");
  assert.deepEqual(f, { track: ["greenfield"] });
  f = toggleValue(f, "track", "greenfield");
  assert.deepEqual(f, {}, "an empty array would match nothing and blank the list");
  f = toggleValue({}, "processor", true);
  assert.deepEqual(f, { processor: true });
  assert.deepEqual(toggleValue(f, "processor", true), {});
});

test("a single-value facet replaces rather than accumulates", () => {
  let f = toggleValue({}, "stale_days", 7);
  assert.deepEqual(f, { stale_days: 7 });
  f = toggleValue(f, "stale_days", 30);
  assert.deepEqual(f, { stale_days: 30 });
  assert.deepEqual(toggleValue(f, "stale_days", 30), {}, "picking it again clears it");
});

test("a full-width score range does not count as set", () => {
  assert.equal(isSet("score", [0, 100]), false);
  assert.equal(isSet("score", [60, 100]), true);
  assert.equal(isSet("score", [0, 80]), true);
  assert.equal(countActive({ score: [0, 100], track: ["greenfield"] }), 1);
});

test("chips name each active value and come off one at a time", () => {
  const rows = [lead({ market_city: "Katy" })];
  const f = { track: ["displacement", "greenfield"], processor: true, score: [60, 100], stale_days: 14 };
  const chips = activeChips(f, rows);
  assert.deepEqual(chips.map((c) => c.label),
    ["Displacement", "Greenfield", "Processor found", "Not touched in 14 days", "Score 60–100"]);

  const after = clearChip(f, "track", "displacement");
  assert.deepEqual(after.track, ["greenfield"], "one value off, the other stays");
  assert.equal(clearChip(f, "processor", true).processor, undefined);
  assert.equal(clearChip(f, "score", null).score, undefined);
  assert.equal(clearChip(f, "stale_days", 14).stale_days, undefined);
});

test("setFacet refuses a value that is not actually a filter", () => {
  assert.deepEqual(setFacet({}, "track", []), {});
  assert.deepEqual(setFacet({ track: ["greenfield"] }, "track", []), {});
  assert.deepEqual(setFacet({}, "nonsense", true), {}, "an unknown facet is dropped");
});

test("a stored view loses only the facets this build no longer has", () => {
  assert.deepEqual(
    sanitize({ track: ["greenfield"], distance_miles: 5, processor: false }),
    { track: ["greenfield"] });
});

test("every facet declares what the panel needs to draw it", () => {
  for (const f of FACETS) {
    assert.match(f.id, /^[a-z_]+$/);
    assert.match(f.label, /\S/);
    assert.ok(["enum", "toggle", "range"].includes(f.kind), `${f.id} has a drawable kind`);
    assert.equal(typeof f.test, "function");
    if (f.kind === "enum") assert.ok(f.options || f.from, `${f.id} can list its options`);
    if (f.kind === "range") assert.ok(Number.isFinite(f.min) && Number.isFinite(f.max));
  }
});
