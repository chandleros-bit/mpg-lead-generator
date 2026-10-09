// test/service_verticals.test.js
// The five service niches: dentists, med spas, HVAC, remodeling, pest control.
import test from "node:test";
import assert from "node:assert/strict";
import { getVertical } from "../lib/verticals/index.js";
import { placeMatchesVertical, fetchAllVerticals, textQueriesFor } from "../lib/fetcher.js";
import { detectProcessors, tierOf, splitDetections } from "../lib/processors.js";
import { scoreBusiness, highTicketPoints } from "../lib/scoring.js";
import { generateCampaign, feeIllustration } from "../lib/campaigns.js";
import { scoredLead } from "../lib/models.js";
import { makeBusiness, WEIGHTS, PERSONAL } from "./helpers.js";

const NICHES = ["dentist", "med_spa", "hvac", "remodeling", "pest_control"];
const ICP = new Set(NICHES);

// ---------- 1. finding the right businesses ----------

test("dentists: typed results count, and so do named ones Google files elsewhere", () => {
  assert.ok(placeMatchesVertical("dentist", "dentist", "Bright Smiles"));
  assert.ok(placeMatchesVertical("dental_clinic", "dentist", "Clinic"));
  assert.ok(placeMatchesVertical("doctor", "dentist", "Katy Orthodontics"));
  assert.ok(!placeMatchesVertical("doctor", "dentist", "Katy Family Medicine"));
  assert.ok(!placeMatchesVertical("pharmacy", "dentist", "Dental Supply Pharmacy"));
});

test("med spas: a name match is required, even for a typed result", () => {
  assert.ok(placeMatchesVertical("spa", "med_spa", "Glow Med Spa"));
  assert.ok(placeMatchesVertical("medical_clinic", "med_spa", "Revive Aesthetics"));
  assert.ok(placeMatchesVertical(null, "med_spa", "Cypress Laser & Botox"));
  assert.ok(!placeMatchesVertical("skin_care_clinic", "med_spa", "Serenity Facials"));
  assert.ok(!placeMatchesVertical("amusement_center", "med_spa", "Laser Tag Arena"));
  assert.ok(!placeMatchesVertical("hair_salon", "med_spa", "Aesthetic Hair Studio"));
});

test("HVAC: no Google type, so the name decides and stores are rejected", () => {
  assert.ok(placeMatchesVertical("plumber", "hvac", "Lone Star Plumbing, Heating & Air"));
  assert.ok(placeMatchesVertical(null, "hvac", "Cypress A/C Services"));
  assert.ok(placeMatchesVertical("general_contractor", "hvac", "Arctic Comfort Systems"));
  assert.ok(!placeMatchesVertical("home_improvement_store", "hvac", "Air Conditioner Outlet"));
  assert.ok(!placeMatchesVertical("plumber", "hvac", "Joe's Plumbing"));
  assert.ok(!placeMatchesVertical(null, "hvac", "Hair Studio"), "\"air\" is a whole word");
});

test("remodeling and pest control verify by name", () => {
  assert.ok(placeMatchesVertical(null, "remodeling", "Elite Kitchen & Bath Remodeling"));
  assert.ok(placeMatchesVertical("general_contractor", "remodeling", "Gulf Coast Renovations"));
  assert.ok(!placeMatchesVertical("building_materials_store", "remodeling", "Kitchen Cabinet Depot"));
  assert.ok(placeMatchesVertical(null, "pest_control", "Bayou Pest Solutions"));
  assert.ok(placeMatchesVertical(null, "pest_control", "Texas Exterminating Co"));
  assert.ok(!placeMatchesVertical(null, "pest_control", "Katy Lawn Care"));
});

function placesResponse(places) {
  return new Response(JSON.stringify({ places }), { status: 200 });
}

test("a text-only niche skips Nearby Search and never sends an includedType", async () => {
  const orig = globalThis.fetch;
  let nearby = 0;
  const bodies = [];
  globalThis.fetch = async (url, opts) => {
    if (String(url).includes("searchNearby")) nearby++;
    if (String(url).includes("searchText")) bodies.push(JSON.parse(opts.body));
    return placesResponse([
      { id: "a", displayName: { text: "Arctic Air Conditioning" }, primaryType: "plumber", userRatingCount: 50 },
      { id: "b", displayName: { text: "Home Depot" }, primaryType: "home_improvement_store", userRatingCount: 900 },
    ]);
  };
  try {
    const out = await fetchAllVerticals({ apiKey: "k", location: "1,2", radiusMeters: 1000, verticals: ["hvac"] });
    assert.equal(nearby, 0);
    assert.equal(bodies.length, textQueriesFor("hvac").length);
    assert.ok(bodies.every((b) => !("includedType" in b)));
    assert.deepEqual(out.map((b) => b.name), ["Arctic Air Conditioning"]);
    assert.equal(out[0].category, "hvac");
  } finally { globalThis.fetch = orig; }
});

test("a text-only niche whose every query fails is an error, not an empty market", async () => {
  const orig = globalThis.fetch;
  globalThis.fetch = async () => new Response("denied", { status: 403 });
  try {
    await assert.rejects(
      () => fetchAllVerticals({ apiKey: "k", location: "1,2", radiusMeters: 1000, verticals: ["pest_control"] }),
      /All pest_control searches failed/,
    );
  } finally { globalThis.fetch = orig; }
});

test("med spa Nearby results without a med spa name are dropped", async () => {
  const orig = globalThis.fetch;
  globalThis.fetch = async (url) => {
    if (String(url).includes("searchNearby")) {
      return placesResponse([
        { id: "1", displayName: { text: "Luxe Med Spa" }, primaryType: "skin_care_clinic" },
        { id: "2", displayName: { text: "Serenity Facials" }, primaryType: "skin_care_clinic" },
      ]);
    }
    return placesResponse([]);
  };
  try {
    const out = await fetchAllVerticals({ apiKey: "k", location: "1,2", radiusMeters: 1000, verticals: ["med_spa"] });
    assert.deepEqual(out.map((b) => b.name), ["Luxe Med Spa"]);
  } finally { globalThis.fetch = orig; }
});

// ---------- 2. fingerprints ----------

test("niche software scores as integrated software; financing is its own tier", () => {
  for (const name of ["Weave", "Boulevard", "Vagaro", "ServiceTitan", "Housecall Pro", "Buildertrend", "FieldRoutes"]) {
    assert.equal(tierOf(name), "integrated_software", name);
  }
  for (const name of ["CareCredit", "Cherry", "GreenSky", "Wisetack", "Hearth"]) {
    assert.equal(tierOf(name), "financing", name);
  }
});

test("detection reads vendor domains and avoids look-alikes", () => {
  const html = `<script src="https://www.vagaro.com/widget.js"></script>
    <a href="https://www.carecredit.com/apply">Finance</a>`;
  const found = detectProcessors(html);
  assert.ok(found.includes("Vagaro"));
  assert.deepEqual(splitDetections(found), { processors: ["Vagaro"], financing: ["CareCredit"] });
  assert.ok(!detectProcessors(`<a href="https://sunsetblvd.com/">x</a>`).includes("Boulevard"));
  assert.ok(detectProcessors(`<iframe src="https://blvd.co/glow/book">`).includes("Boulevard"));
});

// ---------- 3. scoring ----------

test("financing on the site earns high-ticket points and a chip", () => {
  const b = makeBusiness({
    category: "dentist", name: "Katy Family Dental", review_count: 120, rating: 4.0,
    website: "https://katydental.com", processor: ["Weave"], financing: ["CareCredit"],
    review_texts: ["Got my implants here"],
  });
  const lead = scoreBusiness(b, WEIGHTS, ICP);
  assert.equal(lead.track, "displacement");
  assert.ok(lead.why.some((w) => w.includes("Weave patient payments platform")));
  assert.ok(lead.why.some((w) => w.includes("offers customer financing (CareCredit)")));
  assert.ok(lead.why.some((w) => w.includes("high-ticket work: implant")));
  assert.ok(lead.signals.includes("integrated_software"));
});

test("hourly labor rates are read for auto repair only", () => {
  const [, dental] = highTicketPoints("dentist", "Smile Co", ["they charge $150 an hour"], 8);
  assert.equal(dental.laborRate, null);
  const [, auto] = highTicketPoints("auto_repair", "Shop", ["labor is $150 an hour"], 8);
  assert.equal(auto.laborRate, 150);
});

test("each niche is in-ICP when selected and scores on both tracks", () => {
  for (const id of NICHES) {
    const disp = scoreBusiness(makeBusiness({ category: id, review_count: 60, rating: 3.8 }), WEIGHTS, ICP);
    assert.equal(disp.track, "displacement", id);
    const green = scoreBusiness(makeBusiness({ category: id, review_count: 2 }), WEIGHTS, ICP);
    assert.equal(green.track, "greenfield", id);
    assert.ok(green.score > 0, id);
  }
});

// ---------- 4. copy, under the same three rules as auto repair ----------

function lead(id, over = {}) {
  const b = makeBusiness({ place_id: "p", name: "Test Biz", category: id, review_count: 90, ...over });
  return scoredLead({ business: b, track: over.track || "displacement", score: 75, bucket: "hot" });
}
function allText(c) {
  return [c.email1_subject, c.email1_body, c.email2_subject, c.email2_body, c.sms, c.voicemail].join("\n").toLowerCase();
}
function sentences(t) { return t.split(/(?<=[.!?])\s+/); }
const SAVINGS_PROMISES = ["guarantee", "you will save", "you'll save", "i can save you",
  "we can save you", "save you $", "cut your fees by", "lower your rate to", "in savings"];

test("every niche gets its own ticket language, not the generic pitch", () => {
  for (const id of NICHES) {
    const t = allText(generateCampaign(lead(id), PERSONAL));
    const ticket = getVertical(id).copy.ticket_label;
    assert.ok(t.includes(`per ${ticket}`), id);
    assert.ok(!t.includes(`${id.replace(/_/g, " ")} businesses`), `${id}: generic copy leaked`);
  }
});

test("RULES 1-3 hold for every niche on both tracks", () => {
  for (const id of NICHES) {
    for (const track of ["displacement", "greenfield"]) {
      const t = allText(generateCampaign(lead(id, { track, review_count: track === "greenfield" ? 2 : 90 }), PERSONAL));
      const tag = `${id}/${track}`;
      assert.ok(t.includes("visa and mastercard"), tag);
      for (const banned of ["the law changed", "the rules changed", "fees are dropping", "your fees will drop"]) {
        assert.ok(!t.includes(banned), `${tag}: ${banned}`);
      }
      assert.ok(!t.includes("surcharge"), tag);
      assert.ok(t.includes("cash discount") || t.includes("disclosed discount"), tag);
      for (const banned of SAVINGS_PROMISES) assert.ok(!t.includes(banned), `${tag}: ${banned}`);
      for (const s of sentences(t)) {
        if (/\$\s?\d/.test(s)) assert.ok(!/sav\w*/.test(s), `${tag}: "${s.trim()}"`);
      }
      if (track === "greenfield") {
        assert.equal(t.match(/\$\s?\d/g), null, `${tag}: greenfield quotes no figure`);
        assert.equal(t.match(/sav\w*/g), null, `${tag}: greenfield raises no savings`);
      } else {
        assert.ok(/statement/.test(t), tag);
      }
    }
  }
});

test("the cost illustration is the pack's ticket at a rounded-down 2.5 percent", () => {
  assert.equal(feeIllustration(1500), 35);
  assert.equal(feeIllustration(750), 18);
  assert.equal(feeIllustration(9000), 225);
  assert.equal(feeIllustration(35000), 875);
  const t = allText(generateCampaign(lead("hvac"), PERSONAL));
  assert.ok(t.includes("$9,000 system replacement"));
  assert.ok(t.includes("north of $225"));
});

test("copy speaks to the run's market and names Texas only in Texas", () => {
  const tx = allText(generateCampaign(lead("dentist"), PERSONAL, { city: "Katy", state: "TX" }));
  assert.ok(tx.includes("around katy"));
  assert.ok(tx.includes("texas is particular"));
  const fl = allText(generateCampaign(lead("dentist"), PERSONAL, { city: "Tampa", state: "FL" }));
  assert.ok(fl.includes("around tampa"));
  assert.ok(!fl.includes("texas"));
  assert.ok(fl.includes("card fee rules vary by state"));
});

test("detected software and financing are named; nothing is named when not detected", () => {
  const withBoth = allText(generateCampaign(lead("med_spa", { processor: ["Boulevard"], financing: ["Cherry"] }), PERSONAL));
  assert.ok(withBoth.includes("running boulevard"));
  assert.ok(withBoth.includes("offer cherry financing"));
  const bare = allText(generateCampaign(lead("med_spa"), PERSONAL));
  assert.ok(!bare.includes("i also noticed"));
  assert.ok(!bare.includes("financing"));
});

test("pest control pitches the recurring book, with bank draft in the discount", () => {
  const t = allText(generateCampaign(lead("pest_control"), PERSONAL));
  assert.ok(t.includes("every customer on a plan"));
  assert.ok(t.includes("bank draft"));
});

// ---------- 5. service scoring profile ----------

test("a well-run service business with bundled software and financing reaches Hot", async () => {
  const { readFile } = await import("node:fs/promises");
  const W = JSON.parse(await readFile(new URL("../config.json", import.meta.url), "utf8")).weights;
  const icp = new Set(["hvac", "dentist", "restaurant"]);
  const hvac = scoreBusiness(makeBusiness({
    category: "hvac", rating: 4.8, review_count: 150, website: "https://x.com",
    processor: ["ServiceTitan"], financing: ["GreenSky"], review_texts: ["great install of new system"],
  }), W, icp);
  assert.equal(hvac.bucket, "hot", `scored ${hvac.score}`);
  const dentist = scoreBusiness(makeBusiness({
    category: "dentist", rating: 4.9, review_count: 300, website: "https://x.com",
    processor: ["Weave"], financing: ["CareCredit"], review_texts: ["implants"],
  }), W, icp);
  assert.equal(dentist.bucket, "hot", `scored ${dentist.score}`);
});

test("a service business with a good rating and nothing found on the site stays Cold", async () => {
  const { readFile } = await import("node:fs/promises");
  const W = JSON.parse(await readFile(new URL("../config.json", import.meta.url), "utf8")).weights;
  const lead = scoreBusiness(makeBusiness({
    category: "hvac", rating: 4.8, review_count: 150, website: "https://x.com",
  }), W, new Set(["hvac"]));
  assert.equal(lead.bucket, "cold", `scored ${lead.score}`);
});

test("the service profile applies only to service packs", async () => {
  const { displacementWeights } = await import("../lib/scoring.js");
  const W = { displacement: { volume_max: 20, dissatisfaction_max: 35 },
    displacement_profiles: { service: { volume_max: 25, dissatisfaction_max: 15 } } };
  assert.equal(displacementWeights(W, "hvac").dissatisfaction_max, 15);
  assert.equal(displacementWeights(W, "dentist").volume_max, 25);
  assert.equal(displacementWeights(W, "restaurant").dissatisfaction_max, 35);
  assert.equal(displacementWeights(W, "auto_repair").dissatisfaction_max, 35);
  // No profiles configured: everything falls back to the base weights.
  assert.equal(displacementWeights({ displacement: { volume_max: 20 } }, "hvac").volume_max, 20);
});

test("review volume points scale with review count up to the cap", async () => {
  const { reviewVolumePoints } = await import("../lib/scoring.js");
  assert.equal(reviewVolumePoints(0, 25, 150), 0);
  assert.equal(reviewVolumePoints(75, 25, 150), 12);
  assert.equal(reviewVolumePoints(150, 25, 150), 25);
  assert.equal(reviewVolumePoints(900, 25, 150), 25);
});
