// test/enrich.test.js
import test from "node:test";
import assert from "node:assert/strict";
import { findContactPage, extractOwner, enrichOwner } from "../lib/enrich.js";

function resp(text, ok = true) { return { ok, text: async () => text }; }

test("findContactPage picks an About link", () => {
  assert.equal(findContactPage('<a href="/about-us">About</a>', "https://joes.com"), "https://joes.com/about-us");
});

test("findContactPage returns null when no candidate", () => {
  assert.equal(findContactPage('<a href="/menu">Menu</a>', "https://joes.com"), null);
});

test("extractOwner prefers a non-role email over info@", () => {
  const o = extractOwner('Contact <a href="mailto:info@joes.com">info</a> or <a href="mailto:jane@joes.com">Jane</a>');
  assert.equal(o.email, "jane@joes.com");
});

test("extractOwner falls back to a role email when it is the only one", () => {
  assert.equal(extractOwner('mailto:info@joes.com').email, "info@joes.com");
});

test("extractOwner reads a name from JSON-LD founder", () => {
  const html = '<script type="application/ld+json">{"@type":"Restaurant","founder":{"name":"Jane Smith"}}</script>';
  const o = extractOwner(html);
  assert.equal(o.name, "Jane Smith");
  assert.equal(o.confidence, "high");
});

test("extractOwner reads an 'Owner: Name' heuristic", () => {
  const o = extractOwner("<p>Owner: Maria Lopez</p>");
  assert.equal(o.name, "Maria Lopez");
  assert.equal(o.confidence, "low");
});

test("extractOwner returns nulls when nothing is found", () => {
  const o = extractOwner("<p>Great tacos.</p>");
  assert.equal(o.name, null);
  assert.equal(o.email, null);
});

test("enrichOwner reads homepage then contact page for the name", async () => {
  const cache = new Map(), robotsCache = new Map();
  const fetchImpl = async (url) => {
    if (url.endsWith("/robots.txt")) return resp("");
    if (url === "https://joes.com/") return resp('<a href="/team">Team</a> mailto:jane@joes.com');
    if (url === "https://joes.com/team") return resp("<p>Owner: Jane Smith</p>");
    return resp("");
  };
  const owner = await enrichOwner("https://joes.com/", { fetchImpl, cache, robotsCache, deadline: Infinity });
  assert.equal(owner.name, "Jane Smith");
  assert.equal(owner.email, "jane@joes.com");
});

test("enrichOwner returns null when the site is unreachable", async () => {
  const owner = await enrichOwner("https://down.com/", {
    fetchImpl: async () => { throw new Error("dead"); }, cache: new Map(), robotsCache: new Map(),
  });
  assert.equal(owner, null);
});
