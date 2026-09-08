import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import * as leadsModule from "../api/leads.js";

const { GET: handler } = leadsModule;

// Vercel's Node builder decides how to invoke a function from its export shape,
// in @vercel/node/dist/bundling-handler.js:
//
//   listener = unwrapDefaults(listener);          // follows mod.default up to 5x
//   isWebHandler = HTTP_METHODS.some(m => typeof listener[m] === "function")
//                  || typeof listener.fetch === "function";
//   if (isWebHandler) return createWebHandler(listener);
//   if (typeof listener === "function") return listener;   // Node (req, res)
//
// A bare `export default async function handler(req)` unwraps to the function
// itself, which has no GET and no fetch — so it is invoked as a Node handler,
// `req` is an IncomingMessage whose `.url` is relative, and `new URL(req.url)`
// throws TypeError: Invalid URL before a line of our code runs. In production
// that surfaces as FUNCTION_INVOCATION_FAILED and a plain-text error page.
//
// Netlify Functions v2 read the Web signature off a bare default export, so
// this only broke on the move to Vercel. Asserted rather than remembered.
const VERCEL_HTTP_METHODS = ["GET", "HEAD", "OPTIONS", "POST", "PUT", "PATCH", "DELETE"];

test("the module exports a shape Vercel invokes as a Web handler", () => {
  let listener = leadsModule;
  for (let i = 0; i < 5 && listener && listener.default; i++) listener = listener.default;

  const isWebHandler =
    VERCEL_HTTP_METHODS.some((m) => typeof listener[m] === "function") ||
    typeof listener.fetch === "function";

  assert.ok(isWebHandler,
    "api/leads.js must export a named HTTP method (or fetch); a bare default export " +
    "is invoked with Node's (req, res) and crashes on new URL(req.url)");
  assert.equal(typeof leadsModule.GET, "function");
  // A default export would be unwrapped first and would hide the GET export.
  assert.equal(leadsModule.default, undefined,
    "a default export shadows the named one during Vercel's unwrapDefaults");
});

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
  assert.equal(typeof d.summary.closedFiltered, "number");
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
    // Capture the Nearby body specifically: the specialty Text Search sweep
    // posts to searchText afterwards with a locationBias, not a restriction.
    if (String(url).includes("places:searchNearby") && opts && opts.body) {
      placesBody = JSON.parse(opts.body);
    }
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
    if (String(url).includes("places:searchNearby") && opts && opts.body) {
      placesBody = JSON.parse(opts.body);
    }
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
