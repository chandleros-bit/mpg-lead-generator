# Design: MPG Lead Generator → Netlify App

**Date:** 2026-07-01
**Status:** Approved (pending user review of this spec)

## Goal

Turn the local Flask dashboard into a hosted Netlify app so it's reachable
remotely (phone, other machines) without running Python locally. Single user —
personal remote access, not a public share.

## Decisions locked during brainstorming

- **Platform:** Netlify specifically. The Python backend is ported to JavaScript
  and runs as a Netlify Function. (Netlify Functions support JS/TS/Go only — not
  Python — so a true "Netlify app" requires the port.)
- **Structure:** Faithful 1:1 port that mirrors today's architecture (static
  frontend + one server endpoint). Scoring stays server-side and testable.
- **Config:** Non-secret config baked into a repo `config.json` (edit + push to
  change — matches today's "edit config, restart" workflow). Secrets live in
  Netlify environment variables.
- **Access control:** Passphrase gate on live lead-fetching only (it spends the
  Google Places quota). Demo mode stays open (bundled JSON, no API cost).

## Architecture

Static dashboard on Netlify's CDN + one Netlify Function replacing the Flask
route. No server process, no Python at runtime.

```
Browser (dashboard.html/.css/.js)
   │  fetch("/api/leads")  [+ X-App-Passphrase header for live]
   ▼
Netlify Function: leads.js   ← redirect /api/leads → /.netlify/functions/leads
   ├─ check passphrase (live only) against APP_PASSPHRASE env
   ├─ live:  fetcher.js → Google Places API (GOOGLE_PLACES_API_KEY env)
   │  demo:  read bundled demo_places.json
   ├─ pipeline.js → scoring.js + campaigns.js
   └─ JSON { leads, summary, demo, threshold }
```

## Repo layout

```
public/                     ← Netlify publish dir (static)
  index.html                (was templates/dashboard.html, de-templated)
  dashboard.css, dashboard.js, demo_places.json
netlify/functions/
  leads.js                  ← the one function (orchestrates)
lib/                        ← ported logic, plain ESM modules
  scoring.js  campaigns.js  fetcher.js  pipeline.js  config.js
config.json                 ← baked non-secret config (search/personal/weights)
netlify.toml                ← publish dir, functions dir, /api/* redirect
test/                       ← ported test suite (node:test)
package.json
```

## Python → JS port (1:1, no behavior change)

- **models.py** → plain JS objects / factory functions (no dataclasses needed).
- **scoring.py** → `scoring.js`: `classifyTrack`, `dissatisfactionPoints`,
  `keywordPainPoints`, `techPoints`, `volumePoints`, `recencyPoints`,
  `volumePotentialPoints`, `setupGapPoints`, `scoreBusiness`. Same constants
  (`FEE_KEYWORDS`, `FRICTION_KEYWORDS`, `VERTICAL_VOLUME`) and same rounding
  behavior (round-half logic must match Python's `round`).
- **campaigns.py** → `campaigns.js`: `_displacement`, `_greenfield`,
  `generateCampaign`. Template strings and CAN-SPAM footer port directly.
- **fetcher.py** → `fetcher.js`: `parsePlacesResponse`, `normalizeCategory`,
  `fetchNearby` (POST to Places, `X-Goog-Api-Key` / `X-Goog-FieldMask` headers,
  429 retry with exponential backoff), `loadDemoBusinesses`. The dedupe file
  helpers (`load_seen` / `save_seen`) are **dropped** — unused by the web route
  and there is no persistent filesystem on serverless.
- **pipeline.py** → `pipeline.js`: `buildLeads`, `summarize` — unchanged logic,
  same output shape (`{ leads, summary, demo, threshold }`).
- **config.py** → `config.js`: loads `config.json` and reads `process.env` for
  secrets. Passphrase is read from env inside the function.

## Config & secrets

- **Baked in `config.json`** (edit + `git push` to change): `search`,
  `personal`, `weights` — everything except secrets.
- **Netlify environment variables:**
  - `GOOGLE_PLACES_API_KEY` — the Places API key (as today, server-side only).
  - `APP_PASSPHRASE` — the passphrase that gates live fetching.

## Passphrase gate

- First live "Refresh leads" with no stored passphrase → browser prompts; the
  value is saved in `localStorage` and sent as an `X-App-Passphrase` header on
  subsequent live requests.
- The function compares the header to `APP_PASSPHRASE`. Mismatch → `401`; the
  client clears the stored value and re-prompts.
- **Demo mode stays open** — no passphrase required, no API cost.

## Error handling (mirrors Flask)

- Places / network / parse failure → `502 { error }`, shown in the dashboard's
  existing error slot.
- Bad or missing passphrase on a live request → `401 { error }`.
- Missing `GOOGLE_PLACES_API_KEY` at live fetch time → `500 { error }` with a
  clear message.
- Function wraps its body in try/catch so no stack trace leaks to the browser.

## Testing

- Port `tests/test_all.py` (24 cases) to Node's built-in `node:test` runner
  (zero extra dependencies): scoring math, track classification, campaign angle
  rules (Displacement never says "switch" to greenfield, etc.), Places response
  parsing, and pipeline sort/summarize — reusing the same fixtures.
- `netlify dev` runs the function + static site locally — the replacement for
  `python run.py --demo` during development.

## Non-goals (YAGNI)

- No in-browser config editing.
- No database or persistent "seen" dedupe across runs.
- No automated email/SMS/voicemail sending (generate-only, as today).
- No multi-user accounts or roles.

## Risks / watch-items

- **Rounding parity:** JavaScript `Math.round` rounds half up; Python `round`
  uses banker's rounding. Scores are integers derived from small float sums —
  the port must verify test parity and, if any case diverges, replicate Python's
  behavior explicitly.
- **Function cold start + Places latency:** must complete within Netlify's
  function timeout (10s on free tier). A single Nearby Search + scoring is well
  under this, but batch size stays modest.
- **Passphrase in localStorage** is light protection appropriate for a personal
  tool guarding API spend — not account-grade auth. Acceptable per the goal.
