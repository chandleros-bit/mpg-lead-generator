# Known-chain disqualifier

**Date:** 2026-07-02
**Status:** Approved design, ready for implementation plan
**Scope:** One feature. JS/Netlify path only; the legacy Python app (`src/mpg_leads`)
is explicitly out of scope.

## Problem

The two-track scoring model in `lib/scoring.js` cannot tell a national chain or
franchise from an independent business. Chains surface as leads and waste cold
calls — a chain almost never switches card processors because of an unsolicited
call, since those decisions are made at the corporate level. The dashboard should
filter known chains out of results before they reach the call list.

## Goals

- Remove known chains/franchises from the lead list entirely (hard disqualify).
- Detection is automatic and server-side, driven by a user-editable brand list.
- Surface a small "N chains filtered" count so the user can confirm the filter is
  working and tune the list.
- No changes to the scoring engine itself.

## Non-goals

- No manual per-lead flagging or client-side persistence.
- No cross-location analysis or external chain databases.
- No changes to outreach copy, the Python app, or `public/config.json`.

## Overview

A configurable list of chain/franchise brand names lives in `config.json`. During
lead building (server-side), each business name is checked against the list; matches
are dropped before scoring and counted. The count is returned in the API response
and shown as a subtle note in the dashboard. The scoring engine (`lib/scoring.js`)
is untouched — chains never reach it.

## Detection — `lib/chains.js` (new, pure module)

A standalone, DOM-free module mirroring the `lib/research.js` pattern (pure
functions, unit-tested with `node --test`).

- `normalizeName(s)` — lowercases, replaces punctuation with spaces, collapses
  runs of whitespace, and trims. Exported for direct testing.
- `isChain(name, brands)` — normalizes `name`, pads it with a leading/trailing
  space, normalizes each brand, and returns `true` if any padded brand phrase
  (`" " + normalizedBrand + " "`) is a substring of the padded name. This yields
  whole-word / whole-phrase matching: brand `"great clips"` matches
  `"Great Clips of Cypress"` but not a word that merely contains the letters.
  Returns `false` when `name` is empty/falsy or `brands` is empty/missing.

### False-positive tradeoff (accepted, documented)

Whole-word matching eliminates most false positives, but a single-word brand can
still match an unrelated name — e.g. brand `"Chase"` would flag `"Chase's Diner"`
(after normalization `"chase s diner"`, which contains `" chase "`). Because a
disqualified lead is dropped silently, a false positive means a real lead vanishes.

Mitigations:
- The brand list is user-tuned; the user is advised to prefer specific and
  multi-word brand names and to avoid ambiguous single-word entries.
- The "N chains filtered" count is the safety net — an unexpectedly high count is a
  signal to review the list.

## Config — `config.json`

Add a `search.exclude_chains` array, seeded with a default set of national brands
spanning the configured verticals. Example seed (final list finalized in the plan):

```
"exclude_chains": [
  "Starbucks", "Dunkin", "Dunkin Donuts", "McDonald's", "Subway", "Chipotle",
  "Chili's", "Applebee's", "Olive Garden", "Panera", "Sonic Drive-In",
  "Whataburger", "Jack in the Box", "Taco Bell", "Wendy's", "Burger King",
  "Great Clips", "Supercuts", "Sport Clips", "Fantastic Sams",
  "Jiffy Lube", "Take 5", "Valvoline", "Firestone", "Discount Tire",
  "AT&T", "T-Mobile", "Verizon", "GNC", "GameStop", "Massage Envy"
]
```

The list is fully editable by the user. Only the root `config.json` needs it (it is
read server-side via `lib/config.js`); `cfgDict` already forwards the entire
`search` block to the pipeline, so no config plumbing changes are required.
`public/config.json` is not modified — the brand list is never needed client-side.

## Filtering — `lib/pipeline.js`

- `buildLeads(cfg, businesses)` reads `const brands = cfg.search.exclude_chains ?? [];`.
- At the top of the per-business loop, before scoring:
  `if (isChain(b.name, brands)) { chainsFiltered++; continue; }`
  Chains are never passed to `scoreBusiness`.
- **Return-shape change:** `buildLeads` returns `{ rows, chainsFiltered }` instead of
  a bare `rows` array. `summarize(rows)` is unchanged and still takes the kept rows.

## Response & UI

- `netlify/functions/leads.js`: destructure `const { rows, chainsFiltered } =
  buildLeads(cfgDict(cfg), businesses);` and return
  `summary: { ...summarize(rows), chainsFiltered }` (leads/threshold/demo unchanged).
- `public/dashboard.js`: in the load-success handler, when
  `res.d.summary.chainsFiltered > 0`, append a subtle "· N chains filtered" segment
  to the context line. No new stats tile; no change when the count is 0.

## Testing

- **`test/chains.test.js`** (new):
  - Whole-word match: a seeded brand in a business name returns `true`.
  - Case-insensitive: mixed-case name/brand still matches.
  - Punctuation normalization: `"McDonald's"` matches `"mcdonalds"`-style variants.
  - Multi-word brand: `"Great Clips"` matches `"Great Clips of Cypress"`.
  - No false substring match: a brand does not match when it only appears as part of
    a longer word (not on word boundaries).
  - Empty brand list → `false`; empty/missing name → `false`.
- **`test/pipeline.test.js`** (updated):
  - Adjust existing assertions for the `{ rows, chainsFiltered }` return shape.
  - A business whose name matches a brand is excluded from `rows` and increments
    `chainsFiltered`, while an independent business survives.
- **`test/function.test.js`** (updated):
  - Assert `summary.chainsFiltered` is present in the response (additive change;
    confirm no strict shape assertion breaks).

## Isolation summary

- `lib/chains.js` — pure detection, no dependencies, independently testable.
- `lib/pipeline.js` — owns the filter + count; single integration point.
- `config.json` — owns the tunable brand list.
- `lib/scoring.js` — untouched.
