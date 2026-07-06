import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import handler from "../netlify/functions/leads.js";

const require = createRequire(import.meta.url);
const DEMO_RAW = require("../public/demo_places.json");

test("demo request returns leads + summary, no passphrase needed", async () => {
  const res = await handler(new Request("http://x/api/leads?demo=1"));
  assert.equal(res.status, 200);
  const d = await res.json();
  assert.equal(d.demo, true);
  assert.ok(d.leads.length > 0);
  assert.equal(d.summary.total, d.leads.length);
  assert.equal(typeof d.summary.chainsFiltered, "number");
  assert.equal(typeof d.threshold, "number");
});

test("live request without passphrase is 401", async () => {
  delete process.env.APP_PASSPHRASE;
  const res = await handler(new Request("http://x/api/leads"));
  assert.equal(res.status, 401);
});

test("live request with wrong passphrase is 401", async () => {
  process.env.APP_PASSPHRASE = "right";
  const res = await handler(new Request("http://x/api/leads", { headers: { "x-app-passphrase": "wrong" } }));
  assert.equal(res.status, 401);
});

test("live request with correct passphrase but no API key is 500", async () => {
  process.env.APP_PASSPHRASE = "right";
  delete process.env.GOOGLE_PLACES_API_KEY;
  const res = await handler(new Request("http://x/api/leads", { headers: { "x-app-passphrase": "right" } }));
  assert.equal(res.status, 500);
});

test("live request with correct passphrase + key returns leads (stubbed fetch)", async () => {
  process.env.APP_PASSPHRASE = "right";
  process.env.GOOGLE_PLACES_API_KEY = "key";
  const orig = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify(DEMO_RAW), { status: 200 });
  try {
    const res = await handler(new Request("http://x/api/leads", { headers: { "x-app-passphrase": "right" } }));
    assert.equal(res.status, 200);
    const d = await res.json();
    assert.equal(d.demo, false);
    assert.ok(d.leads.length > 0);
  } finally {
    globalThis.fetch = orig;
  }
});

test("fetch failure surfaces as 502", async () => {
  process.env.APP_PASSPHRASE = "right";
  process.env.GOOGLE_PLACES_API_KEY = "key";
  const orig = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error("network down"); };
  try {
    const res = await handler(new Request("http://x/api/leads", { headers: { "x-app-passphrase": "right" } }));
    assert.equal(res.status, 502);
  } finally {
    globalThis.fetch = orig;
  }
});

test("address location is geocoded before searching", async () => {
  process.env.APP_PASSPHRASE = "right";
  process.env.GOOGLE_PLACES_API_KEY = "key";
  const orig = globalThis.fetch;
  let placesBody = null;
  globalThis.fetch = async (url, opts) => {
    if (String(url).includes("maps/api/geocode")) {
      return new Response(JSON.stringify({ status: "OK", results: [{ geometry: { location: { lat: 40, lng: -70 } } }] }), { status: 200 });
    }
    if (opts && opts.body) placesBody = JSON.parse(opts.body);
    return new Response(JSON.stringify(DEMO_RAW), { status: 200 });
  };
  try {
    const res = await handler(new Request("http://x/api/leads?location=77433&miles=5", { headers: { "x-app-passphrase": "right" } }));
    assert.equal(res.status, 200);
    assert.equal(placesBody.locationRestriction.circle.center.latitude, 40);
    assert.equal(placesBody.locationRestriction.circle.radius, Math.round(5 * 1609.344));
  } finally { globalThis.fetch = orig; }
});

test("unresolvable location returns 400", async () => {
  process.env.APP_PASSPHRASE = "right";
  process.env.GOOGLE_PLACES_API_KEY = "key";
  const orig = globalThis.fetch;
  globalThis.fetch = async (url) => {
    if (String(url).includes("maps/api/geocode")) {
      return new Response(JSON.stringify({ status: "ZERO_RESULTS", results: [] }), { status: 200 });
    }
    return new Response(JSON.stringify(DEMO_RAW), { status: 200 });
  };
  try {
    const res = await handler(new Request("http://x/api/leads?location=zzzzz", { headers: { "x-app-passphrase": "right" } }));
    assert.equal(res.status, 400);
  } finally { globalThis.fetch = orig; }
});

test("coordinate location skips geocoding", async () => {
  process.env.APP_PASSPHRASE = "right";
  process.env.GOOGLE_PLACES_API_KEY = "key";
  const orig = globalThis.fetch;
  let geocodeCalled = false;
  let placesBody = null;
  globalThis.fetch = async (url, opts) => {
    if (String(url).includes("maps/api/geocode")) { geocodeCalled = true; return new Response("{}", { status: 200 }); }
    if (opts && opts.body) placesBody = JSON.parse(opts.body);
    return new Response(JSON.stringify(DEMO_RAW), { status: 200 });
  };
  try {
    const res = await handler(new Request("http://x/api/leads?location=40,-70", { headers: { "x-app-passphrase": "right" } }));
    assert.equal(res.status, 200);
    assert.equal(geocodeCalled, false);
    assert.equal(placesBody.locationRestriction.circle.center.latitude, 40);
  } finally { globalThis.fetch = orig; }
});

test("geocoder REQUEST_DENIED surfaces as 502 with the real reason, not a 400", async () => {
  process.env.APP_PASSPHRASE = "right";
  process.env.GOOGLE_PLACES_API_KEY = "key";
  const orig = globalThis.fetch;
  globalThis.fetch = async (url) => {
    if (String(url).includes("maps/api/geocode")) {
      return new Response(JSON.stringify({
        status: "REQUEST_DENIED",
        error_message: "This API project is not authorized to use this API.",
      }), { status: 200 });
    }
    return new Response(JSON.stringify(DEMO_RAW), { status: 200 });
  };
  try {
    const res = await handler(new Request("http://x/api/leads?location=77433", { headers: { "x-app-passphrase": "right" } }));
    assert.equal(res.status, 502);
    const d = await res.json();
    assert.match(d.error, /REQUEST_DENIED/);
  } finally { globalThis.fetch = orig; }
});

test("live enrichment failure still returns scored leads", async () => {
  process.env.APP_PASSPHRASE = "right";
  process.env.GOOGLE_PLACES_API_KEY = "key";
  const orig = globalThis.fetch;
  globalThis.fetch = async (url, opts) => {
    if (String(url).includes("maps/api/geocode")) {
      return new Response(JSON.stringify({ status: "OK", results: [{ geometry: { location: { lat: 30, lng: -95 } } }] }), { status: 200 });
    }
    if (String(url).includes("places.googleapis.com")) {
      return new Response(JSON.stringify(DEMO_RAW), { status: 200 });
    }
    // robots.txt, lead sites, Socrata: simulate down
    throw new Error("enrichment source down");
  };
  try {
    const res = await handler(new Request("http://x/api/leads?location=30,-95", { headers: { "x-app-passphrase": "right" } }));
    assert.equal(res.status, 200);
    const d = await res.json();
    assert.ok(d.leads.length > 0);
    assert.equal(typeof d.summary.chainsFiltered, "number");
  } finally { globalThis.fetch = orig; }
});
