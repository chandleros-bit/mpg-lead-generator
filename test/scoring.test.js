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
test("dissatisfaction needs volume", () => {
  assert.equal(dissatisfactionPoints(3.0, 19, 35), 0);
  assert.equal(dissatisfactionPoints(null, 100, 35), 0);
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
