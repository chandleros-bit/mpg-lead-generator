# "Who to ask for" — pre-call name research

**Date:** 2026-07-02
**Status:** Approved design, ready for implementation plan
**Scope:** One feature. The "known chain" scoring disqualifier is explicitly out of
scope and will get its own spec later.

## Problem

Before dialing a lead, knowing an owner or manager's first name makes the opener
land — small business owners notice when you've done your homework. Finding that
name is a quick manual sweep across a few sources, but doing it by hand for each
lead (retyping the business name into each site) is friction. The dashboard should
launch that sweep with one click per source, pre-filled with the lead's details.

## Goals

- Cut the pre-call name lookup to ~2 minutes by launching pre-filled research tabs
  straight from the lead card.
- Zero new cost, no scraping, no third-party ToS risk (link-launcher only).
- No backend change — the feature runs entirely on data already in the lead payload.

## Non-goals

- No automated fetching or name extraction.
- No capturing, saving, or persisting the name found (launcher only).
- No changes to outreach copy or scoring.

## Overview

A collapsible **"Who to ask for"** panel on each lead card. It sits next to the
existing **Outreach** button and, when expanded, shows a compact row of research
links. Each link is pre-filled per lead from fields already present on the card
(`name`, `address`, `website`, `place_id`) — so the entire feature is client-side
and requires no change to the Netlify function, `lib/` pipeline, or config.

## The four links

Built per lead. All open in a new tab (`target="_blank" rel="noopener"`, matching
the existing "site" link). URLs are assembled with `encodeURIComponent`.

| Source | Purpose | Behavior |
|---|---|---|
| **Google Business** | Opens the exact Maps listing → reviews & owner replies (sometimes signed with a first name) | `https://www.google.com/maps/search/?api=1&query=<name+" "+address>&query_place_id=<place_id>` |
| **Website** | Opens the business site (About / Meet the Owner pages) | Direct link to `website`. **Hidden entirely when the lead has no website.** |
| **LinkedIn** | Finds an owner/founder/GM profile via a Google search scoped to LinkedIn (avoids LinkedIn's login wall, more reliable than LinkedIn's own search) | `https://www.google.com/search?q=site:linkedin.com "<name>" (owner OR founder OR "general manager")` |
| **TX Comptroller** | Opens the Taxable Entity Search for the registered entity, for when nothing else surfaces a name | Opens `https://mycpa.cpa.state.tx.us/coa/` **and copies the business name to the clipboard** so it can be pasted into the search box |

### Why TX Comptroller behaves differently

The Taxable Entity Search is a POST form (results at `/coa/search.do`); it does not
accept the entity name as a URL query parameter, so it cannot be pre-filled the way
the other three can. To keep it one-click-useful, clicking the link copies the
business name to the clipboard (reusing the dashboard's existing clipboard helper)
and opens the page; the button briefly flips to a "Name copied → paste" confirmation,
matching the existing Copy-button affordance.

### Resolved design choices

- **Website link opens the site homepage directly** (predictable; independents'
  About / Meet-the-Owner pages are typically one click from the nav), rather than a
  `site:<domain>` Google search which returns nothing on thin one-page sites.

## UI & interaction

- A **"Who to ask for"** button is added to the card's `.lead-actions` group, next
  to **Outreach**.
- Clicking it toggles a compact research panel using the same show/hide mechanism as
  the Outreach receipt panel. The panel holds a small labeled row of the link
  buttons above.
- The Outreach and Research panels are independent: opening one does not close the
  other, and each toggle updates its own `aria-expanded` state.
- The Website link is omitted from the row when the lead has no website.

## Components & data flow

No new data is needed. The lead payload from `lib/pipeline.js` already carries
`name`, `address`, `website`, and `place_id`.

- **`lib/research.js`** (new, pure ESM): `buildResearchLinks(lead)` → array of
  `{ label, href, copyName? }`. `copyName` is set only for the TX Comptroller entry
  and signals the click handler to copy-then-open. The Website entry is omitted when
  `lead.website` is falsy. This module holds all URL-construction logic and is the
  unit-tested boundary.
- **`public/index.html`**: load `lib/research.js` as a module that exposes
  `buildResearchLinks` to the dashboard IIFE (e.g. assigns it to a `window`-scoped
  global the IIFE reads).
- **`public/dashboard.js`**:
  - `researchPanel(lead)` — renders the panel HTML from `buildResearchLinks(lead)`.
  - `card()` — adds the "Who to ask for" toggle button and the research panel markup.
  - The delegated `el.leads` click handler is extended to (a) toggle the research
    panel and (b) handle the TX Comptroller copy-then-open action.
- **`public/dashboard.css`**: `.research` panel and link styles, leaning on the
  existing receipt/panel styling.

## Testing

`public/dashboard.js` has no browser test harness today (logic-heavy `lib/` code is
tested with `node --test`; the browser IIFE is not). To keep the URL-building logic
verified without inventing a browser test setup, all of it lives in the pure
`lib/research.js`, tested with `node --test`:

- Google Business URL includes the `place_id` and encoded `name`/`address`.
- LinkedIn URL is scoped with `site:linkedin.com` and includes the encoded name.
- Website entry is present with a direct href when `website` is set, and **absent**
  when `website` is null/empty.
- TX Comptroller entry has the fixed COA URL and a `copyName` equal to the business
  name.
- Special characters in the name/address are correctly URL-encoded.

The thin DOM wiring in `dashboard.js` (toggle, copy-then-open) is verified manually
in the running dashboard.

## Out of scope / later

- **"Known chain" scoring disqualifier** — a manual or keyword-based flag so
  franchises/chains stop wasting calls. Separate spec.
