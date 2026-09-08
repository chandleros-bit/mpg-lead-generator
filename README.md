# MPG Merchant Services Lead Generator — Dashboard

A web app that finds Houston-area merchants (Google Places API), scores them on a
two-track model (Displacement vs. Greenfield), and generates track-aware outreach
copy — email, SMS, and voicemail — that you copy and send yourself.

Ships as a static dashboard plus one Vercel Function (`api/leads.js`).
Your Places API key stays server-side in the function and is never exposed to the
browser.

## Quick start (demo mode — no API key needed)

```bash
npx vercel dev           # serves public/ + the function locally
```

Open <http://localhost:3000/?demo=1>. Demo mode loads bundled sample merchants
(`public/demo_places.json`) so you can see the whole dashboard before wiring up
your key — no key, no passphrase.

## Live mode (real leads)

1. Get a Google Places API key with the **Places API (New)** enabled.
2. Create a `.env` in the repo root (gitignored):
   ```bash
   GOOGLE_PLACES_API_KEY="your-key-here"
   APP_PASSPHRASE="something-only-you-know"
   ```
3. Run `npx vercel dev` and open <http://localhost:3000> (no `?demo=1`).

Live mode prompts for the passphrase, then click **Refresh leads** to pull and
score a fresh batch.

Edit your search area (`location`, `radius_meters`), `verticals`,
`score_threshold`, weights, and your personal / CAN-SPAM details in `config.json`.
Keep `public/config.json` in sync — the browser reads a few display fields from it.
Secrets live in env vars, never in the repo.

## Deploy

Hosted on Vercel. `master` is the production branch.

1. Push to GitHub and import the repo at <https://vercel.com/new>. Take the
   settings from `vercel.json` — do not let the dashboard override them.
2. In **Project Settings → Environment Variables**, set for Production (and
   Preview, if you want branch deploys to fetch real leads):
   - `GOOGLE_PLACES_API_KEY` — your Places API (New) key.
   - `APP_PASSPHRASE` — the passphrase that unlocks live lead-fetching.
   - `TABC_APP_TOKEN` — optional; raises the TABC dataset rate limit.
3. Visit your site. Demo mode is at `/?demo=1`; live mode is the default and
   prompts for the passphrase (stored in your browser after the first entry).

Push to `master` to redeploy after editing `config.json`.

There is deliberately no `dev` npm script. `vercel dev` runs the project's own
dev command when one exists, so a script of `"dev": "vercel dev"` makes the CLI
invoke itself and exit 1 on a recursion guard. Call it directly.

### Why `vercel.json` pins things it looks like it should not need

`framework` is pinned to `null` on purpose. This repo has no framework —
`public/` is static and all the logic is in one function — but root
`config.json` is *also* Hugo's config filename, so framework auto-detection can
decide this is a Hugo site and run a build that does not exist. The same false
positive broke every build on the previous host. `outputDirectory` is stated for
the same reason: say what this is, rather than letting it be guessed.

`maxDuration` is 60s because a live run fans out across the Places type search,
one Text Search call per specialty query, the TABC dataset, and the enrichment
scrape. The default 10s is not enough for a wide radius.

## Using the dashboard

- **Score readout** (left of each card) is color-coded: red = Hot, amber = Warm,
  grey = Cold. Leads below your target score sit under the divider.
- **Track tag** (right) shows the play: **Displacement** (established, likely
  unhappy incumbent — "switch & save" angle) or **Greenfield** (brand-new, no
  processor yet — "set up right" angle).
- **Why chips** show exactly which signals fired. Copper-tinted chips are the
  pain/opportunity signals; check them before you dial.
- **Outreach** opens the receipt-style panel with a 4-touch sequence (Email 1,
  Email 2, SMS, Voicemail). Each has a **Copy** button. The angle is chosen
  automatically by track — Displacement leads never get "switch," Greenfield
  leads never get told to switch from a processor they don't have.
- Filter by Hot / Warm / Displacement / Greenfield, search by name, sort by
  score or name.

## Tests

```bash
npm test                 # node --test
```

## How scoring works (short version)

Each merchant is gated by vertical (in-ICP or out), classified into a track, then
scored 0–100 within that track:

- **Displacement:** rating-based dissatisfaction (heaviest, most reliable),
  capped review-keyword pain signals, tech gaps (no website / cash-only), a
  volume proxy, and a processor fingerprint.
- **Greenfield:** recency (newer = higher, no contract lock-in), volume potential
  by vertical, and setup-gap signals.

Buckets: Hot ≥ 70, Warm 40–69, Cold < 40. Tune all weights in `config.json`.

## Notes / limitations

- SMS and voicemail are **generate-only** — you send them. No automated sending.
- Every generated email carries a CAN-SPAM footer (address + opt-out) from config.
- **Processor badge = confirmed incumbent, best-effort.** When a lead's site
  exposes a known payment SDK/fingerprint (Square, Clover, Toast, Stripe, …) it is
  a high-confidence Displacement signal shown as a copper "why" chip. False
  negatives are common (sites that hide the processor, or use one we can't see
  from the front end); a *missing* badge is not proof of no processor.
- **TABC greenfield = confirmed new alcohol license.** New bars/restaurants pulled
  from the Texas open-data TABC feed (dataset `7hf9-qc9f`, "TABC License
  Information") are genuinely newly licensed; "no processor yet" is still
  *inferred*. Only **on-premise** license types are kept (MB/BE → bar,
  BG/RM → restaurant); off-premise retail permits (BQ/Q — convenience, grocery,
  package stores) are excluded as out-of-ICP. TABC is filtered by county, so
  results may fall slightly outside your exact search radius.
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

## Layout

```
config.json                  settings: search area, verticals, weights, personal/CAN-SPAM
vercel.json                  static output dir, framework pin, function timeout
api/
  leads.js                   the one endpoint: fetch → score → campaigns
lib/
  pipeline.js                dedupe, chain filter, enrich, score → display rows
  scoring.js                 two-track scoring engine
  campaigns.js               track-aware copy generator
  fetcher.js                 Places API + parsing + dedupe + demo loader
  processors.js              processor/POS fingerprint detection
  tabc.js                    TABC new-license greenfield source
  chains.js                  known-chain disqualifier (name + domain)
  enrich.js                  owner/decision-maker scrape
  geocode.js                 address → lat,lng
  http.js                    robots-aware fetch, timeouts, global budget
  config.js                  config loader (secrets from env)
  models.js                  Business / ScoredLead factories
public/
  index.html                 UI shell
  dashboard.css              styles
  dashboard.js               client rendering, filter/sort/copy
  research.js                "who to ask for" deep links
  csv.js                     leads → CSV export
  config.json                display-only mirror of config.json
  demo_places.json           bundled demo data
test/                        node --test suite
docs/superpowers/            design specs + implementation plans
```
