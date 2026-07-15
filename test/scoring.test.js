import test from "node:test";
import assert from "node:assert/strict";
import {
  classifyTrack, dissatisfactionPoints, keywordPainPoints, techPoints,
  volumePoints, recencyPoints, volumePotentialPoints, setupGapPoints, scoreBusiness,
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
test("tech points", () => {
  assert.equal(techPoints(null, [], 20), 18);
  assert.equal(techPoints(null, ["cash only here"], 20), 20);
  assert.equal(techPoints("http://s.com", [], 20), 0);
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
test("setup gap", () => {
  assert.equal(setupGapPoints(null, 27), 27);
  assert.equal(setupGapPoints("http://x.com", 27), 8);
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
test("a bad salon in the old dead zone now surfaces", () => {
  // The regression this phase exists for: 3.0 stars on 15 reviews scored 24/cold
  // purely because dissatisfaction was gated at 20 reviews — the worst-rated
  // business in the demo set ranked below a 3.9.
  const b = makeBusiness({ category: "salon", rating: 3.0, review_count: 15, website: null });
  const lead = scoreBusiness(b, WEIGHTS, ICP);
  assert.equal(lead.score, 42);
  assert.equal(lead.bucket, "warm");
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
