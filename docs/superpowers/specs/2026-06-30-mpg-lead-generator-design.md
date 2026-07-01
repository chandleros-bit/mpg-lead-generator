# MPG Merchant Services Lead Generator — Design Spec

**Date:** 2026-06-30
**Owner:** Chandler Atkinson (Media Payments Group sales role)
**Status:** Approved design, pending implementation plan

## Purpose

A standalone, on-demand tool that finds Houston-area SMB merchants, scores them
for likelihood of winning their payment-processing business, and generates
personalized multi-touch outreach for each qualified lead. The scoring and
messaging encode researched best practices from top merchant-services producers
so the output reflects proven targeting and outreach — not generic scraping.

Target user runs this himself, solo, around a hard 4:30 PM daily stop. Output
must drop cleanly into a Google Sheets workflow.

## Scope

**In scope (v1):**
- Fetch merchant candidates via the Google Places API (ToS-compliant).
- Two-track scoring engine (Displacement vs. Greenfield) with plain-English reasons.
- Track-aware campaign generator (email + SMS + voicemail copy, generate-only).
- CSV export of scored leads and generated campaigns.
- Config-driven runs (geography, verticals, thresholds, personal details, weights).

**Explicitly out of scope (deferred to later versions):**
- Automated sending of email/SMS (generate-only for v1 — the "send-ready later" boundary).
- Any database or persistence beyond a local dedupe file.
- Scheduling/automation (built to allow it later, not implemented now).
- Live competitor/top-producer research module (best practices are baked in as fixed logic).
- Integration into Producer OS (standalone by decision).

## Constraints & Non-Negotiables

- **Compliance is built in, not bolted on.** B2B outreach still falls under
  CAN-SPAM (email) and TCPA (business cell numbers). v1 mitigates exposure by
  generating SMS/voicemail as copy only (no sending infrastructure) and by
  including a CAN-SPAM footer (physical address + opt-out) in every generated email.
- **Not legal advice.** Output includes a one-line reminder that leads must be
  lawfully contactable; the user is responsible for verifying TX/federal B2B
  outreach rules before running at volume.
- **Data source is the Places API only.** No HTML scraping of Google Maps. No
  fabricated data. Fields used are limited to what the API legitimately returns.
- **API key never hard-coded.** Read from an environment variable.

## Architecture

A Python command-line tool structured as a linear pipeline:

```
config.yaml ──▶ Fetcher ──▶ Scoring Engine ──▶ Campaign Generator ──▶ Export
                  │                                                      │
              seen.json (dedupe)                            leads_*.csv + campaigns_*.csv
```

No database. The only persisted state is `seen.json`, a dedupe record of
already-processed merchant place IDs so repeat runs don't re-score the same
businesses.

### Components

1. **Config layer** — loads and validates `config.yaml`. Holds search parameters,
   the user's personal/contact details, the CAN-SPAM footer, and the scoring
   weights (tunable without touching code). Reads the Google Places API key from
   an environment variable, not the file.

2. **Lead fetcher** — queries the Places API for businesses matching the config
   (geography + verticals). Retrieves only ToS-permitted fields: name, category,
   address, phone, website, rating, review count, price level, business status,
   and a sample of review text. Handles pagination, backs off on rate limits, and
   de-dupes against `seen.json`.

3. **Scoring engine** — classifies each business into a track, then scores it
   0–100 within that track, and emits a plain-English "why" array. (Detailed below.)

4. **Campaign generator** — for each lead above the configured score threshold,
   produces a track-appropriate 4-touch sequence with personalization tokens filled.

5. **Export layer** — writes two timestamped CSVs, sorted best-first, ready for Sheets.

## Scoring Engine (the "top producer" brain)

### Step 1 — Classify the play (before scoring)

- **Greenfield** — few/no reviews, recently appeared, thin footprint → likely no
  entrenched processor.
- **Displacement** — established (review volume + history) → has an incumbent to
  displace.
- **Low-fit** — outside target verticals → filtered out or routed to a
  "review later" pile.

**Vertical is a gate, not a scorer.** In-ICP or out, with only a ±3 tie-breaker.
The points that would have gone to "what kind of business it is" go instead to
signals that predict a winnable deal.

### Step 2 — Score within track (0–100), bucket Hot (70+) / Warm (40–69) / Cold (<40)

**Displacement track:**
- Dissatisfaction, rating-based (up to 35) — rating 3.0–4.2 with real review
  volume. The heaviest and most *trustworthy* signal: a frustrated-but-open operator.
- Keyword pain (up to 12, + flag) — review-text hits like "surcharge," "cash only,"
  "card declined," "machine down." Deliberately capped so a false positive alone
  cannot manufacture a Hot; also recorded as a note in the "why" array.
- Tech/processor signals (up to 20) — no website, or site with no online
  ordering/booking; "cash only" doubles here.
- Volume proxy (up to 20) — price level + review count → bigger residual = higher priority.
- In-ICP tie-breaker (3).

**Greenfield track:**
- Recency/newness (up to 40) — the core signal; fresher = higher (no contract lock-in).
- Volume potential (up to 30) — vertical's typical transaction volume + price level → future residual.
- Setup-gap signals (up to 27) — no website / no booking = needs a full solution, more room to add value.
- In-ICP tie-breaker (3).
- No dissatisfaction scoring — no incumbent to be unhappy with.

### Output per lead

A plain-English "why" array prefixed with the track, e.g.:
`Displacement • Salon • rating 3.8 on 210 reviews • "cash only" in reviews • no website`

This string is both the user's at-a-glance verification and the input that drives
the campaign generator's angle.

### Honest limitations (documented, not hidden)

- The review-keyword scan is a heuristic and will have false positives; the "why"
  array exists so the user can eyeball-verify in seconds.
- The tool cannot detect the merchant's actual current processor or contract
  end-date from Places data. Those are verified in conversation. The score
  predicts *switch-likelihood*, not a guaranteed opening.

## Campaign Generator

For every lead above the score threshold, generate a 4-touch cadence. **The track
selects the angle automatically** — Displacement leads are never pitched
"switch & save"; Greenfield leads are never told to switch from a nonexistent processor.

**Cadence:**
1. **Email 1 — opener.** Leads with the specific detected signal, not a pitch.
   Displacement references vertical + pain; Greenfield welcomes the new business
   and offers correct setup. Soft CTA (a question).
2. **Email 2 — follow-up (3–4 days later).** Adds one concrete value point
   (effective-rate insight, POS/terminal angle) and a lighter re-ask.
3. **SMS — short nudge.** One or two casual lines referencing the email.
   Generated as copy only — no auto-send.
4. **Voicemail script — the close.** ~15-second spoken script ending with the
   callback number.

**Personalization tokens:** business name, vertical, the specific "why" signal, and
the user's own details (name, MPG, callback number) from config.

**Payments-credible language baked in:** interchange-plus vs. flat-rate, effective
rate, EMV/NFC, "no long-term contract."

**Compliance guardrails in the generator:**
- Every email includes a CAN-SPAM footer (physical address + opt-out line) from config.
- SMS/voicemail are generate-only — no sending infrastructure, no TCPA
  opt-out/consent machinery in v1.
- Output carries a one-line "contact lawfully / not legal advice" reminder.

**Output columns:** one row per lead — `email1_subject`, `email1_body`,
`email2_subject`, `email2_body`, `sms`, `voicemail` — workable straight down the
sheet or pasteable into BPD.

## Config, Error Handling & Testing

### Config (`config.yaml`)
- **Search:** target ZIPs or lat/long + radius; list of verticals; batch size; score
  threshold for campaign generation.
- **Your details:** name, MPG contact info, callback number, CAN-SPAM footer
  (business address + opt-out line).
- **API key:** Google Places key read from an environment variable, not the file.
- **Tuning:** scoring weights live here, adjustable over time without code changes.

### Error handling
- Missing/invalid API key → clear, actionable message (no stack trace).
- Quota/rate limits → back off and retry; if still blocked, save partial results and report.
- Partial data (no reviews/website/phone) → score on what's available; note missing
  fields in the "why" array rather than crashing.
- Zero results → report likely-too-narrow search; suggest widening radius/verticals.
- Every run writes what it completed — a crash at lead 80 of 100 still yields 79
  usable leads, never an empty file.

### Testing (test-first)
- **Scoring engine** — unit tests with hand-built fixture businesses (a classic
  Displacement salon, a fresh Greenfield taquería, a low-fit edge case) asserting
  correct track and bucket. Highest coverage — this is the core logic.
- **Campaign generator** — tests confirm track→angle mapping (Displacement never
  says "switch," Greenfield never assumes an incumbent) and that every
  personalization token fills.
- **Fetcher** — tested against a saved sample API response (fixture) so tests run
  free and offline.
- **End-to-end smoke test** — one tiny real batch to confirm the pipeline writes
  valid CSVs.

## Output Summary

- `leads_YYYY-MM-DD.csv` — scored, sorted best-first, with track + score + "why" array.
- `campaigns_YYYY-MM-DD.csv` — one row per qualified lead with all six copy fields.

## Future / "Later" Upgrades (not built now)

- Swap the export layer for a local database; add scheduling (cron/cloud function).
- Add sending integrations (email + SMS) with proper consent tracking, suppression
  lists, and opt-out handling.
- Optional plug-in path into Producer OS.
- Optional live competitor-watch module.
