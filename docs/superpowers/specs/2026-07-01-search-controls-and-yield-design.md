# Design: User-controllable search + higher lead yield

**Date:** 2026-07-01
**Status:** Approved (design)

## Problem

Three related gaps in the current Lead Desk:

1. The dashboard shows search radius in **kilometers**, but the user works in **miles**.
2. Search **location** and **distance** are static in [`config.json`](../../../config.json) and baked into the Netlify function bundle at build time. Changing where or how far to search requires editing the file and redeploying.
3. A live run returned **only two leads**. The root cause is structural: a single `searchNearby` call returns at most 20 businesses, and any result whose normalized category falls outside the ICP verticals is dropped as `low_fit` in [`lib/pipeline.js`](../../../lib/pipeline.js).

## Goals

- Display distance in miles.
- Let the user change location and distance live from the dashboard, per search, with no redeploy.
- Substantially increase lead yield.

## Non-goals (YAGNI)

- Tuning scoring weights, buckets, or the score threshold.
- Making verticals a user control (they stay in `config.json`).
- Caching geocode results.

## Decisions

| Question | Decision |
| --- | --- |
| Control model | Live dashboard controls (location box + miles box). Function reads them from the request. |
| Location input | Address / city / ZIP, converted to coordinates via the Google Geocoding API (same API key). |
| Distance units & range | Miles, range 1–25, default ~9 (15000 m ≈ 9.3 mi, preserving current behavior). |
| Yield fix | One `searchNearby` call **per vertical**, deduped, with each result tagged to the vertical it was searched under. |
| Verticals | Stay in `config.json`. |
| Scoring | Unchanged. |

## Data flow

```
dashboard.js  ──(?location=77433&miles=9)──►  /api/leads
                                                  │
                        location is an address? ──► lib/geocode.js ──► "lat,long"
                                                  │
                     miles → meters (× 1609.344, clamp ≤ 50000)
                                                  │
                     lib/fetcher.js: ONE searchNearby PER vertical
                        (N calls × ≤20) ──► dedupe by place_id ──► category = searched vertical
                                                  │
                     scoring + campaigns (unchanged) ──► JSON response
```

## Components

### `lib/geocode.js` (new)
`geocodeAddress(apiKey, query)` → `"lat,long"` string.

- Calls `https://maps.googleapis.com/maps/api/geocode/json?address=<query>&key=<apiKey>`.
- On a result, returns `"<lat>,<lng>"` formatted to match the existing `location` string shape.
- Returns `null` (or throws a typed error) when the API yields `ZERO_RESULTS` or an error status, so the caller can surface a 400.

### `lib/fetcher.js` (extend)
Add `fetchAllVerticals({ apiKey, location, radiusMeters, verticals, maxResults })`:

- Loops the vertical list, issuing one `fetchNearby` per vertical using that vertical's Table A place types (existing `verticalsToPlaceTypes` handles a single-element list fine).
- Sets each returned business's `category` to the vertical it was searched under. Because the ICP set equals the config verticals, this guarantees ICP membership and eliminates the `low_fit` drops that shrank the result set.
- Dedupes across verticals by `place_id` (first occurrence wins).
- Wraps each per-vertical call so a single vertical's failure is caught and skipped; the run continues with the remaining verticals. If **every** vertical call fails, throw so the function returns a 502.

`fetchNearby` itself is unchanged apart from being called per-vertical.

### `netlify/functions/leads.js` (extend)
- Parse `location` and `miles` from `url.searchParams`.
- Fall back to `cfg.search.location` and `cfg.search.radius_meters` when a param is absent (and always in demo mode).
- If `location` is present and is **not** already a `lat,long` pair, call `geocodeAddress`; on failure return **400** with a friendly message.
- Convert miles → meters (`miles * 1609.344`), clamp to the Google `searchNearby` max of 50000 m.
- Clamp miles to the 1–25 range before conversion; non-numeric input falls back to the default.
- Call `fetchAllVerticals` instead of the single `fetchNearby`.
- Demo path is unchanged (loads the fixed demo dataset, ignores the controls).

### `public/index.html` (extend)
- Add a location text input and a miles number input to the controls section, alongside Refresh.

### `public/dashboard.js` (extend)
- Read the location and miles inputs; send them as query params on the leads fetch.
- Persist last-used location and miles in `localStorage`; repopulate the inputs on load.
- Change the context line from **km → miles** (drop the `radius_meters / 1000` computation).
- Disable the controls in demo mode.

### `config.json`
- No schema change. `location` and `radius_meters` remain the fallback defaults.

## Error handling

| Case | Behavior |
| --- | --- |
| Blank / missing location param | Use config default location. |
| Geocode returns no results or errors | HTTP 400: "Couldn't find that location — try a ZIP or city." |
| Non-numeric or out-of-range miles | Clamp to 1–25; fall back to default if unparseable. |
| One vertical's Places call fails | Skip that vertical, keep the rest. |
| All vertical calls fail | HTTP 502 (existing fetch-failure path). |
| Demo mode | Controls ignored; fixed dataset returned. |

## Testing

- **`test/geocode.test.js`** (new) — mocked fetch: successful geocode, `ZERO_RESULTS`, API error.
- **`test/fetcher.test.js`** (extend) — per-vertical dedupe, category tagging to the searched vertical, one-vertical-fails resilience, all-fail throws.
- **`test/function.test.js`** (extend) — query-param parsing, default fallback when params absent, geocode path for an address, miles→meters conversion and clamping.
- All existing tests remain green.
