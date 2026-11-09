# Today tab — design

A single composed list that is the one click every morning: due callbacks plus
the best unworked leads, frozen for the day so it can be finished.

## The problem

The morning flow today is open the dashboard, type a city, pick a niche, click
**Run search**, wait out the 60-second function, then repeat per niche. The
landing tab is **Due today**, which holds callbacks and nothing else, so on a
day with no callbacks the first click lands on an empty screen. There is no
view that answers "who do I call or visit today".

## Composition

Four sections, in work order. A lead appears once, under the highest-ranked
section it qualifies for.

| # | Section | Rule | Order within |
|---|---------|------|--------------|
| 1 | Callbacks due | `callback_on <= today`, `status != 'dnc'` | oldest callback first |
| 2 | Hot, never called | `bucket = 'hot'`, `status = 'to_call'`, no `last_outcome` | score desc |
| 3 | Warm, never called | `bucket = 'warm'`, `status = 'to_call'`, no `last_outcome` | score desc |
| 4 | New this week | `first_seen_at` within 7 days, `status = 'to_call'` | score desc |

Every due callback appears — those were promised, and silently hiding one is
worse than a long list. Sections 2 through 4 then fill `goal -
callbacks.length` slots, floored at zero, where `goal` is
`desk.conversation_goal` from `config.json` (40). A callback-heavy day may
therefore exceed the goal; that is intended.

When the pool cannot fill the goal the list is simply short. The meta line says
how short rather than padding with leads that did not qualify.

## Freezing

The list is composed once per day and then held. Working a lead never removes
it or reorders it: the row stays in place and reads as worked. This is what
makes the list finishable — a list that recomputes on every outcome has no
bottom.

Freezing is stored as a new `leads.today_on` date column holding the day a lead
was placed on the list.

- **Compose:** when no lead carries `today_on = today`, run the composer over
  the full pool and stamp the chosen ids in one update.
- **Read:** `today_on = eq.<today>`, ordered by the stored sequence.
- **Rollover:** yesterday's stamp is simply not today's, so the next morning
  composes fresh. No cleanup job, no cron.
- **Idempotent:** a reload re-reads the stamped set and never re-rolls the list.

A date column rather than a `day_lists` table: one list per day per operator,
no history worth keeping, and a join on every read buys nothing. A date column
rather than `localStorage`: the list must follow the user from the laptop that
composed it to the phone they work it from.

### Ordering within the frozen list

`today_on` records membership, not sequence. Order is recomputed on read by the
same section rules, which are stable for a frozen set — a lead's section can
only change if its callback comes due mid-day, and a callback coming due is a
reason to move it up. Score and bucket are not rewritten during a work session,
only by a new search run, and a run that re-scores a lead already on today's
list leaves its membership alone.

## Modules

### `public/today.js` (new)

The composer, pure and isomorphic, no I/O and no DOM:

```js
composeToday(leads, { today, goal, nowMs }) -> [{ ...lead, section }]
```

It lives in `public/` because the browser must be served it and `lib/` is not
served; `api/desk.js` imports it back across that boundary rather than keeping
a second copy in `lib/`. The import direction is unusual and gets a comment
saying so. `public/desk-view.js` sets the precedent for pure browser-side logic
tested under `node --test`.

### `supabase/schema.sql`

```sql
alter table leads add column if not exists today_on date;
create index if not exists leads_today_idx on leads (today_on) where today_on is not null;
```

Written `if not exists` to match the file's re-runnable style. This is the one
manual step: paste into the Supabase SQL editor and run.

### `api/desk.js`

A `vertical=today` path on GET. Reads leads stamped for today; composes and
stamps when none are. `summary()` gains `today_on`, `bucket` and `last_outcome`
in its light column select so the sidebar count is right, and `sidebarCounts`
in `lib/desk.js` gains a `today` number.

### `public/desk-view.js`

`tabLeads` learns the `today` tab. The filter row stays hidden for it, as it is
for **Due today** now: a composed list crossed with a filter is neither.

### `public/dashboard.js`

Sidebar tab replacing **Due today**, section headers between groups, the count,
and the default landing tab. `isVerticalTab` and the stored-tab validation in
`init()` both learn the new id.

## Behavior

**Worked leads stay.** Logging an outcome rewrites `status` and `last_outcome`
as it does now; the row holds its place and renders as done. The conversation
counter already tracks progress toward the goal independently, so the two read
against each other without extra work.

**Callbacks set for today, today.** Setting a callback for the current date on
a lead already on the list moves it into section 1 on the next render. A
callback set on a lead *not* on today's list does not add it — the list is
frozen, and it will be there tomorrow.

**Local mode** (demo, or database unreachable) composes in memory from the page
pool and freezes for the session. Nothing persists, which is what local mode
already promises.

## Tests

`test/today.test.js` against the composer:

- section precedence and cross-section dedupe
- cap arithmetic: sections 2–4 fill exactly `goal - callbacks.length`
- a callback-heavy day that overflows the goal
- a pool too small to fill the goal
- an empty pool
- `status = 'dnc'` excluded everywhere

`test/desk-view.test.js` gains `tabLeads` cases for the new tab.
`test/desk.test.js` gains a `sidebarCounts` case for the `today` number.

## Out of scope

Refilling the list after it is worked through, per-section quotas, and any
scheduled pre-run that would build the list overnight. Each is a separate
change with its own design.
