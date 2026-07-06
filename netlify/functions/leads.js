import { loadConfig, cfgDict } from "../../lib/config.js";
import { fetchAllVerticals, loadDemoBusinesses } from "../../lib/fetcher.js";
import { geocodeAddress, looksLikeCoords } from "../../lib/geocode.js";
import { buildLeads, summarize } from "../../lib/pipeline.js";
import { fetchTabcNew } from "../../lib/tabc.js";

// Netlify Functions v2: route /api/leads directly to this function.
export const config = { path: "/api/leads" };

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const METERS_PER_MILE = 1609.344;
const MAX_RADIUS_METERS = 50000; // Google searchNearby hard cap

// Parse the miles param → radius in meters. Blank/invalid falls back to the
// config default; valid values are clamped to 1–25 mi then to the API cap.
function milesToMeters(milesParam, fallbackMeters) {
  const n = Number(milesParam);
  if (!milesParam || Number.isNaN(n)) return fallbackMeters;
  const clamped = Math.min(25, Math.max(1, n));
  return Math.min(MAX_RADIUS_METERS, Math.round(clamped * METERS_PER_MILE));
}

export default async function handler(req) {
  const cfg = loadConfig();
  const requestStart = Date.now();
  const deadline = requestStart + (cfg.enrichment?.global_budget_ms ?? 6000);
  const url = new URL(req.url);
  const demo = url.searchParams.get("demo") === "1";

  if (!demo) {
    const provided = req.headers.get("x-app-passphrase") || "";
    if (!cfg.passphrase || provided !== cfg.passphrase) {
      return json({ error: "Invalid or missing passphrase." }, 401);
    }
    if (!cfg.apiKey) {
      return json({ error: "GOOGLE_PLACES_API_KEY is not set on the server." }, 500);
    }
  }

  let businesses;
  try {
    if (demo) {
      businesses = loadDemoBusinesses();
    } else {
      const s = cfg.search;
      const rawLoc = (url.searchParams.get("location") || "").trim();
      const radiusMeters = milesToMeters(url.searchParams.get("miles"), s.radius_meters);

      let location = s.location;
      if (rawLoc) {
        if (looksLikeCoords(rawLoc)) {
          location = rawLoc;
        } else {
          const geo = await geocodeAddress(cfg.apiKey, rawLoc);
          if (!geo) {
            return json({ error: "Couldn't find that location — try a ZIP or city." }, 400);
          }
          location = geo;
        }
      }

      businesses = await fetchAllVerticals({
        apiKey: cfg.apiKey,
        location,
        radiusMeters,
        verticals: s.verticals,
        maxResults: s.batch_size ?? 20,
      });

      const t = cfg.sources?.tabc;
      if (t?.enabled) {
        const tabc = await fetchTabcNew({
          counties: t.counties, sinceDays: t.since_days,
          appToken: process.env[t.app_token_env] || null, fetchImpl: fetch,
        });
        businesses = businesses.concat(tabc);
      }
    }
  } catch (e) {
    return json({ error: `Fetch failed: ${e.message}` }, 502);
  }

  const deps = demo ? {} : { fetchImpl: fetch, deadline };
  const { rows, chainsFiltered } = await buildLeads(cfgDict(cfg), businesses, deps);
  return json({
    leads: rows,
    summary: { ...summarize(rows), chainsFiltered },
    demo,
    threshold: cfg.search.score_threshold ?? 40,
  });
}
