import test from "node:test";
import assert from "node:assert/strict";
import { buildResearchLinks } from "../public/research.js";

function lead(over = {}) {
  return {
    name: "Joe's Tacos & Bar",
    address: "123 Main St, Cypress, TX 77433",
    website: "https://joestacos.com",
    place_id: "ChIJ_abc123",
    ...over,
  };
}

function byLabel(links, label) {
  return links.find((l) => l.label === label);
}

test("Google Business link deep-links via place_id and encodes name+address", () => {
  const g = byLabel(buildResearchLinks(lead()), "Google Business");
  assert.ok(g.href.startsWith("https://www.google.com/maps/search/?api=1"));
  assert.ok(g.href.includes("query_place_id=ChIJ_abc123"));
  assert.ok(g.href.includes(encodeURIComponent("Joe's Tacos & Bar")));
  assert.ok(g.href.includes(encodeURIComponent("123 Main St, Cypress, TX 77433")));
});

test("Google Business link omits query_place_id when place_id is missing", () => {
  const g = byLabel(buildResearchLinks(lead({ place_id: "" })), "Google Business");
  assert.ok(!g.href.includes("query_place_id="));
  assert.ok(g.href.includes(encodeURIComponent("Joe's Tacos & Bar")));
});

test("LinkedIn link is a Google search scoped to linkedin.com with the name", () => {
  const l = byLabel(buildResearchLinks(lead()), "LinkedIn");
  assert.ok(l.href.startsWith("https://www.google.com/search?q="));
  assert.ok(l.href.includes(encodeURIComponent("site:linkedin.com")));
  assert.ok(l.href.includes(encodeURIComponent('"Joe\'s Tacos & Bar"')));
  assert.ok(l.href.includes(encodeURIComponent("general manager")));
});

test("Website link is a direct link when website is present", () => {
  const w = byLabel(buildResearchLinks(lead()), "Website");
  assert.equal(w.href, "https://joestacos.com");
  assert.ok(!w.copyName);
});

test("Website entry is omitted when the lead has no website", () => {
  assert.equal(byLabel(buildResearchLinks(lead({ website: "" })), "Website"), undefined);
  assert.equal(byLabel(buildResearchLinks(lead({ website: null })), "Website"), undefined);
});

test("TX Comptroller entry has the fixed COA URL and copies the business name", () => {
  const c = byLabel(buildResearchLinks(lead()), "TX Comptroller");
  assert.equal(c.href, "https://mycpa.cpa.state.tx.us/coa/");
  assert.equal(c.copyName, "Joe's Tacos & Bar");
});

test("builder returns 4 entries with a website, 3 without", () => {
  assert.equal(buildResearchLinks(lead()).length, 4);
  assert.equal(buildResearchLinks(lead({ website: "" })).length, 3);
});
