// public/today.js
// The Today list: which leads make today's call sheet, and in what order.
//
// Pure and isomorphic — no DOM, no I/O. It lives in public/ because the
// browser must be served it and lib/ is not served; api/desk.js imports it
// back across that boundary rather than keeping a second copy of the rules
// under lib/. The two sides must agree: the server stamps membership, the
// browser orders what comes back, and divergent rules would show a list that
// is not the one that was stamped.
//
// Selection and ordering are deliberately separate. Selection gates on call
// status — never-called leads only — and runs once, the morning the list is
// composed. Ordering ignores call status, so a lead worked at 9am still sorts
// into the section it was picked for and holds its place on the sheet all
// day. A list that reshuffles under you as you work it has no bottom, and the
// point of this tab is a list that can be finished.
import { isDue } from "./desk-view.js";

const WEEK_MS = 7 * 86400000;

// Rank order is the work order. "other" catches a lead whose bucket changed
// after it was picked, so an unexpected state sorts last instead of vanishing.
//
// The labels name what a lead is, not why it was picked. "Hot — not yet
// called" is true of the pick and false of the row an hour later, and a
// heading that goes stale over its own rows is worse than a plain one. How
// far along a lead is belongs in its Last touch column, which has it.
export const SECTIONS = [
  ["callback", "Callbacks due"],
  ["hot", "Hot"],
  ["warm", "Warm"],
  ["new", "New this week"],
  ["other", "Also on today's list"],
];

const RANK = Object.fromEntries(SECTIONS.map(([id], i) => [id, i]));

export function sectionLabel(id) {
  const hit = SECTIONS.find(([s]) => s === id);
  return hit ? hit[1] : id;
}

// Which section a lead reads as right now. Call status is deliberately not
// consulted: this answers "where does this row sit", not "should it be here".
export function sectionOf(lead, today, nowMs = Date.now()) {
  if (isDue(lead, today)) return "callback";
  if (lead.bucket === "hot") return "hot";
  if (lead.bucket === "warm") return "warm";
  if (lead.first_seen_at && Date.parse(lead.first_seen_at) >= nowMs - WEEK_MS) return "new";
  return "other";
}

function neverCalled(lead) {
  return lead.status === "to_call" && !lead.last_outcome;
}

function byScoreDesc(a, b) {
  return (b.score || 0) - (a.score || 0) || String(a.id).localeCompare(String(b.id));
}

// Today's picks, before ordering. Every due callback is taken — those were
// promised, and dropping one silently is worse than a long sheet. The rest of
// the goal is filled from Hot, then Warm, then new-this-week, each capped by
// what is left rather than by a quota of its own: a thin Hot day should spend
// its slots on Warm, not waste them.
export function selectToday(leads, { today, goal = 40, nowMs = Date.now() } = {}) {
  const live = (leads || []).filter((l) => l.status !== "dnc");
  const callbacks = live.filter((l) => isDue(l, today)).sort((a, b) =>
    String(a.callback_on).localeCompare(String(b.callback_on)) || byScoreDesc(a, b));

  const taken = new Set(callbacks.map((l) => l.id));
  const out = callbacks.slice();
  let slots = Math.max(0, goal - callbacks.length);
  if (!slots) return out;

  const weekAgo = nowMs - WEEK_MS;
  const pool = live.filter((l) => !taken.has(l.id) && neverCalled(l));
  const tiers = [
    pool.filter((l) => l.bucket === "hot"),
    pool.filter((l) => l.bucket === "warm"),
    pool.filter((l) => l.first_seen_at && Date.parse(l.first_seen_at) >= weekAgo),
  ];

  for (const tier of tiers) {
    if (!slots) break;
    for (const lead of tier.sort(byScoreDesc)) {
      if (!slots) break;
      if (taken.has(lead.id)) continue;
      taken.add(lead.id);
      out.push(lead);
      slots--;
    }
  }
  return out;
}

// Tag an already-chosen set with its sections and put it in work order.
// Callbacks run oldest first — the one you have put off longest is the one
// that needs the call. Everything else runs by score inside its section.
export function orderToday(leads, { today, nowMs = Date.now() } = {}) {
  return (leads || [])
    .filter((l) => l.status !== "dnc")
    .map((l) => ({ lead: l, section: sectionOf(l, today, nowMs) }))
    .sort((a, b) => {
      const r = RANK[a.section] - RANK[b.section];
      if (r) return r;
      if (a.section === "callback") {
        const c = String(a.lead.callback_on).localeCompare(String(b.lead.callback_on));
        if (c) return c;
      }
      return byScoreDesc(a.lead, b.lead);
    })
    .map(({ lead, section }) => ({ ...lead, section }));
}

// Pick and order in one pass: what the server runs the first time a day is
// opened, and what local mode runs every render because it stamps nothing.
export function composeToday(leads, opts = {}) {
  return orderToday(selectToday(leads, opts), opts);
}
