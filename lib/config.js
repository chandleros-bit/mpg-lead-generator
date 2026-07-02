// Static JSON import so esbuild inlines the config into the function bundle
// (createRequire + a relative path is NOT bundle-safe on Netlify).
import raw from "../config.json" with { type: "json" };

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
