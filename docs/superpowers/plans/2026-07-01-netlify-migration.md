# Netlify Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Port the local Flask lead-generation dashboard to a Netlify app — static frontend on the CDN plus one Netlify Function that replaces the Flask `/api/leads` route — with a passphrase gate on live (quota-spending) fetches.

**Architecture:** The browser loads static files (`public/`) and calls `/api/leads`, which Netlify routes to a single Function (`netlify/functions/leads.js`). The Function checks a passphrase (live only), fetches from Google Places (live) or bundled demo data (demo), scores each business, attaches outreach copy, and returns JSON. All scoring/campaign/fetch logic is a 1:1 JavaScript port of the existing Python, kept in `lib/` as focused ESM modules and covered by ported tests.

**Tech Stack:** Node 20 (ESM), Netlify Functions v2, Node's built-in `node:test` runner (zero test deps), `esbuild` bundler (Netlify default), Google Places API (New).

**Spec:** `docs/superpowers/specs/2026-07-01-netlify-migration-design.md`

**Note on the existing Python app:** It stays in place and still runs locally (`python run.py --demo`). This plan adds the JS/Netlify layer alongside it; it does not delete Python. The JS modules are the source of truth for the deployed app.

**Cross-version note:** All JSON loading uses `createRequire` (works on any Node ≥18). `fetch`, `Request`, and `Response` are Node 18+ globals — no polyfill needed. Local development requires Node ≥18; Netlify build pins Node 20.

---

## File Structure

**Created:**
- `package.json` — ESM project, `test`/`dev` scripts.
- `netlify.toml` — publish dir, Node version, bundler.
- `config.json` — baked non-secret config (search / personal / weights).
- `lib/models.js` — object factories (`business`, `scoredLead`).
- `lib/scoring.js` — two-track scoring engine + `pyRound` helper.
- `lib/campaigns.js` — track-aware outreach copy generator.
- `lib/fetcher.js` — Places fetch, response parsing, category normalization, demo loader, dedupe.
- `lib/pipeline.js` — `buildLeads` + `summarize`.
- `lib/config.js` — loads `config.json` + secrets from env.
- `netlify/functions/leads.js` — the Function (orchestration + passphrase gate + errors).
- `public/index.html` — de-templated static shell (from `templates/dashboard.html`).
- `public/dashboard.css` — copied from `src/mpg_leads/static/dashboard.css`.
- `public/dashboard.js` — copied + edited client (demo param, passphrase, mode badge, shell from config).
- `public/demo_places.json` — copied from `src/mpg_leads/static/demo_places.json`.
- `test/helpers.js` — shared test fixtures (`ICP`, `WEIGHTS`, `PERSONAL`, `CFG`, `makeBusiness`).
- `test/scoring.test.js`, `test/campaigns.test.js`, `test/fetcher.test.js`, `test/pipeline.test.js`, `test/function.test.js`.

**Modified:**
- `README.md` — add Netlify deploy + local `netlify dev` instructions.
- `.gitignore` — already covers `node_modules/`, `.netlify/`, `.env` (verify).

**Not touched:** `src/mpg_leads/**` (Python), `tests/test_all.py`, `run.py`, `config.yaml`.

---

## Task 1: Scaffold Node project, Netlify config, baked config + demo data

**Files:**
- Create: `package.json`, `netlify.toml`, `config.json`, `public/demo_places.json`
- Create: `test/smoke.test.js` (temporary sanity test, deleted in Step 6)

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "mpg-lead-generator-web",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "test": "node --test",
    "dev": "netlify dev"
  }
}
```

- [ ] **Step 2: Create `netlify.toml`**

```toml
[build]
  publish = "public"

[build.environment]
  NODE_VERSION = "20"

[functions]
  node_bundler = "esbuild"
```

Routing to `/api/leads` is declared in the Function file itself (Netlify Functions v2 `config.path`), so no redirect rule is needed here.

- [ ] **Step 3: Create `config.json`** (non-secret config, ported from `config.yaml`)

```json
{
  "search": {
    "location": "29.9691,-95.6972",
    "radius_meters": 15000,
    "verticals": ["restaurant", "bar", "cafe", "retail", "salon", "spa", "auto", "professional"],
    "batch_size": 60,
    "score_threshold": 55
  },
  "personal": {
    "name": "Chandler Atkinson",
    "company": "Media Payments Group",
    "callback_number": "(555) 555-5555",
    "email": "you@example.com",
    "canspam_footer": {
      "business_address": "123 Example St, Cypress, TX 77433",
      "optout_line": "Reply STOP or email you@example.com to opt out of further messages."
    }
  },
  "weights": {
    "displacement": {"dissatisfaction_max": 35, "keyword_pain_max": 12, "tech_max": 20, "volume_max": 20, "icp_tiebreak": 3},
    "greenfield": {"recency_max": 40, "volume_potential_max": 30, "setup_gap_max": 27, "icp_tiebreak": 3},
    "buckets": {"hot": 70, "warm": 40},
    "greenfield_review_cutoff": 8
  }
}
```

- [ ] **Step 4: Copy the demo data into `public/`**

Run (bash): `mkdir -p public && cp src/mpg_leads/static/demo_places.json public/demo_places.json`
Run (PowerShell): `New-Item -ItemType Directory -Force public; Copy-Item src/mpg_leads/static/demo_places.json public/demo_places.json`
Expected: `public/demo_places.json` exists and is identical to the source (a raw Places API response with 10 places).

- [ ] **Step 5: Create `test/smoke.test.js` and confirm the runner works**

```javascript
import test from "node:test";
import assert from "node:assert/strict";

test("test runner works", () => {
  assert.equal(1 + 1, 2);
});
```

Run: `node --test`
Expected: PASS (1 test).

- [ ] **Step 6: Delete the smoke test and commit**

Run (bash): `rm test/smoke.test.js`
Run (PowerShell): `Remove-Item test/smoke.test.js`

```bash
git add package.json netlify.toml config.json public/demo_places.json
git commit -m "chore: scaffold Netlify project (config, demo data, test runner)"
```

---

## Task 2: `lib/models.js` — object factories

**Files:**
- Create: `lib/models.js`
- Create: `test/helpers.js`
- Test: `test/models.test.js`

- [ ] **Step 1: Write the failing test** — `test/models.test.js`

```javascript
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/models.test.js`
Expected: FAIL — cannot find module `../lib/models.js`.

- [ ] **Step 3: Write `lib/models.js`**

```javascript
// Plain-object factories mirroring the Python dataclasses. Uses `??` (not `||`)
// so that falsy-but-valid values like price_level 0 survive.
export function business(o) {
  return {
    place_id: o.place_id,
    name: o.name,
    category: o.category,
    address: o.address,
    phone: o.phone ?? null,
    website: o.website ?? null,
    rating: o.rating ?? null,
    review_count: o.review_count ?? 0,
    price_level: o.price_level ?? null,
    business_status: o.business_status ?? "",
    review_texts: o.review_texts ?? [],
  };
}

export function scoredLead(o) {
  return {
    business: o.business,
    track: o.track,
    score: o.score,
    bucket: o.bucket,
    why: o.why ?? [],
  };
}
```

- [ ] **Step 4: Create `test/helpers.js`** (shared fixtures, mirrors `tests/test_all.py`)

```javascript
import { business } from "../lib/models.js";

export const ICP = new Set(["restaurant", "bar", "cafe", "retail", "salon", "spa", "auto", "professional"]);

export const WEIGHTS = {
  displacement: { dissatisfaction_max: 35, keyword_pain_max: 12, tech_max: 20, volume_max: 20, icp_tiebreak: 3 },
  greenfield: { recency_max: 40, volume_potential_max: 30, setup_gap_max: 27, icp_tiebreak: 3 },
  buckets: { hot: 70, warm: 40 },
  greenfield_review_cutoff: 8,
};

export const PERSONAL = {
  name: "Chandler Atkinson",
  company: "Media Payments Group",
  callback_number: "(555) 555-5555",
  email: "c@mpg.com",
  canspam_footer: { business_address: "1 St, Cypress TX", optout_line: "Reply STOP to opt out." },
};

export const CFG = { search: { verticals: [...ICP] }, personal: PERSONAL, weights: WEIGHTS };

export function makeBusiness(kw = {}) {
  return business({
    place_id: "p1", name: "Test Co", category: "restaurant", address: "1 Main St",
    phone: null, website: null, rating: null, review_count: 0,
    price_level: null, business_status: "OPERATIONAL", review_texts: [],
    ...kw,
  });
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `node --test test/models.test.js`
Expected: PASS (3 tests).

- [ ] **Step 6: Commit**

```bash
git add lib/models.js test/helpers.js test/models.test.js
git commit -m "feat: add JS model factories mirroring Python dataclasses"
```

---

## Task 3: `lib/scoring.js` — two-track scoring engine

**Files:**
- Create: `lib/scoring.js`
- Test: `test/scoring.test.js`

- [ ] **Step 1: Write the failing test** — `test/scoring.test.js` (ports every scoring case from `tests/test_all.py`)

```javascript
import test from "node:test";
import assert from "node:assert/strict";
import {
  classifyTrack, dissatisfactionPoints, keywordPainPoints, techPoints,
  volumePoints, recencyPoints, volumePotentialPoints, setupGapPoints, scoreBusiness,
} from "../lib/scoring.js";
import { ICP, WEIGHTS, makeBusiness } from "./helpers.js";

// ---------- classification ----------
test("out of ICP is low_fit", () => {
  assert.equal(classifyTrack(makeBusiness({ category: "laundromat", review_count: 100 }), ICP, 8), "low_fit");
});
test("few reviews is greenfield", () => {
  assert.equal(classifyTrack(makeBusiness({ category: "restaurant", review_count: 3 }), ICP, 8), "greenfield");
});
test("established is displacement", () => {
  assert.equal(classifyTrack(makeBusiness({ category: "salon", review_count: 210 }), ICP, 8), "displacement");
});
test("cutoff is exclusive", () => {
  assert.equal(classifyTrack(makeBusiness({ category: "cafe", review_count: 8 }), ICP, 8), "displacement");
});

// ---------- displacement scorers ----------
test("dissatisfaction scales", () => {
  assert.equal(dissatisfactionPoints(4.2, 100, 35), 0);
  assert.equal(dissatisfactionPoints(3.0, 100, 35), 35);
  assert.equal(dissatisfactionPoints(3.6, 100, 35), 18);
  assert.equal(dissatisfactionPoints(2.5, 100, 35), 35);
});
test("dissatisfaction needs volume", () => {
  assert.equal(dissatisfactionPoints(3.0, 19, 35), 0);
  assert.equal(dissatisfactionPoints(null, 100, 35), 0);
});
test("keyword pain caps and reports", () => {
  const [pts, hits] = keywordPainPoints(["they add a surcharge", "card declined twice"], 12);
  assert.equal(pts, 12);
  assert.deepEqual(new Set(hits), new Set(["fees", "friction"]));
  assert.deepEqual(keywordPainPoints(["great food"], 12), [0, []]);
});
test("tech points", () => {
  assert.equal(techPoints(null, [], 20), 18);
  assert.equal(techPoints(null, ["cash only here"], 20), 20);
  assert.equal(techPoints("http://s.com", [], 20), 0);
});
test("volume points", () => {
  assert.equal(volumePoints(4, 200, 20), 20);
  assert.equal(volumePoints(0, 0, 20), 0);
});

// ---------- greenfield scorers ----------
test("recency", () => {
  assert.equal(recencyPoints(0, 8, 40), 40);
  assert.equal(recencyPoints(4, 8, 40), 20);
  assert.equal(recencyPoints(8, 8, 40), 0);
});
test("volume potential", () => {
  assert.ok(volumePotentialPoints("restaurant", 4, 30) > volumePotentialPoints("professional", 0, 30));
});
test("setup gap", () => {
  assert.equal(setupGapPoints(null, 27), 27);
  assert.equal(setupGapPoints("http://x.com", 27), 8);
});

// ---------- assembly ----------
test("low_fit scores zero", () => {
  const lead = scoreBusiness(makeBusiness({ category: "laundromat", review_count: 50 }), WEIGHTS, ICP);
  assert.equal(lead.track, "low_fit");
  assert.equal(lead.score, 0);
  assert.equal(lead.bucket, "cold");
});
test("unhappy salon is hot displacement", () => {
  const b = makeBusiness({ category: "salon", rating: 3.2, review_count: 210, website: null, price_level: 2, review_texts: ["cash only and a surcharge"] });
  const lead = scoreBusiness(b, WEIGHTS, ICP);
  assert.equal(lead.track, "displacement");
  assert.equal(lead.bucket, "hot");
  assert.ok(lead.why.some((w) => w.includes("Displacement")));
});
test("fresh taqueria is hot greenfield", () => {
  const b = makeBusiness({ category: "restaurant", review_count: 2, website: null, price_level: 2 });
  const lead = scoreBusiness(b, WEIGHTS, ICP);
  assert.equal(lead.track, "greenfield");
  assert.ok(lead.score >= 70);
  assert.equal(lead.bucket, "hot");
});
test("score clamps to 100", () => {
  const b = makeBusiness({ category: "restaurant", review_count: 0, website: null, price_level: 4 });
  assert.ok(scoreBusiness(b, WEIGHTS, ICP).score <= 100);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/scoring.test.js`
Expected: FAIL — cannot find module `../lib/scoring.js`.

- [ ] **Step 3: Write `lib/scoring.js`**

```javascript
import { scoredLead } from "./models.js";

export const FEE_KEYWORDS = ["surcharge", "cash only", "card fee", "adds 3", "card minimum",
  "convenience fee", "fee to use card", "extra to use card"];
export const FRICTION_KEYWORDS = ["card declined", "machine down", "card reader", "terminal",
  "system was down", "couldn't take card", "card wasn't working"];

export const VERTICAL_VOLUME = {
  restaurant: 1.0, bar: 1.0, cafe: 0.9, retail: 0.85,
  auto: 0.75, salon: 0.7, spa: 0.7, professional: 0.6,
};

// Match Python's round() (banker's rounding: half to even). JS Math.round rounds
// half toward +Infinity, which would diverge on exact .5 values.
export function pyRound(x) {
  const floor = Math.floor(x);
  const frac = x - floor;
  if (Math.abs(frac - 0.5) < 1e-9) {
    return floor % 2 === 0 ? floor : floor + 1;
  }
  return Math.round(x);
}

export function classifyTrack(b, icp, greenfieldCutoff) {
  if (!icp.has(b.category)) return "low_fit";
  if (b.review_count < greenfieldCutoff) return "greenfield";
  return "displacement";
}

export function dissatisfactionPoints(rating, reviewCount, wmax) {
  if (rating === null || rating === undefined || reviewCount < 20 || rating > 4.2) return 0;
  const r = Math.max(rating, 3.0);
  const frac = (4.2 - r) / (4.2 - 3.0); // 0 at 4.2, 1 at 3.0
  return pyRound(frac * wmax);
}

export function keywordPainPoints(reviewTexts, wmax) {
  const text = reviewTexts.join(" ").toLowerCase();
  const groups = { fees: FEE_KEYWORDS, friction: FRICTION_KEYWORDS };
  const hits = Object.keys(groups).filter((g) => groups[g].some((kw) => text.includes(kw)));
  return [Math.min(wmax, hits.length * 6), hits];
}

export function techPoints(website, reviewTexts, wmax) {
  const text = reviewTexts.join(" ").toLowerCase();
  let pts = 0;
  if (!website) pts += 18;
  if (text.includes("cash only")) pts += 2;
  return Math.min(pts, wmax);
}

export function volumePoints(priceLevel, reviewCount, wmax) {
  const pl = priceLevel === null || priceLevel === undefined ? 1 : priceLevel;
  const pricePts = (pl / 4) * 10;
  const rcPts = Math.min(reviewCount / 200, 1.0) * 10;
  return pyRound(Math.min(pricePts + rcPts, wmax));
}

export function recencyPoints(reviewCount, greenfieldCutoff, wmax) {
  if (reviewCount >= greenfieldCutoff) return 0;
  return pyRound(((greenfieldCutoff - reviewCount) / greenfieldCutoff) * wmax);
}

export function volumePotentialPoints(vertical, priceLevel, wmax) {
  const base = VERTICAL_VOLUME[vertical] ?? 0.6;
  const pl = (priceLevel === null || priceLevel === undefined ? 1 : priceLevel) / 4;
  return pyRound((0.6 * base + 0.4 * pl) * wmax);
}

export function setupGapPoints(website, wmax) {
  return website ? pyRound(wmax * 0.3) : wmax;
}

function bucketFor(score, buckets) {
  if (score >= buckets.hot) return "hot";
  if (score >= buckets.warm) return "warm";
  return "cold";
}

function label(category) {
  const spaced = category.replace(/_/g, " ");
  return spaced.charAt(0).toUpperCase() + spaced.slice(1).toLowerCase();
}

export function scoreBusiness(b, weights, icp) {
  const cutoff = weights.greenfield_review_cutoff;
  const track = classifyTrack(b, icp, cutoff);
  const why = [];

  if (track === "low_fit") {
    return scoredLead({
      business: b, track, score: 0, bucket: "cold",
      why: [`Low-fit • ${label(b.category)} • outside target verticals`],
    });
  }

  let score;
  if (track === "displacement") {
    const w = weights.displacement;
    const dis = dissatisfactionPoints(b.rating, b.review_count, w.dissatisfaction_max);
    const [pain, hits] = keywordPainPoints(b.review_texts, w.keyword_pain_max);
    const tech = techPoints(b.website, b.review_texts, w.tech_max);
    const vol = volumePoints(b.price_level, b.review_count, w.volume_max);
    score = dis + pain + tech + vol + w.icp_tiebreak;

    why.push(`Displacement • ${label(b.category)}`);
    if (b.rating !== null && b.rating !== undefined && b.review_count >= 20) {
      why.push(`rating ${b.rating} on ${b.review_count} reviews`);
    }
    if (hits.includes("fees")) why.push('fee complaints in reviews ("surcharge"/"cash only")');
    if (hits.includes("friction")) why.push("payment-friction complaints in reviews");
    if (!b.website) why.push("no website");
  } else { // greenfield
    const w = weights.greenfield;
    const rec = recencyPoints(b.review_count, cutoff, w.recency_max);
    const volp = volumePotentialPoints(b.category, b.price_level, w.volume_potential_max);
    const gap = setupGapPoints(b.website, w.setup_gap_max);
    score = rec + volp + gap + w.icp_tiebreak;

    why.push(`Greenfield • ${label(b.category)}`);
    why.push(`${b.review_count} reviews (new, likely no processor yet)`);
    if (!b.website) why.push("no website — needs full setup");
  }

  score = Math.max(0, Math.min(100, pyRound(score)));
  return scoredLead({ business: b, track, score, bucket: bucketFor(score, weights.buckets), why });
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test test/scoring.test.js`
Expected: PASS (16 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/scoring.js test/scoring.test.js
git commit -m "feat: port two-track scoring engine to JS"
```

---

## Task 4: `lib/campaigns.js` — outreach copy generator

**Files:**
- Create: `lib/campaigns.js`
- Test: `test/campaigns.test.js`

- [ ] **Step 1: Write the failing test** — `test/campaigns.test.js`

```javascript
import test from "node:test";
import assert from "node:assert/strict";
import { generateCampaign } from "../lib/campaigns.js";
import { scoredLead } from "../lib/models.js";
import { PERSONAL, makeBusiness } from "./helpers.js";

function displacementLead() {
  const b = makeBusiness({ name: "Cut & Co Salon", category: "salon", rating: 3.5, review_count: 120 });
  return scoredLead({ business: b, track: "displacement", score: 75, bucket: "hot", why: ["Displacement • Salon"] });
}
function greenfieldLead() {
  const b = makeBusiness({ name: "Nueva Taqueria", category: "restaurant", review_count: 2 });
  return scoredLead({ business: b, track: "greenfield", score: 80, bucket: "hot", why: ["Greenfield • Restaurant"] });
}

test("displacement angle is not a setup pitch", () => {
  const c = generateCampaign(displacementLead(), PERSONAL);
  const body = (c.email1_body + c.email2_body).toLowerCase();
  assert.ok(body.includes("switch") || body.includes("overpay") || body.includes("rate"));
  assert.ok(!body.includes("getting set up"));
});

test("greenfield angle is not a switch pitch", () => {
  const c = generateCampaign(greenfieldLead(), PERSONAL);
  const body = (c.email1_body + c.email2_body).toLowerCase();
  assert.ok(body.includes("set up") || body.includes("getting started"));
  assert.ok(!body.includes("switch"));
});

test("footer present and no unrendered tokens", () => {
  const c = generateCampaign(displacementLead(), PERSONAL);
  assert.ok(c.email1_body.includes("Reply STOP to opt out."));
  assert.ok(!c.email1_body.includes("{") && !c.email1_body.includes("}"));
  assert.ok(!c.voicemail.includes("{") && !c.voicemail.includes("}"));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/campaigns.test.js`
Expected: FAIL — cannot find module `../lib/campaigns.js`.

- [ ] **Step 3: Write `lib/campaigns.js`**

```javascript
function footer(personal) {
  const f = personal.canspam_footer;
  return `\n\n—\n${personal.name}, ${personal.company}\n${f.business_address}\n${f.optout_line}`;
}

function displacement(lead, personal) {
  const name = lead.business.name;
  const vertical = lead.business.category.replace(/_/g, " ");
  const foot = footer(personal);
  const who = personal.name;
  const company = personal.company;

  return {
    place_id: lead.business.place_id,
    email1_subject: `Quick question about card processing at ${name}`,
    email1_body:
      `Hi ${name} team,\n\n` +
      `I work with ${vertical} businesses around Houston on their card ` +
      `processing, and a couple of your reviews caught my eye. Would you be ` +
      `open to a two-minute look at your current effective rate? Most ` +
      `${vertical}s I review are overpaying and don't realize it — no ` +
      `long-term contract on our side either.\n\n` +
      `Worth a quick look?\n\n${who}, ${company}` +
      foot,
    email2_subject: `Re: card processing at ${name}`,
    email2_body:
      `Hi again,\n\n` +
      `One concrete thing: if you're on flat-rate pricing (Square, Clover, ` +
      `and similar), switching to interchange-plus usually drops the ` +
      `effective rate noticeably at your volume. I'm happy to read your ` +
      `latest statement and tell you straight whether it's worth changing.\n\n` +
      `Reply here or call/text ${personal.callback_number}.\n\n${who}` +
      foot,
    sms:
      `Hi ${name} — ${who} with ${company}. Saw your spot and think you may be ` +
      `overpaying on card fees. Open to a quick rate check? No contract.`,
    voicemail:
      `Hi, this is ${who} with ${company}. I help local ${vertical}s cut their ` +
      `card-processing costs without locking into a contract. If you'd like a ` +
      `free rate review, call me back at ${personal.callback_number}. Thanks!`,
  };
}

function greenfield(lead, personal) {
  const name = lead.business.name;
  const vertical = lead.business.category.replace(/_/g, " ");
  const foot = footer(personal);
  const who = personal.name;
  const company = personal.company;

  return {
    place_id: lead.business.place_id,
    email1_subject: `Congrats on ${name} — payments set up right`,
    email1_body:
      `Hi ${name} team,\n\n` +
      `Congrats on the new ${vertical}! When you're getting set up to take ` +
      `cards, the choices you make now are hard to undo later. I help new ` +
      `Houston businesses start on transparent pricing and the right hardware ` +
      `from day one.\n\n` +
      `Want a quick rundown of what to look for?\n\n${who}, ${company}` +
      foot,
    email2_subject: `Re: getting ${name} ready to take cards`,
    email2_body:
      `Hi again,\n\n` +
      `Quick tip for a new ${vertical}: avoid leased terminals and flat-rate ` +
      `lock-ins — they're easy to sign up for and expensive to leave. I can ` +
      `walk you through getting started on interchange-plus with EMV/NFC ` +
      `hardware so you're ready for chip and tap on opening day.\n\n` +
      `Reply here or call/text ${personal.callback_number}.\n\n${who}` +
      foot,
    sms:
      `Hi ${name} — ${who} with ${company}. Congrats on opening! Happy to help ` +
      `you get card payments set up right from the start. Want a quick tip sheet?`,
    voicemail:
      `Hi, this is ${who} with ${company}. Congratulations on the new ${vertical}! ` +
      `I help new businesses get payments set up right the first time. Give me ` +
      `a call back at ${personal.callback_number} whenever's good. Thanks!`,
  };
}

export function generateCampaign(lead, personal) {
  return lead.track === "greenfield" ? greenfield(lead, personal) : displacement(lead, personal);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test test/campaigns.test.js`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/campaigns.js test/campaigns.test.js
git commit -m "feat: port track-aware campaign generator to JS"
```

---

## Task 5: `lib/fetcher.js` — Places fetch, parsing, normalization, demo loader

**Files:**
- Create: `lib/fetcher.js`
- Test: `test/fetcher.test.js`

- [ ] **Step 1: Write the failing test** — `test/fetcher.test.js`

```javascript
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import {
  parsePlacesResponse, dedupe, normalizeCategory, loadDemoBusinesses,
  fetchNearby, PRICE_LEVELS,
} from "../lib/fetcher.js";

const require = createRequire(import.meta.url);
const DEMO_RAW = require("../public/demo_places.json");

test("parse and normalize demo response", () => {
  const businesses = parsePlacesResponse(DEMO_RAW);
  assert.equal(businesses.length, 10);
  const barber = businesses.find((b) => b.place_id === "DEMO_A");
  assert.equal(barber.category, "salon"); // barber_shop → salon
  assert.equal(barber.price_level, PRICE_LEVELS.PRICE_LEVEL_MODERATE);
  assert.ok(barber.review_texts.some((t) => t.toLowerCase().includes("cash only")));
});

test("normalize category passthrough", () => {
  assert.equal(normalizeCategory("restaurant"), "restaurant");
  assert.equal(normalizeCategory("unknown_type"), "unknown_type");
});

test("dedupe removes seen ids", () => {
  const businesses = parsePlacesResponse(DEMO_RAW);
  const fresh = dedupe(businesses, new Set(["DEMO_A"]));
  assert.ok(fresh.every((b) => b.place_id !== "DEMO_A"));
});

test("loadDemoBusinesses returns parsed businesses", () => {
  const businesses = loadDemoBusinesses();
  assert.equal(businesses.length, 10);
});

test("fetchNearby posts to Places and parses response (stubbed fetch)", async () => {
  const orig = globalThis.fetch;
  let sawUrl, sawHeaders;
  globalThis.fetch = async (url, opts) => {
    sawUrl = url;
    sawHeaders = opts.headers;
    return new Response(JSON.stringify(DEMO_RAW), { status: 200 });
  };
  try {
    const businesses = await fetchNearby({
      apiKey: "k", location: "29.9,-95.6", radiusMeters: 15000,
      includedTypes: ["restaurant"], maxResults: 10,
    });
    assert.equal(businesses.length, 10);
    assert.equal(sawUrl, "https://places.googleapis.com/v1/places:searchNearby");
    assert.equal(sawHeaders["X-Goog-Api-Key"], "k");
  } finally {
    globalThis.fetch = orig;
  }
});

test("fetchNearby throws after exhausting 429 retries", async () => {
  const orig = globalThis.fetch;
  globalThis.fetch = async () => new Response("", { status: 429 });
  try {
    await assert.rejects(
      () => fetchNearby({ apiKey: "k", location: "1,2", radiusMeters: 1, includedTypes: ["restaurant"], retries: 2, backoffMs: 0 }),
      /rate limit/i,
    );
  } finally {
    globalThis.fetch = orig;
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/fetcher.test.js`
Expected: FAIL — cannot find module `../lib/fetcher.js`.

- [ ] **Step 3: Write `lib/fetcher.js`**

```javascript
import { createRequire } from "node:module";
import { business } from "./models.js";

const require = createRequire(import.meta.url);

export const PLACES_URL = "https://places.googleapis.com/v1/places:searchNearby";

export const PRICE_LEVELS = {
  PRICE_LEVEL_FREE: 0, PRICE_LEVEL_INEXPENSIVE: 1,
  PRICE_LEVEL_MODERATE: 2, PRICE_LEVEL_EXPENSIVE: 3,
  PRICE_LEVEL_VERY_EXPENSIVE: 4,
};

export const FIELD_MASK = [
  "places.id", "places.displayName", "places.primaryType",
  "places.formattedAddress", "places.nationalPhoneNumber",
  "places.websiteUri", "places.rating", "places.userRatingCount",
  "places.priceLevel", "places.businessStatus", "places.reviews",
].join(",");

const TYPE_NORMALIZATION = {
  hair_salon: "salon", beauty_salon: "salon", nail_salon: "salon",
  barber_shop: "salon", spa: "spa", day_spa: "spa",
  restaurant: "restaurant", meal_takeaway: "restaurant",
  meal_delivery: "restaurant", pizza_restaurant: "restaurant",
  mexican_restaurant: "restaurant", cafe: "cafe", coffee_shop: "cafe",
  bar: "bar", pub: "bar", night_club: "bar",
  clothing_store: "retail", store: "retail", shoe_store: "retail",
  gift_shop: "retail", furniture_store: "retail", boutique: "retail",
  car_repair: "auto", car_wash: "auto", auto_parts_store: "auto",
  dentist: "professional", doctor: "professional", lawyer: "professional",
  accounting: "professional", veterinary_care: "professional",
};

export function normalizeCategory(primaryType) {
  return TYPE_NORMALIZATION[primaryType] ?? primaryType;
}

export function parsePlacesResponse(raw) {
  const out = [];
  for (const p of raw.places ?? []) {
    const reviews = (p.reviews ?? [])
      .filter((r) => r.text)
      .map((r) => (r.text && r.text.text) || "");
    out.push(business({
      place_id: p.id,
      name: (p.displayName && p.displayName.text) || "",
      category: normalizeCategory(p.primaryType ?? ""),
      address: p.formattedAddress ?? "",
      phone: p.nationalPhoneNumber ?? null,
      website: p.websiteUri ?? null,
      rating: p.rating ?? null,
      review_count: p.userRatingCount ?? 0,
      price_level: PRICE_LEVELS[p.priceLevel] ?? null,
      business_status: p.businessStatus ?? "",
      review_texts: reviews.filter((t) => t),
    }));
  }
  return out;
}

export function dedupe(businesses, seenIds) {
  return businesses.filter((b) => !seenIds.has(b.place_id));
}

export function loadDemoBusinesses() {
  const raw = require("../public/demo_places.json");
  return parsePlacesResponse(raw);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// backoffMs is injectable so tests don't actually wait between retries.
export async function fetchNearby({ apiKey, location, radiusMeters, includedTypes,
  maxResults = 20, retries = 3, backoffMs = 1000 }) {
  const [lat, lng] = location.split(",").map(Number);
  const body = {
    includedTypes,
    maxResultCount: maxResults,
    locationRestriction: { circle: { center: { latitude: lat, longitude: lng }, radius: Number(radiusMeters) } },
  };
  const headers = {
    "Content-Type": "application/json",
    "X-Goog-Api-Key": apiKey,
    "X-Goog-FieldMask": FIELD_MASK,
  };
  for (let attempt = 0; attempt < retries; attempt++) {
    const resp = await fetch(PLACES_URL, { method: "POST", headers, body: JSON.stringify(body) });
    if (resp.status === 429) {
      await sleep(2 ** attempt * backoffMs);
      continue;
    }
    if (!resp.ok) {
      throw new Error(`Places API error ${resp.status}`);
    }
    return parsePlacesResponse(await resp.json());
  }
  throw new Error("Places API rate limit: exhausted retries");
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test test/fetcher.test.js`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/fetcher.js test/fetcher.test.js
git commit -m "feat: port Places fetcher + parser to JS (global fetch, injectable backoff)"
```

---

## Task 6: `lib/pipeline.js` — buildLeads + summarize

**Files:**
- Create: `lib/pipeline.js`
- Test: `test/pipeline.test.js`

- [ ] **Step 1: Write the failing test** — `test/pipeline.test.js`

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
  const rows = buildLeads(CFG, parsePlacesResponse(DEMO_RAW));
  // DEMO_I is a laundromat (low-fit) named "Cypress Discount Vapes" → excluded
  assert.ok(rows.every((r) => r.name !== "Cypress Discount Vapes"));
  const scores = rows.map((r) => r.score);
  assert.deepEqual(scores, [...scores].sort((a, b) => b - a));
  assert.ok(rows.every((r) => r.campaign.email1_body));
});

test("summarize counts add up", () => {
  const rows = buildLeads(CFG, parsePlacesResponse(DEMO_RAW));
  const s = summarize(rows);
  assert.equal(s.total, rows.length);
  assert.equal(s.displacement + s.greenfield, s.total);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/pipeline.test.js`
Expected: FAIL — cannot find module `../lib/pipeline.js`.

- [ ] **Step 3: Write `lib/pipeline.js`**

```javascript
import { scoreBusiness } from "./scoring.js";
import { generateCampaign } from "./campaigns.js";

export function buildLeads(cfg, businesses) {
  const icp = new Set(cfg.search.verticals);
  const personal = cfg.personal;
  const weights = cfg.weights;

  const rows = [];
  for (const b of businesses) {
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
  return rows;
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

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test test/pipeline.test.js`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/pipeline.js test/pipeline.test.js
git commit -m "feat: port pipeline (buildLeads + summarize) to JS"
```

---

## Task 7: `lib/config.js` — config + secrets loader

**Files:**
- Create: `lib/config.js`
- Test: `test/config.test.js`

- [ ] **Step 1: Write the failing test** — `test/config.test.js`

```javascript
import test from "node:test";
import assert from "node:assert/strict";
import { loadConfig, cfgDict } from "../lib/config.js";

test("loadConfig reads baked config and env secrets", () => {
  process.env.GOOGLE_PLACES_API_KEY = "test-key";
  process.env.APP_PASSPHRASE = "test-pass";
  const cfg = loadConfig();
  assert.ok(Array.isArray(cfg.search.verticals));
  assert.equal(cfg.apiKey, "test-key");
  assert.equal(cfg.passphrase, "test-pass");
});

test("loadConfig returns null secrets when env is unset", () => {
  delete process.env.GOOGLE_PLACES_API_KEY;
  delete process.env.APP_PASSPHRASE;
  const cfg = loadConfig();
  assert.equal(cfg.apiKey, null);
  assert.equal(cfg.passphrase, null);
});

test("cfgDict exposes only search/personal/weights", () => {
  const cfg = loadConfig();
  const d = cfgDict(cfg);
  assert.deepEqual(Object.keys(d).sort(), ["personal", "search", "weights"]);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/config.test.js`
Expected: FAIL — cannot find module `../lib/config.js`.

- [ ] **Step 3: Write `lib/config.js`**

```javascript
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const raw = require("../config.json");

export function loadConfig() {
  return {
    search: raw.search,
    personal: raw.personal,
    weights: raw.weights,
    apiKey: process.env.GOOGLE_PLACES_API_KEY || null,
    passphrase: process.env.APP_PASSPHRASE || null,
  };
}

export function cfgDict(cfg) {
  return { search: cfg.search, personal: cfg.personal, weights: cfg.weights };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test test/config.test.js`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/config.js test/config.test.js
git commit -m "feat: add JS config loader (baked config + env secrets)"
```

---

## Task 8: `netlify/functions/leads.js` — the Function (orchestration + gate)

**Files:**
- Create: `netlify/functions/leads.js`
- Test: `test/function.test.js`

- [ ] **Step 1: Write the failing test** — `test/function.test.js`

```javascript
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import handler from "../netlify/functions/leads.js";

const require = createRequire(import.meta.url);
const DEMO_RAW = require("../public/demo_places.json");

test("demo request returns leads + summary, no passphrase needed", async () => {
  const res = await handler(new Request("http://x/api/leads?demo=1"));
  assert.equal(res.status, 200);
  const d = await res.json();
  assert.equal(d.demo, true);
  assert.ok(d.leads.length > 0);
  assert.equal(d.summary.total, d.leads.length);
  assert.equal(typeof d.threshold, "number");
});

test("live request without passphrase is 401", async () => {
  delete process.env.APP_PASSPHRASE;
  const res = await handler(new Request("http://x/api/leads"));
  assert.equal(res.status, 401);
});

test("live request with wrong passphrase is 401", async () => {
  process.env.APP_PASSPHRASE = "right";
  const res = await handler(new Request("http://x/api/leads", { headers: { "x-app-passphrase": "wrong" } }));
  assert.equal(res.status, 401);
});

test("live request with correct passphrase but no API key is 500", async () => {
  process.env.APP_PASSPHRASE = "right";
  delete process.env.GOOGLE_PLACES_API_KEY;
  const res = await handler(new Request("http://x/api/leads", { headers: { "x-app-passphrase": "right" } }));
  assert.equal(res.status, 500);
});

test("live request with correct passphrase + key returns leads (stubbed fetch)", async () => {
  process.env.APP_PASSPHRASE = "right";
  process.env.GOOGLE_PLACES_API_KEY = "key";
  const orig = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify(DEMO_RAW), { status: 200 });
  try {
    const res = await handler(new Request("http://x/api/leads", { headers: { "x-app-passphrase": "right" } }));
    assert.equal(res.status, 200);
    const d = await res.json();
    assert.equal(d.demo, false);
    assert.ok(d.leads.length > 0);
  } finally {
    globalThis.fetch = orig;
  }
});

test("fetch failure surfaces as 502", async () => {
  process.env.APP_PASSPHRASE = "right";
  process.env.GOOGLE_PLACES_API_KEY = "key";
  const orig = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error("network down"); };
  try {
    const res = await handler(new Request("http://x/api/leads", { headers: { "x-app-passphrase": "right" } }));
    assert.equal(res.status, 502);
  } finally {
    globalThis.fetch = orig;
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/function.test.js`
Expected: FAIL — cannot find module `../netlify/functions/leads.js`.

- [ ] **Step 3: Write `netlify/functions/leads.js`**

```javascript
import { loadConfig, cfgDict } from "../../lib/config.js";
import { fetchNearby, loadDemoBusinesses } from "../../lib/fetcher.js";
import { buildLeads, summarize } from "../../lib/pipeline.js";

// Netlify Functions v2: route /api/leads directly to this function.
export const config = { path: "/api/leads" };

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "content-type": "application/json" },
  });
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
      businesses = await fetchNearby({
        apiKey: cfg.apiKey,
        location: s.location,
        radiusMeters: s.radius_meters,
        includedTypes: s.verticals,
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

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test test/function.test.js`
Expected: PASS (6 tests).

- [ ] **Step 5: Run the whole suite**

Run: `node --test`
Expected: PASS (39 tests across all files).

- [ ] **Step 6: Commit**

```bash
git add netlify/functions/leads.js test/function.test.js
git commit -m "feat: add /api/leads Netlify Function with passphrase gate"
```

---

## Task 9: Frontend — static shell + client (demo param, passphrase, mode badge)

**Files:**
- Create: `public/index.html` (de-templated from `src/mpg_leads/templates/dashboard.html`)
- Create: `public/dashboard.css` (copied)
- Create: `public/dashboard.js` (copied + edited)

- [ ] **Step 1: Copy the CSS unchanged**

Run (bash): `cp src/mpg_leads/static/dashboard.css public/dashboard.css`
Run (PowerShell): `Copy-Item src/mpg_leads/static/dashboard.css public/dashboard.css`

- [ ] **Step 2: Create `public/index.html`** (Jinja removed; ids added for JS-populated shell)

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Lead Desk</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;600;700&family=Inter:wght@400;500;600&family=JetBrains+Mono:wght@400;500;700&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="dashboard.css">
</head>
<body>
  <header class="topbar">
    <div class="brand">
      <span class="brand-mark" aria-hidden="true"></span>
      <span class="brand-name" id="brand-name">Lead Desk</span>
      <span class="brand-sub">Lead Desk</span>
    </div>
    <div class="topbar-right">
      <span class="mode-badge" id="mode" hidden></span>
      <span class="operator" id="operator" hidden></span>
      <button id="refresh" class="btn btn-primary" type="button">Refresh leads</button>
    </div>
  </header>

  <section class="context">
    <p class="context-line" id="context"></p>
  </section>

  <section class="stats" id="stats" hidden>
    <div class="stat"><span class="stat-num" id="stat-hot">0</span><span class="stat-label">Hot</span></div>
    <div class="stat"><span class="stat-num" id="stat-warm">0</span><span class="stat-label">Warm</span></div>
    <div class="stat stat-track-d"><span class="stat-num" id="stat-disp">0</span><span class="stat-label">Displacement</span></div>
    <div class="stat stat-track-g"><span class="stat-num" id="stat-green">0</span><span class="stat-label">Greenfield</span></div>
  </section>

  <section class="controls" id="controls" hidden>
    <div class="filters" role="group" aria-label="Filter leads">
      <button class="chip is-active" data-filter="all" type="button">All</button>
      <button class="chip" data-filter="hot" type="button">Hot</button>
      <button class="chip" data-filter="warm" type="button">Warm</button>
      <button class="chip" data-filter="displacement" type="button">Displacement</button>
      <button class="chip" data-filter="greenfield" type="button">Greenfield</button>
    </div>
    <div class="control-right">
      <input id="search" class="search" type="search" placeholder="Filter by name…" aria-label="Filter by business name">
      <label class="sort">Sort
        <select id="sort" aria-label="Sort leads">
          <option value="score">Score</option>
          <option value="name">Name</option>
        </select>
      </label>
    </div>
  </section>

  <main id="leads" class="leads" aria-live="polite">
    <div class="state" id="loading">Scoring leads…</div>
  </main>

  <footer class="compliance">
    Generate-only outreach. You send it. Contact only businesses you may lawfully
    reach — this tool is not legal advice.
  </footer>

  <script src="dashboard.js"></script>
</body>
</html>
```

- [ ] **Step 3: Copy the client JS, then apply the edits below**

Run (bash): `cp src/mpg_leads/static/dashboard.js public/dashboard.js`
Run (PowerShell): `Copy-Item src/mpg_leads/static/dashboard.js public/dashboard.js`

- [ ] **Step 4: Edit `public/dashboard.js` — add constants + helpers after the `state` declaration**

Find (near the top, inside the IIFE):

```javascript
  var state = { leads: [], filter: "all", sort: "score", query: "", threshold: 40 };
```

Add immediately after it:

```javascript
  var DEMO = new URLSearchParams(location.search).get("demo") === "1";
  var PASS_KEY = "mpg_pass";

  function getPass() { return localStorage.getItem(PASS_KEY) || ""; }
  function ensurePass() {
    var p = getPass();
    if (!p) {
      p = window.prompt("Enter passphrase to fetch live leads:") || "";
      if (p) localStorage.setItem(PASS_KEY, p);
    }
    return p;
  }

  function initShell() {
    fetch("config.json")
      .then(function (r) { return r.json(); })
      .then(function (cfg) {
        document.getElementById("brand-name").textContent = cfg.personal.company || "Lead Desk";
        document.title = (cfg.personal.company || "Lead Desk") + " — Lead Desk";
        var op = document.getElementById("operator");
        if (cfg.personal.name) { op.textContent = cfg.personal.name; op.hidden = false; }
        state.threshold = cfg.search.score_threshold || 40;
        var km = (cfg.search.radius_meters / 1000).toFixed(1);
        document.getElementById("context").innerHTML =
          "Searching <strong>" + esc(cfg.search.verticals.join(", ")) + "</strong> within " +
          "<strong>" + km + " km</strong>. Target score <strong>" + state.threshold +
          "+</strong>. Leads below target sit under the divider.";
      })
      .catch(function () { /* shell is best-effort; leads still load */ });
  }

  function setModeBadge(demo) {
    var badge = document.getElementById("mode");
    badge.textContent = demo ? "Demo data" : "Live · Places API";
    badge.className = "mode-badge " + (demo ? "mode-demo" : "mode-live");
    badge.hidden = false;
  }
```

- [ ] **Step 5: Edit `public/dashboard.js` — replace the whole `load()` function**

Replace this existing function:

```javascript
  function load() {
    el.leads.innerHTML = '<div class="state">Scoring leads…</div>';
    el.refresh.disabled = true;
    fetch("/api/leads")
      .then(function (r) { return r.json().then(function (d) { return { ok: r.ok, d: d }; }); })
      .then(function (res) {
        if (!res.ok) {
          el.leads.innerHTML = '<div class="empty"><strong>Could not load leads.</strong>' +
            esc(res.d.error || "Unknown error") + "</div>";
          return;
        }
        state.leads = res.d.leads || [];
        state.threshold = res.d.threshold || 40;
        paintStats(res.d.summary);
        render();
      })
      .catch(function (e) {
        el.leads.innerHTML = '<div class="empty"><strong>Could not reach the server.</strong>' +
          esc(String(e)) + "</div>";
      })
      .then(function () { el.refresh.disabled = false; });
  }
```

With:

```javascript
  function load() {
    el.leads.innerHTML = '<div class="state">Scoring leads…</div>';
    el.refresh.disabled = true;

    var url = DEMO ? "/api/leads?demo=1" : "/api/leads";
    var opts = {};
    if (!DEMO) {
      var p = ensurePass();
      opts.headers = { "X-App-Passphrase": p };
    }

    fetch(url, opts)
      .then(function (r) { return r.json().then(function (d) { return { ok: r.ok, status: r.status, d: d }; }); })
      .then(function (res) {
        if (res.status === 401) {
          localStorage.removeItem(PASS_KEY);
          el.leads.innerHTML = '<div class="empty"><strong>Passphrase rejected.</strong>' +
            "Click Refresh leads to try again.</div>";
          return;
        }
        if (!res.ok) {
          el.leads.innerHTML = '<div class="empty"><strong>Could not load leads.</strong>' +
            esc(res.d.error || "Unknown error") + "</div>";
          return;
        }
        state.leads = res.d.leads || [];
        state.threshold = res.d.threshold || 40;
        setModeBadge(res.d.demo);
        paintStats(res.d.summary);
        render();
      })
      .catch(function (e) {
        el.leads.innerHTML = '<div class="empty"><strong>Could not reach the server.</strong>' +
          esc(String(e)) + "</div>";
      })
      .then(function () { el.refresh.disabled = false; });
  }
```

- [ ] **Step 6: Edit `public/dashboard.js` — call `initShell()` before the initial `load()`**

Find the final line inside the IIFE:

```javascript
  load();
})();
```

Replace with:

```javascript
  initShell();
  load();
})();
```

- [ ] **Step 7: Copy `config.json` into `public/` so the client can fetch it**

The client fetches `config.json` relative to the site root. Copy the baked config there:

Run (bash): `cp config.json public/config.json`
Run (PowerShell): `Copy-Item config.json public/config.json`

Note: `public/config.json` contains only non-secret display config (company, verticals, radius, threshold, and the CAN-SPAM contact details that already appear in outreach). No API key or passphrase is in this file.

- [ ] **Step 8: Verify the whole suite still passes** (frontend has no unit tests; this confirms nothing broke)

Run: `node --test`
Expected: PASS (39 tests).

- [ ] **Step 9: Commit**

```bash
git add public/index.html public/dashboard.css public/dashboard.js public/config.json
git commit -m "feat: static frontend (de-templated shell, demo param, passphrase, mode badge)"
```

---

## Task 10: Local verification with `netlify dev` + README

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Run the app locally end-to-end in demo mode**

Run: `npx netlify dev`
Then open the printed local URL with `?demo=1` appended (e.g. `http://localhost:8888/?demo=1`).
Expected: dashboard loads, mode badge reads "Demo data", 10 demo businesses minus low-fit are scored and rendered, filters/sort/search work, "Outreach" expands the copy panel, "Copy" buttons work.

- [ ] **Step 2: Verify the live gate locally**

With `netlify dev` still running, open the local URL **without** `?demo=1`.
Expected: a passphrase prompt appears. Entering anything (no `APP_PASSPHRASE` set locally) → the leads area shows "Passphrase rejected." This confirms the gate blocks live fetches. (Full live testing happens post-deploy with env vars set.)

- [ ] **Step 3: Update `README.md`** — add a Netlify section

Add the following section after the "Live mode (real leads)" section:

```markdown
## Deploying to Netlify (hosted, remote access)

This repo also ships as a Netlify app: a static dashboard plus one Netlify
Function (`netlify/functions/leads.js`) that replaces the Flask route. The
scoring/campaign/fetch logic lives in `lib/` as a JavaScript port of the Python
modules, covered by tests you can run with `node --test`.

### Local development

```bash
npx netlify dev          # serves public/ + the function locally
```

Open `http://localhost:8888/?demo=1` for demo mode (no key, no passphrase).
Omit `?demo=1` for live mode (prompts for the passphrase).

### Deploy

1. Push this repo to GitHub and create a Netlify site from it (build command:
   none; publish directory: `public`).
2. In **Site settings → Environment variables**, set:
   - `GOOGLE_PLACES_API_KEY` — your Places API (New) key.
   - `APP_PASSPHRASE` — the passphrase that unlocks live lead-fetching.
3. Visit your site. Demo mode is at `/?demo=1`; live mode is the default and
   prompts for the passphrase (stored in your browser after the first entry).

Edit search area, verticals, weights, and your personal/CAN-SPAM details in
`config.json` (and `public/config.json`), then push to redeploy. Secrets stay
in Netlify env vars — never in the repo.
```

- [ ] **Step 4: Commit**

```bash
git add README.md
git commit -m "docs: document Netlify deploy and local netlify dev workflow"
```

---

## Notes on parity & gotchas (read before implementing)

- **`config.json` is duplicated** into `public/config.json` (Task 9 Step 7). The
  root copy is imported by the Function; the `public/` copy is fetched by the
  browser for the shell. Keep them in sync when editing (both are committed).
  This is deliberate: the Function must not read files outside its bundle, and
  the browser must not see secrets (there are none in this file, but the split
  keeps the boundary clean).
- **Rounding parity** is handled by `pyRound` in `lib/scoring.js`. If any scoring
  test diverges from the Python expectation, the bug is almost certainly a
  missed `pyRound` call or a `||` where `??` was needed (falsy `0` price levels).
- **`fetch`/`Request`/`Response`** are Node 18+ globals. Tests stub
  `globalThis.fetch` and restore it in `finally`.
- **Test count** referenced in commands: 3 (models) + 16 (scoring) + 3
  (campaigns) + 6 (fetcher) + 2 (pipeline) + 3 (config) + 6 (function) = **39**.
