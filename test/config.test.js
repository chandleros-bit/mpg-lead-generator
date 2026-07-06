import test from "node:test";
import assert from "node:assert/strict";
import { loadConfig, cfgDict } from "../lib/config.js";

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
