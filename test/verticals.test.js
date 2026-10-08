// test/verticals.test.js
import test from "node:test";
import assert from "node:assert/strict";
import {
  VERTICALS, getVertical, verticalIds, listVerticals, validatePack, exclusionsFor,
  VERTICAL_SOFTWARE, FINANCING,
} from "../lib/verticals/index.js";
import { keywordHits, keywordPattern } from "../lib/verticals/match.js";
import { discoverCheckoutUrl, splitDetections, tierOf } from "../lib/processors.js";
import { placeMatchesVertical } from "../lib/fetcher.js";

test("every registered pack is valid", () => {
  for (const id of verticalIds()) {
    assert.deepEqual(validatePack(getVertical(id)), [], id);
  }
});

test("pack ids are unique and the legacy verticals are all still there", () => {
  const ids = verticalIds();
  assert.equal(new Set(ids).size, ids.length);
  for (const id of ["restaurant", "bar", "cafe", "retail", "salon", "spa", "auto", "professional", "auto_repair"]) {
    assert.ok(VERTICALS[id], id);
  }
});

test("listVerticals puts featured packs first and exposes only picker fields", () => {
  const list = listVerticals();
  assert.equal(list[0].id, "auto_repair");
  assert.ok(list[0].featured);
  const firstLegacy = list.findIndex((v) => !v.featured);
  assert.ok(list.slice(firstLegacy).every((v) => !v.featured), "featured block is contiguous");
  assert.deepEqual(Object.keys(list[0]).sort(), ["featured", "id", "label"]);
});

test("validatePack catches a text-only niche with nothing to verify results by", () => {
  const bad = { ...getVertical("auto_repair"), search: { place_types: [], text_queries: ["x"], name_keywords: [], reject_types: [], require_name_match: false } };
  assert.ok(validatePack(bad).some((e) => e.includes("name_keywords")));
});

test("exclusionsFor merges config chains with the selected packs' chains only", () => {
  const { brands } = exclusionsFor(["auto_repair"], { exclude_chains: ["Starbucks"] });
  assert.ok(brands.includes("Starbucks"));
  assert.ok(brands.includes("Jiffy Lube"));
  const salonOnly = exclusionsFor(["salon"], { exclude_chains: [] });
  assert.ok(!salonOnly.brands.includes("Jiffy Lube"));
});

test("keyword matching: whole word with plural, or prefix when starred", () => {
  assert.deepEqual(keywordHits(["bath"], "Cypress Bath Co"), ["bath"]);
  assert.deepEqual(keywordHits(["bath"], "bathe the dog"), []);
  assert.deepEqual(keywordHits(["remodel*"], "Elite Remodeling LLC"), ["remodel"]);
  assert.deepEqual(keywordHits(["euro*"], "Neuro Motors"), []);
  assert.ok(keywordPattern("a/c").test("Cool A/C Services"));
});

test("auto repair software still classifies as integrated software", () => {
  assert.equal(tierOf("Tekmetric"), "integrated_software");
  assert.ok(VERTICAL_SOFTWARE.Tekmetric.includes("tekmetric.com"));
});

test("splitDetections keeps financing out of the processor list", () => {
  const fin = Object.keys(FINANCING)[0];
  if (!fin) return; // no financing signatures registered yet
  const { processors, financing } = splitDetections(["Clover", fin]);
  assert.deepEqual(processors, ["Clover"]);
  assert.deepEqual(financing, [fin]);
});

test("discoverCheckoutUrl reads pack path keywords from the path only", () => {
  const html = `<a href="https://facebook.com/acme">fb</a><a href="/book-online">Book</a>`;
  assert.equal(discoverCheckoutUrl(html, "https://acme.com/"), null, "no pack keywords: old behavior");
  assert.equal(discoverCheckoutUrl(html, "https://acme.com/", ["book"]), "https://acme.com/book-online");
});

test("placeMatchesVertical keeps auto repair type-only", () => {
  assert.ok(placeMatchesVertical("car_repair", "auto_repair", "Anything"));
  assert.ok(!placeMatchesVertical(null, "auto_repair", "Joe's Auto Repair"));
});
