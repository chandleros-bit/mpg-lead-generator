import test from "node:test";
import assert from "node:assert/strict";
import { openStatus, clockLabel } from "../public/hours.js";
import { parseHours, parsePlacesResponse } from "../lib/fetcher.js";

// Mon-Fri 8 AM to 6 PM, Sat 9 to 1, closed Sunday. Central daylight time.
const SHOP = {
  utc_offset: -300,
  periods: [1, 2, 3, 4, 5].map((d) => ({ open: { day: d, hour: 8, minute: 0 }, close: { day: d, hour: 18, minute: 0 } }))
    .concat([{ open: { day: 6, hour: 9, minute: 0 }, close: { day: 6, hour: 13, minute: 0 } }]),
};

// Thu Oct 8 2026, local Central time → UTC ms.
const at = (h, m = 0, day = 8) => Date.UTC(2026, 9, day, h + 5, m);

test("open during business hours, with the closing time", () => {
  assert.deepEqual(openStatus(SHOP, at(10)), { open: true, label: "Open until 6 PM" });
});

test("closed after hours points at tomorrow's opening", () => {
  assert.deepEqual(openStatus(SHOP, at(19)), { open: false, label: "Closed · opens Fri 8 AM" });
});

test("closed before opening the same day says just the time", () => {
  assert.deepEqual(openStatus(SHOP, at(7, 15)), { open: false, label: "Closed · opens 8 AM" });
});

test("Saturday night skips closed Sunday to Monday", () => {
  assert.deepEqual(openStatus(SHOP, at(15, 0, 10)), { open: false, label: "Closed · opens Mon 8 AM" });
});

test("a period past midnight still reads as open after midnight", () => {
  const bar = { utc_offset: -300, periods: [{ open: { day: 5, hour: 16 }, close: { day: 6, hour: 2 } }] };
  assert.deepEqual(openStatus(bar, at(1, 0, 10)), { open: true, label: "Open until 2 AM" });
});

test("a period with no close is open 24 hours", () => {
  assert.deepEqual(openStatus({ utc_offset: -300, periods: [{ open: { day: 0, hour: 0 } }] }, at(3)),
    { open: true, label: "Open 24 hours" });
});

test("no hours or no offset is unknown, never closed", () => {
  assert.equal(openStatus(null), null);
  assert.equal(openStatus({ periods: [] }), null);
  assert.equal(openStatus({ periods: SHOP.periods }), null);
});

test("clock labels", () => {
  assert.equal(clockLabel(0, 0), "12 AM");
  assert.equal(clockLabel(12, 30), "12:30 PM");
  assert.equal(clockLabel(17, 0), "5 PM");
});

test("Places hours are kept on the business", () => {
  const [b] = parsePlacesResponse({ places: [{
    id: "x", displayName: { text: "Shop" }, utcOffsetMinutes: -300,
    regularOpeningHours: { periods: [{ open: { day: 1, hour: 8, minute: 0 }, close: { day: 1, hour: 17, minute: 30 } }] },
  }] });
  assert.deepEqual(b.hours, { utc_offset: -300, periods: [{ open: { day: 1, hour: 8, minute: 0 }, close: { day: 1, hour: 17, minute: 30 } }] });
  assert.equal(parseHours({}), null);
});
