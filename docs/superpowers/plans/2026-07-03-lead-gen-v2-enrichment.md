# Lead-gen v2 — Enrichment & New Signals Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add processor-badge detection, a TABC greenfield source, chain-domain
filtering, and scrape-only owner enrichment to the JS/Netlify lead pipeline, all
config-driven and failing gracefully.

**Architecture:** Approach A — all work stays in the one `/api/leads` function. A
shared bounded-fetch utility (`lib/http.js`) enforces per-fetch timeout, robots
compliance, a per-request HTML cache, bounded concurrency, and a start-relative
wall-clock deadline. Processor detection runs on ranked Displacement candidates
*before* final scoring (so the badge moves the score); owner enrichment runs
*after* scoring on the small above-threshold set. Any disabled/failed/timed-out
source is skipped and the lead still scores on Places data alone.

**Tech Stack:** Node ESM, `node:test` + `node:assert/strict`, Netlify Functions
v2, Google Places, data.texas.gov Socrata (TABC).

**Reference:** Design spec at
`docs/superpowers/specs/2026-07-03-lead-gen-v2-enrichment-design.md`.

**Conventions (match existing code):**
- Run all tests: `node --test`. Run one file: `node --test test/<file>.test.js`.
- Pure modules mirror `lib/chains.js`: no DOM, injectable `fetchImpl`, unit-tested.
- Commit after each red→green cycle. JS path is Python-parity-free.

**Refinement vs. spec:** on review, `processor_max` is added **additively** to the
Displacement weights (no reduction of existing maxes needed); the 0–100 clamp
absorbs the overflow, and existing `scoring.test.js` fixtures stay unchanged.

---

### Task 1: `lib/http.js` — bounded fetch, budget, robots, cache

**Files:**
- Create: `lib/http.js`
- Test: `test/http.test.js`

- [ ] **Step 1: Write failing tests**

```js
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
```

- [ ] **Step 2: Run to verify failure**

Run: `node --test test/http.test.js`
Expected: FAIL — `Cannot find module '../lib/http.js'`.

- [ ] **Step 3: Implement `lib/http.js`**

```js
// lib/http.js
// Bounded, robots-aware fetch utilities for best-effort scraping. The only
// impurity is the injected fetchImpl, so everything here is testable offline.

export const BOT_UA = "MPG-LeadBot/1.0 (+https://mediapaymentsgroup.com/bot)";
export const BOT_UA_TOKEN = "mpg-leadbot";

export async function fetchWithTimeout(url, { timeoutMs = 3000, fetchImpl = fetch, userAgent = BOT_UA } = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const resp = await fetchImpl(url, { signal: ctrl.signal, headers: { "User-Agent": userAgent } });
    if (!resp || !resp.ok) return null;
    return await resp.text();
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

// Run fn over items with bounded concurrency, stopping at the wall-clock
// deadline. Items not reached by the deadline stay null (graceful skip).
export async function mapWithBudget(items, fn, { concurrency = 5, deadline = Infinity } = {}) {
  const results = new Array(items.length).fill(null);
  let i = 0;
  async function worker() {
    while (i < items.length) {
      const idx = i++;
      if (Date.now() >= deadline) return;
      results[idx] = await fn(items[idx], idx);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
  return results;
}

// Map user-agent → array of Disallow prefixes. Pragmatic grouping: a run of
// consecutive User-agent lines shares the rules that follow.
export function parseRobots(text) {
  const map = {};
  let agents = [], expectingAgents = true;
  for (const raw of String(text || "").split(/\r?\n/)) {
    const line = raw.replace(/#.*/, "").trim();
    if (!line) continue;
    const idx = line.indexOf(":");
    if (idx === -1) continue;
    const field = line.slice(0, idx).trim().toLowerCase();
    const value = line.slice(idx + 1).trim();
    if (field === "user-agent") {
      if (!expectingAgents) { agents = []; expectingAgents = true; }
      const a = value.toLowerCase();
      agents.push(a); map[a] ??= [];
    } else if (field === "disallow") {
      expectingAgents = false;
      for (const a of agents) (map[a] ??= []).push(value);
    } else {
      expectingAgents = false;
    }
  }
  return map;
}

export function robotsDisallows(map, path, userAgent = "*") {
  const ua = userAgent.toLowerCase();
  const rules = map[ua] || map["*"] || [];
  return rules.some((p) => p && path.startsWith(p));
}

// Robots-aware, cached page fetch shared by processor + owner scraping.
export async function fetchPage(url, { fetchImpl = fetch, cache, robotsCache, timeoutMs = 3000, userAgent = BOT_UA, uaToken = BOT_UA_TOKEN } = {}) {
  if (cache && cache.has(url)) return cache.get(url);
  let origin, path;
  try { const u = new URL(url); origin = u.origin; path = u.pathname; }
  catch { cache?.set(url, null); return null; }

  if (robotsCache) {
    let robots = robotsCache.get(origin);
    if (robots === undefined) {
      const txt = await fetchWithTimeout(`${origin}/robots.txt`, { timeoutMs, fetchImpl, userAgent });
      robots = txt ? parseRobots(txt) : {};
      robotsCache.set(origin, robots);
    }
    if (robotsDisallows(robots, path, uaToken)) { cache?.set(url, null); return null; }
  }

  const html = await fetchWithTimeout(url, { timeoutMs, fetchImpl, userAgent });
  cache?.set(url, html);
  return html;
}
```

- [ ] **Step 4: Run to verify pass**

Run: `node --test test/http.test.js`
Expected: PASS (9 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/http.js test/http.test.js
git commit -m "feat: lib/http.js bounded fetch, robots, budget, page cache"
```

---

### Task 2: `lib/processors.js` — processor/POS detection (#1)

**Files:**
- Create: `lib/processors.js`
- Test: `test/processors.test.js`

- [ ] **Step 1: Write failing tests**

```js
// test/processors.test.js
import test from "node:test";
import assert from "node:assert/strict";
import { detectProcessors, discoverCheckoutUrl, detectSiteProcessors } from "../lib/processors.js";

function resp(text, ok = true) { return { ok, text: async () => text }; }

test("detectProcessors finds Square by SDK domain", () => {
  assert.deepEqual(detectProcessors('<script src="https://web.squarecdn.com/v1/square.js"></script>'), ["Square"]);
});

test("detectProcessors finds Stripe by js.stripe.com", () => {
  assert.deepEqual(detectProcessors('<script src="https://js.stripe.com/v3"></script>'), ["Stripe"]);
});

test("detectProcessors returns [] when nothing matches", () => {
  assert.deepEqual(detectProcessors("<html>just a menu</html>"), []);
});

test("detectProcessors can find multiple processors", () => {
  const html = 'link to toasttab.com and js.stripe.com';
  assert.deepEqual(new Set(detectProcessors(html)), new Set(["Toast", "Stripe"]));
});

test("discoverCheckoutUrl resolves a relative order link", () => {
  const html = '<a href="/order-online">Order</a>';
  assert.equal(discoverCheckoutUrl(html, "https://joes.com"), "https://joes.com/order-online");
});

test("discoverCheckoutUrl returns null with no candidate", () => {
  assert.equal(discoverCheckoutUrl('<a href="/gallery">Photos</a>', "https://joes.com"), null);
});

test("detectSiteProcessors reads homepage then checkout page via cache", async () => {
  const cache = new Map(), robotsCache = new Map();
  const fetchImpl = async (url) => {
    if (url.endsWith("/robots.txt")) return resp("");
    if (url === "https://joes.com/") return resp('<a href="/order">Order</a>');
    if (url === "https://joes.com/order") return resp('<script src="https://clover.com/x.js">');
    return resp("");
  };
  const found = await detectSiteProcessors("https://joes.com/", { fetchImpl, cache, robotsCache, deadline: Infinity });
  assert.deepEqual(found, ["Clover"]);
});

test("detectSiteProcessors returns [] when the site is unreachable", async () => {
  const found = await detectSiteProcessors("https://down.com/", {
    fetchImpl: async () => { throw new Error("dead"); }, cache: new Map(), robotsCache: new Map(),
  });
  assert.deepEqual(found, []);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `node --test test/processors.test.js`
Expected: FAIL — `Cannot find module '../lib/processors.js'`.

- [ ] **Step 3: Implement `lib/processors.js`**

```js
// lib/processors.js
// Pure processor/POS fingerprint detection + a bounded site scrape. Fingerprints
// are payment-SDK/domain strings (far more reliable than visible badges).
import { fetchPage } from "./http.js";

export const PROCESSOR_SIGNATURES = {
  Square: ["squareup.com", "web.squarecdn.com", "square-marketplace"],
  Clover: ["clover.com", "clover.js"],
  Toast: ["toasttab.com"],
  Stripe: ["js.stripe.com", "stripe.com/v3", "checkout.stripe.com"],
  Clearent: ["clearent"],
  "Shopify Payments": ["cdn.shopify.com", "shopify.com/payments", "shop_pay"],
  PayPal: ["paypal.com/sdk", "paypalobjects.com"],
  Aloha: ["alohaenterprise", "ncrcloud"],
};

export function detectProcessors(html, signatures = PROCESSOR_SIGNATURES) {
  const text = String(html || "").toLowerCase();
  const found = [];
  for (const [name, sigs] of Object.entries(signatures)) {
    if (sigs.some((s) => text.includes(s.toLowerCase()))) found.push(name);
  }
  return found;
}

export function discoverCheckoutUrl(html, baseUrl) {
  const kw = ["order", "checkout", "menu", "toasttab.com", "clover.com"];
  const re = /href\s*=\s*["']([^"']+)["']/gi;
  let m;
  while ((m = re.exec(String(html || "")))) {
    if (kw.some((k) => m[1].toLowerCase().includes(k))) {
      try { return new URL(m[1], baseUrl).href; } catch { /* skip bad href */ }
    }
  }
  return null;
}

export async function detectSiteProcessors(website, deps) {
  const { fetchImpl, cache, robotsCache, timeoutMs = 3000, checkCheckout = true, deadline = Infinity } = deps;
  if (!website) return [];
  const html = await fetchPage(website, { fetchImpl, cache, robotsCache, timeoutMs });
  if (!html) return [];
  const found = new Set(detectProcessors(html));
  if (checkCheckout && Date.now() < deadline) {
    const checkoutUrl = discoverCheckoutUrl(html, website);
    if (checkoutUrl && checkoutUrl !== website) {
      const chtml = await fetchPage(checkoutUrl, { fetchImpl, cache, robotsCache, timeoutMs });
      for (const p of detectProcessors(chtml)) found.add(p);
    }
  }
  return [...found];
}
```

- [ ] **Step 4: Run to verify pass**

Run: `node --test test/processors.test.js`
Expected: PASS (8 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/processors.js test/processors.test.js
git commit -m "feat: processor/POS fingerprint detection (lib/processors.js)"
```

---

### Task 3: `lib/models.js` extension + `lib/tabc.js` — TABC greenfield source (#3)

**Files:**
- Modify: `lib/models.js` (extend `business()` with `source`, `licensed_on`, `processor`, `owner`)
- Create: `lib/tabc.js`
- Create: `test/fixtures/tabc_sample.json`
- Test: `test/tabc.test.js`

> **Field-name caveat:** the Socrata dataset id (`DEFAULT_DATASET`) and column
> names below are the current best-known TABC "License Information" fields but are
> **unverified**. Before relying on live data, confirm them against a real
> response from `https://data.texas.gov` and update both the fixture and the
> field reads. Tests are fixture-based, so a wrong field name will NOT be caught
> by the suite — the fixture must mirror a genuine payload.

- [ ] **Step 1: Extend `lib/models.js`**

In `lib/models.js`, add four fields to the object returned by `business()` (after `review_texts`):

```js
    review_texts: o.review_texts ?? [],
    source: o.source ?? "places",
    licensed_on: o.licensed_on ?? null,
    processor: o.processor ?? [],
    owner: o.owner ?? null,
```

- [ ] **Step 2: Create the fixture `test/fixtures/tabc_sample.json`**

```json
[
  {
    "license_number": "MB123456",
    "trade_name": "Bayou Craft Taproom",
    "license_type": "Mixed Beverage Permit",
    "location_address": "1200 Barker Cypress Rd",
    "location_city": "Cypress",
    "location_zip": "77433",
    "location_phone": "2815550142",
    "license_issue_date": "2026-06-15"
  },
  {
    "license_number": "BQ998877",
    "trade_name": "Katy Corner Cafe",
    "license_type": "Wine and Beer Retailer",
    "location_address": "455 Grand Pkwy",
    "location_city": "Katy",
    "location_zip": "77494",
    "license_issue_date": "2026-06-20"
  },
  { "license_number": "NONAME", "license_type": "Mixed Beverage Permit" }
]
```

- [ ] **Step 3: Write failing tests**

```js
// test/tabc.test.js
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { parseTabcRows, fetchTabcNew } from "../lib/tabc.js";

const require = createRequire(import.meta.url);
const SAMPLE = require("./fixtures/tabc_sample.json");

test("parseTabcRows maps rows into greenfield-shaped businesses", () => {
  const out = parseTabcRows(SAMPLE);
  assert.equal(out.length, 2); // the third row has no name → skipped
  const first = out[0];
  assert.equal(first.name, "Bayou Craft Taproom");
  assert.equal(first.category, "bar");
  assert.equal(first.source, "tabc");
  assert.equal(first.review_count, 0);
  assert.equal(first.website, null);
  assert.equal(first.licensed_on, "2026-06-15");
  assert.ok(first.place_id.startsWith("tabc:"));
  assert.ok(first.address.includes("77433"));
});

test("parseTabcRows categorizes wine/beer as bar and others as restaurant", () => {
  const out = parseTabcRows(SAMPLE);
  assert.equal(out[1].category, "bar");
});

test("parseTabcRows tolerates a non-array input", () => {
  assert.deepEqual(parseTabcRows(null), []);
  assert.deepEqual(parseTabcRows({ error: "bad" }), []);
});

test("fetchTabcNew returns [] with no counties", async () => {
  assert.deepEqual(await fetchTabcNew({ counties: [], sinceDays: 90, fetchImpl: async () => ({ ok: true, json: async () => [] }) }), []);
});

test("fetchTabcNew returns parsed rows on success", async () => {
  const fetchImpl = async () => ({ ok: true, json: async () => SAMPLE });
  const out = await fetchTabcNew({ counties: ["Harris"], sinceDays: 90, fetchImpl });
  assert.equal(out.length, 2);
});

test("fetchTabcNew swallows a fetch error and returns []", async () => {
  const fetchImpl = async () => { throw new Error("socrata down"); };
  assert.deepEqual(await fetchTabcNew({ counties: ["Harris"], sinceDays: 90, fetchImpl }), []);
});
```

- [ ] **Step 4: Run to verify failure**

Run: `node --test test/tabc.test.js`
Expected: FAIL — `Cannot find module '../lib/tabc.js'`.

- [ ] **Step 5: Implement `lib/tabc.js`**

```js
// lib/tabc.js
// Recently issued TABC (alcohol) licenses as a "new establishment, no processor
// yet" greenfield source. Pure parse + injectable fetch. See field-name caveat
// in the plan — dataset id and columns must be verified against a live payload.
import { business } from "./models.js";

export const DEFAULT_DATASET = "naix-2893"; // TABC License Information — VERIFY

export function tabcUrl({ dataset = DEFAULT_DATASET, counties, sinceDays }) {
  const since = new Date(Date.now() - sinceDays * 86400000).toISOString().slice(0, 10);
  const inList = counties.map((c) => `'${String(c).toUpperCase()}'`).join(",");
  const where = `license_issue_date >= '${since}' AND upper(location_county) in (${inList})`;
  return `https://data.texas.gov/resource/${dataset}.json?$where=${encodeURIComponent(where)}&$limit=1000`;
}

function categoryFor(licenseType) {
  const t = String(licenseType || "").toLowerCase();
  return /beer|wine|mixed|bar|beverage/.test(t) ? "bar" : "restaurant";
}

export function parseTabcRows(rows) {
  if (!Array.isArray(rows)) return [];
  const out = [];
  for (const r of rows) {
    const name = r.trade_name || r.location_name || r.owner_name || "";
    if (!name) continue;
    const address = [r.location_address, r.location_city, "TX", r.location_zip].filter(Boolean).join(", ");
    out.push(business({
      place_id: `tabc:${r.license_number || r.taxpayer_number || name}`,
      name,
      category: categoryFor(r.license_type || r.permit_type),
      address,
      phone: r.location_phone || null,
      website: null,
      rating: null,
      review_count: 0,
      price_level: null,
      business_status: "OPERATIONAL",
      review_texts: [],
      source: "tabc",
      licensed_on: r.license_issue_date || null,
    }));
  }
  return out;
}

export async function fetchTabcNew({ counties, sinceDays, appToken, fetchImpl = fetch } = {}) {
  if (!counties || !counties.length) return [];
  try {
    const headers = appToken ? { "X-App-Token": appToken } : {};
    const resp = await fetchImpl(tabcUrl({ counties, sinceDays }), { headers });
    if (!resp || !resp.ok) return [];
    return parseTabcRows(await resp.json());
  } catch {
    return [];
  }
}
```

- [ ] **Step 6: Run to verify pass**

Run: `node --test test/tabc.test.js`
Expected: PASS (6 tests).

- [ ] **Step 7: Commit**

```bash
git add lib/models.js lib/tabc.js test/tabc.test.js test/fixtures/tabc_sample.json
git commit -m "feat: TABC greenfield source + business() source/owner/processor fields"
```

---

### Task 4: `lib/enrich.js` — owner/decision-maker enrichment (#4)

**Files:**
- Create: `lib/enrich.js`
- Test: `test/enrich.test.js`

- [ ] **Step 1: Write failing tests**

```js
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
```

- [ ] **Step 2: Run to verify failure**

Run: `node --test test/enrich.test.js`
Expected: FAIL — `Cannot find module '../lib/enrich.js'`.

- [ ] **Step 3: Implement `lib/enrich.js`**

```js
// lib/enrich.js
// Best-effort owner/decision-maker enrichment by scraping the lead's own site.
// Pure extraction + a bounded scrape. Surfaces a name/email for MANUAL outreach —
// nothing is ever sent (generate-only boundary preserved).
import { fetchPage } from "./http.js";

const CONTACT_KW = ["about", "team", "meet", "staff", "owner", "contact", "our-story", "ourstory"];
const ROLE_LOCAL = new Set(["info", "support", "contact", "hello", "admin", "sales", "office", "team"]);

export function findContactPage(html, baseUrl) {
  const re = /href\s*=\s*["']([^"']+)["']/gi;
  let m;
  while ((m = re.exec(String(html || "")))) {
    if (CONTACT_KW.some((k) => m[1].toLowerCase().includes(k))) {
      try { return new URL(m[1], baseUrl).href; } catch { /* skip bad href */ }
    }
  }
  return null;
}

export function extractOwner(html) {
  const text = String(html || "");
  const out = { name: null, email: null, title: null, confidence: "low" };

  const mailtos = [...text.matchAll(/mailto:([^"'?>\s]+)/gi)].map((m) => m[1]);
  const bare = [...text.matchAll(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g)].map((m) => m[0]);
  const emails = [...mailtos, ...bare];
  out.email = emails.find((e) => !ROLE_LOCAL.has(e.split("@")[0].toLowerCase())) || emails[0] || null;

  for (const m of text.matchAll(/<script[^>]*application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      const data = JSON.parse(m[1]);
      for (const n of Array.isArray(data) ? data : [data]) {
        const person = n.founder || n.owner || (n["@type"] === "Person" ? n : null);
        if (person && person.name) { out.name = person.name; out.title = "Owner"; out.confidence = "high"; break; }
      }
    } catch { /* ignore malformed JSON-LD */ }
    if (out.name) break;
  }

  if (!out.name) {
    const flat = text.replace(/<[^>]+>/g, " ");
    const a = flat.match(/(?:owner|founder|proprietor)[:\s,–-]+([A-Z][a-z]+\s+[A-Z][a-z]+)/i);
    const b = flat.match(/([A-Z][a-z]+\s+[A-Z][a-z]+)\s*[,–-]\s*(?:owner|founder|proprietor)/i);
    if (a || b) { out.name = (a || b)[1]; out.title = "Owner"; out.confidence = "low"; }
  }
  return out;
}

export async function enrichOwner(website, deps) {
  const { fetchImpl, cache, robotsCache, timeoutMs = 3000, deadline = Infinity } = deps;
  if (!website) return null;
  const home = await fetchPage(website, { fetchImpl, cache, robotsCache, timeoutMs });
  let best = home ? extractOwner(home) : { name: null, email: null, title: null, confidence: "low" };

  if ((!best.name || !best.email) && home && Date.now() < deadline) {
    const contact = findContactPage(home, website);
    if (contact && contact !== website) {
      const chtml = await fetchPage(contact, { fetchImpl, cache, robotsCache, timeoutMs });
      if (chtml) {
        const more = extractOwner(chtml);
        best = {
          name: best.name || more.name,
          email: best.email || more.email,
          title: best.title || more.title,
          confidence: best.confidence === "high" || more.confidence === "high" ? "high" : "low",
        };
      }
    }
  }
  return best.name || best.email ? best : null;
}
```

- [ ] **Step 4: Run to verify pass**

Run: `node --test test/enrich.test.js`
Expected: PASS (9 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/enrich.js test/enrich.test.js
git commit -m "feat: owner/decision-maker enrichment (lib/enrich.js)"
```

---

### Task 5: `lib/chains.js` — domain matching (#2 delta)

**Files:**
- Modify: `lib/chains.js` (add `normalizeDomain`, `isChainDomain`)
- Test: `test/chains.test.js` (append cases)

- [ ] **Step 1: Add failing tests to `test/chains.test.js`**

Append to `test/chains.test.js`:

```js
import { normalizeDomain, isChainDomain } from "../lib/chains.js";

test("normalizeDomain strips scheme, www, and path", () => {
  assert.equal(normalizeDomain("https://www.Loves.com/stores/123"), "loves.com");
  assert.equal(normalizeDomain("http://order.toasttab.com"), "order.toasttab.com");
  assert.equal(normalizeDomain(""), "");
  assert.equal(normalizeDomain(null), "");
});

test("isChainDomain matches exact domain and subdomains", () => {
  const domains = ["loves.com"];
  assert.equal(isChainDomain("https://www.loves.com", domains), true);
  assert.equal(isChainDomain("https://stores.loves.com/tx", domains), true);
  assert.equal(isChainDomain("https://joestacos.com", domains), false);
});

test("isChainDomain is false for empty inputs", () => {
  assert.equal(isChainDomain("", ["loves.com"]), false);
  assert.equal(isChainDomain("https://loves.com", []), false);
  assert.equal(isChainDomain(null, ["loves.com"]), false);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `node --test test/chains.test.js`
Expected: FAIL — `normalizeDomain` / `isChainDomain` not exported.

- [ ] **Step 3: Add to `lib/chains.js`**

Append to `lib/chains.js`:

```js
// Bare host of a URL: drop scheme, leading www., and any path/query/hash.
export function normalizeDomain(url) {
  let s = String(url || "").trim().toLowerCase();
  if (!s) return "";
  s = s.replace(/^[a-z]+:\/\//, "").replace(/^www\./, "");
  return s.split(/[/?#]/)[0];
}

// True when the lead's domain equals, or is a subdomain of, any blocked domain.
export function isChainDomain(website, domains) {
  const d = normalizeDomain(website);
  if (!d || !domains || domains.length === 0) return false;
  return domains.some((dom) => {
    const nd = normalizeDomain(dom);
    return nd && (d === nd || d.endsWith(`.${nd}`));
  });
}
```

- [ ] **Step 4: Run to verify pass**

Run: `node --test test/chains.test.js`
Expected: PASS (all existing + 3 new).

- [ ] **Step 5: Commit**

```bash
git add lib/chains.js test/chains.test.js
git commit -m "feat: chain disqualifier domain matching (isChainDomain)"
```

---

### Task 6: `lib/scoring.js` — processor Displacement signal

**Files:**
- Modify: `lib/scoring.js` (add `processorPoints`, wire into displacement branch + why)
- Modify: `test/helpers.js` (add `processor_max` to `WEIGHTS.displacement`)
- Test: `test/scoring.test.js` (append cases)

- [ ] **Step 1: Add `processor_max` to `test/helpers.js`**

In `test/helpers.js`, change the displacement weights line to include `processor_max`:

```js
  displacement: { dissatisfaction_max: 35, keyword_pain_max: 12, tech_max: 20, volume_max: 20, processor_max: 25, icp_tiebreak: 3 },
```

- [ ] **Step 2: Write failing tests (append to `test/scoring.test.js`)**

```js
import { processorPoints } from "../lib/scoring.js";

test("processorPoints awards full weight only when a processor was detected", () => {
  assert.equal(processorPoints(["Square"], 25), 25);
  assert.equal(processorPoints([], 25), 0);
  assert.equal(processorPoints(undefined, 25), 0);
});

test("a detected processor raises the displacement score and adds a why-chip", () => {
  const base = makeBusiness({ category: "cafe", rating: 4.0, review_count: 150, website: "http://c.com", price_level: 2 });
  const withProc = makeBusiness({ category: "cafe", rating: 4.0, review_count: 150, website: "http://c.com", price_level: 2, processor: ["Square"] });
  const a = scoreBusiness(base, WEIGHTS, ICP);
  const b = scoreBusiness(withProc, WEIGHTS, ICP);
  assert.ok(b.score > a.score);
  assert.ok(b.why.some((w) => w.includes("Square detected on site")));
});

test("processor signal outweighs the keyword-pain signal", () => {
  // processor_max (25) must exceed keyword_pain_max (12)
  assert.ok(WEIGHTS.displacement.processor_max > WEIGHTS.displacement.keyword_pain_max);
});
```

- [ ] **Step 3: Run to verify failure**

Run: `node --test test/scoring.test.js`
Expected: FAIL — `processorPoints` not exported.

- [ ] **Step 4: Implement in `lib/scoring.js`**

Add the exported scorer near the other displacement scorers (after `volumePoints`):

```js
export function processorPoints(processor, wmax) {
  return processor && processor.length ? wmax : 0;
}
```

In `scoreBusiness`, inside the `if (track === "displacement")` block, update the score line and add the why-chip:

```js
    const vol = volumePoints(b.price_level, b.review_count, w.volume_max);
    const proc = processorPoints(b.processor, w.processor_max ?? 0);
    score = dis + pain + tech + vol + proc + w.icp_tiebreak;

    why.push(`Displacement • ${label(b.category)}`);
    if (b.processor && b.processor.length) why.push(`${b.processor[0]} detected on site`);
```

(Leave the rest of the displacement `why` pushes as they are.)

- [ ] **Step 5: Run to verify pass**

Run: `node --test test/scoring.test.js`
Expected: PASS — new tests green, all existing displacement/greenfield fixtures still pass (additive weight, no rebalance).

- [ ] **Step 6: Commit**

```bash
git add lib/scoring.js test/scoring.test.js test/helpers.js
git commit -m "feat: processor detection as a weighted displacement signal"
```

---

### Task 7: `lib/pipeline.js` — async orchestration, merge/dedupe, scrape wiring

**Files:**
- Modify: `lib/pipeline.js` (async `buildLeads`, TABC dedupe, chain-domain filter, processor + owner scrape passes)
- Test: `test/pipeline.test.js` (update existing to `await`; add new cases)

- [ ] **Step 1: Update existing tests to await + add new cases**

In `test/pipeline.test.js`, make the existing three `buildLeads` call sites `await` (they are inside `test(...)` callbacks — mark those callbacks `async` and prefix `await`):

```js
test("buildLeads excludes low-fit and sorts by score desc", async () => {
  const { rows } = await buildLeads(CFG, parsePlacesResponse(DEMO_RAW));
  // ...unchanged assertions...
});

test("buildLeads returns a chainsFiltered count (0 when no list)", async () => {
  const { chainsFiltered } = await buildLeads(CFG, parsePlacesResponse(DEMO_RAW));
  assert.equal(chainsFiltered, 0);
});

test("buildLeads drops businesses whose name matches a brand, and counts them", async () => {
  const businesses = parsePlacesResponse(DEMO_RAW);
  const withChain = businesses.map((b, i) => (i === 0 ? { ...b, name: "Starbucks Coffee" } : b));
  const cfg = { ...CFG, search: { ...CFG.search, exclude_chains: ["Starbucks"] } };
  const { rows, chainsFiltered } = await buildLeads(cfg, withChain);
  assert.equal(chainsFiltered, 1);
  assert.ok(rows.every((r) => r.name !== "Starbucks Coffee"));
  assert.ok(rows.length > 0);
});

test("summarize counts add up", async () => {
  const { rows } = await buildLeads(CFG, parsePlacesResponse(DEMO_RAW));
  const s = summarize(rows);
  assert.equal(s.total, rows.length);
  assert.equal(s.displacement + s.greenfield, s.total);
});
```

Append new cases:

```js
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
  assert.ok(row.why.some((w) => w.includes("Square detected on site")));
});

test("buildLeads still scores when the scraping source is down (graceful)", async () => {
  const b = business({ place_id: "p1", name: "Joes Cafe", category: "cafe", address: "1 Main, Cypress TX 77433", rating: 3.2, review_count: 150, website: "https://joes.com/", price_level: 2 });
  const cfg = { ...CFG, enrichment: { processor_detection: { enabled: true, max_sites: 25 } } };
  const fetchImpl = async () => { throw new Error("network down"); };
  const { rows } = await buildLeads(cfg, [b], { fetchImpl, deadline: Infinity });
  const row = rows.find((r) => r.name === "Joes Cafe");
  assert.ok(row); // still present and scored
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
```

- [ ] **Step 2: Run to verify failure**

Run: `node --test test/pipeline.test.js`
Expected: FAIL — `buildLeads(...).rows` is undefined (not awaited) / new fields missing.

- [ ] **Step 3: Rewrite `lib/pipeline.js`**

```js
// lib/pipeline.js
import { scoreBusiness, classifyTrack } from "./scoring.js";
import { generateCampaign } from "./campaigns.js";
import { isChain, isChainDomain, normalizeName } from "./chains.js";
import { detectSiteProcessors } from "./processors.js";
import { enrichOwner } from "./enrich.js";
import { mapWithBudget } from "./http.js";

// Dedupe key resilient to address-string differences between Places and TABC:
// normalized name + first number (street #) + 5-digit ZIP.
function dedupeKey(b) {
  const addr = String(b.address || "");
  const num = (addr.match(/\d+/) || [""])[0];
  const zip = (addr.match(/\b\d{5}\b/) || [""])[0];
  return `${normalizeName(b.name)}|${num}|${zip}`;
}

export async function buildLeads(cfg, businesses, deps = {}) {
  const icp = new Set(cfg.search.verticals);
  const personal = cfg.personal;
  const weights = cfg.weights;
  const brands = cfg.search.exclude_chains ?? [];
  const domains = cfg.search.exclude_domains ?? [];
  const cutoff = weights.greenfield_review_cutoff;
  const threshold = cfg.search.score_threshold ?? 40;
  const enr = cfg.enrichment ?? {};
  const { fetchImpl } = deps;
  const deadline = deps.deadline ?? Infinity;
  const cache = new Map();
  const robotsCache = new Map();

  // 1. Dedupe TABC rows that collide with a Places business.
  const placesKeys = new Set(
    businesses.filter((b) => (b.source ?? "places") !== "tabc").map(dedupeKey)
  );
  const merged = businesses.filter(
    (b) => (b.source ?? "places") !== "tabc" || !placesKeys.has(dedupeKey(b))
  );

  // 2. Chain filter (name OR domain).
  let chainsFiltered = 0;
  const kept = [];
  for (const b of merged) {
    if (isChain(b.name, brands) || isChainDomain(b.website, domains)) { chainsFiltered++; continue; }
    kept.push(b);
  }

  // 3. Processor scrape on ranked Displacement candidates (before final scoring).
  const pd = enr.processor_detection ?? {};
  if (pd.enabled && fetchImpl) {
    const candidates = kept
      .filter((b) => b.website && classifyTrack(b, icp, cutoff) === "displacement")
      .map((b) => ({ b, pre: scoreBusiness(b, weights, icp).score }))
      .sort((x, y) => y.pre - x.pre)
      .slice(0, pd.max_sites ?? 25)
      .map((x) => x.b);
    await mapWithBudget(candidates, async (b) => {
      b.processor = await detectSiteProcessors(b.website, {
        fetchImpl, cache, robotsCache,
        timeoutMs: pd.fetch_timeout_ms ?? 3000,
        checkCheckout: pd.check_checkout_page !== false,
        deadline,
      });
    }, { concurrency: 5, deadline });
  }

  // 4. Score everything.
  const scored = [];
  for (const b of kept) {
    const lead = scoreBusiness(b, weights, icp);
    if (lead.track === "low_fit") continue;
    scored.push(lead);
  }

  // 5. Owner enrichment on above-threshold leads with a website.
  const ow = enr.owner ?? {};
  if (ow.enabled && fetchImpl) {
    const targets = scored
      .filter((l) => l.score >= threshold && l.business.website)
      .slice(0, ow.max_sites ?? 10);
    await mapWithBudget(targets, async (l) => {
      l.business.owner = await enrichOwner(l.business.website, {
        fetchImpl, cache, robotsCache, timeoutMs: ow.fetch_timeout_ms ?? 3000, deadline,
      });
    }, { concurrency: 5, deadline });
  }

  // 6. Build display rows.
  const rows = [];
  for (const lead of scored) {
    const b = lead.business;
    const camp = generateCampaign(lead, personal);
    rows.push({
      place_id: b.place_id,
      name: b.name,
      category: b.category.replace(/_/g, " "),
      address: b.address,
      phone: b.phone || "",
      website: b.website || "",
      rating: b.rating,
      review_count: b.review_count,
      score: lead.score,
      track: lead.track,
      bucket: lead.bucket,
      why: lead.why,
      processor: b.processor ?? [],
      owner: b.owner ?? null,
      source: b.source ?? "places",
      campaign: {
        email1_subject: camp.email1_subject,
        email1_body: camp.email1_body,
        email2_subject: camp.email2_subject,
        email2_body: camp.email2_body,
        sms: camp.sms,
        voicemail: camp.voicemail,
      },
    });
  }

  rows.sort((a, b) => b.score - a.score);
  return { rows, chainsFiltered };
}

export function summarize(rows) {
  return {
    total: rows.length,
    hot: rows.filter((r) => r.bucket === "hot").length,
    warm: rows.filter((r) => r.bucket === "warm").length,
    cold: rows.filter((r) => r.bucket === "cold").length,
    displacement: rows.filter((r) => r.track === "displacement").length,
    greenfield: rows.filter((r) => r.track === "greenfield").length,
  };
}
```

- [ ] **Step 4: Run to verify pass**

Run: `node --test test/pipeline.test.js`
Expected: PASS (existing + 5 new).

- [ ] **Step 5: Commit**

```bash
git add lib/pipeline.js test/pipeline.test.js
git commit -m "feat: async pipeline — TABC merge/dedupe, chain-domain filter, processor+owner scrape"
```

---

### Task 8: `lib/campaigns.js` — address the owner by name

**Files:**
- Modify: `lib/campaigns.js` (owner-aware greeting)
- Test: `test/campaigns.test.js` (append case)

- [ ] **Step 1: Add a failing test to `test/campaigns.test.js`**

Append the tests below. Do **not** add imports — `generateCampaign` and `PERSONAL`
are already imported at the top of this file.

```js
function leadWith(owner) {
  return {
    track: "displacement",
    business: { place_id: "p1", name: "Joes Cafe", category: "cafe", owner },
  };
}

test("greeting uses the owner's first name when known", () => {
  const c = generateCampaign(leadWith({ name: "Jane Smith" }), PERSONAL);
  assert.ok(c.email1_body.startsWith("Hi Jane,"));
});

test("greeting falls back to the business team when no owner", () => {
  const c = generateCampaign(leadWith(null), PERSONAL);
  assert.ok(c.email1_body.startsWith("Hi Joes Cafe team,"));
});
```

- [ ] **Step 2: Run to verify failure**

Run: `node --test test/campaigns.test.js`
Expected: FAIL — greeting is still `Hi Joes Cafe team,` for the owner case.

- [ ] **Step 3: Implement in `lib/campaigns.js`**

Add a helper near the top (after `footer`):

```js
function greeting(lead) {
  const owner = lead.business.owner;
  if (owner && owner.name) {
    const first = String(owner.name).trim().replace(/^(dr|mr|mrs|ms)\.?\s+/i, "").split(/\s+/)[0];
    if (first) return `Hi ${first},`;
  }
  return `Hi ${lead.business.name} team,`;
}
```

In both `displacement(lead, personal)` and `greenfield(lead, personal)`, replace the opening line `` `Hi ${name} team,\n\n` + `` in `email1_body` with `` `${greeting(lead)}\n\n` + ``.

- [ ] **Step 4: Run to verify pass**

Run: `node --test test/campaigns.test.js`
Expected: PASS (existing + 2 new).

- [ ] **Step 5: Commit**

```bash
git add lib/campaigns.js test/campaigns.test.js
git commit -m "feat: address a known owner by first name in campaign copy"
```

---

### Task 9: `config.json` + `lib/config.js` — knobs, sources, weights

**Files:**
- Modify: `config.json` (add `exclude_domains`, `sources`, `enrichment`, `processor_max`, seed Love's)
- Modify: `lib/config.js` (expose `enrichment` + `sources`; forward `enrichment` in `cfgDict`)
- Modify: `test/config.test.js` (the existing `cfgDict` key assertion must include `enrichment`)

- [ ] **Step 1: Edit `config.json`**

Add `"Love's Travel Stop"` to `search.exclude_chains`, and add these keys:

```jsonc
"search": {
  // ...existing keys...
  "exclude_domains": ["loves.com"]
},
"sources": {
  "tabc": { "enabled": true, "counties": ["Harris", "Fort Bend"], "since_days": 120, "app_token_env": "TABC_APP_TOKEN" }
},
"enrichment": {
  "global_budget_ms": 6000,
  "processor_detection": { "enabled": true, "max_sites": 25, "fetch_timeout_ms": 3000, "check_checkout_page": true },
  "owner": { "enabled": true, "max_sites": 10, "fetch_timeout_ms": 3000 }
}
```

And add `processor_max` to `weights.displacement`:

```jsonc
"displacement": {"dissatisfaction_max": 35, "keyword_pain_max": 12, "tech_max": 20, "volume_max": 20, "processor_max": 25, "icp_tiebreak": 3},
```

- [ ] **Step 2: Edit `lib/config.js`**

`loadConfig` returns object — add two fields:

```js
  return {
    search: raw.search,
    personal: raw.personal,
    weights: raw.weights,
    enrichment: raw.enrichment ?? {},
    sources: raw.sources ?? {},
    apiKey: process.env.GOOGLE_PLACES_API_KEY || null,
    passphrase: process.env.APP_PASSPHRASE || null,
  };
```

`cfgDict` forwards enrichment to the pipeline:

```js
export function cfgDict(cfg) {
  return { search: cfg.search, personal: cfg.personal, weights: cfg.weights, enrichment: cfg.enrichment };
}
```

- [ ] **Step 3: Update the `cfgDict` shape assertion in `test/config.test.js`**

The existing test asserts `cfgDict` exposes exactly `["personal","search","weights"]`.
`cfgDict` now also forwards `enrichment`, so update that assertion:

```js
test("cfgDict exposes search/personal/weights/enrichment", () => {
  const cfg = loadConfig();
  const d = cfgDict(cfg);
  assert.deepEqual(Object.keys(d).sort(), ["enrichment", "personal", "search", "weights"]);
});
```

- [ ] **Step 4: Run the full suite to verify nothing regressed**

Run: `node --test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add config.json lib/config.js test/config.test.js
git commit -m "feat: config for enrichment sources, exclude_domains, processor_max, Love's"
```

---

### Task 10: `netlify/functions/leads.js` — deadline, TABC fetch, async buildLeads

**Files:**
- Modify: `netlify/functions/leads.js`
- Test: `test/function.test.js` (guard bodyless GETs in stubs; add graceful-enrichment case)

- [ ] **Step 1: Update `test/function.test.js`**

In the two tests that assign `placesBody = JSON.parse(opts.body)` ("address location is geocoded…" and "coordinate location skips geocoding"), guard against the bodyless GET requests that scraping/TABC now make:

```js
    if (opts && opts.body) placesBody = JSON.parse(opts.body);
```

Append a graceful-enrichment case:

```js
test("live enrichment failure still returns scored leads", async () => {
  process.env.APP_PASSPHRASE = "right";
  process.env.GOOGLE_PLACES_API_KEY = "key";
  const orig = globalThis.fetch;
  globalThis.fetch = async (url, opts) => {
    if (String(url).includes("maps/api/geocode")) {
      return new Response(JSON.stringify({ status: "OK", results: [{ geometry: { location: { lat: 30, lng: -95 } } }] }), { status: 200 });
    }
    if (String(url).includes("places.googleapis.com")) {
      return new Response(JSON.stringify(DEMO_RAW), { status: 200 });
    }
    // robots.txt, lead sites, Socrata: simulate down
    throw new Error("enrichment source down");
  };
  try {
    const res = await handler(new Request("http://x/api/leads?location=30,-95", { headers: { "x-app-passphrase": "right" } }));
    assert.equal(res.status, 200);
    const d = await res.json();
    assert.ok(d.leads.length > 0);
    assert.equal(typeof d.summary.chainsFiltered, "number");
  } finally { globalThis.fetch = orig; }
});
```

- [ ] **Step 2: Run to verify failure**

Run: `node --test test/function.test.js`
Expected: FAIL — new test and/or async change not yet wired.

- [ ] **Step 3: Edit `netlify/functions/leads.js`**

Add the import:

```js
import { fetchTabcNew } from "../../lib/tabc.js";
```

At the top of `handler`, compute the deadline:

```js
export default async function handler(req) {
  const cfg = loadConfig();
  const requestStart = Date.now();
  const deadline = requestStart + (cfg.enrichment?.global_budget_ms ?? 6000);
  const url = new URL(req.url);
  const demo = url.searchParams.get("demo") === "1";
```

After the live `businesses = await fetchAllVerticals({...})` call (still inside the `else` branch, before the closing `}` of the `try`), merge TABC:

```js
      const t = cfg.sources?.tabc;
      if (t?.enabled) {
        const tabc = await fetchTabcNew({
          counties: t.counties, sinceDays: t.since_days,
          appToken: process.env[t.app_token_env] || null, fetchImpl: fetch,
        });
        businesses = businesses.concat(tabc);
      }
```

Replace the final `buildLeads` call with the async, deps-aware version (demo skips live scraping):

```js
  const deps = demo ? {} : { fetchImpl: fetch, deadline };
  const { rows, chainsFiltered } = await buildLeads(cfgDict(cfg), businesses, deps);
  return json({
    leads: rows,
    summary: { ...summarize(rows), chainsFiltered },
    demo,
    threshold: cfg.search.score_threshold ?? 40,
  });
```

- [ ] **Step 4: Run to verify pass**

Run: `node --test test/function.test.js`
Expected: PASS (existing + new graceful case).

- [ ] **Step 5: Run the full suite**

Run: `node --test`
Expected: PASS across all files.

- [ ] **Step 6: Commit**

```bash
git add netlify/functions/leads.js test/function.test.js
git commit -m "feat: wire TABC + enrichment deadline into the leads function"
```

---

### Task 11: `public/dashboard.js` — processor chip color + owner display

**Files:**
- Modify: `public/dashboard.js`

> No unit test: `dashboard.js` is a browser IIFE with no existing test harness.
> Verify via the preview workflow (below).

- [ ] **Step 1: Make processor why-chips render as copper "signal" chips**

In `isSignal(reason)`, add a `"detected on site"` check:

```js
  function isSignal(reason) {
    var r = reason.toLowerCase();
    return r.indexOf("complaint") >= 0 || r.indexOf("no website") >= 0 ||
           r.indexOf("surcharge") >= 0 || r.indexOf("cash only") >= 0 ||
           r.indexOf("detected on site") >= 0;
  }
```

- [ ] **Step 2: Show the owner in the research panel**

Add an owner-line helper above `researchPanel`:

```js
  function ownerLine(lead) {
    var o = lead.owner;
    if (!o || (!o.name && !o.email)) return "";
    var bits = [];
    if (o.name) bits.push("<strong>" + esc(o.name) + "</strong>" + (o.title ? " · " + esc(o.title) : ""));
    if (o.email) bits.push('<a href="mailto:' + esc(o.email) + '">' + esc(o.email) + "</a>");
    return '<div class="research-owner">Owner: ' + bits.join(" · ") + "</div>";
  }
```

In `researchPanel`, insert the owner line before the links:

```js
  function researchPanel(lead) {
    var links = buildResearchLinks(lead).map(researchLinkEl).join("");
    return (
      '<div class="research-inner">' +
        '<div class="research-head">Who to ask for · research before you call</div>' +
        ownerLine(lead) +
        '<div class="research-links">' + links + "</div>" +
      "</div>"
    );
  }
```

- [ ] **Step 3: Verify in the browser preview**

- Ensure a launch config exists (`.claude/launch.json`) running `npx netlify dev` (or `npm run dev`) on its port; start it with the preview tool.
- Load `/?demo=1`. (Demo skips live scraping, so processor/owner will be empty — this only verifies no render regression.)
- To verify the new UI renders, temporarily add `"processor": ["Square"]` and `"owner": {"name":"Jane Smith","email":"jane@x.com","title":"Owner"}` to one lead in `public/demo_places.json`? No — demo data is Places-shaped, not lead-shaped. Instead confirm via `preview_snapshot` that existing cards still render and expand ("Who to ask for" panel opens), and confirm the `isSignal`/`ownerLine` code paths with a quick `preview_eval` calling the functions on a stub lead.
- Expected: cards render, no console errors (`preview_console_logs`).

- [ ] **Step 4: Commit**

```bash
git add public/dashboard.js
git commit -m "feat: copper processor chips + owner display on lead cards"
```

---

### Task 12: README — update Notes / limitations

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Rewrite the "Notes / limitations" bullets**

Replace the existing bullet block under `## Notes / limitations` with:

```markdown
- SMS and voicemail are **generate-only** — you send them. No automated sending.
- Every generated email carries a CAN-SPAM footer (address + opt-out) from config.
- **Processor badge = confirmed incumbent, best-effort.** When a lead's site
  exposes a known payment SDK/fingerprint (Square, Clover, Toast, Stripe, …) it is
  a high-confidence Displacement signal shown as a copper "why" chip. False
  negatives are common (sites that hide the processor, or use one we can't see
  from the front end); a *missing* badge is not proof of no processor.
- **TABC greenfield = confirmed new alcohol license.** New bars/restaurants pulled
  from the Texas open-data TABC feed are genuinely newly licensed; "no processor
  yet" is still *inferred*. TABC is filtered by county, so results may fall
  slightly outside your exact search radius.
- **Owner enrichment = best-effort.** Names/emails are scraped from the lead's own
  About/Team/Contact pages and may be missing or wrong; they are surfaced for you
  to contact manually — still generate-only.
- Scraping honors robots.txt, sends an identifying User-Agent, and only fetches a
  couple of shallow pages per site. Any source that is disabled, down, or slow is
  skipped — the lead still scores on Places data alone.
- Yelp review scanning is **not** integrated: there is no ToS-compliant way to get
  full review text (the Fusion API returns only short excerpts).
- The tool can't see a merchant's actual processor contract end-date — the score
  predicts switch-likelihood, not a guaranteed opening.
- **Not legal advice.** Confirm you may lawfully contact a business before outreach.
```

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs: update Notes/limitations for v2 enrichment sources"
```

---

## Self-Review

**Spec coverage:**
- #1 Processor detection → Tasks 1, 2, 6, 7, 11. Weighted above keyword-pain (Task 6). ✅
- #2 Chain-domain delta → Task 5, wired in Task 7; Love's seeded Task 9. ✅
- #3 TABC greenfield → Task 3, merged/deduped Task 7, fetched Task 10. ✅
- #4 Owner enrichment → Task 4, wired Task 7, copy Task 8, UI Task 11. ✅
- Graceful degradation → `lib/http.js` (Task 1) + explicit tests in Tasks 7 & 10. ✅
- Config-driven → Task 9. Robots.txt → Task 1. README → Task 12. ✅
- Yelp explicitly cut → README Task 12. ✅

**Placeholder scan:** No "TBD/TODO/later" left as work items. The one flagged
unknown (TABC dataset id/fields) is called out with a concrete default, a fixture,
and a verification instruction — not a blank. ✅

**Type consistency:** `fetchPage`/`fetchWithTimeout`/`mapWithBudget` signatures in
Task 1 match their callers in Tasks 2, 4, 7. `business()` gains `source`,
`licensed_on`, `processor`, `owner` (Task 3) and rows expose the same (Task 7).
`processorPoints(processor, wmax)` (Task 6) matches the `b.processor` array set in
Task 7. `owner` object shape `{ name, email, title, confidence }` (Task 4) matches
`ownerLine`/campaign reads (Tasks 8, 11). `deps.deadline` threaded consistently
from Task 10 → 7 → 2/4. ✅

**Deviation noted:** `processor_max` is additive (no rebalance of existing
displacement maxes), so `scoring.test.js` fixtures are preserved — a deliberate,
documented refinement of the spec's "rebalance" note.
