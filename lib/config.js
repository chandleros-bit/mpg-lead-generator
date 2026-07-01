import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const raw = require("../config.json");

export function loadConfig() {
  return {
    search: raw.search,
    personal: raw.personal,
    weights: raw.weights,
    apiKey: process.env.GOOGLE_PLACES_API_KEY || null,
    passphrase: process.env.APP_PASSPHRASE || null,
  };
}

export function cfgDict(cfg) {
  return { search: cfg.search, personal: cfg.personal, weights: cfg.weights };
}
