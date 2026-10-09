import { loadConfig, cfgDict } from "../lib/config.js";
import { fetchAllVerticals, loadDemoBusinesses } from "../lib/fetcher.js";
import { geocodeAddress, geocodeMarket, looksLikeCoords } from "../lib/geocode.js";
import { getVertical } from "../lib/verticals/index.js";
import { dbConfig, rpc } from "../lib/db.js";
import { leadToDbRow } from "../lib/desk.js";
import { buildLeads, summarize } from "../lib/pipeline.js";
import { fetchTabcNew } from "../lib/tabc.js";

// Vercel routes by file path: api/leads.js serves /api/leads. No route export
// needed — and none wanted, since `config` is a reserved export name here.
//
// Exported as `GET`, not as a default, and that is load-bearing. Vercel's Node
// builder picks the calling convention off the export shape:
//
//   listener = unwrapDefaults(listener);          // follows mod.default up to 5x
//   isWebHandler = HTTP_METHODS.some(m => typeof listener[m] === "function")
//                  || typeof listener.fetch === "function";
//   if (isWebHandler) return createWebHandler(listener);
//   if (typeof listener === "function") return listener;   // Node (req, res)
//
// A bare `export default async function handler(req)` unwraps to the function
// itself, which carries no GET and no fetch, so it is invoked as a Node handler
// with an IncomingMessage. `req.url` is then relative ("/api/leads?demo=1") and
// the `new URL(req.url)` below throws TypeError: Invalid URL before any of this
// runs — a FUNCTION_INVOCATION_FAILED on every request. Netlify Functions v2
// read the Web signature straight off a default export, which is why the body
// survived the platform move unchanged but the export did not.
//
// Adding a default export back would also break it: unwrapDefaults follows
// `default` first and would hide this named export. test/function.test.js
// asserts both halves.

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

// TABC licenses are Texas, and only bars and restaurants. Any other run skips
// the call entirely rather than fetching rows the pipeline would discard.
const TABC_VERTICALS = new Set(["bar", "restaurant"]);

// One vertical per run when the dashboard picks one; the config list when it
// doesn't ("default" or absent). An unknown id is a 400, not a silent fallback:
// searching the wrong niche looks exactly like an empty market.
export function resolveVerticals(param, cfgVerticals) {
  const v = String(param || "").trim();
  if (!v || v === "default") return { verticals: cfgVerticals, single: false };
  if (!getVertical(v)) return { error: `Unknown vertical "${v}".` };
  return { verticals: [v], single: true };
}

export async function saveRun(db, rows, runInfo, market, fetchImpl = fetch) {
  if (!db) return { saved: false, configured: false };
  if (!rows.length) return { saved: true, configured: true, new_count: 0, existing_count: 0 };
  try {
    const out = await rpc(db, "save_run", {
      p_run: runInfo,
      p_leads: rows.map((r) => leadToDbRow(r, runInfo.vertical, market)),
    }, { fetchImpl });
    const byPlace = new Map((out.leads || []).map((l) => [l.place_id, l]));
    for (const r of rows) {
      const s = byPlace.get(r.place_id);
      if (s) { r.lead_id = s.id; r.is_new = s.is_new; r.status = s.status; }
    }
    return { saved: true, configured: true, run_id: out.run_id,
      new_count: out.new_count, existing_count: out.existing_count };
  } catch (e) {
    return { saved: false, configured: true, error: e.message };
  }
}

export async function GET(req) {
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

  const picked = resolveVerticals(url.searchParams.get("vertical"), cfg.search.verticals);
  if (picked.error) return json({ error: picked.error }, 400);
  const verticals = picked.verticals;
  let market = cfg.search.market ?? null;
  let tabcCounties = cfg.sources?.tabc?.counties ?? [];

  let businesses;
  try {
    if (demo) {
      businesses = loadDemoBusinesses();
    } else {
      const s = cfg.search;
      const rawLoc = (url.searchParams.get("location") || "").trim();
      const city = (url.searchParams.get("city") || "").trim();
      const state = (url.searchParams.get("state") || "").trim().toUpperCase();
      const radiusMeters = milesToMeters(url.searchParams.get("miles"), s.radius_meters);

      let location = s.location;
      if (city) {
        // The market path: one city (or ZIP) and a state per run.
        const m = await geocodeMarket(cfg.apiKey, city, state);
        if (!m) {
          return json({ error: "Couldn't find that city. Check the spelling or try a ZIP." }, 400);
        }
        location = m.location;
        market = { city: m.city, state: m.state };
        // County-filtered sources follow the market, so a Dallas run doesn't
        // pull Harris County licenses.
        tabcCounties = m.county ? [m.county] : [];
      } else if (rawLoc) {
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
        verticals,
        maxResults: s.batch_size ?? 20,
      });

      const t = cfg.sources?.tabc;
      const inTexas = !market || String(market.state || "").toUpperCase() === "TX";
      if (t?.enabled && inTexas && verticals.some((v) => TABC_VERTICALS.has(v))) {
        const tabc = await fetchTabcNew({
          counties: tabcCounties, sinceDays: t.since_days,
          appToken: process.env[t.app_token_env] || null, fetchImpl: fetch,
        });
        businesses = businesses.concat(tabc);
      }
    }
  } catch (e) {
    return json({ error: `Fetch failed: ${e.message}` }, 502);
  }

  const deps = demo ? {} : { fetchImpl: fetch, deadline };
  const run = cfgDict(cfg);
  run.search = { ...run.search, verticals };
  run.market = market;
  const { rows, chainsFiltered, closedFiltered } = await buildLeads(run, businesses, deps);

  // Save the run. New businesses are added; ones already saved are refreshed
  // but keep their tab, call status and notes (see save_run in
  // supabase/schema.sql). A database failure never costs the run: the leads
  // still come back, with saving reported as failed.
  const save = await saveRun(demo ? null : dbConfig(), rows, {
    vertical: picked.single ? verticals[0] : "mixed",
    city: market && market.city, state: market && market.state,
    miles: Number(url.searchParams.get("miles")) || null,
  }, market);

  return json({
    leads: rows,
    save,
    summary: { ...summarize(rows), chainsFiltered, closedFiltered },
    demo,
    threshold: cfg.search.score_threshold ?? 40,
    verticals,
    market,
  });
}
