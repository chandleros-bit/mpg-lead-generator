import test from "node:test";
import assert from "node:assert/strict";
import { sortLeads, confidenceRank, bucketRank, BUCKET_ORDER } from "../public/sort.js";

const lead = (name, score, confidence, bucket) => ({ name, score, confidence, bucket });

test("confidence ranks high > medium > low", () => {
  assert.ok(confidenceRank("high") > confidenceRank("medium"));
  assert.ok(confidenceRank("medium") > confidenceRank("low"));
});

test("bucket ranks hot > warm > cold", () => {
  assert.ok(bucketRank("hot") > bucketRank("warm"));
  assert.ok(bucketRank("warm") > bucketRank("cold"));
  assert.deepEqual(BUCKET_ORDER, ["hot", "warm", "cold"]);
});

test("unknown or missing values sort last, never first", () => {
  assert.equal(confidenceRank(undefined), 0);
  assert.equal(confidenceRank("bogus"), 0);
  assert.equal(bucketRank(undefined), 0);
  assert.ok(confidenceRank("low") > confidenceRank(undefined));
  assert.ok(bucketRank("cold") > bucketRank(undefined));
});

test("confidence sort ranks evidence within a bucket, not across buckets", () => {
  // The case this exists for: two Hot leads one point apart. The corroborated
  // one calls first — but neither is buried under a Cold lead just because the
  // Cold one happens to carry a signal.
  const rows = sortLeads([
    lead("Precision Auto", 25, "medium", "cold"),
    lead("Grand Opening Boba", 71, "low", "hot"),
    lead("Cut & Co", 72, "medium", "hot"),
    lead("Harvest Table", 69, "medium", "warm"),
  ], "confidence");
  assert.deepEqual(rows.map((r) => r.name),
    ["Cut & Co", "Grand Opening Boba", "Harvest Table", "Precision Auto"]);
});

test("a strong opportunity is never buried under a weak evidenced one", () => {
  const rows = sortLeads([
    lead("cold but evidenced", 25, "high", "cold"),
    lead("hot but unevidenced", 71, "low", "hot"),
  ], "confidence");
  assert.equal(rows[0].name, "hot but unevidenced", "bucket leads; evidence breaks ties inside it");
});

test("within a bucket, higher confidence beats a higher score", () => {
  const rows = sortLeads([
    lead("higher score, no evidence", 95, "low", "hot"),
    lead("lower score, corroborated", 71, "high", "hot"),
  ], "confidence");
  assert.equal(rows[0].name, "lower score, corroborated");
});

test("within a bucket and tier, score orders", () => {
  const rows = sortLeads([
    lead("b", 40, "high", "hot"),
    lead("a", 90, "high", "hot"),
    lead("c", 65, "high", "hot"),
  ], "confidence");
  assert.deepEqual(rows.map((r) => r.score), [90, 65, 40]);
});

test("score sort is unchanged and ignores confidence", () => {
  const rows = sortLeads([
    lead("a", 40, "high", "cold"),
    lead("b", 90, "low", "hot"),
  ], "score");
  assert.deepEqual(rows.map((r) => r.score), [90, 40]);
});

test("name sort is unchanged", () => {
  const rows = sortLeads([lead("Zeta", 90, "high", "hot"), lead("Alpha", 10, "low", "cold")], "name");
  assert.deepEqual(rows.map((r) => r.name), ["Alpha", "Zeta"]);
});

test("sortLeads does not mutate its input", () => {
  const input = [lead("a", 10, "low", "cold"), lead("b", 90, "high", "hot")];
  const copy = input.slice();
  sortLeads(input, "confidence");
  assert.deepEqual(input, copy);
});

test("an unknown sort mode falls back to score", () => {
  const rows = sortLeads([lead("a", 10, "high", "hot"), lead("b", 90, "low", "cold")], "nonsense");
  assert.deepEqual(rows.map((r) => r.score), [90, 10]);
});
