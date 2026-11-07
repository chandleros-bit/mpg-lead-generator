// Static JSON import so esbuild inlines the config into the function bundle
// (createRequire + a relative path is NOT bundle-safe in a serverless bundle).
import raw from "../config.json" with { type: "json" };

// Secrets are set by pasting into a hosting dashboard, and a paste carries a
// trailing newline or space often enough to matter. Untrimmed, the passphrase
// comparison in api/leads.js can never match what the user types, so every live
// request 401s while the value looks right on screen. Whitespace-only reads as
// unset rather than as a secret made of spaces, so the handler takes its "not
// configured" branch instead of comparing against blanks. lib/db.js has always
// trimmed its two; this brings the rest in line.
function envSecret(v) {
  const s = String(v ?? "").trim();
  return s || null;
}

export function loadConfig() {
  return {
    search: raw.search,
    personal: raw.personal,
    weights: raw.weights,
    enrichment: raw.enrichment ?? {},
    sources: raw.sources ?? {},
    desk: raw.desk ?? {},
    apiKey: envSecret(process.env.GOOGLE_PLACES_API_KEY),
    passphrase: envSecret(process.env.APP_PASSPHRASE),
  };
}

export function cfgDict(cfg) {
  return {
    search: cfg.search, personal: cfg.personal, weights: cfg.weights, enrichment: cfg.enrichment,
    market: cfg.search.market ?? null,
  };
}
