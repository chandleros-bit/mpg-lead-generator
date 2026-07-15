// lib/pipeline.js
import { scoreBusiness, classifyTrack } from "./scoring.js";
import { generateCampaign } from "./campaigns.js";
import { isChain, isChainDomain, normalizeName } from "./chains.js";
import { detectSiteProcessors } from "./processors.js";
import { enrichOwner } from "./enrich.js";
import { mapWithBudget } from "./http.js";

// Dedupe key resilient to address-string differences between Places and TABC:
// normalized name + first number (street #) + 5-digit ZIP.
function dedupeKey(b) {
  const addr = String(b.address || "");
  const num = (addr.match(/\d+/) || [""])[0];
  const zip = (addr.match(/\b\d{5}\b/) || [""])[0];
  return `${normalizeName(b.name)}|${num}|${zip}`;
}

export async function buildLeads(cfg, businesses, deps = {}) {
  const icp = new Set(cfg.search.verticals);
  const personal = cfg.personal;
  const weights = cfg.weights;
  const brands = cfg.search.exclude_chains ?? [];
  const domains = cfg.search.exclude_domains ?? [];
  const cutoff = weights.greenfield_review_cutoff;
  const threshold = cfg.search.score_threshold ?? 40;
  const enr = cfg.enrichment ?? {};
  const { fetchImpl } = deps;
  const deadline = deps.deadline ?? Infinity;
  const cache = new Map();
  const robotsCache = new Map();

  // 1. Dedupe TABC rows that collide with a Places business.
  const placesKeys = new Set(
    businesses.filter((b) => (b.source ?? "places") !== "tabc").map(dedupeKey)
  );
  const merged = businesses.filter(
    (b) => (b.source ?? "places") !== "tabc" || !placesKeys.has(dedupeKey(b))
  );

  // 2. Chain filter (name OR domain), then drop closed businesses.
  //
  // Closed businesses are dropped here — before enrichment — so a business that
  // no longer exists can't burn any of the global fetch budget. CLOSED_TEMPORARILY
  // is a real lead that just isn't callable today, so it survives with a chip.
  // An empty/missing status means Places didn't say; treat that as operational
  // (TABC rows set OPERATIONAL explicitly).
  let chainsFiltered = 0;
  let closedFiltered = 0;
  const kept = [];
  for (const b of merged) {
    if (isChain(b.name, brands) || isChainDomain(b.website, domains)) { chainsFiltered++; continue; }
    if (b.business_status === "CLOSED_PERMANENTLY") { closedFiltered++; continue; }
    kept.push(b);
  }

  // 3. Processor scrape on ranked Displacement candidates (before final scoring).
  const pd = enr.processor_detection ?? {};
  if (pd.enabled && fetchImpl) {
    const candidates = kept
      .filter((b) => b.website && classifyTrack(b, icp, cutoff) === "displacement")
      .map((b) => ({ b, pre: scoreBusiness(b, weights, icp).score }))
      .sort((x, y) => y.pre - x.pre)
      .slice(0, pd.max_sites ?? 25)
      .map((x) => x.b);
    await mapWithBudget(candidates, async (b) => {
      b.processor = await detectSiteProcessors(b.website, {
        fetchImpl, cache, robotsCache,
        timeoutMs: pd.fetch_timeout_ms ?? 3000,
        checkCheckout: pd.check_checkout_page !== false,
        deadline,
      });
    }, { concurrency: 5, deadline });
  }

  // 4. Score everything.
  const scored = [];
  for (const b of kept) {
    const lead = scoreBusiness(b, weights, icp);
    if (lead.track === "low_fit") continue;
    scored.push(lead);
  }

  // 5. Owner enrichment on above-threshold leads with a website.
  const ow = enr.owner ?? {};
  if (ow.enabled && fetchImpl) {
    const targets = scored
      .filter((l) => l.score >= threshold && l.business.website)
      .slice(0, ow.max_sites ?? 10);
    await mapWithBudget(targets, async (l) => {
      l.business.owner = await enrichOwner(l.business.website, {
        fetchImpl, cache, robotsCache, timeoutMs: ow.fetch_timeout_ms ?? 3000, deadline,
      });
    }, { concurrency: 5, deadline });
  }

  // 6. Build display rows.
  const rows = [];
  for (const lead of scored) {
    const b = lead.business;
    const camp = generateCampaign(lead, personal);
    rows.push({
      place_id: b.place_id,
      name: b.name,
      category: b.category.replace(/_/g, " "),
      address: b.address,
      phone: b.phone || "",
      website: b.website || "",
      rating: b.rating,
      review_count: b.review_count,
      score: lead.score,
      track: lead.track,
      bucket: lead.bucket,
      why: lead.why,
      confidence: lead.confidence,
      signals: lead.signals,
      processor: b.processor ?? [],
      owner: b.owner ?? null,
      source: b.source ?? "places",
      campaign: {
        email1_subject: camp.email1_subject,
        email1_body: camp.email1_body,
        email2_subject: camp.email2_subject,
        email2_body: camp.email2_body,
        sms: camp.sms,
        voicemail: camp.voicemail,
      },
    });
  }

  rows.sort((a, b) => b.score - a.score);
  return { rows, chainsFiltered, closedFiltered };
}

export function summarize(rows) {
  return {
    total: rows.length,
    hot: rows.filter((r) => r.bucket === "hot").length,
    warm: rows.filter((r) => r.bucket === "warm").length,
    cold: rows.filter((r) => r.bucket === "cold").length,
    displacement: rows.filter((r) => r.track === "displacement").length,
    greenfield: rows.filter((r) => r.track === "greenfield").length,
  };
}
