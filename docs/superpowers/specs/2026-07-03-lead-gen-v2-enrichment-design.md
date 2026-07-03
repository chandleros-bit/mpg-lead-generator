# Lead-gen v2 — enrichment & new signals

**Date:** 2026-07-03
**Status:** Approved design, ready for implementation plan
**Scope:** One combined initiative, four capabilities. JS/Netlify path only; the
legacy Python app (`src/mpg_leads`) is explicitly out of scope and not modified.

## Summary

Four additions to the existing two-track (Displacement / Greenfield) pipeline:

1. **Processor-badge detection (#1)** — scrape each Displacement candidate's
   website (and one checkout/payment page if discoverable) for known
   processor/POS fingerprints. A detected processor is a high-confidence
   Displacement signal, weighted **stronger** than the review-keyword heuristic,
   and surfaces in the dashboard "why" chips.
2. **Chain disqualifier — domain delta (#2)** — extend the shipped known-chain
   filter to also match on website **domain**, and seed corporate domains /
   Love's Travel Stop. Hard-drop behavior unchanged.
3. **TABC greenfield source (#3)** — pull recently issued TABC (alcohol) licenses
   from the Texas open-data Socrata API as a genuine "new establishment, no
   incumbent yet" signal, merged into the same pipeline alongside Places.
4. **Owner enrichment (#4)** — for above-threshold leads, scrape the lead's own
   About/Team/Contact pages for an owner/decision-maker name + email so campaign
   copy can address a person instead of "team."

Cut from scope after review: **Yelp review scanning (#5)** — no compliant path to
full review text (Fusion API returns ≤3 short excerpts; scraping violates ToS).

## Goals

- Add processor detection as a **scoring input** (it moves the Displacement
  score, not just an annotation), weighted above `keyword_pain_max`.
- Add TABC as a first-class Greenfield source that flows through existing
  Greenfield scoring.
- Enrich above-threshold leads with a person's name/email for outreach copy.
- Extend chain filtering to domains.
- **Every new source is config-driven and fails gracefully:** a lead still scores
  on Places data alone if any source is disabled, down, or times out.
- Preserve the **generate-only** boundary: enrichment surfaces an email for the
  user to contact manually; nothing is ever sent automatically.

## Non-goals

- No changes to the Python app or to `public/config.json` (new knobs are
  server-side only).
- No Yelp integration.
- No paid enrichment API (Hunter.io etc.) — documented as a future option only.
- No out-of-band scraping/caching infrastructure (rejected Approach C).
- No exclude-vs-flag toggle for chains — matches remain a silent hard-drop.
- No processor detection on Greenfield leads (a detected processor contradicts
  the Greenfield "no processor yet" premise).

## Architecture — Approach A (single request, bounded best-effort scraping)

All work stays in the one `/api/leads` Netlify function. Live scraping is bounded
by a shared HTTP utility enforcing per-fetch timeout, bounded concurrency, and a
**start-relative wall-clock deadline**. Work not completed by the deadline is
skipped — that skip *is* the graceful degradation. Rejected alternatives:
Approach B (separate `/api/enrich` endpoint) breaks "the badge moves the score"
because the badge would arrive after scoring; Approach C (scheduled scrape +
cache) is over-built for a single-user tool.

### Timeout budget (hardened)

Netlify sync functions default to a ~10s limit. The Places fan-out is 8 serial
calls that run *before* any scraping. Therefore the budget is a **deadline
computed from request start**, not an additive constant:

- Handler records `requestStart` and computes `deadline = requestStart +
  enrichment.global_budget_ms`.
- All scraping passes stop issuing new fetches once `Date.now() >= deadline`.
- `global_budget_ms` is set conservatively (~6000) and/or the function timeout is
  raised in `netlify.toml`. The plan pins the final numbers.

## Components

### `lib/http.js` (new) — scraping backbone

Pure-ish utility; the only impurity is the injected `fetchImpl`.

- `fetchWithTimeout(url, { timeoutMs, fetchImpl, userAgent })` — GET with an
  `AbortController` deadline and a descriptive `User-Agent`. Returns response
  **text or `null`** on any error/timeout. Never throws.
- `mapWithBudget(items, fn, { concurrency, deadline })` — runs `fn` over `items`
  with bounded concurrency, stopping at the wall-clock `deadline`; unreached items
  resolve to `null`. This is the mechanism behind graceful degradation.
- Per-request **fetch cache**: a `Map<domain, html>` (and a
  `Map<domain, robotsResult>`), created per request and threaded into the scraping
  passes so a homepage/robots file is fetched at most once and reused across the
  processor and owner phases.

### robots.txt policy (new)

Honors the "respect robots.txt/ToS" constraint.

- `parseRobots(text, userAgent)` — **pure**; returns disallowed path prefixes for
  our UA (falling back to `*`). Fixture-tested.
- Before scraping a domain, fetch `/robots.txt` once (cached per request). If the
  target path is disallowed, skip that fetch and treat the signal as absent.
- Fetches are shallow (homepage + at most one About/checkout page) and carry an
  identifying `User-Agent`. A missing/unreachable `robots.txt` is treated as
  "allowed" (standard convention).

### `lib/processors.js` (new) — #1 detection

Pure core + injectable fetch, mirroring `lib/chains.js` / `lib/research.js`.

- `PROCESSOR_SIGNATURES` — module constant (like `FEE_KEYWORDS`), mapping
  processor → fingerprint strings. Detection keys off payment-SDK/script/domain
  fingerprints (far more reliable than visible badges): Square
  (`squareup.com`, `web.squarecdn.com`), Clover (`clover.com`, `clover.js`),
  Toast (`toasttab.com`), Stripe (`js.stripe.com`), Clearent (`clearent`), plus
  Shopify Payments, Aloha, PayPal. Final list pinned in the plan.
- `detectProcessors(html, signatures)` — **pure**; deduped list of detected
  processor names. Fixture-tested.
- `discoverCheckoutUrl(html, baseUrl)` — **pure**; returns one likely
  order/checkout link (`order`, `checkout`, `menu`, toasttab/clover hrefs) or
  `null`. Gated by `check_checkout_page`; at most one extra fetch per site.

Operational knobs (`enabled`, `max_sites`, `fetch_timeout_ms`,
`check_checkout_page`) live in `config.json`; signatures stay in code, consistent
with how `FEE_KEYWORDS` already works.

**Candidate selection & cap:** processor scraping runs on Displacement-track
candidates **that have a website**, ranked by **preliminary Places-only score**,
scraping the top `max_sites`. This guarantees the cap always spends budget on the
most promising leads. (Preliminary score = `scoreBusiness` on Places data before
the processor signal exists.)

### `lib/tabc.js` (new) — #3 Greenfield source

Pure parse + injectable fetch.

- `fetchTabcNew({ counties, sinceDays, appToken, fetchImpl })` — queries the
  data.texas.gov Socrata endpoint with a SoQL filter on county + license issue
  date; returns raw rows. Impure, injectable, wrapped so failure → `[]`.
- `parseTabcRows(rows)` — **pure**; maps each row into the existing `business()`
  shape: synthetic `place_id` (`tabc:<license#>`), `name`, `address`, `category`
  (`restaurant`/`bar`), `website: null`, `review_count: 0`, `source: "tabc"`,
  `licensed_on` date. Fixture-tested against a real sample payload.

**Merge & dedupe:** in the handler, TABC results are fetched alongside
`fetchAllVerticals` and concatenated into the businesses list before
`buildLeads`. Dedupe against Places on a **normalized `name` + street-number +
ZIP** key (not the full address string, which differs between sources) so the same
business never appears as both a Places Displacement lead and a TABC Greenfield
lead.

**Geography note (documented limitation):** TABC filters by county, not lat/lng
radius, so results are county-scoped and may fall slightly outside the exact
search radius. Accepted — it is a lead *source*, not a precise geo query.

**Unverified, must pin in plan:** the exact Socrata dataset ID and column names
(issue-date field, county field). Because tests are fixture-based, a wrong field
name would not be caught by the suite — the fixture must be built from a genuine
response.

### `lib/chains.js` (extend) — #2 domain delta

- `normalizeDomain(url)` — **pure**; strips scheme / `www.` / path → bare host.
- `isChainDomain(website, domains)` — **pure**; true if the lead's normalized
  domain matches any entry in the domain blocklist.
- Pipeline drops a lead if `isChain(name, brands)` **or**
  `isChainDomain(website, domains)`. Still a silent hard-drop; still counted in
  `chainsFiltered`.
- Existing `normalizeName` / `isChain` unchanged.

### `lib/enrich.js` (new) — #4 owner enrichment

Pure extraction + injectable fetch.

- `findContactPage(html, baseUrl)` — **pure**; picks an About/Team/Contact URL
  from homepage links (`about`, `team`, `meet`, `staff`, `owner`, `contact`) or
  `null`.
- `extractOwner(html)` — **pure**; returns `{ name?, email?, title?, confidence }`.
  Email via `mailto:` first, then a text-email regex, de-prioritizing role
  addresses (`info@`, `support@`, `contact@`). Name via JSON-LD
  (`founder`/`employee`) or an "Owner/Founder/Proprietor" proximity heuristic.
  Best-effort; `confidence` flagged low when only a heuristic matched.
- Runs only on **above-threshold leads that have a website** (small set), reusing
  the per-request HTML cache from the processor phase where possible.

### `lib/scoring.js` (extend) — processor signal

- `processorPoints(processor, wmax)` — returns `wmax` when a processor was
  detected on the business, else `0`.
- New weight `weights.displacement.processor_max` (proposed **25** — greater than
  `keyword_pain_max: 12`, satisfying "weighted stronger than the review
  heuristic"). Displacement weights are rebalanced so the badge is meaningful
  under the 0–100 clamp; concrete numbers pinned in the plan.
- `why` gains a copper/pain-signal chip, e.g. `"Square detected on site"`.
- Displacement-only. Greenfield scoring is unchanged except TABC leads (which
  classify as Greenfield via `review_count: 0`) gain a why-chip
  `"New TABC license (issued <date>) — no processor yet"`.
- **Expected fixture impact:** rebalancing changes existing Displacement scores,
  so `scoring.test.js` numeric fixtures shift. Acceptable — JS path is explicitly
  Python-parity-free (per the chain-disqualifier spec).

### `lib/pipeline.js` (extend) — sole orchestration point

`buildLeads(cfg, businesses, deps)` becomes **async** and accepts injected
fetchers/deadline (defaulted for production, overridden in tests):

1. Merge Places + TABC businesses; dedupe TABC against Places by normalized
   name + street-number + ZIP.
2. Chain filter (`isChain` name **or** `isChainDomain` domain) → increment
   `chainsFiltered`.
3. Classify tracks (cheap, pure). Compute preliminary Places-only scores; select
   Displacement candidates with a website, ranked by preliminary score.
4. **Processor scrape** (top `max_sites`, bounded concurrency, robots-checked,
   budget-bounded) → attach `processor` to those businesses.
5. Score all leads (processor signal now influences Displacement score/sort).
6. Select above-threshold leads with a website → **owner scrape** (remaining
   budget, reusing cached HTML) → attach `owner`.
7. Generate campaigns, build rows (rows now carry `processor`, `owner`, `source`),
   return `{ rows, chainsFiltered }`.

Return shape stays `{ rows, chainsFiltered }`; rows gain fields. `summarize`
unchanged. If enrichment is disabled or all fetches fail, steps 4/6 attach
nothing and scoring proceeds on Places data alone.

### `lib/campaigns.js` (extend)

- If `lead.owner?.name` is present, the greeting becomes `"Hi <FirstName>,"`
  (first token of the name; a small heuristic — titles like "Dr." are stripped);
  otherwise the current `"Hi <name> team,"`.
- The scraped email is **displayed only**, never sent — generate-only boundary
  intact.

### `netlify/functions/leads.js` (extend)

- Records `requestStart`, computes the deadline, fetches TABC alongside Places,
  and `await`s the now-async `buildLeads`, passing the deadline + default
  fetchers.
- No new top-level response keys; enrichment data rides on each row.

### `public/dashboard.js` (extend)

- Processor badge renders as a copper why-chip via the existing why-chip renderer
  (no new tile).
- Owner name/email shown in the existing research/outreach panel.

## Config additions (`config.json`, server-side only)

```jsonc
"search": {
  "exclude_domains": ["loves.com"]          // #2 — seed corporate domains
  // exclude_chains gains "Love's Travel Stop"
},
"sources": {
  "tabc": {
    "enabled": true,
    "counties": ["Harris", "Fort Bend"],
    "since_days": 120,
    "app_token_env": "TABC_APP_TOKEN"        // optional Socrata token from env
  }
},
"enrichment": {
  "global_budget_ms": 6000,                  // start-relative deadline
  "processor_detection": {
    "enabled": true, "max_sites": 25,
    "fetch_timeout_ms": 3000, "check_checkout_page": true
  },
  "owner": { "enabled": true, "max_sites": 10, "fetch_timeout_ms": 3000 }
},
"weights": { "displacement": { "processor_max": 25 } }
```

Every new source has an `enabled` flag. Disabled/failed → pipeline still scores on
Places data. No secrets in the repo — `TABC_APP_TOKEN` (optional) comes from env.

## Testing (fixtures only, no live calls)

All fetches are injectable (`fetchImpl`), so the suite runs fully offline.

- `test/http.test.js` — `fetchWithTimeout` returns `null` on timeout/error;
  `mapWithBudget` respects deadline + concurrency; robots parsing/enforcement.
- `test/processors.test.js` — `detectProcessors` per processor + none + multi;
  `discoverCheckoutUrl`.
- `test/tabc.test.js` — `parseTabcRows` from a real-shape Socrata JSON fixture;
  malformed/empty handled → `[]`.
- `test/enrich.test.js` — `findContactPage` + `extractOwner` (mailto, JSON-LD,
  role-email de-prioritization, none-found → low/empty).
- `test/chains.test.js` — `normalizeDomain` + `isChainDomain` cases (www./path
  stripping, no false match); existing name cases unchanged.
- `test/scoring.test.js` — processor adds more points than keyword-pain; why-chip
  present; no-processor path unchanged; updated numeric fixtures.
- `test/pipeline.test.js` — injected fake fetchers attach processor/owner; a
  **source-down still scores** (graceful); TABC merged + deduped; async
  `buildLeads`; cap/ranking selects top candidates.
- `test/function.test.js` — updated for async + injectable/disabled enrichment.

## README "Notes / limitations" updates

- Processor badge = a **confirmed** incumbent signal, but best-effort: only sites
  exposing a known SDK/fingerprint; false negatives common; can't see back-office
  processors.
- TABC = **confirmed** new alcohol license (real new-establishment signal);
  "no processor yet" remains **inferred**. County-scoped vs. search-radius
  mismatch noted.
- Owner enrichment = best-effort, may be missing/wrong; surfaced for manual
  outreach only — still generate-only.
- Yelp intentionally **not** integrated (ToS / API limits).
- Scraping honors robots.txt and uses an identifying User-Agent; only shallow,
  browser-equivalent page fetches.

## Isolation summary

- `lib/http.js` — bounded fetch + budget + robots + cache; the one impurity
  (injected fetch), independently testable.
- `lib/processors.js`, `lib/tabc.js`, `lib/enrich.js` — pure cores + injectable
  fetch; each testable in isolation with fixtures.
- `lib/chains.js` — gains a parallel pure domain check.
- `lib/scoring.js` — gains exactly one Displacement signal.
- `lib/pipeline.js` — sole orchestration point; owns merge/dedupe/scrape ordering.
- `config.json` — owns every knob and enable flag.
