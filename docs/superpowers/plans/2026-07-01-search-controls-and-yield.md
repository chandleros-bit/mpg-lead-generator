# Search Controls + Higher Lead Yield Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the user set search location (address/ZIP) and distance (miles) live from the dashboard, and raise lead yield by searching one Places call per vertical instead of one call total.

**Architecture:** The Netlify function reads `location` and `miles` query params, geocodes an address into coordinates via the Google Geocoding API, converts miles→meters, then issues one `searchNearby` call per ICP vertical (deduping and tagging each result to its vertical so nothing is wrongly dropped as `low_fit`). The frontend gains a location box and a miles box, persists them in `localStorage`, and displays distance in miles.

**Tech Stack:** Node.js ES modules, Netlify Functions v2, `node --test`, Google Places API (New) `searchNearby`, Google Geocoding API. No build step for `lib/` — plain ESM.

**Spec:** [docs/superpowers/specs/2026-07-01-search-controls-and-yield-design.md](../specs/2026-07-01-search-controls-and-yield-design.md)

---

## File Structure

| File | Responsibility | Change |
| --- | --- | --- |
| `lib/geocode.js` | Address→coordinates + coordinate detection | Create |
| `test/geocode.test.js` | Unit tests for geocode module | Create |
| `lib/fetcher.js` | Add `fetchAllVerticals` (per-vertical fan-out, dedupe, tag) | Modify |
| `test/fetcher.test.js` | Tests for `fetchAllVerticals` | Modify |
| `netlify/functions/leads.js` | Parse params, geocode, convert miles, call `fetchAllVerticals` | Modify |
| `test/function.test.js` | Tests for param parsing / geocode / radius | Modify |
| `public/index.html` | Location + miles inputs | Modify |
| `public/dashboard.js` | Read inputs, send params, persist, miles display | Modify |
| `public/dashboard.css` | Style the new controls | Modify |

Existing modules (`scoring.js`, `pipeline.js`, `campaigns.js`, `models.js`, `config.js`) are unchanged.

---

## Task 1: Geocoding module

Converts an address/ZIP into a `"lat,lng"` string and detects when input is already coordinates. Pure module, stubbed-fetch tests.

**Files:**
- Create: `lib/geocode.js`
- Test: `test/geocode.test.js`

- [ ] **Step 1: Write the failing tests**

Create `test/geocode.test.js`:

```js
import test from "node:test";
import assert from "node:assert/strict";
import { geocodeAddress, looksLikeCoords } from "../lib/geocode.js";

test("looksLikeCoords detects coordinate strings", () => {
  assert.equal(looksLikeCoords("29.9691,-95.6972"), true);
  assert.equal(looksLikeCoords("40, -70"), true);
  assert.equal(looksLikeCoords("77433"), false);
  assert.equal(looksLikeCoords("Cypress, TX"), false);
});

test("geocodeAddress returns lat,lng on success", async () => {
  const orig = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response(JSON.stringify({ status: "OK", results: [{ geometry: { location: { lat: 29.5, lng: -95.5 } } }] }), { status: 200 });
  try {
    assert.equal(await geocodeAddress("k", "77433"), "29.5,-95.5");
  } finally { globalThis.fetch = orig; }
});

test("geocodeAddress returns null on ZERO_RESULTS", async () => {
  const orig = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response(JSON.stringify({ status: "ZERO_RESULTS", results: [] }), { status: 200 });
  try {
    assert.equal(await geocodeAddress("k", "zzzzz"), null);
  } finally { globalThis.fetch = orig; }
});

test("geocodeAddress throws on HTTP error", async () => {
  const orig = globalThis.fetch;
  globalThis.fetch = async () => new Response("nope", { status: 500 });
  try {
    await assert.rejects(() => geocodeAddress("k", "x"), /Geocoding API error 500/);
  } finally { globalThis.fetch = orig; }
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test test/geocode.test.js`
Expected: FAIL — cannot resolve `../lib/geocode.js` (module does not exist).

- [ ] **Step 3: Write the module**

Create `lib/geocode.js`:

```js
export const GEOCODE_URL = "https://maps.googleapis.com/maps/api/geocode/json";

// True when the string is already a "lat,lng" pair (so we can skip geocoding).
// "Cypress, TX" has a comma but non-numeric parts, so it returns false.
export function looksLikeCoords(s) {
  return /^-?\d+(\.\d+)?\s*,\s*-?\d+(\.\d+)?$/.test(String(s).trim());
}

// Returns "lat,lng" on success, or null when the address can't be resolved.
// Throws on HTTP/network failure so the caller can distinguish "not found"
// (400 to the user) from "upstream broke" (502).
export async function geocodeAddress(apiKey, query) {
  const url = `${GEOCODE_URL}?address=${encodeURIComponent(query)}&key=${apiKey}`;
  const resp = await fetch(url);
  if (!resp.ok) {
    const detail = await resp.text().catch(() => "");
    throw new Error(`Geocoding API error ${resp.status}${detail ? `: ${detail}` : ""}`);
  }
  const data = await resp.json();
  if (data.status !== "OK" || !data.results || !data.results.length) {
    return null;
  }
  const loc = data.results[0].geometry.location;
  return `${loc.lat},${loc.lng}`;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test test/geocode.test.js`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/geocode.js test/geocode.test.js
git commit -m "feat: geocode module — address/ZIP to coordinates"
```

---

## Task 2: Per-vertical fan-out in fetcher

Add `fetchAllVerticals`: one `searchNearby` per vertical, dedupe by `place_id`, tag each result's `category` to the vertical it was searched under, and stay resilient to a single vertical failing.

**Files:**
- Modify: `lib/fetcher.js` (add export at end of file)
- Test: `test/fetcher.test.js` (add import + 3 tests)

- [ ] **Step 1: Write the failing tests**

In `test/fetcher.test.js`, update the import block at the top to add `fetchAllVerticals`:

```js
import {
  parsePlacesResponse, dedupe, normalizeCategory, loadDemoBusinesses,
  fetchNearby, PRICE_LEVELS, verticalsToPlaceTypes, fetchAllVerticals,
} from "../lib/fetcher.js";
```

Then append these tests to the end of `test/fetcher.test.js`:

```js
test("fetchAllVerticals dedupes across verticals and tags category", async () => {
  const orig = globalThis.fetch;
  const one = { places: [{ id: "X", displayName: { text: "Co" }, primaryType: "restaurant", formattedAddress: "1 St" }] };
  globalThis.fetch = async () => new Response(JSON.stringify(one), { status: 200 });
  try {
    const out = await fetchAllVerticals({
      apiKey: "k", location: "1,2", radiusMeters: 1000, verticals: ["salon", "restaurant"], maxResults: 20,
    });
    assert.equal(out.length, 1);          // same place_id from both verticals → deduped
    assert.equal(out[0].category, "salon"); // first vertical that found it wins the tag
  } finally { globalThis.fetch = orig; }
});

test("fetchAllVerticals skips a failing vertical and keeps the rest", async () => {
  const orig = globalThis.fetch;
  let n = 0;
  globalThis.fetch = async () => {
    n++;
    if (n === 1) throw new Error("boom"); // first vertical's call fails
    return new Response(JSON.stringify({ places: [{ id: "Y", displayName: { text: "Co" }, primaryType: "cafe", formattedAddress: "2 St" }] }), { status: 200 });
  };
  try {
    const out = await fetchAllVerticals({
      apiKey: "k", location: "1,2", radiusMeters: 1000, verticals: ["salon", "cafe"], maxResults: 20,
    });
    assert.equal(out.length, 1);
    assert.equal(out[0].category, "cafe");
  } finally { globalThis.fetch = orig; }
});

test("fetchAllVerticals throws when every vertical fails", async () => {
  const orig = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error("down"); };
  try {
    await assert.rejects(
      () => fetchAllVerticals({ apiKey: "k", location: "1,2", radiusMeters: 1000, verticals: ["salon", "cafe"] }),
      /All vertical searches failed/,
    );
  } finally { globalThis.fetch = orig; }
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test test/fetcher.test.js`
Expected: FAIL — `fetchAllVerticals` is not exported (`undefined is not a function`).

- [ ] **Step 3: Implement `fetchAllVerticals`**

Append to the end of `lib/fetcher.js`:

```js
// Fan out one searchNearby call per vertical, dedupe by place_id, and tag each
// result's category to the vertical it was found under. Tagging guarantees the
// business is in the ICP set (which equals the vertical list), so pipeline's
// low_fit filter can't silently discard real matches. A single vertical's
// failure is tolerated; only an all-fail run throws.
export async function fetchAllVerticals({ apiKey, location, radiusMeters, verticals, maxResults = 20 }) {
  const seen = new Set();
  const out = [];
  let failures = 0;
  let lastErr = null;
  for (const vertical of verticals) {
    try {
      const found = await fetchNearby({
        apiKey, location, radiusMeters, includedTypes: [vertical], maxResults,
      });
      for (const b of found) {
        if (seen.has(b.place_id)) continue;
        seen.add(b.place_id);
        b.category = vertical;
        out.push(b);
      }
    } catch (e) {
      failures++;
      lastErr = e;
    }
  }
  if (verticals.length > 0 && failures === verticals.length) {
    throw new Error(`All vertical searches failed: ${lastErr && lastErr.message}`);
  }
  return out;
}
```

- [ ] **Step 4: Run the full test file to verify pass (and no regressions)**

Run: `node --test test/fetcher.test.js`
Expected: PASS — all existing tests plus the 3 new ones.

- [ ] **Step 5: Commit**

```bash
git add lib/fetcher.js test/fetcher.test.js
git commit -m "feat: fetchAllVerticals — per-vertical search, dedupe, category tag"
```

---

## Task 3: Wire params + geocode into the function

Read `location`/`miles` from the request, geocode addresses, convert miles→meters, and call `fetchAllVerticals`. Falls back to config defaults when params are absent.

**Files:**
- Modify: `netlify/functions/leads.js`
- Test: `test/function.test.js` (add 3 tests)

- [ ] **Step 1: Write the failing tests**

Append to the end of `test/function.test.js`:

```js
test("address location is geocoded before searching", async () => {
  process.env.APP_PASSPHRASE = "right";
  process.env.GOOGLE_PLACES_API_KEY = "key";
  const orig = globalThis.fetch;
  let placesBody = null;
  globalThis.fetch = async (url, opts) => {
    if (String(url).includes("maps/api/geocode")) {
      return new Response(JSON.stringify({ status: "OK", results: [{ geometry: { location: { lat: 40, lng: -70 } } }] }), { status: 200 });
    }
    placesBody = JSON.parse(opts.body);
    return new Response(JSON.stringify(DEMO_RAW), { status: 200 });
  };
  try {
    const res = await handler(new Request("http://x/api/leads?location=77433&miles=5", { headers: { "x-app-passphrase": "right" } }));
    assert.equal(res.status, 200);
    assert.equal(placesBody.locationRestriction.circle.center.latitude, 40);
    assert.equal(placesBody.locationRestriction.circle.radius, Math.round(5 * 1609.344));
  } finally { globalThis.fetch = orig; }
});

test("unresolvable location returns 400", async () => {
  process.env.APP_PASSPHRASE = "right";
  process.env.GOOGLE_PLACES_API_KEY = "key";
  const orig = globalThis.fetch;
  globalThis.fetch = async (url) => {
    if (String(url).includes("maps/api/geocode")) {
      return new Response(JSON.stringify({ status: "ZERO_RESULTS", results: [] }), { status: 200 });
    }
    return new Response(JSON.stringify(DEMO_RAW), { status: 200 });
  };
  try {
    const res = await handler(new Request("http://x/api/leads?location=zzzzz", { headers: { "x-app-passphrase": "right" } }));
    assert.equal(res.status, 400);
  } finally { globalThis.fetch = orig; }
});

test("coordinate location skips geocoding", async () => {
  process.env.APP_PASSPHRASE = "right";
  process.env.GOOGLE_PLACES_API_KEY = "key";
  const orig = globalThis.fetch;
  let geocodeCalled = false;
  let placesBody = null;
  globalThis.fetch = async (url, opts) => {
    if (String(url).includes("maps/api/geocode")) { geocodeCalled = true; return new Response("{}", { status: 200 }); }
    placesBody = JSON.parse(opts.body);
    return new Response(JSON.stringify(DEMO_RAW), { status: 200 });
  };
  try {
    const res = await handler(new Request("http://x/api/leads?location=40,-70", { headers: { "x-app-passphrase": "right" } }));
    assert.equal(res.status, 200);
    assert.equal(geocodeCalled, false);
    assert.equal(placesBody.locationRestriction.circle.center.latitude, 40);
  } finally { globalThis.fetch = orig; }
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test test/function.test.js`
Expected: FAIL — geocoding not wired in (address path won't produce center lat 40; the 400 case won't trigger).

- [ ] **Step 3: Update the function**

Replace the entire contents of `netlify/functions/leads.js` with:

```js
import { loadConfig, cfgDict } from "../../lib/config.js";
import { fetchAllVerticals, loadDemoBusinesses } from "../../lib/fetcher.js";
import { geocodeAddress, looksLikeCoords } from "../../lib/geocode.js";
import { buildLeads, summarize } from "../../lib/pipeline.js";

// Netlify Functions v2: route /api/leads directly to this function.
export const config = { path: "/api/leads" };

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const METERS_PER_MILE = 1609.344;
const MAX_RADIUS_METERS = 50000; // Google searchNearby hard cap

// Parse the miles param → radius in meters. Blank/invalid falls back to the
// config default; valid values are clamped to 1–25 mi then to the API cap.
function milesToMeters(milesParam, fallbackMeters) {
  const n = Number(milesParam);
  if (!milesParam || Number.isNaN(n)) return fallbackMeters;
  const clamped = Math.min(25, Math.max(1, n));
  return Math.min(MAX_RADIUS_METERS, Math.round(clamped * METERS_PER_MILE));
}

export default async function handler(req) {
  const cfg = loadConfig();
  const url = new URL(req.url);
  const demo = url.searchParams.get("demo") === "1";

  if (!demo) {
    const provided = req.headers.get("x-app-passphrase") || "";
    if (!cfg.passphrase || provided !== cfg.passphrase) {
      return json({ error: "Invalid or missing passphrase." }, 401);
    }
    if (!cfg.apiKey) {
      return json({ error: "GOOGLE_PLACES_API_KEY is not set on the server." }, 500);
    }
  }

  let businesses;
  try {
    if (demo) {
      businesses = loadDemoBusinesses();
    } else {
      const s = cfg.search;
      const rawLoc = (url.searchParams.get("location") || "").trim();
      const radiusMeters = milesToMeters(url.searchParams.get("miles"), s.radius_meters);

      let location = s.location;
      if (rawLoc) {
        if (looksLikeCoords(rawLoc)) {
          location = rawLoc;
        } else {
          const geo = await geocodeAddress(cfg.apiKey, rawLoc);
          if (!geo) {
            return json({ error: "Couldn't find that location — try a ZIP or city." }, 400);
          }
          location = geo;
        }
      }

      businesses = await fetchAllVerticals({
        apiKey: cfg.apiKey,
        location,
        radiusMeters,
        verticals: s.verticals,
        maxResults: s.batch_size ?? 20,
      });
    }
  } catch (e) {
    return json({ error: `Fetch failed: ${e.message}` }, 502);
  }

  const rows = buildLeads(cfgDict(cfg), businesses);
  return json({
    leads: rows,
    summary: summarize(rows),
    demo,
    threshold: cfg.search.score_threshold ?? 40,
  });
}
```

- [ ] **Step 4: Run the full test file to verify pass (and no regressions)**

Run: `node --test test/function.test.js`
Expected: PASS — the 6 existing tests plus the 3 new ones. (The existing "returns leads (stubbed fetch)" and "502" tests still pass because `fetchAllVerticals` returns/dedupes DEMO_RAW across verticals and throws only when all calls fail.)

- [ ] **Step 5: Run the entire suite**

Run: `npm test`
Expected: PASS — all files green.

- [ ] **Step 6: Commit**

```bash
git add netlify/functions/leads.js test/function.test.js
git commit -m "feat: leads function reads location/miles params, geocodes, fans out per vertical"
```

---

## Task 4: Dashboard controls (location + miles)

Add the two inputs, send them as query params, persist to `localStorage`, and switch the context line from km to miles. No automated tests exist for the frontend; verify via demo mode and the full backend suite.

**Files:**
- Modify: `public/index.html`
- Modify: `public/dashboard.js`
- Modify: `public/dashboard.css`

- [ ] **Step 1: Add the inputs to the HTML**

In `public/index.html`, insert this new section immediately after the `</section>` that closes `.context` (currently around line 28, before `<section class="stats" ...>`):

```html
  <section class="search-params" id="search-params">
    <label class="field">Location
      <input id="loc-input" type="text" placeholder="ZIP or city — blank uses default" autocomplete="off">
    </label>
    <label class="field">Distance
      <span class="field-unit"><input id="miles-input" type="number" min="1" max="25" step="1" value="9"> mi</span>
    </label>
  </section>
```

- [ ] **Step 2: Add constants and element refs in dashboard.js**

In `public/dashboard.js`, just after the `var PASS_KEY = "mpg_pass";` line, add:

```js
  var LOC_KEY = "mpg_loc";
  var MILES_KEY = "mpg_miles";
```

Then in the `var el = { ... };` object, add two entries so it reads:

```js
  var el = {
    leads: document.getElementById("leads"),
    stats: document.getElementById("stats"),
    controls: document.getElementById("controls"),
    refresh: document.getElementById("refresh"),
    search: document.getElementById("search"),
    sort: document.getElementById("sort"),
    locInput: document.getElementById("loc-input"),
    milesInput: document.getElementById("miles-input"),
  };
```

- [ ] **Step 3: Replace `initShell` with a miles-aware version**

In `public/dashboard.js`, replace the whole `function initShell() { ... }` block with:

```js
  function milesFromMeters(m) { return Math.max(1, Math.round(m / 1609.344)); }

  function setContext(verticals, miles) {
    document.getElementById("context").innerHTML =
      "Searching <strong>" + esc(verticals.join(", ")) + "</strong> within " +
      "<strong>" + esc(miles) + " mi</strong>. Target score <strong>" + state.threshold +
      "+</strong>. Leads below target sit under the divider.";
  }

  function initShell() {
    if (DEMO) { el.locInput.disabled = true; el.milesInput.disabled = true; }
    var savedLoc = localStorage.getItem(LOC_KEY);
    if (savedLoc) el.locInput.value = savedLoc;
    var savedMiles = localStorage.getItem(MILES_KEY);
    fetch("config.json")
      .then(function (r) { return r.json(); })
      .then(function (cfg) {
        document.getElementById("brand-name").textContent = cfg.personal.company || "Lead Desk";
        document.title = (cfg.personal.company || "Lead Desk") + " — Lead Desk";
        var op = document.getElementById("operator");
        if (cfg.personal.name) { op.textContent = cfg.personal.name; op.hidden = false; }
        state.threshold = cfg.search.score_threshold || 40;
        state.verticals = cfg.search.verticals || [];
        var miles = savedMiles || String(milesFromMeters(cfg.search.radius_meters));
        el.milesInput.value = miles;
        setContext(state.verticals, miles);
      })
      .catch(function () { /* shell is best-effort; leads still load */ });
  }
```

- [ ] **Step 4: Add `verticals` to the state object**

In `public/dashboard.js`, change the `state` initializer line to include `verticals`:

```js
  var state = { leads: [], filter: "all", sort: "score", query: "", threshold: 40, verticals: [] };
```

- [ ] **Step 5: Replace `load` so it sends params and persists them**

In `public/dashboard.js`, replace the beginning of `function load() { ... }` — from the function opening through the `fetch(url, opts)` line — with:

```js
  function load() {
    el.leads.innerHTML = '<div class="state">Scoring leads…</div>';
    el.refresh.disabled = true;

    var url;
    var opts = {};
    if (DEMO) {
      url = "/api/leads?demo=1";
    } else {
      var loc = el.locInput.value.trim();
      var miles = el.milesInput.value.trim();
      if (loc) { localStorage.setItem(LOC_KEY, loc); } else { localStorage.removeItem(LOC_KEY); }
      if (miles) { localStorage.setItem(MILES_KEY, miles); }
      var qs = [];
      if (loc) qs.push("location=" + encodeURIComponent(loc));
      if (miles) qs.push("miles=" + encodeURIComponent(miles));
      url = "/api/leads" + (qs.length ? "?" + qs.join("&") : "");
      if (state.verticals.length) setContext(state.verticals, miles || el.milesInput.value);
      var p = ensurePass();
      opts.headers = { "X-App-Passphrase": p };
    }

    fetch(url, opts)
```

Leave the rest of `load` (the `.then(...)` chain) unchanged.

- [ ] **Step 6: Style the new controls**

Append to the end of `public/dashboard.css`:

```css
/* ---------- Search params ---------- */
.search-params {
  display: flex; gap: 18px; flex-wrap: wrap; align-items: flex-end;
  padding: 16px 28px 0;
}
.field {
  display: flex; flex-direction: column; gap: 6px;
  font-size: 12px; text-transform: uppercase; letter-spacing: .08em;
  color: var(--muted);
}
.field-unit { display: flex; align-items: center; gap: 6px; color: var(--ink); }
.field-unit input { width: 84px; }
.field input {
  font: inherit; text-transform: none; letter-spacing: normal; color: var(--ink);
  padding: 8px 12px; border: 1px solid var(--line); border-radius: 8px; background: var(--card);
  min-width: 220px;
}
.field-unit input { min-width: 0; }
.field input:disabled { opacity: .55; cursor: not-allowed; }
@media (max-width: 720px) {
  .search-params { padding-left: 18px; padding-right: 18px; }
  .field input { min-width: 0; width: 100%; }
}
```

- [ ] **Step 7: Verify the backend suite still passes**

Run: `npm test`
Expected: PASS — no backend regressions from the frontend changes.

- [ ] **Step 8: Manual verification in the browser**

Run: `npm run dev` (starts `netlify dev`).

Check, in order:
1. Open `http://localhost:8888/?demo=1`. The **Location** and **Miles** inputs appear under the intro line and are **disabled** (demo mode). The context line reads "…within **9 mi**…" (miles, not km).
2. Open `http://localhost:8888/` (live). The inputs are **enabled**. Miles defaults to `9`; location is blank with the placeholder shown.
3. Type `77433` into Location, change Miles to `12`, click **Refresh leads**. The context line updates to "…within **12 mi**…". (A live fetch needs `APP_PASSPHRASE` + `GOOGLE_PLACES_API_KEY` set in the Netlify dev env; if unset you'll get the passphrase/key error — that is expected and still confirms the params are wired.)
4. Reload the page. Location still shows `77433` and Miles still shows `12` (persisted via `localStorage`).

- [ ] **Step 9: Commit**

```bash
git add public/index.html public/dashboard.js public/dashboard.css
git commit -m "feat: dashboard location + miles controls, miles display, persistence"
```

---

## Definition of Done

- `npm test` is green (existing suite + `geocode.test.js` + new `fetcher`/`function` tests).
- Dashboard shows distance in **miles** and lets the user set location (ZIP/city/coords) and distance live.
- A live run fans out one Places call per vertical, deduped and tagged, so yield is no longer capped at a single 20-result call.
- Blank location falls back to the config default; an unresolvable address returns a friendly 400; demo mode is unchanged with its controls disabled.
