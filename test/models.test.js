import test from "node:test";
import assert from "node:assert/strict";
import { business, scoredLead } from "../lib/models.js";

test("business applies defaults for omitted fields", () => {
  const b = business({ place_id: "p1", name: "X", category: "cafe", address: "1 St" });
  assert.equal(b.phone, null);
  assert.equal(b.website, null);
  assert.equal(b.rating, null);
  assert.equal(b.review_count, 0);
  assert.equal(b.price_level, null);
  assert.equal(b.business_status, "");
  assert.deepEqual(b.review_texts, []);
});

test("business preserves price_level 0 (not coerced to null)", () => {
  const b = business({ place_id: "p", name: "X", category: "cafe", address: "a", price_level: 0 });
  assert.equal(b.price_level, 0);
});

test("scoredLead defaults why to empty array", () => {
  const lead = scoredLead({ business: {}, track: "greenfield", score: 80, bucket: "hot" });
  assert.deepEqual(lead.why, []);
});
