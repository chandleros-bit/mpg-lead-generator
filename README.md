# MPG Merchant Services Lead Generator — Dashboard

A local web app that finds Houston-area merchants (Google Places API), scores them
on a two-track model (Displacement vs. Greenfield), and generates track-aware
outreach copy — email, SMS, and voicemail — that you copy and send yourself.

Runs entirely on your machine. Your Places API key stays server-side and is never
exposed to the browser.

## Quick start (demo mode — no API key needed)

```bash
pip install -r requirements.txt
python run.py --demo
```

Open <http://127.0.0.1:5000> in your browser. Demo mode loads bundled sample
merchants so you can see the whole dashboard before wiring up your key.

## Live mode (real leads)

1. Get a Google Places API key with the **Places API (New)** enabled.
2. Copy and edit your config:
   ```bash
   cp config.example.yaml config.yaml
   ```
   Set your search area (`location`, `radius_meters`), `verticals`, `score_threshold`,
   and your personal details / CAN-SPAM footer.
3. Export your key and run:
   ```bash
   export GOOGLE_PLACES_API_KEY="your-key-here"
   python run.py
   ```

Click **Refresh leads** to pull and score a fresh batch.

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
pytest -v
```

## How scoring works (short version)

Each merchant is gated by vertical (in-ICP or out), classified into a track, then
scored 0–100 within that track:

- **Displacement:** rating-based dissatisfaction (heaviest, most reliable),
  capped review-keyword pain signals, tech gaps (no website / cash-only), and a
  volume proxy.
- **Greenfield:** recency (newer = higher, no contract lock-in), volume potential
  by vertical, and setup-gap signals.

Buckets: Hot ≥ 70, Warm 40–69, Cold < 40. Tune all weights in `config.yaml`.

## Notes / limitations

- SMS and voicemail are **generate-only** — you send them. No automated sending,
  which keeps you clear of TCPA sending obligations for now.
- Every generated email carries a CAN-SPAM footer (address + opt-out) from config.
- The review-keyword scan is a heuristic; the why chips let you verify fast.
- The tool can't see a merchant's actual processor or contract end-date — the
  score predicts switch-likelihood, not a guaranteed opening.
- **Not legal advice.** Confirm you may lawfully contact a business before outreach.

## Layout

```
run.py                       launcher
config.yaml                  your settings (gitignored in real use)
src/mpg_leads/
  app.py                     Flask app + routes
  pipeline.py                score + attach campaigns → display rows
  scoring.py                 two-track scoring engine
  campaigns.py               track-aware copy generator
  fetcher.py                 Places API + parsing + dedupe + demo loader
  config.py                  config loader (API key from env)
  models.py                  Business / ScoredLead / Campaign
  templates/dashboard.html   UI shell
  static/dashboard.css       styles
  static/dashboard.js        client rendering, filter/sort/copy
  static/demo_places.json    bundled demo data
tests/                       pytest suite
docs/superpowers/            design spec + implementation plan
```
