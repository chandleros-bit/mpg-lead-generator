import { loadConfig, cfgDict } from "../../lib/config.js";
import { fetchNearby, loadDemoBusinesses } from "../../lib/fetcher.js";
import { buildLeads, summarize } from "../../lib/pipeline.js";

// Netlify Functions v2: route /api/leads directly to this function.
export const config = { path: "/api/leads" };

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "content-type": "application/json" },
  });
}

export default async function handler(req) {
  const cfg = loadConfig();
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
      businesses = await fetchNearby({
        apiKey: cfg.apiKey,
        location: s.location,
        radiusMeters: s.radius_meters,
        includedTypes: s.verticals,
        maxResults: s.batch_size ?? 20,
      });
    }
  } catch (e) {
    return json({ error: `Fetch failed: ${e.message}` }, 502);
  }

  const rows = buildLeads(cfgDict(cfg), businesses);
  return json({
    leads: rows,
    summary: summarize(rows),
    demo,
    threshold: cfg.search.score_threshold ?? 40,
  });
}
