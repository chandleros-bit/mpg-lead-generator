// test/search-target.test.js — turning what is typed in the place box into
// query params. Browser-loaded from public/, unit-tested with node --test.
import test from "node:test";
import assert from "node:assert/strict";
import { looksLikeCoords, searchParams } from "../public/search-target.js";
import { looksLikeCoords as serverLooksLikeCoords } from "../lib/geocode.js";

// ---------- recognising a coordinate pair ----------

test("a decimal pair is coordinates, with or without a space", () => {
  assert.equal(looksLikeCoords("29.9691,-95.6972"), true);
  assert.equal(looksLikeCoords("29.9691, -95.6972"), true);
  assert.equal(looksLikeCoords("  29.9691 , -95.6972  "), true);
});

test("whole numbers and positive longitudes still count", () => {
  assert.equal(looksLikeCoords("30,-95"), true);
  assert.equal(looksLikeCoords("51.5,0.12"), true);
});

test("place names are not coordinates", () => {
  assert.equal(looksLikeCoords("Cypress, TX"), false);
  assert.equal(looksLikeCoords("77433"), false);
  assert.equal(looksLikeCoords(""), false);
  assert.equal(looksLikeCoords("Katy"), false);
});

// Out of range is a typo, not a place on Earth. Rejecting it here sends the
// value down the city path, where the server answers "Couldn't find that
// city" — a visible error, rather than a Places search centred on nowhere.
test("an out-of-range pair is rejected rather than searched", () => {
  assert.equal(looksLikeCoords("299691,-956972"), false);
  assert.equal(looksLikeCoords("91,0"), false);
  assert.equal(looksLikeCoords("0,181"), false);
  assert.equal(looksLikeCoords("-90,180"), true, "the limits themselves are valid");
});

// The client is deliberately stricter (it range-checks), but everything it
// accepts the server must also accept, or it would send a location param that
// api/leads.js then treats as an address and hands to the geocoder.
test("everything the client calls coordinates, the server does too", () => {
  for (const s of ["29.9691,-95.6972", "29.9691, -95.6972", "30,-95", "-90,180"]) {
    assert.equal(serverLooksLikeCoords(searchParamsPlace(s)), true, s);
  }
});

function searchParamsPlace(typed) {
  const qs = searchParams({ vertical: "auto_repair", place: typed, state: "TX", miles: "1" });
  const hit = qs.find((p) => p.startsWith("location="));
  return decodeURIComponent(hit.slice("location=".length));
}

// ---------- building the query ----------

test("a city goes out as city + state", () => {
  assert.deepEqual(
    searchParams({ vertical: "auto_repair", place: "Katy", state: "TX", miles: "9" }),
    ["vertical=auto_repair", "city=Katy", "state=TX", "miles=9"],
  );
});

test("coordinates go out as location, with no city or state", () => {
  const qs = searchParams({ vertical: "auto_repair", place: "29.9691, -95.6972", state: "TX", miles: "1" });
  assert.deepEqual(qs, ["vertical=auto_repair", "location=29.9691%2C-95.6972", "miles=1"]);
});

// The spaces a Google Maps right-click leaves behind are stripped, so the URL
// carries a clean pair and Number() on each half never sees padding.
test("the pasted pair is normalised before it is sent", () => {
  const qs = searchParams({ vertical: "cafe", place: "  30.1 , -95.2 ", state: "", miles: "" });
  assert.deepEqual(qs, ["vertical=cafe", "location=30.1%2C-95.2"]);
});

test("an empty place box searches the configured default", () => {
  assert.deepEqual(searchParams({ vertical: "bar", place: "", state: "TX", miles: "9" }),
    ["vertical=bar", "miles=9"]);
});

test("a place name is percent-encoded", () => {
  const qs = searchParams({ vertical: "spa", place: "O'Fallon", state: "MO", miles: "5" });
  assert.ok(qs.includes("city=O'Fallon") || qs.includes("city=O%27Fallon"), qs.join("&"));
});
