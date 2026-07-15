import test from "node:test";
import assert from "node:assert/strict";
import {
  classifyTrack, dissatisfactionPoints, keywordPainPoints, techPoints,
  volumePoints, recencyPoints, volumePotentialPoints, setupGapPoints, scoreBusiness,
  websiteStatus,
} from "../lib/scoring.js";
import { ICP, WEIGHTS, makeBusiness } from "./helpers.js";
import { processorPoints } from "../lib/scoring.js";

// ---------- classification ----------
test("out of ICP is low_fit", () => {
  assert.equal(classifyTrack(makeBusiness({ category: "laundromat", review_count: 100 }), ICP, 8), "low_fit");
});
test("few reviews is greenfield", () => {
  assert.equal(classifyTrack(makeBusiness({ category: "restaurant", review_count: 3 }), ICP, 8), "greenfield");
});
test("established is displacement", () => {
  assert.equal(classifyTrack(makeBusiness({ category: "salon", review_count: 210 }), ICP, 8), "displacement");
});
test("cutoff is exclusive", () => {
  assert.equal(classifyTrack(makeBusiness({ category: "cafe", review_count: 8 }), ICP, 8), "displacement");
});

// ---------- displacement scorers ----------
test("dissatisfaction scales", () => {
  assert.equal(dissatisfactionPoints(4.2, 100, 35), 0);
  assert.equal(dissatisfactionPoints(3.0, 100, 35), 35);
  assert.equal(dissatisfactionPoints(3.6, 100, 35), 18);
  assert.equal(dissatisfactionPoints(2.5, 100, 35), 35);
});
test("dissatisfaction needs a rating at all", () => {
  assert.equal(dissatisfactionPoints(null, 100, 35), 0);
  assert.equal(dissatisfactionPoints(undefined, 100, 35), 0);
});

// ---------- graduated volume confidence ----------

test("dissatisfaction is graduated, not a cliff at 20 reviews", () => {
  // Full weight from 20 up.
  assert.equal(dissatisfactionPoints(3.0, 20, 35), 35);
  assert.equal(dissatisfactionPoints(3.0, 200, 35), 35);
  // Half weight across the old dead zone (10–19) instead of a structural zero.
  assert.equal(dissatisfactionPoints(3.0, 15, 35), 18);
  assert.equal(dissatisfactionPoints(3.0, 10, 35), 18);
  assert.equal(dissatisfactionPoints(3.0, 19, 35), 18);
  // Below 10 a rating is one bad night — still zero, deliberately.
  assert.equal(dissatisfactionPoints(3.0, 9, 35), 0);
  assert.equal(dissatisfactionPoints(3.0, 0, 35), 0);
});

test("the >4.2 gate still wins over volume", () => {
  // A happy business is not a displacement lead no matter how many reviews.
  assert.equal(dissatisfactionPoints(4.3, 100, 35), 0);
  assert.equal(dissatisfactionPoints(4.8, 15, 35), 0);
});

test("graduated weight scales with rating, not just volume", () => {
  // 3.6 is halfway between 4.2 and 3.0 → half of 35 is ~18, halved again ~9.
  assert.equal(dissatisfactionPoints(3.6, 100, 35), 18);
  assert.equal(dissatisfactionPoints(3.6, 15, 35), 9);
});

test("volume-confidence thresholds are config-driven", () => {
  const vc = { full_at: 50, half_at: 25 };
  assert.equal(dissatisfactionPoints(3.0, 50, 35, vc), 35);
  assert.equal(dissatisfactionPoints(3.0, 30, 35, vc), 18);
  assert.equal(dissatisfactionPoints(3.0, 24, 35, vc), 0);
});

test("pyRound still rounds half-to-even through the new multiplier", () => {
  // 35 * 1.0 * 0.5 = 17.5 → 18 (17 is odd, so half rounds up to even).
  assert.equal(dissatisfactionPoints(3.0, 15, 35), 18);
  // 30 * 1.0 * 0.5 = 15.0 → exact, no rounding involved.
  assert.equal(dissatisfactionPoints(3.0, 15, 30), 15);
  // 25 * 1.0 * 0.5 = 12.5 → 12 (12 is even, so half rounds down).
  assert.equal(dissatisfactionPoints(3.0, 15, 25), 12);
});
test("keyword pain caps and reports", () => {
  const [pts, hits] = keywordPainPoints(["they add a surcharge", "card declined twice"], 12);
  assert.equal(pts, 12);
  assert.deepEqual(new Set(hits), new Set(["fees", "friction"]));
  assert.deepEqual(keywordPainPoints(["great food"], 12), [0, []]);
});
test("tech points pay by website certainty", () => {
  // A null websiteUri is Places not telling us, not proof of no website. It's a
  // proxy with a known false-negative rate, so it earns a capped 8 of 20 rather
  // than the old 18.
  assert.equal(techPoints(null, [], 20), 8);
  // Corroborated by the reviews → this is now evidence, and earns full marks.
  assert.equal(techPoints(null, ["cash only here"], 20), 20); // 18 + 2, capped at wmax
  assert.equal(techPoints(null, ["call to order, no website"], 20), 18);
  // Has a site → nothing, as before.
  assert.equal(techPoints("http://s.com", [], 20), 0);
  // A site plus a cash-only mention still gets the cash-only nudge only.
  assert.equal(techPoints("http://s.com", ["cash only"], 20), 2);
});

test("setup gap pays by website certainty", () => {
  assert.equal(setupGapPoints(null, [], 27), 14);                    // unknown → half
  assert.equal(setupGapPoints(null, ["cash only"], 27), 27);         // confirmed → full
  assert.equal(setupGapPoints("http://x.com", [], 27), 8);           // present → unchanged
});

test("websiteStatus is tri-state, not a boolean", () => {
  assert.equal(websiteStatus("http://x.com", []), "present");
  assert.equal(websiteStatus("http://x.com", ["cash only"]), "present"); // a real site wins
  assert.equal(websiteStatus(null, []), "unknown");
  assert.equal(websiteStatus(null, ["great tacos"]), "unknown");
  assert.equal(websiteStatus(null, ["they are cash only"]), "absent_confirmed");
  assert.equal(websiteStatus(null, ["call to order"]), "absent_confirmed");
});

test("a TABC row's null website is an artifact, not a signal", () => {
  // lib/tabc.js hardcodes website: null because the dataset has no website
  // column. Under the old rule every TABC lead collected the full 27-point
  // setup gap for a field nothing ever populated.
  const tabc = makeBusiness({
    category: "bar", review_count: 0, website: null, source: "tabc",
    business_status: "OPERATIONAL", licensed_on: "2026-07-01", review_texts: [],
  });
  const lead = scoreBusiness(tabc, WEIGHTS, ICP);
  assert.equal(lead.track, "greenfield");
  assert.equal(lead.score, 78, "was 91 — the 13 lost points were pure artifact");
  assert.equal(lead.bucket, "hot", "still Hot on signals it actually earned");
});

test("website chips distinguish unconfirmed from confirmed", () => {
  const chipFor = (b) => scoreBusiness(b, WEIGHTS, ICP).why.find((w) => w.includes("website"));
  // Displacement, no corroboration → must read as unconfirmed.
  const unconfirmed = chipFor(makeBusiness({ category: "salon", rating: 3.5, review_count: 100, website: null }));
  assert.match(unconfirmed, /unconfirmed/);
  // Displacement, corroborated → reads as real evidence.
  const confirmed = chipFor(makeBusiness({ category: "salon", rating: 3.5, review_count: 100, website: null, review_texts: ["cash only"] }));
  assert.doesNotMatch(confirmed, /unconfirmed/);
  // Greenfield, no corroboration → same honesty.
  const gf = chipFor(makeBusiness({ category: "bar", review_count: 2, website: null }));
  assert.match(gf, /unconfirmed/);
});
test("volume points", () => {
  assert.equal(volumePoints(4, 200, 20), 20);
  assert.equal(volumePoints(0, 0, 20), 0);
});

// ---------- greenfield scorers ----------
test("recency", () => {
  assert.equal(recencyPoints(0, 8, 40), 40);
  assert.equal(recencyPoints(4, 8, 40), 20);
  assert.equal(recencyPoints(8, 8, 40), 0);
});
test("volume potential", () => {
  assert.ok(volumePotentialPoints("restaurant", 4, 30) > volumePotentialPoints("professional", 0, 30));
});

// ---------- assembly ----------
test("low_fit scores zero", () => {
  const lead = scoreBusiness(makeBusiness({ category: "laundromat", review_count: 50 }), WEIGHTS, ICP);
  assert.equal(lead.track, "low_fit");
  assert.equal(lead.score, 0);
  assert.equal(lead.bucket, "cold");
});
test("unhappy salon is hot displacement", () => {
  const b = makeBusiness({ category: "salon", rating: 3.2, review_count: 210, website: null, price_level: 2, review_texts: ["cash only and a surcharge"] });
  const lead = scoreBusiness(b, WEIGHTS, ICP);
  assert.equal(lead.track, "displacement");
  assert.equal(lead.bucket, "hot");
  assert.ok(lead.why.some((w) => w.includes("Displacement")));
});
test("fresh taqueria is hot greenfield", () => {
  const b = makeBusiness({ category: "restaurant", review_count: 2, website: null, price_level: 2 });
  const lead = scoreBusiness(b, WEIGHTS, ICP);
  assert.equal(lead.track, "greenfield");
  assert.ok(lead.score >= 70);
  assert.equal(lead.bucket, "hot");
});
test("the 8-19 dead zone is gone: a thin bad rating now earns points", () => {
  // Isolates the dissatisfaction change by giving the lead a real website, so
  // the website-certainty rules contribute nothing either way. 3.0 stars on 15
  // reviews used to earn a structural zero from the heaviest weight.
  const thin = makeBusiness({ category: "salon", rating: 3.0, review_count: 15, website: "https://s.com" });
  const solid = makeBusiness({ category: "salon", rating: 3.0, review_count: 200, website: "https://s.com" });
  assert.equal(scoreBusiness(thin, WEIGHTS, ICP).score, 24);   // 18 dissatisfaction + 3 vol + 3 tiebreak
  assert.equal(scoreBusiness(solid, WEIGHTS, ICP).score, 50);  // 35 + 12 vol + 3, unchanged by this phase
  assert.ok(scoreBusiness(thin, WEIGHTS, ICP).score > 6, "scored 6 before the graduated curve");
});

test("a thin rating plus an unlisted website is Cold, and should be", () => {
  // The two phases pull opposite ways on the same lead, and the honest answer is
  // low. 3.0 stars on 15 reviews now earns half dissatisfaction (18, was 0), but
  // its null websiteUri now earns 8 rather than 18 because Places simply didn't
  // say. Net 32 — up from 24, still Cold. One thin review-derived signal and one
  // proxy is not a lead worth calling first.
  const b = makeBusiness({ category: "salon", rating: 3.0, review_count: 15, website: null });
  const lead = scoreBusiness(b, WEIGHTS, ICP);
  assert.equal(lead.score, 32);
  assert.equal(lead.bucket, "cold");
});

test("a scoring rating always shows a chip that says how thin it is", () => {
  // A lead must never earn dissatisfaction points with no chip explaining why.
  const thin = scoreBusiness(makeBusiness({ category: "salon", rating: 3.0, review_count: 15 }), WEIGHTS, ICP);
  const chip = thin.why.find((w) => w.startsWith("rating "));
  assert.ok(chip, `expected a rating chip, got ${JSON.stringify(thin.why)}`);
  assert.match(chip, /thin sample/, "a half-weight signal must read as half-confidence");

  const solid = scoreBusiness(makeBusiness({ category: "salon", rating: 3.0, review_count: 200 }), WEIGHTS, ICP);
  const solidChip = solid.why.find((w) => w.startsWith("rating "));
  assert.equal(solidChip, "rating 3 on 200 reviews", "full-weight chip stays as it was");
});

test("a rating that earns nothing shows no rating chip", () => {
  // Below the half threshold the rating contributes zero, so claiming it as a
  // reason would be inventing evidence.
  // 9 reviews still classifies as displacement (greenfield cutoff is 8).
  const lead = scoreBusiness(makeBusiness({ category: "salon", rating: 3.0, review_count: 9 }), WEIGHTS, ICP);
  assert.equal(lead.track, "displacement");
  assert.equal(lead.why.some((w) => w.startsWith("rating ")), false);
});

test("score clamps to 100", () => {
  const b = makeBusiness({ category: "restaurant", review_count: 0, website: null, price_level: 4 });
  assert.ok(scoreBusiness(b, WEIGHTS, ICP).score <= 100);
});

test("processorPoints pays by acceptance channel, not by mere detection", () => {
  // Card-present is the only tier that's evidence about the register we sell to.
  assert.equal(processorPoints(["Clover"], 25, 10), 25);
  assert.equal(processorPoints(["Toast"], 25, 10), 25);
  // Square could be either channel — partial credit, not full.
  assert.equal(processorPoints(["Square"], 25, 10), 10);
  // Online-only tells us nothing about the terminal. No points.
  assert.equal(processorPoints(["Stripe"], 25, 10), 0);
  assert.equal(processorPoints(["PayPal"], 25, 10), 0);
  assert.equal(processorPoints(["Shopify Payments"], 25, 10), 0);
  assert.equal(processorPoints([], 25, 10), 0);
  assert.equal(processorPoints(undefined, 25, 10), 0);
});

test("processorPoints takes the strongest tier when a site shows several", () => {
  // A restaurant running Clover at the register and Stripe for online gift cards
  // is still a card-present displacement target.
  assert.equal(processorPoints(["Stripe", "Clover"], 25, 10), 25);
  assert.equal(processorPoints(["Stripe", "Square"], 25, 10), 10);
  assert.equal(processorPoints(["PayPal", "Shopify Payments"], 25, 10), 0);
});

test("a healthy restaurant with online-only Stripe is not a displacement lead", () => {
  // The regression this phase exists for: 4.8 stars on 300 reviews, Stripe for
  // online orders only. Scored 43/warm on the strength of a fingerprint that
  // says nothing about the register.
  const b = makeBusiness({
    category: "restaurant", rating: 4.8, review_count: 300,
    website: "https://x.com", price_level: 2, processor: ["Stripe"],
  });
  const lead = scoreBusiness(b, WEIGHTS, ICP);
  assert.equal(lead.score, 18);
  assert.equal(lead.bucket, "cold");
  assert.ok(
    lead.why.some((w) => w.includes("online checkout")),
    `chip should say the hit is online-only, got ${JSON.stringify(lead.why)}`,
  );
});

test("the same restaurant running Clover keeps full displacement weight", () => {
  const b = makeBusiness({
    category: "restaurant", rating: 4.8, review_count: 300,
    website: "https://x.com", price_level: 2, processor: ["Clover"],
  });
  const lead = scoreBusiness(b, WEIGHTS, ICP);
  assert.equal(lead.score, 43);
  assert.ok(lead.why.some((w) => w.includes("card-present")));
});

test("processor chips name the channel honestly", () => {
  const chip = (processor) =>
    scoreBusiness(makeBusiness({ category: "cafe", review_count: 50, website: "https://x.com", processor }), WEIGHTS, ICP)
      .why.find((w) => w.toLowerCase().includes(processor[0].toLowerCase()));
  assert.match(chip(["Clover"]), /card-present/);
  assert.match(chip(["Square"]), /channel unknown/);
  assert.match(chip(["Stripe"]), /online checkout/);
});

test("legacy processorPoints arity still zeroes with no ambiguous weight", () => {
  // Ambiguous max is optional; without it Square earns nothing rather than throwing.
  assert.equal(processorPoints(["Square"], 25), 0);
  assert.equal(processorPoints(["Clover"], 25), 25);
});

test("a detected processor raises the displacement score and adds a why-chip", () => {
  const base = makeBusiness({ category: "cafe", rating: 4.0, review_count: 150, website: "http://c.com", price_level: 2 });
  const withProc = makeBusiness({ category: "cafe", rating: 4.0, review_count: 150, website: "http://c.com", price_level: 2, processor: ["Square"] });
  const a = scoreBusiness(base, WEIGHTS, ICP);
  const b = scoreBusiness(withProc, WEIGHTS, ICP);
  assert.ok(b.score > a.score);
  assert.ok(b.why.some((w) => w.includes("Square detected — channel unknown")));
});

test("a card-present processor outweighs the keyword-pain signal", () => {
  // A confirmed register beats review chatter: processor_max (25) > keyword_pain_max (12).
  assert.ok(WEIGHTS.displacement.processor_max > WEIGHTS.displacement.keyword_pain_max);
  // But an ambiguous hit must NOT outrank real review evidence — it's a guess.
  assert.ok(WEIGHTS.displacement.processor_ambiguous_max < WEIGHTS.displacement.keyword_pain_max);
});
