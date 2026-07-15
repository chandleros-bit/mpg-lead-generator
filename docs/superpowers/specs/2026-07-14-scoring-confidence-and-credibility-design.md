# MPG Lead Generator — Scoring Confidence & Credibility Spec

**Date:** 2026-07-14
**Owner:** Chandler Atkinson (Media Payments Group sales role)
**Status:** Proposed design, pending approval and implementation plan

## Purpose

Make the lead score honest about its own certainty. Today one number, 0–100, and a bucket carry every lead regardless of whether four independent signals fired or one weak proxy did. This spec decouples **how good a lead looks** (score, unchanged in purpose) from **how much we should believe it** (a new confidence tier), and fixes the six specific places the current logic manufactures false confidence.

The test of success: the call list can be triaged by "call these first, they're real" instead of treating every Hot lead as worth the same five minutes of prep.

## Scope

**In scope:**
- `business_status` filtering in `lib/pipeline.js`.
- Card-present vs. online-only processor signature split in `lib/processors.js`.
- Graduated dissatisfaction curve, tri-state website certainty, and confidence-tier computation in `lib/scoring.js`.
- `source` and confidence rendering in `public/dashboard.js`; new columns in `public/csv.js`.
- Config additions in `config.json` + `public/config.json`.
- Unit tests in `test/` (`node --test`).

**Out of scope:**
- New data sources (TX Secretary of State filings, Yelp, live domain probes).
- Airtable/CRM sync, lead status, statement-audit calculator.
- The Python path (`src/mpg_leads/scoring.py`) — see "Python mirror" below.
- Re-tuning bucket thresholds (`hot: 70`, `warm: 40`).

## Constraints & Non-negotiables

- **Everything here runs on data already collected.** No new API calls, no new fetch budget. The scraper's robots.txt/timeout/global-budget discipline is untouched.
- **Score stays 0–100 and stays the sort key.** Confidence is a second, orthogonal axis — never folded into the number.
- **Confidence must never be derived from the score.** A high score computed entirely from proxies is exactly the case this exists to catch.
- **Signals only count as corroborating if they come from different sources.** See "Independence" below — this is the load-bearing rule.

## Background: findings verified against the code

I ran the real scoring engine to confirm each claim in the review. Every number below is output from `lib/scoring.js` at current `config.json` weights, not estimated.

| # | Claim | Verified? | Evidence |
| :-- | :---- | :---- | :---- |
| 1 | Closed businesses aren't filtered | **Yes** | A `CLOSED_PERMANENTLY` restaurant, 2.5★/200 reviews, scores **74 → Hot**. `business_status` is in the Places field mask and on the model; no code reads it. |
| 2 | Null website treated as certain | **Yes** | `techPoints` grants 18/20; `setupGapPoints` grants the full 27. |
| 3 | 8–19 review dead zone | **Yes** | Salon, 3.0★, 15 reviews, no site → **24, Cold**. Same salon at 20 reviews → **60, Warm**. Five reviews swing 36 points and two buckets. |
| 4 | Processor detection is track-blind | **Yes** | Restaurant, 4.8★/300 reviews, healthy, Stripe-only → **43, Warm**, chip "Stripe detected on site". 25 of those 43 points are the Stripe hit; without it the lead is 18/Cold. |
| 5 | Review sample is thin | **Yes** | Places returns ~5 curated reviews; `keyword_pain_points` scans only those. Not fixable without a new source — it is handled here as a *confidence* input, not a scoring fix. |
| 6 | TABC and Places leads look identical | **Yes** | A TABC bar and a Places bar both score **91, Hot**, with byte-identical `why` arrays: `["Greenfield • Bar", "0 reviews (new, likely no processor yet)", "no website — needs full setup"]`. |

### Corrections to the source review

The review is substantially right; five details need adjusting before implementation.

1. **"35 of ~90 possible points" is wrong — the displacement max is 115** (35 + 12 + 20 + 20 + 25 + 3), clamped to 100. The ~90 figure omits `processor_max: 25`, which exists in root `config.json` but is **missing from `public/config.json`**. That drift is the trap flagged in the earlier roadmap review, now confirmed live.

2. **`source` is not entirely unsurfaced.** `public/csv.js` already exports a `Source` column. It is the *dashboard cards* that never render it. Narrower fix than the review implies.

3. **The "confirmed no-website via a live fetch" idea cannot work as written.** When `websiteUri` is null there is no URL to probe. Absence can't be confirmed by fetching nothing. Corroboration has to come from review text (`"cash only"`, `"call to order"`) or a new data source — see Open Decisions.

4. **TABC rows have `website: null` *by construction*.** `lib/tabc.js` hardcodes `website: null` because the TABC dataset has no website column. So every TABC lead collects the full 27-point setup-gap bonus for a field that was never populated by anything. This is the review's own point #2 in its purest form, and the review missed it. It is the single strongest argument for this spec.

5. **Rating-dissatisfaction and keyword-pain are not independent signals.** Both are computed from the same ~5-review Google sample. The review's rubric ("2+ independent signals agree") would let two review-derived signals qualify a lead as High — but if the sample is unrepresentative, *both* are wrong together. This directly contradicts the review's own point #5. The rubric below fixes it.

## Design

### Independence: the rule that makes confidence mean something

Signals are grouped by **origin**, and only cross-origin agreement counts as corroboration:

| Origin | Signals | Why it can fail |
| :---- | :---- | :---- |
| **Review corpus** (Google, ~5 curated) | rating-dissatisfaction, keyword pain | Thin, non-random sample. All review signals fail together. |
| **Site fingerprint** (live scrape) | card-present processor hit | Independent of reviews. Fails on JS-rendered or blocked sites. |
| **Public record** (TABC) | confirmed new license | Independent of both. Strongest available. |

**High confidence requires at least one non-review-derived signal.** Two review-derived signals agreeing is one sample speaking twice.

### Data model (`lib/models.js`)

Add a tri-state website field. `null` currently conflates "has no website" with "we don't know", and those must be scored differently.

```js
website_status: "present" | "absent_confirmed" | "unknown"
```

Derivation (`website_status` is computed, never fetched):
- `website` non-null → `"present"`
- `website` null, any source → `"unknown"` (Places has known false negatives; TABC never populates it)
- `"absent_confirmed"` only via review-text corroboration (see Fix 4)

Add to `scoredLead`:
```js
confidence: "high" | "medium" | "low",
signals: string[],   // the independent signals that fired, for display + audit
```

### Fix 1 — Filter on `business_status` (highest priority, lowest cost)

In `lib/pipeline.js`, between the chain filter (step 2) and the processor scrape (step 3), so closed businesses never consume fetch budget:

- `CLOSED_PERMANENTLY` → drop, count into a new `closedFiltered` return value alongside `chainsFiltered`.
- `CLOSED_TEMPORARILY` → keep, push a `"temporarily closed"` chip into `why`, and cap confidence at **Low**.
- `""` / missing → keep (TABC rows set `"OPERATIONAL"`; treat unknown as operational).

Rationale: dropping a permanently closed business costs nothing and removes the risk of cold-calling a business that no longer exists. Temporarily closed is a real lead — it just isn't callable today.

### Fix 2 — Split processor signatures by acceptance channel

The pitch is card-present. A Stripe tag on a restaurant's gift-card page says nothing about the terminal at the register. Replace the flat `PROCESSOR_SIGNATURES` map with tiered groups in `lib/processors.js`:

```js
export const CARD_PRESENT = {          // in-store POS — real displacement evidence
  Clover: ["clover.com", "clover.js"],
  Toast: ["toasttab.com"],
  Aloha: ["alohaenterprise", "ncrcloud"],
  Clearent: ["clearent"],
};
export const AMBIGUOUS = {             // sells both channels — can't tell from a fingerprint
  Square: ["squareup.com", "web.squarecdn.com", "square-marketplace"],
  "Shopify Payments": ["cdn.shopify.com", "shopify.com/payments", "shop_pay"],
};
export const ONLINE_CHECKOUT = {       // tells us nothing about the register
  Stripe: ["js.stripe.com", "stripe.com/v3", "checkout.stripe.com"],
  PayPal: ["paypal.com/sdk", "paypalobjects.com"],
};
```

`detectProcessors` returns `[{ name, tier }]` instead of `[name]`. `PROCESSOR_SIGNATURES` is kept as a merged export so `discoverCheckoutUrl` and existing tests keep working.

Scoring (`processorPoints`):

| Tier | Points | Chip | Counts as a signal? |
| :---- | :---- | :---- | :---- |
| `card_present` | full `processor_max` (25) | "Clover POS detected — card-present" | **Yes** (site-fingerprint origin) |
| `ambiguous` | `processor_ambiguous_max` (10, new config key) | "Square detected — channel unknown" | No |
| `online_checkout` | 0 | "Stripe on site (online checkout — not our lane)" | No |

Square lands in `ambiguous` deliberately: it is both the most common small-merchant card-present processor *and* a common online checkout, and the fingerprint cannot distinguish them. Awarding it full displacement points would rebuild the exact false confidence being removed; awarding zero would discard a genuinely useful lead. Ten points and an honest chip is the truthful middle.

Effect on the verified example: the 4.8★/300-review Stripe-only restaurant drops **43 → 18, Warm → Cold**, which is correct — it is a healthy business whose register we know nothing about.

### Fix 3 — Graduate the dissatisfaction curve

Replace the hard `review_count < 20 → 0` cliff in `dissatisfactionPoints` with a volume-confidence multiplier:

```js
function volumeConfidence(reviewCount) {
  if (reviewCount >= 20) return 1.0;
  if (reviewCount >= 10) return 0.5;
  return 0.0;
}
```

Applied as `pyRound(frac * wmax * volumeConfidence(reviewCount))`, preserving `pyRound` (banker's rounding) for Python parity.

The `rating > 4.2` early return and the `Math.max(rating, 3.0)` floor stay as-is.

Effect on the verified example: the 3.0★/15-review salon goes **24 → 42, Cold → Warm**. It surfaces, and — because a single review-derived signal fired — it surfaces as **Medium**, not High. That pairing is the whole point: the lead becomes visible without being oversold.

The 10-review floor is deliberate. Below 10 reviews a rating is one bad night, and the business is likely Greenfield anyway (cutoff is 8).

### Fix 4 — Downgrade "no website" from certainty to a proxy

Rewrite `techPoints` and `setupGapPoints` against `website_status`:

| `website_status` | `techPoints` (displacement, max 20) | `setupGapPoints` (greenfield, max 27) |
| :---- | :---- | :---- |
| `present` | 0 | `pyRound(wmax * 0.3)` = 8 *(unchanged)* |
| `unknown` | **8** (was 18) | **`pyRound(wmax * 0.5)` = 14** (was 27) |
| `absent_confirmed` | 18 *(current full value)* | 27 *(current full value)* |

The `+2` for `"cash only"` in review text stays, capped at `tech_max`.

Promotion to `absent_confirmed` requires review-text corroboration — new `NO_SITE_KEYWORDS = ["cash only", "call to order", "no website", "call ahead to order"]`. This is the only route available today, and it is honest about that: absence of a `websiteUri` field is absence of evidence.

Effect on TABC: a TABC bar drops **91 → 78**, still comfortably Hot, but the 13 points it loses were pure artifact of a column the dataset does not have. It keeps its Hot ranking on signals it has actually earned (a freshly issued license, vertical volume potential).

### Fix 5 — Surface `source`, and weight it into confidence

- `lib/scoring.js`: for `source === "tabc"`, replace the `"0 reviews (new, likely no processor yet)"` chip with **`"confirmed new — TABC license issued {licensed_on}"`**. `licensed_on` is already on the model and currently unused in display.
- Places greenfield keeps a hedged chip: **`"{n} reviews (new — inferred, not confirmed)"`**.
- TABC source counts as a public-record signal → floors confidence at **Medium** (per the review's fix #5).
- `public/dashboard.js`: add `source` to the card's `data-` attributes and render a source tag next to the existing track tag.

**A TABC-only lead caps at Medium, not High** — and that is correct, despite the review calling TABC "your single highest-confidence lead type." A TABC row carries exactly one signal: the license. It has no reviews and no website to fingerprint (the dedupe step in `pipeline.js` drops the TABC row whenever the business also appears in Places, so TABC-only rows are by definition the sparse ones). One strong signal is still one signal. High means *corroborated*, and nothing corroborates it.

### Fix 6 — Show the evidence count

Render `signals.length` next to the score: **`82 · Hot · High · 3 signals`**. This falls out of the confidence work for free — `signals` is already the array the tier is computed from — so it needs no separate phase.

### The confidence rubric

Computed in `lib/scoring.js` as `computeConfidence(business, signalList)`, from the signal list only — never from the score.

**Counting signals** (each fires at most once):

| Signal | Origin | Condition |
| :---- | :---- | :---- |
| `confirmed_source` | public record | `source === "tabc"` |
| `card_present_processor` | site fingerprint | any detected processor at `card_present` tier |
| `rating_dissatisfaction` | review corpus | `rating <= 4.2` and `review_count >= 20` |
| `keyword_pain` | review corpus | any `fees` or `friction` keyword hit |
| `website_absent_confirmed` | review corpus | `website_status === "absent_confirmed"` |

**Explicitly not signals** (the proxies this spec exists to distrust): `website_status === "unknown"`, review count alone, price level, `ambiguous`/`online_checkout` processor hits.

**Tiers:**

| Tier | Rule |
| :---- | :---- |
| **High** | ≥2 signals, **and** ≥1 from a non-review origin (`confirmed_source` or `card_present_processor`) |
| **Medium** | Exactly 1 signal; **or** ≥2 signals all from the review corpus; **or** `source === "tabc"` (floor) |
| **Low** | 0 signals — score is entirely proxy-driven; **or** `business_status === "CLOSED_TEMPORARILY"` (cap) |

The `rating_dissatisfaction` threshold is `<= 4.2` (matching `dissatisfactionPoints`' cutoff), not `>= 20 reviews` alone — a 4.9★ business with 500 reviews is not dissatisfied, and shouldn't count as evidence of anything.

**Display:** `82 · Hot · High · 3 signals`, confidence styled as a distinct chip so it reads as a separate axis from the bucket.

### Config additions

Both `config.json` and `public/config.json` — the drift found in Correction 1 means `processor_max` must be added to `public/config.json` in this change regardless:

```json
"weights": {
  "displacement": { "processor_max": 25, "processor_ambiguous_max": 10, ... },
  "volume_confidence": { "full_at": 20, "half_at": 10 },
  "website_unknown": { "tech_points": 8, "setup_gap_factor": 0.5 }
}
```

## Implementation phases

Ordered by leverage-to-risk. Each phase is independently shippable and leaves tests green.

| Phase | Change | Files | Risk |
| :---- | :---- | :---- | :---- |
| **1** | `business_status` filter | `lib/pipeline.js` | Trivial. Removes a live embarrassment risk. Ship alone. |
| **2** | Config drift fix (`processor_max` into `public/config.json`) | `public/config.json` | Trivial. Unblocks Phase 3. |
| **3** | Processor tier split | `lib/processors.js`, `lib/scoring.js`, config | Medium — changes scores on existing leads. |
| **4** | Graduated dissatisfaction | `lib/scoring.js`, config | Low — additive, surfaces new leads. |
| **5** | `website_status` tri-state | `lib/models.js`, `lib/scoring.js`, `lib/tabc.js`, config | Medium — touches both tracks. |
| **6** | Confidence + `source` + signal count | `lib/scoring.js`, `lib/pipeline.js`, `public/dashboard.js`, `public/csv.js` | Low — mostly additive. |

Phases 3–5 move scores. Before merging Phase 3, capture a baseline: run the current engine over `public/demo_places.json`, save the scored output, and diff after each phase so every bucket change is one you intended.

## Test plan

`node --test`, extending `test/scoring.test.js`, `test/processors.test.js`, `test/pipeline.test.js`. `test/helpers.js` `WEIGHTS` needs the new keys.

Cases that must pass:

1. `CLOSED_PERMANENTLY` is dropped by `buildLeads` and counted in `closedFiltered`; the 2.5★/200 restaurant that scores 74 today never reaches `rows`.
2. `CLOSED_TEMPORARILY` survives, gets its chip, and is capped at Low confidence.
3. `detectProcessors` tiers each of the eight known signatures correctly; a Clover hit scores 25, Square 10, Stripe 0.
4. The Stripe-only 4.8★/300 restaurant scores 18/Cold (was 43/Warm) and is **not** High confidence.
5. `dissatisfactionPoints(3.0, 15, 35) === 18`; `(3.0, 9, 35) === 0`; `(3.0, 20, 35) === 35`; `(4.3, 100, 35) === 0` (regression: the >4.2 return still wins).
6. The 3.0★/15-review salon scores 42/Warm at **Medium**, not High.
7. A TABC bar scores 78/Hot at **Medium**, with a `"confirmed new — TABC license issued"` chip and no `"no website — needs full setup"` chip.
8. A TABC bar and an identical Places bar produce **different** `why` arrays and different confidence — the regression test for the review's point #6.
9. Two review-derived signals (bad rating + fee keywords, no TABC, no card-present hit) yield **Medium**, never High — the independence rule.
10. Card-present hit + fee keywords yields **High**.
11. A lead with zero signals and a Hot score (proxies only) yields **Low** — confidence never reads off the score.
12. `pyRound` parity holds on `.5` boundaries through the new multiplier.

## Open decisions

1. **Square's tier.** Specced as `ambiguous`/10 points. If your Houston-area experience is that a Square fingerprint on an SMB site nearly always means a Square register, promote it to `card_present` and this gets simpler. Your call — it's a field-knowledge question, not a code question.
2. **Confirming website absence.** No route exists in current data (Correction 3). Specced as review-text keywords only. A real fix needs a new source. Worth a spike, not a blocker.
3. **Python mirror.** `src/mpg_leads/scoring.py` will drift further behind after this. The earlier roadmap review already flagged retiring it. Recommend **retire to demo-only** and note it in the README rather than porting six changes twice — but say so before Phase 3, because that's where the paths diverge irreconcilably.
4. **Bucket thresholds.** Phases 3–5 move scores down on average (the artifact points are being removed). `hot: 70` / `warm: 40` may want re-tuning once you see the baseline diff. Deliberately out of scope here — retune on evidence, after.

## What this does not fix

The review's point #5 stands unresolved by design: reviews remain a thin, Google-curated sample, so "no pain keywords found" still isn't evidence of no pain. This spec's response is not to fix the sample but to stop pretending it's complete — review-derived signals can never alone produce High confidence. That's a mitigation, not a fix. The actual fix is a different data source.
