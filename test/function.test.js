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
