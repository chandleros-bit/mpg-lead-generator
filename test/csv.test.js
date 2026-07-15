// test/csv.test.js
import test from "node:test";
import assert from "node:assert/strict";
import { leadsToCsv } from "../public/csv.js";

const HEADER =
  "Name,Category,Address,Phone,Website,Rating,Review Count,Score,Track,Bucket," +
  "Signals,Processors,Owner Name,Owner Email,Confidence,Evidence Count,Source";

function row(over = {}) {
  return {
    name: "Joe's Tacos", category: "restaurant", address: "123 Main St",
    phone: "7135550100", website: "https://joestacos.com", rating: 3.8,
    review_count: 210, score: 72, track: "displacement", bucket: "hot",
    why: ["Displacement • Restaurant", "Square detected on site"],
    processor: ["Square"], owner: { name: "Jane Smith", email: "jane@joestacos.com" },
    source: "places", confidence: "high", signals: ["card_present_processor", "keyword_pain"],
    ...over,
  };
}

test("first line is the labeled header row", () => {
  assert.equal(leadsToCsv([]).split("\r\n")[0], HEADER);
});

test("empty rows produce a header-only document", () => {
  assert.equal(leadsToCsv([]), HEADER);
});

test("a lead serializes to 17 labeled columns in order", () => {
  const cells = leadsToCsv([row({ why: ["a", "b"], processor: ["Square", "Toast"] })])
    .split("\r\n")[1].split(",");
  assert.deepEqual(cells, [
    "Joe's Tacos", "restaurant", "123 Main St", "7135550100", "https://joestacos.com",
    "3.8", "210", "72", "displacement", "hot", "a; b", "Square; Toast",
    "Jane Smith", "jane@joestacos.com", "high", "2", "places",
  ]);
});

test("fields with commas, quotes, or newlines are quoted and escaped", () => {
  const line = leadsToCsv([row({
    address: "123 Main St, Cypress, TX",
    name: 'Bob "The Boss" BBQ',
    why: ["fee complaints (\"surcharge\")"],
  })]).split("\r\n")[1];
  assert.ok(line.includes('"123 Main St, Cypress, TX"'));
  assert.ok(line.includes('"Bob ""The Boss"" BBQ"'));
  assert.ok(line.includes('"fee complaints (""surcharge"")"'));
});

test("empty arrays and null owner produce empty cells", () => {
  const cells = leadsToCsv([row({ why: [], processor: [], owner: null })])
    .split("\r\n")[1].split(",");
  assert.equal(cells[10], ""); // Signals (the why chips)
  assert.equal(cells[11], ""); // Processors
  assert.equal(cells[12], ""); // Owner Name
  assert.equal(cells[13], ""); // Owner Email
  assert.equal(cells[14], "high"); // Confidence
  assert.equal(cells[15], "2"); // Evidence Count
  assert.equal(cells[16], "places"); // Source
});

test("a lead with no evidence exports Low and a zero count", () => {
  const cells = leadsToCsv([row({ confidence: "low", signals: [] })]).split("\r\n")[1].split(",");
  assert.equal(cells[14], "low");
  assert.equal(cells[15], "0");
});

test("null/undefined rating serializes to an empty cell", () => {
  const cells = leadsToCsv([row({ rating: null })]).split("\r\n")[1].split(",");
  assert.equal(cells[5], ""); // Rating
  assert.equal(cells[6], "210"); // Review Count still present
});
