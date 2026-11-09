import test from "node:test";
import assert from "node:assert/strict";
import { selectToday, orderToday, composeToday, sectionOf, sectionLabel } from "../public/today.js";

const TODAY = "2026-11-09";
const NOW = Date.UTC(2026, 10, 9, 15, 0); // 9am Central
const THIS_WEEK = new Date(NOW - 2 * 86400000).toISOString();
const LAST_MONTH = new Date(NOW - 40 * 86400000).toISOString();

let nextId = 1;
function lead(o = {}) {
  return {
    id: o.id ?? nextId++,
    vertical: "hvac",
    status: "to_call",
    bucket: "warm",
    score: 50,
    callback_on: null,
    last_outcome: null,
    first_seen_at: LAST_MONTH,
    ...o,
  };
}

const ids = (rows) => rows.map((r) => r.id);

test("every due callback is taken, oldest first, even past the goal", () => {
  const leads = [
    lead({ id: 1, callback_on: "2026-11-09", score: 10 }),
    lead({ id: 2, callback_on: "2026-11-02", score: 20 }),
    lead({ id: 3, callback_on: "2026-11-06", score: 30 }),
  ];
  const out = composeToday(leads, { today: TODAY, goal: 2, nowMs: NOW });
  assert.deepEqual(ids(out), [2, 3, 1]);
  assert.equal(out.length, 3, "a callback-heavy day overflows the goal rather than hiding one");
  assert.ok(out.every((r) => r.section === "callback"));
});

test("a callback dated in the future is not due", () => {
  const out = composeToday([lead({ id: 1, callback_on: "2026-12-01" })], { today: TODAY, goal: 40, nowMs: NOW });
  assert.equal(out[0].section, "warm", "it is still pickable on its own merits, just not as a callback");
});

test("hot fills before warm, warm before new, each by score", () => {
  const leads = [
    lead({ id: 1, bucket: "warm", score: 60 }),
    lead({ id: 2, bucket: "hot", score: 70 }),
    lead({ id: 3, bucket: "hot", score: 90 }),
    lead({ id: 4, bucket: "cold", score: 10, first_seen_at: THIS_WEEK }),
    lead({ id: 5, bucket: "warm", score: 65 }),
  ];
  const out = composeToday(leads, { today: TODAY, goal: 40, nowMs: NOW });
  assert.deepEqual(ids(out), [3, 2, 5, 1, 4]);
  assert.deepEqual(out.map((r) => r.section), ["hot", "hot", "warm", "warm", "new"]);
});

test("sections 2-4 fill exactly goal minus the callbacks", () => {
  const leads = [
    lead({ id: 1, callback_on: "2026-11-08" }),
    lead({ id: 2, callback_on: "2026-11-09" }),
    ...Array.from({ length: 20 }, (_, i) => lead({ id: 100 + i, bucket: "hot", score: 100 - i })),
  ];
  const out = selectToday(leads, { today: TODAY, goal: 5, nowMs: NOW });
  assert.equal(out.length, 5, "2 callbacks + 3 filled");
  assert.deepEqual(ids(out), [1, 2, 100, 101, 102]);
});

test("callbacks alone can leave no slots to fill", () => {
  const leads = [
    lead({ id: 1, callback_on: "2026-11-01" }),
    lead({ id: 2, callback_on: "2026-11-02" }),
    lead({ id: 3, bucket: "hot", score: 99 }),
  ];
  assert.deepEqual(ids(selectToday(leads, { today: TODAY, goal: 2, nowMs: NOW })), [1, 2]);
});

test("a lead is picked once, under its highest section", () => {
  // Due callback, hot, and new this week all at once.
  const both = lead({ id: 1, callback_on: "2026-11-05", bucket: "hot", first_seen_at: THIS_WEEK });
  const out = composeToday([both], { today: TODAY, goal: 40, nowMs: NOW });
  assert.equal(out.length, 1);
  assert.equal(out[0].section, "callback");
});

test("already-called leads are never picked, due callbacks excepted", () => {
  const leads = [
    lead({ id: 1, bucket: "hot", score: 99, last_outcome: "no_answer" }),
    lead({ id: 2, bucket: "hot", score: 98, status: "worked", last_outcome: "talked" }),
    lead({ id: 3, bucket: "hot", score: 97 }),
    lead({ id: 4, bucket: "hot", score: 96, last_outcome: "voicemail", callback_on: "2026-11-08" }),
  ];
  assert.deepEqual(ids(selectToday(leads, { today: TODAY, goal: 40, nowMs: NOW })), [4, 3]);
});

test("do-not-contact leads are excluded from selection and from ordering", () => {
  const leads = [
    lead({ id: 1, status: "dnc", bucket: "hot", score: 99 }),
    lead({ id: 2, status: "dnc", callback_on: "2026-11-01" }),
    lead({ id: 3, bucket: "hot", score: 50 }),
  ];
  assert.deepEqual(ids(composeToday(leads, { today: TODAY, goal: 40, nowMs: NOW })), [3]);
  assert.deepEqual(ids(orderToday(leads, { today: TODAY, nowMs: NOW })), [3]);
});

test("a pool too small to fill the goal gives a short list, not a padded one", () => {
  const leads = [lead({ id: 1, bucket: "hot" }), lead({ id: 2, bucket: "cold", last_outcome: "no_answer" })];
  assert.deepEqual(ids(composeToday(leads, { today: TODAY, goal: 40, nowMs: NOW })), [1]);
});

test("an empty pool composes to an empty list", () => {
  assert.deepEqual(composeToday([], { today: TODAY, goal: 40, nowMs: NOW }), []);
  assert.deepEqual(composeToday(undefined, { today: TODAY, goal: 40, nowMs: NOW }), []);
});

test("a lead worked today keeps its section and its place", () => {
  const picked = [
    lead({ id: 1, bucket: "hot", score: 90 }),
    lead({ id: 2, bucket: "hot", score: 80 }),
    lead({ id: 3, bucket: "warm", score: 70 }),
  ];
  const before = ids(orderToday(picked, { today: TODAY, nowMs: NOW }));
  // Work the top lead: the row is done, but the sheet does not move under it.
  picked[0].status = "worked";
  picked[0].last_outcome = "talked";
  assert.deepEqual(ids(orderToday(picked, { today: TODAY, nowMs: NOW })), before);
});

test("setting a callback for today moves a lead up into the callback section", () => {
  const picked = [
    lead({ id: 1, bucket: "hot", score: 90 }),
    lead({ id: 2, bucket: "warm", score: 70, last_outcome: "no_answer", callback_on: TODAY }),
  ];
  const out = orderToday(picked, { today: TODAY, nowMs: NOW });
  assert.deepEqual(ids(out), [2, 1]);
  assert.equal(out[0].section, "callback");
});

test("a lead whose bucket fell away after it was picked sorts last, not out", () => {
  const picked = [lead({ id: 1, bucket: "hot", score: 90 }), lead({ id: 2, bucket: "cold", score: 80 })];
  const out = orderToday(picked, { today: TODAY, nowMs: NOW });
  assert.deepEqual(ids(out), [1, 2]);
  assert.equal(out[1].section, "other");
});

test("ordering is stable for equal scores in a section", () => {
  const picked = [lead({ id: 2, bucket: "hot", score: 50 }), lead({ id: 1, bucket: "hot", score: 50 })];
  assert.deepEqual(ids(orderToday(picked, { today: TODAY, nowMs: NOW })), [1, 2]);
});

test("sectionOf reads a lead's current place without consulting call status", () => {
  assert.equal(sectionOf(lead({ callback_on: "2026-11-01", status: "worked" }), TODAY, NOW), "callback");
  assert.equal(sectionOf(lead({ bucket: "hot", status: "worked" }), TODAY, NOW), "hot");
  assert.equal(sectionOf(lead({ bucket: "cold", first_seen_at: THIS_WEEK }), TODAY, NOW), "new");
  assert.equal(sectionOf(lead({ bucket: "cold" }), TODAY, NOW), "other");
});

test("every section has a label", () => {
  for (const id of ["callback", "hot", "warm", "new", "other"]) {
    assert.match(sectionLabel(id), /\S/);
  }
});
