import test from "node:test";
import assert from "node:assert/strict";
import {
  areaFrom, lastTouch, rowChips, tabLeads, applyFilter, applyOpenOnly, applySearch,
  orderLeads, visibleLeads, telHref, isNewLead, filterCounts, shortDate,
} from "../public/desk-view.js";

const TODAY = "2026-10-08";
const NOW = Date.UTC(2026, 9, 8, 15, 0); // 10 AM Central

function lead(o) {
  return { id: o.id ?? 1, vertical: "hvac", status: "to_call", bucket: "warm", score: 50,
    callback_on: null, last_outcome: null, notes: "", ...o };
}

test("area reads city and ZIP from a Google address", () => {
  assert.equal(areaFrom("21902 Katy Fwy, Katy, TX 77450, USA"), "Katy 77450");
  assert.equal(areaFrom("1 Main"), "1 Main");
  assert.equal(areaFrom(""), "");
});

test("last touch prefers a callback, then the last outcome", () => {
  assert.deepEqual(lastTouch(lead({ callback_on: TODAY }), TODAY), { kind: "due", text: "Callback today" });
  assert.deepEqual(lastTouch(lead({ callback_on: "2026-10-06" }), TODAY), { kind: "due", text: "Callback Oct 6" });
  assert.deepEqual(lastTouch(lead({ callback_on: "2026-10-13" }), TODAY), { kind: "tried", text: "Callback Oct 13" });
  assert.deepEqual(lastTouch(lead({ last_outcome: "voicemail", last_touch_at: "2026-10-06T15:00:00Z" }), TODAY),
    { kind: "tried", text: "Voicemail · Oct 6" });
  assert.deepEqual(lastTouch(lead({}), TODAY), { kind: "none", text: "Not called yet" });
  assert.equal(shortDate("2026-01-31"), "Jan 31");
});

test("row chips trim parenthetical explanations without leaving half a bracket", () => {
  assert.deepEqual(rowChips(["1 reviews (new — inferred, not confirmed)", "rating 3 on 15 reviews (thin sample — half weight)"]).map((c) => c.text),
    ["1 reviews", "rating 3 on 15 reviews"]);
});

test("row chips drop the track line and mark real evidence", () => {
  const chips = rowChips([
    "Displacement • Hvac",
    "ServiceTitan field service software — bundled payments, rate rarely shopped",
    "offers customer financing (GreenSky)",
    "no website listed (unconfirmed)",
    "extra",
  ]);
  assert.deepEqual(chips, [
    { text: "ServiceTitan field service software", kind: "sig" },
    { text: "offers customer financing (GreenSky)", kind: "sig" },
    { text: "no website listed", kind: "plain" },
  ]);
});

test("tabs: a vertical, due today, new this week, and all; do-not-contact never shows", () => {
  const leads = [
    lead({ id: 1 }), lead({ id: 2, vertical: "dentist" }), lead({ id: 3, status: "dnc", callback_on: TODAY }),
    lead({ id: 4, status: "worked", callback_on: TODAY }), lead({ id: 5, first_seen_at: "2026-10-07T00:00:00Z" }),
  ];
  assert.deepEqual(tabLeads(leads, "hvac", TODAY, NOW).map((l) => l.id), [1, 4, 5]);
  assert.deepEqual(tabLeads(leads, "due", TODAY, NOW).map((l) => l.id), [4]);
  assert.deepEqual(tabLeads(leads, "new_week", TODAY, NOW).map((l) => l.id), [5]);
  assert.equal(tabLeads(leads, "all", TODAY, NOW).length, 4);
});

test("filters: to call excludes worked; hot and warm are uncalled only", () => {
  const leads = [lead({ id: 1, bucket: "hot" }), lead({ id: 2, bucket: "hot", status: "worked" }), lead({ id: 3 })];
  assert.deepEqual(applyFilter(leads, "to_call").map((l) => l.id), [1, 3]);
  assert.deepEqual(applyFilter(leads, "hot").map((l) => l.id), [1]);
  assert.deepEqual(applyFilter(leads, "worked").map((l) => l.id), [2]);
  assert.deepEqual(filterCounts(leads, null), { to_call: 2, hot: 1, warm: 1, new: 0, worked: 1 });
});

test("new means first found in the tab's latest run", () => {
  assert.equal(isNewLead({ first_run_id: 9 }, 9), true);
  assert.equal(isNewLead({ first_run_id: 8 }, 9), false);
  assert.equal(isNewLead({ is_new: true }, 9), true);
});

test("open now only drops closed businesses but keeps unknown hours", () => {
  const open = { utc_offset: -300, periods: [{ open: { day: 4, hour: 8 }, close: { day: 4, hour: 18 } }] };
  const closed = { utc_offset: -300, periods: [{ open: { day: 4, hour: 12 }, close: { day: 4, hour: 18 } }] };
  const leads = [lead({ id: 1, hours: open }), lead({ id: 2, hours: closed }), lead({ id: 3, hours: null })];
  assert.deepEqual(applyOpenOnly(leads, true, NOW).map((l) => l.id), [1, 3]);
  assert.equal(applyOpenOnly(leads, false, NOW).length, 3);
});

test("search covers name, notes and address", () => {
  const leads = [lead({ id: 1, name: "Arctic Air" }), lead({ id: 2, notes: "contract ends March" }), lead({ id: 3, address: "Katy, TX" })];
  assert.deepEqual(applySearch(leads, "march").map((l) => l.id), [2]);
  assert.deepEqual(applySearch(leads, "arctic").map((l) => l.id), [1]);
  assert.deepEqual(applySearch(leads, "katy").map((l) => l.id), [3]);
});

test("order: due callbacks float to the top, then score", () => {
  const leads = [lead({ id: 1, score: 90 }), lead({ id: 2, score: 40, callback_on: TODAY }), lead({ id: 3, score: 70 })];
  assert.deepEqual(orderLeads(leads, "hvac", TODAY).map((l) => l.id), [2, 1, 3]);
  const due = [lead({ id: 1, callback_on: TODAY, score: 90 }), lead({ id: 2, callback_on: "2026-10-02", score: 10 })];
  assert.deepEqual(orderLeads(due, "due", TODAY).map((l) => l.id), [2, 1]);
});

test("visibleLeads chains tab, filter, open-now and search", () => {
  const leads = [lead({ id: 1, bucket: "hot", name: "A" }), lead({ id: 2, bucket: "hot", name: "B", status: "worked" })];
  assert.deepEqual(visibleLeads(leads, { tab: "hvac", filter: "hot", openOnly: false, query: "", today: TODAY, nowMs: NOW }).map((l) => l.id), [1]);
});

test("tel links dial US numbers with the country code", () => {
  assert.equal(telHref("(281) 555-0118"), "tel:+12815550118");
  assert.equal(telHref("1-281-555-0118"), "tel:+12815550118");
  assert.equal(telHref(""), "");
});
