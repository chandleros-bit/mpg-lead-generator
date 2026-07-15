import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { loadConfig, cfgDict } from "../lib/config.js";

const require = createRequire(import.meta.url);
const ROOT_CFG = require("../config.json");
const PUBLIC_CFG = require("../public/config.json");

// The complete set of paths public/dashboard.js reads out of config.json
// (see initShell). public/config.json exists only to serve these to the
// browser — config.json itself sits outside the publish dir. If you teach the
// dashboard to read another field, add it here and to public/config.json.
const CLIENT_READS = [
  ["personal", "company"],
  ["personal", "name"],
  ["search", "score_threshold"],
  ["search", "verticals"],
  ["search", "radius_meters"],
];

const at = (obj, path) => path.reduce((o, k) => (o == null ? undefined : o[k]), obj);

// Leaf = a scalar or an array. Objects are containers we recurse through.
function leafPaths(obj, path = [], out = []) {
  for (const [k, v] of Object.entries(obj)) {
    const p = [...path, k];
    if (v && typeof v === "object" && !Array.isArray(v)) leafPaths(v, p, out);
    else out.push(p);
  }
  return out;
}

test("loadConfig reads baked config and env secrets", () => {
  process.env.GOOGLE_PLACES_API_KEY = "test-key";
  process.env.APP_PASSPHRASE = "test-pass";
  const cfg = loadConfig();
  assert.ok(Array.isArray(cfg.search.verticals));
  assert.equal(cfg.apiKey, "test-key");
  assert.equal(cfg.passphrase, "test-pass");
});

test("loadConfig returns null secrets when env is unset", () => {
  delete process.env.GOOGLE_PLACES_API_KEY;
  delete process.env.APP_PASSPHRASE;
  const cfg = loadConfig();
  assert.equal(cfg.apiKey, null);
  assert.equal(cfg.passphrase, null);
});

test("cfgDict exposes search/personal/weights/enrichment", () => {
  const cfg = loadConfig();
  const d = cfgDict(cfg);
  assert.deepEqual(Object.keys(d).sort(), ["enrichment", "personal", "search", "weights"]);
});

// ---------- public/config.json is the browser's view, nothing more ----------

test("public/config.json carries only fields the dashboard reads", () => {
  // Anything else is dead weight that reads as authoritative. A stale copy of
  // `weights` here is the drift trap: you tune the engine in config.json and
  // this file quietly describes a scoring model that no longer exists.
  const allowed = new Set(CLIENT_READS.map((p) => p.join(".")));
  const extra = leafPaths(PUBLIC_CFG).map((p) => p.join(".")).filter((p) => !allowed.has(p));
  assert.deepEqual(extra, [], `public/config.json carries fields nothing reads: ${extra.join(", ")}`);
});

test("public/config.json has every field the dashboard reads", () => {
  const missing = CLIENT_READS.filter((p) => at(PUBLIC_CFG, p) === undefined).map((p) => p.join("."));
  assert.deepEqual(missing, [], `public/config.json is missing: ${missing.join(", ")}`);
});

test("public/config.json never contradicts config.json", () => {
  // public/ may omit anything, but whatever it does carry must match the config
  // the function actually scores with — otherwise the header describes a
  // different engine than the one producing the leads.
  const mismatches = [];
  for (const p of leafPaths(PUBLIC_CFG)) {
    const pub = at(PUBLIC_CFG, p);
    const root = at(ROOT_CFG, p);
    try {
      assert.deepEqual(pub, root);
    } catch {
      mismatches.push(`${p.join(".")}: public=${JSON.stringify(pub)} root=${JSON.stringify(root)}`);
    }
  }
  assert.deepEqual(mismatches, [], `public/config.json drifted from config.json:\n${mismatches.join("\n")}`);
});
