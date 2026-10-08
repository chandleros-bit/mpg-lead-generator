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

Pick the vertical, city (or ZIP), state, and distance on the dashboard. Each run
is one vertical in one market. Leaving City blank uses the default `market` and
`location` in `config.json`; leaving Vertical on "Mixed" uses the `verticals`
list there.

Edit the defaults, `score_threshold`, weights, and your personal / CAN-SPAM
details in `config.json`.
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

## Verticals

Every niche is one pack file in `lib/verticals/`. A pack holds everything the
engine knows about that niche: Google place types and Text Search phrasings,
name keywords that verify a result, chains to drop, the management software
that bundles payments, customer-financing widgets, high-ticket keywords, who to
ask for, and the inputs for its email copy.

Niches with deep packs: auto repair, dentists, med spas, HVAC, home remodeling,
pest control. The original broad verticals (restaurants, bars, salons, and so
on) are lighter packs in `lib/verticals/legacy.js`.

Google has no place type for HVAC, pest control, or remodeling, so those are
found by Text Search alone and a result only counts when its name says what it
is. Med spas get the same name check on every result, because Google files them
under spa, skin care, medical clinic, and more.

To add a niche: copy a pack, edit it, list it in `lib/verticals/index.js`, then
run `npm run sync-verticals` so the dashboard picker sees it. `npm test`
validates every pack and fails if the picker list is out of date.

## Markets

A run targets one city and state. The API geocodes it, searches around it, and
passes the city into the copy ("around Katy"). The state decides the card-rule
line in the copy: Texas names its surcharge ban, other states get a general
note, and every state is pitched as a cash discount. TABC new-license leads are
pulled only for Texas runs of bars or restaurants, scoped to the market's
county.

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
- **Auto repair is a first-class vertical** (`auto_repair`), separate from the
  generic `auto` bucket that still holds car washes and parts stores. It gets a
  second discovery pass: after the `car_repair` type search, a set of specialty
  Text Search queries (transmission, European, diesel, collision, brake, tire
  and lube) pulls the high-ticket independents that a bare type search ranks
  below the chains. Text Search is not type-constrained, so every result is
  re-checked against the vertical's own type list before it counts — a "brake
  shop" query otherwise returns dealerships. Set `textSearch: false` on
  `fetchAllVerticals` to skip the sweep. See
  `docs/superpowers/specs/2026-09-07-auto-repair-vertical-design.md`.
- **Shop-management software outranks a POS fingerprint.** Tekmetric,
  Shopmonkey, Shop-Ware, AutoLeap, Protractor and Mitchell 1 bundle their own
  payments, so a shop running one took a rate it never shopped — usually a
  default to replace rather than a relationship to displace. These score in
  their own `integrated_software` tier, above `card_present`. The platform name
  is safe to say in an email because it is a fact about their software; a
  fingerprinted *processor* is a guess and the copy never names one.
- **High-ticket proxies are proxies.** Specialty keywords and a posted labor
  rate read from reviews nudge the ranking (8 points against a 100+ scale) so
  you know which of two similar shops is worth the drive. They are never quoted
  to a merchant. The number that goes in front of an owner comes off their
  statement.
- **The auto copy holds three rules, and the tests enforce them:** the
  Visa/Mastercard settlement is described as pending, never as done (preliminary
  approval June 2026, fairness hearing November 2026, appeals expected); in
  Texas it is dual pricing and cash discount, never surcharging (§604A.0021 is
  still on the books and *Rowell* only protects its named plaintiffs); and no
  savings figure is promised before a statement is read.
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
  campaigns.js               track-aware copy generator + per-vertical overrides
  fetcher.js                 Places Nearby + Text Search, parsing, dedupe, demo loader
  processors.js              processor/POS + shop-management fingerprint detection
  tabc.js                    TABC new-license greenfield source
  chains.js                  known-chain disqualifier (name + domain)
  enrich.js                  owner/decision-maker scrape
  geocode.js                 address → lat,lng; city/state → market and county
  verticals/                 one pack per niche + registry (index.js) + keyword matching
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
  verticals.json             picker list, generated by npm run sync-verticals
  demo_places.json           bundled demo data
scripts/sync-verticals.js    regenerates public/verticals.json from the registry
test/                        node --test suite
docs/superpowers/            design specs + implementation plans
```
