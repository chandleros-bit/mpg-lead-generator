// test/http.test.js
import test from "node:test";
import assert from "node:assert/strict";
import {
  fetchWithTimeout, mapWithBudget, parseRobots, robotsDisallows, fetchPage,
} from "../lib/http.js";

function resp(text, ok = true) {
  return { ok, text: async () => text, json: async () => JSON.parse(text) };
}

test("fetchWithTimeout returns text on ok response", async () => {
  const html = await fetchWithTimeout("http://x", { fetchImpl: async () => resp("<html>hi</html>") });
  assert.equal(html, "<html>hi</html>");
});

test("fetchWithTimeout returns null on non-ok", async () => {
  const html = await fetchWithTimeout("http://x", { fetchImpl: async () => resp("nope", false) });
  assert.equal(html, null);
});

test("fetchWithTimeout returns null when fetch throws", async () => {
  const html = await fetchWithTimeout("http://x", { fetchImpl: async () => { throw new Error("boom"); } });
  assert.equal(html, null);
});

test("mapWithBudget maps all items when deadline is far", async () => {
  const out = await mapWithBudget([1, 2, 3], async (n) => n * 2, { concurrency: 2, deadline: Infinity });
  assert.deepEqual(out, [2, 4, 6]);
});

test("mapWithBudget leaves unreached items null past the deadline", async () => {
  const out = await mapWithBudget([1, 2, 3], async (n) => n, { concurrency: 1, deadline: Date.now() - 1 });
  assert.deepEqual(out, [null, null, null]);
});

test("parseRobots collects disallow prefixes per agent with * fallback", () => {
  const map = parseRobots("User-agent: *\nDisallow: /private\nDisallow: /tmp");
  assert.ok(robotsDisallows(map, "/private/x", "mpg-leadbot"));
  assert.ok(!robotsDisallows(map, "/public", "mpg-leadbot"));
});

test("robotsDisallows treats empty Disallow as allow-all", () => {
  const map = parseRobots("User-agent: *\nDisallow:");
  assert.equal(robotsDisallows(map, "/anything", "mpg-leadbot"), false);
});

test("fetchPage skips a disallowed path and caches the miss", async () => {
  const cache = new Map(), robotsCache = new Map();
  let siteHits = 0;
  const fetchImpl = async (url) => {
    if (url.endsWith("/robots.txt")) return resp("User-agent: *\nDisallow: /");
    siteHits++; return resp("<html>secret</html>");
  };
  const html = await fetchPage("http://x.com/about", { fetchImpl, cache, robotsCache });
  assert.equal(html, null);
  assert.equal(siteHits, 0);
});

test("fetchPage caches HTML so a second call does not refetch", async () => {
  const cache = new Map(), robotsCache = new Map();
  let hits = 0;
  const fetchImpl = async (url) => {
    if (url.endsWith("/robots.txt")) return resp("");
    hits++; return resp("<html>ok</html>");
  };
  const a = await fetchPage("http://x.com/", { fetchImpl, cache, robotsCache });
  const b = await fetchPage("http://x.com/", { fetchImpl, cache, robotsCache });
  assert.equal(a, "<html>ok</html>");
  assert.equal(b, "<html>ok</html>");
  assert.equal(hits, 1);
});
