# Facet filters and saved views — design

Narrow a tab by several things at once, then keep the combination as a named
view you can get back to in one click.

## The problem

`FILTERS` in `public/desk-view.js` is five mutually exclusive buttons — To
call, Hot, Warm, New, Worked — and `applyFilter` is a `switch`. One choice at
a time, and no choice spans two ideas. Everything that would actually sort a
call list is already on the row and unreachable: track, a detected processor,
financing, confidence, how long since the last touch, whether there is a
website, which market it came from. The README claimed you could filter by
Displacement and Greenfield; you never could.

Filtering alone is only half of it. A combination worth building — hot
displacement leads with a detected processor and no website, never called —
is worth keeping. Rebuilding it from five clicks every morning is the same
problem this is meant to solve.

## Model

A plain object, absent keys meaning "not filtering":

```js
{
  track: ["displacement"],      // enum, OR within
  confidence: ["high", "medium"],
  source: ["places"],
  city: ["Katy"],
  processor: true,              // toggle
  financing: true,
  never_called: true,
  has_phone: true,
  no_website: true,
  stale_days: 14,               // last touch older than N days
  score: [60, 100],             // range
}
```

Facets are ANDed with each other and ORed within one. That is what people
expect of a filter set and it keeps `applyFacets` a reduction over predicates
rather than a growing `switch`.

The status segment stays exactly as it is: one choice, because `to_call`,
`worked` and the bucket shortcuts genuinely are exclusive. Facets sit beside
it and narrow whatever it selected.

### The facets

| Facet | Kind | Source field |
|-------|------|--------------|
| Track | enum | `track` |
| Processor found | toggle | `processor` non-empty |
| Financing found | toggle | `financing` non-empty |
| Confidence | enum | `confidence` |
| Never called | toggle | `last_outcome` null and `status = to_call` |
| Not touched in | enum (7/14/30 days) | `last_touch_at` |
| Has phone | toggle | `phone` |
| No website | toggle | `website` empty |
| Score | range | `score` |
| Market | enum, values read off the loaded rows | `market_city` |
| Source | enum | `source` |

Every one of these is already in `LIST_COLUMNS`, so the whole thing is
client-side over rows the tab has loaded. No new reads, no new indexes.

## UI

The toolbar keeps the status segment and the Open-now toggle. Beside them a
**Filters** button opens a panel holding the rest, badged with the number of
active facets. Under the toolbar, each active facet renders as a removable
chip, so what is narrowing the list is visible without opening anything —
a filter you cannot see is a filter you forget you set.

Enum options carry counts, computed with their own facet relaxed, which is
what makes a count useful: it says what you would get by picking it, not what
you already have.

Composed tabs take no facets. Today and Due are ordered lists with their own
rules; crossing one with a filter gives something that is neither, and the
filter row is already hidden for them.

## Saved views

A named capture of the status filter, the facets, and the open-now toggle.
Stored in Supabase for the reason `today_on` is: a view built at the desk
should be there on the phone.

```sql
create table if not exists saved_views (
  id         bigserial primary key,
  name       text not null,
  tab        text,
  filter     text,
  facets     jsonb not null default '{}',
  open_only  boolean not null default false,
  position   integer not null default 0,
  created_at timestamptz not null default now()
);
```

`tab` records where it was saved so the view can return you there; null means
it applies wherever you are. Views render as pills above the toolbar: click to
apply, × to delete behind a confirm.

The desk API carries this rather than a new endpoint — `GET /api/desk` returns
`views` alongside the counts, and `POST` gains `save_view` and `delete_view`
actions next to the existing `outcome` and `update`. One authenticated surface
is enough for a tool this size.

## Modules

- **`public/facets.js`** (new, pure): the descriptor table, `applyFacets`,
  `facetCounts`, `activeChips`, `countActive`, `clearFacet`. No DOM, no I/O,
  tested under `node --test` like `desk-view.js` and `today.js`.
- **`public/desk-view.js`**: `visibleLeads` takes `facets` and applies them
  after the status filter and before open-now and search.
- **`api/desk.js`**: the two new POST actions and `views` on the summary.
- **`supabase/schema.sql`**: the table, re-runnable like the rest.
- **`public/dashboard.js`**: the panel, the chips, the view pills.

`dashboard.js` is past 700 lines and this adds to it. The pure logic goes to
`facets.js` to keep that growth down to wiring, but the file is approaching
the point where the rendering should be split from the state handling. Not
part of this change; worth saying out loud.

## Tests

`test/facets.test.js`: each predicate in isolation, AND across facets, OR
within one, an empty facet set changing nothing, counts computed with the
facet relaxed, chips round-tripping through `clearFacet`.

`test/desk-view.test.js`: `visibleLeads` applying facets in the right order
relative to the status filter, open-now and search.

`test/desk.test.js`: `save_view` and `delete_view`, and a bad payload refused.

## Out of scope

Distance and radius facets, which need the `lat`/`lng` columns that do not
exist yet. Sorting controls. Sharing a view with another user — there is one
operator.
