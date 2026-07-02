# Known-Chain Disqualifier Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Filter known chains/franchises out of the lead list server-side, before scoring, driven by a user-editable brand list in `config.json`, and surface an "N chains filtered" count.

**Architecture:** A new pure module `lib/chains.js` does name-based detection. `lib/pipeline.js` applies the filter at the top of its build loop (before scoring), counts drops, and returns `{ rows, chainsFiltered }`. The Netlify function folds the count into `summary`; the dashboard shows a small note. Scoring is untouched.

**Tech Stack:** Vanilla ES modules (browser + Node), `node --test`, Netlify Functions v2, static assets in `public/`.

---

## File structure

- **Create** `lib/chains.js` — pure `normalizeName` + `isChain` (detection only).
- **Create** `test/chains.test.js` — `node --test` coverage for detection.
- **Modify** `config.json` — add seeded `search.exclude_chains` array.
- **Modify** `lib/pipeline.js` — filter + count chains; return `{ rows, chainsFiltered }`.
- **Modify** `test/pipeline.test.js` — adapt to new return shape + chain-drop test.
- **Modify** `netlify/functions/leads.js` — thread `chainsFiltered` into `summary`.
- **Modify** `test/function.test.js` — assert `summary.chainsFiltered` present.
- **Modify** `public/dashboard.js` — show "N chains filtered" note when count > 0.

Note: `helpers.js` `CFG` intentionally has no `exclude_chains`; `pipeline.js` reads
`cfg.search.exclude_chains ?? []`, so existing helper-based tests keep passing.

**Task ordering note:** the `buildLeads` return-shape change (Task 3) and its only
consumer `leads.js` (also Task 3) are committed together so the full suite stays
green at every commit boundary.

---

## Task 1: Pure chain detection (`lib/chains.js`) + tests

**Files:**
- Create: `lib/chains.js`
- Create test: `test/chains.test.js`

- [ ] **Step 1: Write the failing test**

Create `test/chains.test.js`:

```javascript
import test from "node:test";
import assert from "node:assert/strict";
import { isChain, normalizeName } from "../lib/chains.js";

const BRANDS = ["Starbucks", "Great Clips", "McDonald's", "Jiffy Lube"];

test("normalizeName lowercases, drops apostrophes, and spaces punctuation", () => {
  assert.equal(normalizeName("McDonald's"), "mcdonalds");
  assert.equal(normalizeName("Great  Clips!"), "great clips");
  assert.equal(normalizeName("Chili's-Bar & Grill"), "chilis bar grill");
  assert.equal(normalizeName(""), "");
  assert.equal(normalizeName(null), "");
});

test("isChain matches a brand as a whole word in the business name", () => {
  assert.equal(isChain("Starbucks Coffee #1234", BRANDS), true);
});

test("isChain is case-insensitive", () => {
  assert.equal(isChain("STARBUCKS on Main", BRANDS), true);
});

test("isChain matches across apostrophe/punctuation differences", () => {
  assert.equal(isChain("McDonalds", BRANDS), true);
  assert.equal(isChain("Dunkin' Donuts", ["Dunkin Donuts"]), true);
});

test("isChain matches a multi-word brand", () => {
  assert.equal(isChain("Great Clips of Cypress", BRANDS), true);
});

test("isChain does not match a brand inside a longer word", () => {
  assert.equal(isChain("Supersonic Car Wash", ["Sonic"]), false);
  assert.equal(isChain("Subs & Such Deli", ["Subway"]), false);
});

test("isChain returns false for an independent business", () => {
  assert.equal(isChain("Bayou City Nail Bar", BRANDS), false);
});

test("isChain returns false for empty brand list or empty name", () => {
  assert.equal(isChain("Starbucks", []), false);
  assert.equal(isChain("", BRANDS), false);
  assert.equal(isChain(null, BRANDS), false);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- test/chains.test.js`
Expected: FAIL — cannot find module `../lib/chains.js`.

- [ ] **Step 3: Write minimal implementation**

Create `lib/chains.js`:

```javascript
// Pure known-chain detection. No DOM, no config loading — the caller passes the
// brand list. Unit-tested with node --test. Mirrors the lib/research.js pattern.

// Lowercase, drop apostrophes so "McDonald's" == "McDonalds", turn any other
// punctuation run into a single space, then trim.
export function normalizeName(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

// True when any brand appears as a whole word/phrase in the business name.
// Pad both the name and each brand with spaces and test for " brand " as a
// substring, so a brand only matches on word boundaries.
export function isChain(name, brands) {
  const norm = normalizeName(name);
  if (!norm || !brands || brands.length === 0) return false;
  const padded = ` ${norm} `;
  for (const brand of brands) {
    const nb = normalizeName(brand);
    if (nb && padded.includes(` ${nb} `)) return true;
  }
  return false;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- test/chains.test.js`
Expected: PASS — all 8 tests green.

- [ ] **Step 5: Commit**

```bash
git add lib/chains.js test/chains.test.js
git commit -m "feat: pure isChain/normalizeName known-chain detection"
```

---

## Task 2: Seed the brand list in `config.json`

**Files:**
- Modify: `config.json`

- [ ] **Step 1: Add the `exclude_chains` array to the `search` block**

In `config.json`, add an `exclude_chains` key inside `"search"` (after
`"score_threshold"`; add a trailing comma to the line above it). The `search` block
becomes:

```json
  "search": {
    "location": "29.9691,-95.6972",
    "radius_meters": 15000,
    "verticals": ["restaurant", "bar", "cafe", "retail", "salon", "spa", "auto", "professional"],
    "batch_size": 20,
    "score_threshold": 55,
    "exclude_chains": [
      "Starbucks", "Dunkin", "Dunkin Donuts", "McDonald's", "Subway", "Chipotle",
      "Chili's", "Applebee's", "Olive Garden", "Panera", "Sonic Drive-In",
      "Whataburger", "Jack in the Box", "Taco Bell", "Wendy's", "Burger King",
      "Great Clips", "Supercuts", "Sport Clips", "Fantastic Sams",
      "Jiffy Lube", "Take 5", "Valvoline", "Firestone", "Discount Tire",
      "AT&T", "T-Mobile", "Verizon", "GNC", "GameStop", "Massage Envy"
    ]
  },
```

- [ ] **Step 2: Verify the JSON is valid and the key is an array of the expected size**

Run: `node -e "const c=require('./config.json'); if(!Array.isArray(c.search.exclude_chains)) throw new Error('not an array'); console.log('exclude_chains length:', c.search.exclude_chains.length)"`
Expected: prints `exclude_chains length: 31` (no error).

- [ ] **Step 3: Confirm no demo business name collides with a seeded brand**

Run (single line; `require` resolves the JSON, `pathToFileURL` lets `-e` import the ESM module — depends on `lib/chains.js` from Task 1, already committed):

```bash
node -e "const {pathToFileURL}=require('url'); import(pathToFileURL('./lib/chains.js').href).then(({isChain})=>{const c=require('./config.json'); const d=require('./public/demo_places.json'); console.log('demo collisions:', (d.places||[]).map(p=>p.displayName&&p.displayName.text).filter(n=>isChain(n,c.search.exclude_chains)));});"
```

Expected: `demo collisions: []` (no demo business is mistaken for a chain). If the
list is non-empty, a seeded brand is too broad — report it; do not proceed.

- [ ] **Step 4: Commit**

```bash
git add config.json
git commit -m "feat: seed search.exclude_chains brand list"
```

---

## Task 3: Filter chains in the pipeline and thread the count through the API

The return-shape change and its consumer move together so the suite stays green.

**Files:**
- Modify: `lib/pipeline.js`
- Modify: `test/pipeline.test.js`
- Modify: `netlify/functions/leads.js`
- Modify: `test/function.test.js`

- [ ] **Step 1: Update `test/pipeline.test.js` for the new return shape + a chain-drop test**

Replace the entire contents of `test/pipeline.test.js` with:

```javascript
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { parsePlacesResponse } from "../lib/fetcher.js";
import { buildLeads, summarize } from "../lib/pipeline.js";
import { CFG } from "./helpers.js";

const require = createRequire(import.meta.url);
const DEMO_RAW = require("../public/demo_places.json");

test("buildLeads excludes low-fit and sorts by score desc", () => {
  const { rows } = buildLeads(CFG, parsePlacesResponse(DEMO_RAW));
  // DEMO_I is a laundromat (low-fit) named "Cypress Discount Vapes" → excluded
  assert.ok(rows.every((r) => r.name !== "Cypress Discount Vapes"));
  const scores = rows.map((r) => r.score);
  assert.deepEqual(scores, [...scores].sort((a, b) => b - a));
  assert.ok(rows.every((r) => r.campaign.email1_body));
});

test("buildLeads returns a chainsFiltered count (0 when no list)", () => {
  const { chainsFiltered } = buildLeads(CFG, parsePlacesResponse(DEMO_RAW));
  assert.equal(chainsFiltered, 0);
});

test("buildLeads drops businesses whose name matches a brand, and counts them", () => {
  const businesses = parsePlacesResponse(DEMO_RAW);
  // Rename the first demo business (an in-ICP barber shop) to a chain name.
  const withChain = businesses.map((b, i) => (i === 0 ? { ...b, name: "Starbucks Coffee" } : b));
  const cfg = { ...CFG, search: { ...CFG.search, exclude_chains: ["Starbucks"] } };
  const { rows, chainsFiltered } = buildLeads(cfg, withChain);
  assert.equal(chainsFiltered, 1);
  assert.ok(rows.every((r) => r.name !== "Starbucks Coffee"));
  assert.ok(rows.length > 0);
});

test("summarize counts add up", () => {
  const { rows } = buildLeads(CFG, parsePlacesResponse(DEMO_RAW));
  const s = summarize(rows);
  assert.equal(s.total, rows.length);
  assert.equal(s.displacement + s.greenfield, s.total);
});
```

- [ ] **Step 2: Add the failing assertion to `test/function.test.js`**

In `test/function.test.js`, in the test named
`"demo request returns leads + summary, no passphrase needed"`, add one assertion
immediately after the existing `assert.equal(d.summary.total, d.leads.length);` line:

```javascript
  assert.equal(typeof d.summary.chainsFiltered, "number");
```

- [ ] **Step 3: Run both test files to verify they FAIL**

Run: `npm test -- test/pipeline.test.js test/function.test.js`
Expected: FAIL — `buildLeads` still returns an array (destructuring `{ rows }` /
`{ chainsFiltered }` yields `undefined`), and `d.summary.chainsFiltered` is
`undefined`.

- [ ] **Step 4: Update `lib/pipeline.js`**

Add the import at the top (after the existing imports):

```javascript
import { isChain } from "./chains.js";
```

Replace the `buildLeads` function with:

```javascript
export function buildLeads(cfg, businesses) {
  const icp = new Set(cfg.search.verticals);
  const personal = cfg.personal;
  const weights = cfg.weights;
  const brands = cfg.search.exclude_chains ?? [];

  const rows = [];
  let chainsFiltered = 0;
  for (const b of businesses) {
    if (isChain(b.name, brands)) { chainsFiltered++; continue; }
    const lead = scoreBusiness(b, weights, icp);
    if (lead.track === "low_fit") continue;
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
```

Leave `summarize(rows)` unchanged.

- [ ] **Step 5: Update `netlify/functions/leads.js`**

Replace the two lines near the end (the `buildLeads` call and the `return json({...})`):

```javascript
  const { rows, chainsFiltered } = buildLeads(cfgDict(cfg), businesses);
  return json({
    leads: rows,
    summary: { ...summarize(rows), chainsFiltered },
    demo,
    threshold: cfg.search.score_threshold ?? 40,
  });
```

- [ ] **Step 6: Run the full suite to verify everything PASSES**

Run: `npm test`
Expected: all suites PASS (chains, pipeline, function, and the rest). `chainsFiltered`
is `0` for demo data.

- [ ] **Step 7: Commit**

```bash
git add lib/pipeline.js test/pipeline.test.js netlify/functions/leads.js test/function.test.js
git commit -m "feat: pipeline filters chains before scoring; API returns chainsFiltered"
```

---

## Task 4: Show the "N chains filtered" note (`dashboard.js`)

**Files:**
- Modify: `public/dashboard.js`

No unit test — DOM wiring, verified manually in Step 3.

- [ ] **Step 1: Append the note after a successful load**

In `public/dashboard.js`, inside the `fetch(url, opts)` success `.then` handler, find
the block that runs on success (after the `if (!res.ok)` block), which currently reads:

```javascript
        state.leads = res.d.leads || [];
        state.threshold = res.d.threshold || 40;
        setModeBadge(res.d.demo);
        paintStats(res.d.summary);
        render();
```

Replace it with:

```javascript
        state.leads = res.d.leads || [];
        state.threshold = res.d.threshold || 40;
        setModeBadge(res.d.demo);
        paintStats(res.d.summary);
        var cf = (res.d.summary && res.d.summary.chainsFiltered) || 0;
        if (state.verticals.length) {
          setContext(state.verticals, el.milesInput.value);
          if (cf > 0) {
            document.getElementById("context").innerHTML +=
              " · <strong>" + cf + "</strong> chain" + (cf === 1 ? "" : "s") + " filtered";
          }
        }
        render();
```

This rebuilds the context line from scratch each load (so the note never duplicates
across refreshes) and appends the chain count only when it is > 0.

- [ ] **Step 2: Confirm tests still pass and JS is syntactically valid**

Run: `npm test`
Expected: all suites PASS (unchanged — this task adds no tests).
Run: `node --check public/dashboard.js`
Expected: exits 0 (no syntax error). If `--check` rejects the top-level `import`,
instead confirm visually that the edit is balanced and report that.

- [ ] **Step 3: Manual verification (temporary config tweak, then revert)**

The demo data contains no chains, so the note is hidden by default. To see it:

1. Temporarily add a token that matches a demo business to the seed list — edit
   `config.json` and add `"Precision"` to `search.exclude_chains` (matches
   "Precision Auto Care").
2. Run `npx netlify dev --framework="#static"` and open
   `http://localhost:8888/?demo=1`.
3. Confirm the context line ends with `· 1 chain filtered` and that
   "Precision Auto Care" is absent from the cards.
4. Refresh once more and confirm the note still reads `· 1 chain filtered` (not
   duplicated).
5. **Revert** the `config.json` change: `git checkout config.json` (removes the
   temporary "Precision" entry). Confirm the note disappears on reload.

- [ ] **Step 4: Commit**

```bash
git add public/dashboard.js
git commit -m "feat: show 'N chains filtered' note on the dashboard"
```

---

## Final verification

- [ ] **Run the full suite**

Run: `npm test`
Expected: all suites PASS, including `test/chains.test.js` and the updated
`test/pipeline.test.js` / `test/function.test.js`.

- [ ] **Confirm scope**

Run: `git diff --name-only master..HEAD` (or against the pre-work commit)
Expected only: `lib/chains.js`, `test/chains.test.js`, `config.json`,
`lib/pipeline.js`, `test/pipeline.test.js`, `netlify/functions/leads.js`,
`test/function.test.js`, `public/dashboard.js`, and plan/spec docs. No changes under
`src/` (Python), `lib/scoring.js`, or `public/config.json`.

---

## Spec coverage check

- Hard disqualify chains before scoring → Task 3 (filter at top of loop, before `scoreBusiness`).
- Detection via configurable brand list, whole-word/normalized matching → Task 1 (`isChain`/`normalizeName`) + Task 2 (`config.json`).
- Apostrophe/punctuation normalization ("McDonald's" == "McDonalds") → Task 1 `normalizeName` (drops apostrophes).
- No false substring match → Task 1 test ("inside a longer word").
- `buildLeads` returns `{ rows, chainsFiltered }` → Task 3.
- Count in API `summary.chainsFiltered` → Task 3 (leads.js).
- "N chains filtered" note when > 0 → Task 4.
- Scoring untouched, Python app + `public/config.json` untouched → Final verification scope check.
