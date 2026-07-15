import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { parsePlacesResponse } from "../lib/fetcher.js";
import { buildLeads, summarize } from "../lib/pipeline.js";
import { CFG } from "./helpers.js";

const require = createRequire(import.meta.url);
const DEMO_RAW = require("../public/demo_places.json");

test("buildLeads excludes low-fit and sorts by score desc", async () => {
  const { rows } = await buildLeads(CFG, parsePlacesResponse(DEMO_RAW));
  // DEMO_I is a laundromat (low-fit) named "Cypress Discount Vapes" → excluded
  assert.ok(rows.every((r) => r.name !== "Cypress Discount Vapes"));
  const scores = rows.map((r) => r.score);
  assert.deepEqual(scores, [...scores].sort((a, b) => b - a));
  assert.ok(rows.every((r) => r.campaign.email1_body));
});

test("buildLeads returns a chainsFiltered count (0 when no list)", async () => {
  const { chainsFiltered } = await buildLeads(CFG, parsePlacesResponse(DEMO_RAW));
  assert.equal(chainsFiltered, 0);
});

test("buildLeads drops businesses whose name matches a brand, and counts them", async () => {
  const businesses = parsePlacesResponse(DEMO_RAW);
  // Rename the first demo business (an in-ICP barber shop) to a chain name.
  const withChain = businesses.map((b, i) => (i === 0 ? { ...b, name: "Starbucks Coffee" } : b));
  const cfg = { ...CFG, search: { ...CFG.search, exclude_chains: ["Starbucks"] } };
  const { rows, chainsFiltered } = await buildLeads(cfg, withChain);
  assert.equal(chainsFiltered, 1);
  assert.ok(rows.every((r) => r.name !== "Starbucks Coffee"));
  assert.ok(rows.length > 0);
});

// ---------- business_status filtering ----------

test("buildLeads drops CLOSED_PERMANENTLY and counts it", async () => {
  // Without the filter this lead scores 74/hot on old bad reviews and tops the list.
  const b = business({
    place_id: "c1", name: "Ghost Kitchen", category: "restaurant", address: "1 Main St",
    rating: 2.5, review_count: 200, price_level: 3, business_status: "CLOSED_PERMANENTLY",
  });
  const { rows, closedFiltered } = await buildLeads(CFG, [b]);
  assert.equal(closedFiltered, 1);
  assert.equal(rows.length, 0);
});

test("buildLeads returns closedFiltered 0 when nothing is closed", async () => {
  const b = business({
    place_id: "o1", name: "Open Co", category: "cafe", address: "9 Main St",
    rating: 4.0, review_count: 30, business_status: "OPERATIONAL",
  });
  const { closedFiltered } = await buildLeads(CFG, [b]);
  assert.equal(closedFiltered, 0);
});

test("the demo fixture exercises the closed filter", async () => {
  // DEMO_K is CLOSED_PERMANENTLY (dropped); DEMO_L is CLOSED_TEMPORARILY (kept).
  const { rows, closedFiltered } = await buildLeads(CFG, parsePlacesResponse(DEMO_RAW));
  assert.equal(closedFiltered, 1);
  assert.ok(rows.every((r) => r.name !== "Old Post Cantina"), "permanently closed is dropped");
  const temp = rows.find((r) => r.name === "Harvest Table Kitchen");
  assert.ok(temp, "temporarily closed survives");
  assert.ok(temp.why.some((w) => w.toLowerCase().includes("temporarily closed")));
});

test("buildLeads keeps CLOSED_TEMPORARILY and flags it", async () => {
  const b = business({
    place_id: "c2", name: "Back Soon Cafe", category: "cafe", address: "2 Main St",
    rating: 3.2, review_count: 60, business_status: "CLOSED_TEMPORARILY",
  });
  const { rows, closedFiltered } = await buildLeads(CFG, [b]);
  assert.equal(closedFiltered, 0, "temporarily closed is not dropped");
  assert.equal(rows.length, 1);
  assert.ok(
    rows[0].why.some((w) => w.toLowerCase().includes("temporarily closed")),
    `expected a temporarily-closed chip, got ${JSON.stringify(rows[0].why)}`,
  );
});

test("buildLeads treats missing/empty business_status as operational", async () => {
  const b = business({
    place_id: "c3", name: "No Status Co", category: "salon", address: "3 Main St",
    rating: 3.5, review_count: 40, business_status: "",
  });
  const { rows, closedFiltered } = await buildLeads(CFG, [b]);
  assert.equal(closedFiltered, 0);
  assert.equal(rows.length, 1);
});

test("a closed business never reaches the processor scrape", async () => {
  // Closed leads must be dropped before enrichment so they can't burn fetch budget.
  let fetched = 0;
  const fetchImpl = async () => { fetched++; return respHtml("<html>clover.com</html>"); };
  const closed = business({
    place_id: "c4", name: "Dead Diner", category: "restaurant", address: "4 Main St",
    rating: 2.0, review_count: 300, website: "https://dead.example",
    business_status: "CLOSED_PERMANENTLY",
  });
  const cfg = { ...CFG, enrichment: { processor_detection: { enabled: true, max_sites: 5 }, owner: { enabled: false } } };
  const { rows } = await buildLeads(cfg, [closed], { fetchImpl });
  assert.equal(rows.length, 0);
  assert.equal(fetched, 0, "closed lead should not be scraped");
});

test("summarize counts add up", async () => {
  const { rows } = await buildLeads(CFG, parsePlacesResponse(DEMO_RAW));
  const s = summarize(rows);
  assert.equal(s.total, rows.length);
  assert.equal(s.displacement + s.greenfield, s.total);
});

import { business } from "../lib/models.js";

function respHtml(text, ok = true) { return { ok, text: async () => text }; }

test("buildLeads filters a lead by chain domain", async () => {
  const b = business({ place_id: "d1", name: "Loves of Cypress", category: "auto", address: "1 Rd, Cypress TX 77433", review_count: 100, website: "https://www.loves.com/store" });
  const cfg = { ...CFG, search: { ...CFG.search, exclude_domains: ["loves.com"] } };
  const { rows, chainsFiltered } = await buildLeads(cfg, [b]);
  assert.equal(chainsFiltered, 1);
  assert.equal(rows.length, 0);
});

test("buildLeads dedupes a TABC business that matches a Places business", async () => {
  const places = business({ place_id: "p1", name: "Bayou Craft Taproom", category: "bar", address: "1200 Barker Cypress Rd, Cypress, TX 77433", review_count: 40 });
  const tabc = business({ place_id: "tabc:MB1", name: "Bayou Craft Taproom", category: "bar", address: "1200 Barker Cypress Rd, Cypress, TX 77433", review_count: 0, source: "tabc" });
  const { rows } = await buildLeads(CFG, [places, tabc]);
  assert.equal(rows.filter((r) => r.name === "Bayou Craft Taproom").length, 1);
});

test("buildLeads attaches a processor when detection is enabled", async () => {
  const b = business({ place_id: "p1", name: "Joes Cafe", category: "cafe", address: "1 Main, Cypress TX 77433", rating: 4.0, review_count: 150, website: "https://joes.com/", price_level: 2 });
  const cfg = { ...CFG, enrichment: { processor_detection: { enabled: true, max_sites: 25, check_checkout_page: false } } };
  const fetchImpl = async (url) => {
    if (url.endsWith("/robots.txt")) return respHtml("");
    return respHtml('<script src="https://web.squarecdn.com/v1/square.js"></script>');
  };
  const { rows } = await buildLeads(cfg, [b], { fetchImpl, deadline: Infinity });
  const row = rows.find((r) => r.name === "Joes Cafe");
  assert.deepEqual(row.processor, ["Square"]);
  assert.ok(row.why.some((w) => w.includes("Square detected — channel unknown")));
});

test("buildLeads still scores when the scraping source is down (graceful)", async () => {
  const b = business({ place_id: "p1", name: "Joes Cafe", category: "cafe", address: "1 Main, Cypress TX 77433", rating: 3.2, review_count: 150, website: "https://joes.com/", price_level: 2 });
  const cfg = { ...CFG, enrichment: { processor_detection: { enabled: true, max_sites: 25 } } };
  const fetchImpl = async () => { throw new Error("network down"); };
  const { rows } = await buildLeads(cfg, [b], { fetchImpl, deadline: Infinity });
  const row = rows.find((r) => r.name === "Joes Cafe");
  assert.ok(row);
  assert.deepEqual(row.processor, []);
});

test("buildLeads enriches an above-threshold lead with an owner", async () => {
  const b = business({ place_id: "p1", name: "Joes Cafe", category: "cafe", rating: 3.0, review_count: 210, address: "1 Main, Cypress TX 77433", website: "https://joes.com/", price_level: 3, review_texts: ["surcharge and cash only"] });
  const cfg = { ...CFG, search: { ...CFG.search, score_threshold: 40 }, enrichment: { owner: { enabled: true, max_sites: 10 } } };
  const fetchImpl = async (url) => {
    if (url.endsWith("/robots.txt")) return respHtml("");
    return respHtml('<p>Owner: Jane Smith</p> mailto:jane@joes.com');
  };
  const { rows } = await buildLeads(cfg, [b], { fetchImpl, deadline: Infinity });
  const row = rows.find((r) => r.name === "Joes Cafe");
  assert.equal(row.owner.name, "Jane Smith");
  assert.equal(row.owner.email, "jane@joes.com");
});
