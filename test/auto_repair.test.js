// test/auto_repair.test.js
//
// The auto repair vertical, end to end: discovery (type + specialty Text
// Search), the shop-management fingerprint, the high-ticket proxies, and the
// three compliance rules the outreach copy has to hold.
import test from "node:test";
import assert from "node:assert/strict";
import {
  normalizeCategory, VERTICAL_PLACE_TYPES, verticalsToPlaceTypes,
  textQueriesFor, placeMatchesVertical, fetchTextSearch, fetchTextForVertical,
  fetchAllVerticals, PLACES_TEXT_URL,
} from "../lib/fetcher.js";
import {
  detectProcessors, tierOf, isShopManagement, SHOP_MANAGEMENT,
} from "../lib/processors.js";
import {
  processorPoints, processorChip, collectSignals, computeConfidence,
  specialtyHits, laborRateMentioned, highTicketPoints, painHits,
  VERTICAL_VOLUME, LABOR_RATE_FLOOR, scoreBusiness,
} from "../lib/scoring.js";
import { generateCampaign } from "../lib/campaigns.js";
import { scoredLead } from "../lib/models.js";
import { ICP, WEIGHTS, PERSONAL, makeBusiness } from "./helpers.js";

// ---------- 1. the vertical is its own thing ----------

test("car_repair normalizes to auto_repair, not the generic auto bucket", () => {
  assert.equal(normalizeCategory("car_repair"), "auto_repair");
  assert.equal(normalizeCategory("car_wash"), "auto");
  assert.equal(normalizeCategory("auto_parts_store"), "auto");
});

test("auto_repair expands to car_repair only", () => {
  assert.deepEqual(VERTICAL_PLACE_TYPES.auto_repair, ["car_repair"]);
  assert.deepEqual(verticalsToPlaceTypes(["auto_repair"]), ["car_repair"]);
  // A car wash and a repair shop must never be searched as the same vertical.
  assert.ok(!verticalsToPlaceTypes(["auto_repair"]).includes("car_wash"));
});

test("auto repair carries a repair-order-sized volume weight", () => {
  assert.ok(VERTICAL_VOLUME.auto_repair > VERTICAL_VOLUME.auto);
  assert.ok(VERTICAL_VOLUME.auto_repair > VERTICAL_VOLUME.retail);
});

// ---------- 2. specialty Text Search ----------

test("the specialty queries reach the high-ticket work the bare type misses", () => {
  const q = textQueriesFor("auto_repair").join(" ").toLowerCase();
  for (const term of ["transmission", "european", "diesel", "collision", "brake", "tire"]) {
    assert.ok(q.includes(term), `expected a ${term} query`);
  }
  assert.deepEqual(textQueriesFor("salon"), []); // opt-in only
});

test("placeMatchesVertical rejects an off-type Text Search result", () => {
  assert.ok(placeMatchesVertical("car_repair", "auto_repair"));
  // A "brake shop" query happily returns dealerships and parts stores.
  assert.ok(!placeMatchesVertical("car_dealer", "auto_repair"));
  assert.ok(!placeMatchesVertical("auto_parts_store", "auto_repair"));
  // No type at all is unverifiable, so it is not in-ICP.
  assert.ok(!placeMatchesVertical(null, "auto_repair"));
});

test("fetchTextSearch posts a locationBias circle to searchText", async () => {
  const orig = globalThis.fetch;
  let sawUrl, sentBody;
  globalThis.fetch = async (url, opts) => {
    sawUrl = String(url);
    sentBody = JSON.parse(opts.body);
    return new Response(JSON.stringify({ places: [] }), { status: 200 });
  };
  try {
    await fetchTextSearch({
      apiKey: "k", textQuery: "transmission repair shop", location: "29.9,-95.6",
      radiusMeters: 15000, includedType: "car_repair", maxResults: 60,
    });
    assert.equal(sawUrl, PLACES_TEXT_URL);
    assert.equal(sentBody.textQuery, "transmission repair shop");
    assert.equal(sentBody.includedType, "car_repair");
    // searchText's locationRestriction only takes a rectangle; a circle has to
    // ride on locationBias or the API 400s.
    assert.equal(sentBody.locationBias.circle.center.latitude, 29.9);
    assert.equal(sentBody.locationBias.circle.radius, 15000);
    assert.equal(sentBody.maxResultCount, 20); // clamped
    assert.equal(sentBody.locationRestriction, undefined);
  } finally { globalThis.fetch = orig; }
});

test("fetchTextForVertical keeps repair shops and drops dealerships", async () => {
  const orig = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({
    places: [
      { id: "SHOP", displayName: { text: "Cypress Transmission" }, primaryType: "car_repair", formattedAddress: "1 St" },
      { id: "DEALER", displayName: { text: "Big Ford" }, primaryType: "car_dealer", formattedAddress: "2 St" },
    ],
  }), { status: 200 });
  try {
    const out = await fetchTextForVertical({
      apiKey: "k", vertical: "auto_repair", location: "1,2", radiusMeters: 1000,
    });
    assert.equal(out.length, 1);
    assert.equal(out[0].place_id, "SHOP");
    assert.equal(out[0].category, "auto_repair");
    assert.equal(out[0].source, "places_text");
    // The phrase that found it is worth keeping: a transmission hit and a lube
    // hit are not the same lead at the same score.
    assert.equal(out[0].matched_query, textQueriesFor("auto_repair")[0]);
  } finally { globalThis.fetch = orig; }
});

test("a failing specialty query does not sink the rest of the sweep", async () => {
  const orig = globalThis.fetch;
  let n = 0;
  globalThis.fetch = async () => {
    n++;
    if (n === 1) throw new Error("boom");
    return new Response(JSON.stringify({
      places: [{ id: `P${n}`, displayName: { text: "Shop" }, primaryType: "car_repair", formattedAddress: "1 St" }],
    }), { status: 200 });
  };
  try {
    const out = await fetchTextForVertical({
      apiKey: "k", vertical: "auto_repair", location: "1,2", radiusMeters: 1000,
    });
    assert.ok(out.length > 0);
  } finally { globalThis.fetch = orig; }
});

test("fetchAllVerticals runs the sweep for auto repair and can be turned off", async () => {
  const orig = globalThis.fetch;
  let textCalls = 0;
  globalThis.fetch = async (url) => {
    if (String(url).includes("places:searchText")) textCalls++;
    return new Response(JSON.stringify({ places: [] }), { status: 200 });
  };
  try {
    await fetchAllVerticals({ apiKey: "k", location: "1,2", radiusMeters: 1000, verticals: ["auto_repair"] });
    assert.equal(textCalls, textQueriesFor("auto_repair").length);

    textCalls = 0;
    await fetchAllVerticals({ apiKey: "k", location: "1,2", radiusMeters: 1000, verticals: ["auto_repair"], textSearch: false });
    assert.equal(textCalls, 0);

    // A vertical with no specialty queries spends nothing extra.
    textCalls = 0;
    await fetchAllVerticals({ apiKey: "k", location: "1,2", radiusMeters: 1000, verticals: ["salon"] });
    assert.equal(textCalls, 0);
  } finally { globalThis.fetch = orig; }
});

// ---------- 3. shop-management fingerprint ----------

test("shop management platforms are detected and out-rank a bare POS hit", () => {
  assert.deepEqual(detectProcessors("<script src='https://booking.tekmetric.com/x.js'>"), ["Tekmetric"]);
  assert.deepEqual(detectProcessors("powered by shopmonkey.io"), ["Shopmonkey"]);
  for (const name of Object.keys(SHOP_MANAGEMENT)) {
    assert.equal(tierOf(name), "integrated_software", name);
    assert.ok(isShopManagement(name));
  }
  assert.ok(!isShopManagement("Clover"));
});

test("bare 'shopware' does not fire — that is the ecommerce platform, not the shop system", () => {
  assert.deepEqual(detectProcessors("<meta content='Shopware 6 storefront'>"), []);
  assert.deepEqual(detectProcessors("<a href='https://shop-ware.com'>"), ["Shop-Ware"]);
});

test("integrated software beats card-present when a site shows both", () => {
  assert.equal(processorPoints(["Clover", "Tekmetric"], 25, 10, 28), 28);
  assert.equal(processorPoints(["Tekmetric"], 25, 10), 25); // defaults to the card-present weight
  assert.match(processorChip(["Clover", "Tekmetric"]), /Tekmetric shop software/);
  assert.match(processorChip(["Clover", "Tekmetric"]), /rarely shopped/);
});

test("an integrated-software hit is site-fingerprint evidence, not a review guess", () => {
  const b = makeBusiness({ category: "auto_repair", review_count: 40, processor: ["AutoLeap"] });
  const signals = collectSignals(b, WEIGHTS);
  assert.ok(signals.includes("integrated_software"));
  assert.ok(!signals.includes("card_present_processor")); // one processor signal, not two
  // Paired with any second signal it should read as corroborated.
  assert.equal(computeConfidence(["integrated_software", "keyword_pain"]), "high");
});

// ---------- 4. high-ticket proxies ----------

test("specialty work is picked up from the name and the reviews", () => {
  assert.deepEqual(specialtyHits("auto_repair", "Cypress Transmission & Diesel", []), ["transmission", "diesel"]);
  // "euro" catches both the shorthand and "European" without double counting.
  assert.deepEqual(specialtyHits("auto_repair", "Euro Auto Werks", []), ["euro"]);
  assert.deepEqual(specialtyHits("auto_repair", "European Motors", []), ["euro"]);
  assert.deepEqual(specialtyHits("auto_repair", "Shop", ["they rebuilt my BMW"]), ["bmw"]);
  // Inert for every vertical that has not opted in.
  assert.deepEqual(specialtyHits("salon", "Transmission Hair Co", []), []);
});

test("labor rate reads the highest hourly figure mentioned", () => {
  assert.equal(laborRateMentioned(["they charge $145/hr"]), 145);
  assert.equal(laborRateMentioned(["$120 an hour here", "dealer wanted $210 per hour"]), 210);
  assert.equal(laborRateMentioned(["labor rate is $155 and worth it"]), 155);
  assert.equal(laborRateMentioned(["the part was $40"]), null);
});

test("high-ticket points stay a nudge, and stay off for other verticals", () => {
  const [pts, ev] = highTicketPoints("auto_repair", "Euro Diesel Transmission", ["labor is $150 an hour"], 8);
  assert.equal(pts, 8); // capped
  assert.ok(ev.specialties.length >= 3);
  assert.ok(ev.laborRate >= LABOR_RATE_FLOOR);

  assert.deepEqual(highTicketPoints("restaurant", "Transmission Tacos", ["$150 an hour"], 8), [0, { specialties: [], laborRate: null }]);
  assert.deepEqual(highTicketPoints("auto_repair", "Euro Diesel", [], 0), [0, { specialties: [], laborRate: null }]);
});

test("dual-pricing language in reviews counts as fee pain", () => {
  assert.deepEqual(painHits(["they give you a cash discount if you skip the card"]), ["fees"]);
  assert.deepEqual(painHits(["the cash price is lower"]), ["fees"]);
});

test("a specialty shop scores above an identical general shop", () => {
  const base = {
    category: "auto_repair", rating: 3.6, review_count: 90,
    website: "https://x.com", price_level: 2, review_texts: ["labor is $150 an hour"],
  };
  const general = scoreBusiness(makeBusiness({ ...base, name: "Main Street Auto" }), WEIGHTS, ICP);
  const specialty = scoreBusiness(makeBusiness({ ...base, name: "Main Street Transmission & Diesel" }), WEIGHTS, ICP);
  assert.ok(specialty.score > general.score);
  assert.ok(specialty.why.some((w) => w.includes("high-ticket work")));
  assert.ok(specialty.why.some((w) => w.includes("labor rate around $150/hr")));
});

test("the specialty query that found a shop shows up as a routing chip", () => {
  const b = makeBusiness({
    category: "auto_repair", name: "A1 Trans", review_count: 40, rating: 3.5,
    source: "places_text", matched_query: "transmission repair shop",
  });
  const lead = scoreBusiness(b, WEIGHTS, ICP);
  assert.ok(lead.why.some((w) => w.includes('found via specialty search: "transmission repair shop"')));
});

// ---------- 5. the copy, and the three rules it has to hold ----------

function autoLead(over = {}) {
  const b = makeBusiness({
    place_id: "p9", name: "Cypress Transmission", category: "auto_repair",
    rating: 3.6, review_count: 140, ...over,
  });
  return scoredLead({ business: b, track: over.track || "displacement", score: 78, bucket: "hot" });
}

function allText(c) {
  return [c.email1_subject, c.email1_body, c.email2_subject, c.email2_body, c.sms, c.voicemail].join("\n").toLowerCase();
}

test("auto repair gets its own copy, not the generic vertical pitch", () => {
  const c = generateCampaign(autoLead(), PERSONAL);
  const t = allText(c);
  assert.ok(t.includes("repair order"));
  assert.ok(t.includes("statement"));
  assert.ok(!t.includes("i work with auto_repair businesses"));
});

test("RULE 1 — the settlement is described as pending, never as done", () => {
  for (const track of ["displacement", "greenfield"]) {
    const t = allText(generateCampaign(autoLead({ track, review_count: track === "greenfield" ? 2 : 140 }), PERSONAL));
    assert.ok(t.includes("visa and mastercard"), track);
    // Nothing that claims the change has already landed or that fees are falling.
    for (const banned of ["the law changed", "the rules changed", "fees are dropping",
      "your fees will drop", "rates are going down", "now legal to"]) {
      assert.ok(!t.includes(banned), `${track}: must not say "${banned}"`);
    }
  }
});

test("RULE 2 — Texas: dual pricing and cash discount, never the word surcharge", () => {
  for (const track of ["displacement", "greenfield"]) {
    const t = allText(generateCampaign(autoLead({ track, review_count: track === "greenfield" ? 2 : 140 }), PERSONAL));
    assert.ok(!t.includes("surcharge"), `${track}: 604A.0021 still bans it on its face`);
    assert.ok(t.includes("dual pricing") || t.includes("cash discount") || t.includes("disclosed discount"), track);
  }
});

test("RULE 3 — no savings number is promised before a statement is read", () => {
  const t = allText(generateCampaign(autoLead(), PERSONAL));
  for (const banned of ["guarantee", "guaranteed", "you will save", "we will save you", "save you $"]) {
    assert.ok(!t.includes(banned), `must not say "${banned}"`);
  }
  assert.ok(t.includes("cannot tell you what you would save") || t.includes("no obligation"));
});

test("a fingerprinted shop platform is named; a processor guess is not", () => {
  const withPlatform = generateCampaign(autoLead({ processor: ["Tekmetric"] }), PERSONAL);
  assert.ok(withPlatform.email2_body.includes("Tekmetric"));
  const withPos = generateCampaign(autoLead({ processor: ["Clover"] }), PERSONAL);
  assert.ok(!withPos.email2_body.includes("Clover"));
});

test("greenfield auto copy sets up, displacement copy does not congratulate", () => {
  const gf = generateCampaign(autoLead({ track: "greenfield", review_count: 2 }), PERSONAL);
  assert.ok(gf.email1_body.toLowerCase().includes("congrats"));
  const dp = generateCampaign(autoLead(), PERSONAL);
  assert.ok(!dp.email1_body.toLowerCase().includes("congrats"));
});

test("auto copy keeps the CAN-SPAM footer and renders every token", () => {
  for (const track of ["displacement", "greenfield"]) {
    const c = generateCampaign(autoLead({ track, review_count: track === "greenfield" ? 2 : 140 }), PERSONAL);
    assert.ok(c.email1_body.includes("Reply STOP to opt out."), track);
    assert.ok(c.email2_body.includes("Reply STOP to opt out."), track);
    for (const field of [c.email1_body, c.email2_body, c.sms, c.voicemail]) {
      assert.ok(!field.includes("{") && !field.includes("}"), track);
      assert.ok(!field.includes("undefined"), track);
    }
  }
});

test("non-auto verticals keep the generic copy untouched", () => {
  const salon = scoredLead({
    business: makeBusiness({ name: "Cut & Co", category: "salon", rating: 3.5, review_count: 120 }),
    track: "displacement", score: 70, bucket: "hot",
  });
  const c = generateCampaign(salon, PERSONAL);
  assert.ok(c.email1_subject.startsWith("Quick question about card processing at"));
});
