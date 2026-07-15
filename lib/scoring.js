import { scoredLead } from "./models.js";
import { tierOf } from "./processors.js";

export const FEE_KEYWORDS = ["surcharge", "cash only", "card fee", "adds 3", "card minimum",
  "convenience fee", "fee to use card", "extra to use card"];
export const FRICTION_KEYWORDS = ["card declined", "machine down", "card reader", "terminal",
  "system was down", "couldn't take card", "card wasn't working"];

export const VERTICAL_VOLUME = {
  restaurant: 1.0, bar: 1.0, cafe: 0.9, retail: 0.85,
  auto: 0.75, salon: 0.7, spa: 0.7, professional: 0.6,
};

// Banker's rounding (half to even). Originally here to match Python's round();
// the Python path is gone, but this stays because every score on record was
// computed with it — switching to Math.round would shift results on exact .5
// values for no benefit.
export function pyRound(x) {
  const floor = Math.floor(x);
  const frac = x - floor;
  if (Math.abs(frac - 0.5) < 1e-9) {
    return floor % 2 === 0 ? floor : floor + 1;
  }
  return Math.round(x);
}

export function classifyTrack(b, icp, greenfieldCutoff) {
  if (!icp.has(b.category)) return "low_fit";
  if (b.review_count < greenfieldCutoff) return "greenfield";
  return "displacement";
}

export const DEFAULT_VOLUME_CONFIDENCE = { full_at: 20, half_at: 10 };

// How much we trust a rating, given how many reviews it rests on. The old code
// used a hard cutoff at 20, which made 8–19 a dead zone: a business classifies
// as Displacement at 8+ reviews but earned nothing from the heaviest weight
// until 20, so a genuinely bad salon with 15 reviews was capped near Cold.
//
// Below half_at a rating is one bad night, so it still earns nothing — that part
// of the cliff is deliberate. Between half_at and full_at the signal is real but
// thin, and it's paid at half weight rather than ignored.
export function volumeConfidence(reviewCount, vc = DEFAULT_VOLUME_CONFIDENCE) {
  if (reviewCount >= vc.full_at) return 1.0;
  if (reviewCount >= vc.half_at) return 0.5;
  return 0.0;
}

export function dissatisfactionPoints(rating, reviewCount, wmax, vc = DEFAULT_VOLUME_CONFIDENCE) {
  if (rating === null || rating === undefined || rating > 4.2) return 0;
  const confidence = volumeConfidence(reviewCount, vc);
  if (confidence === 0) return 0;
  const r = Math.max(rating, 3.0);
  const frac = (4.2 - r) / (4.2 - 3.0); // 0 at 4.2, 1 at 3.0
  return pyRound(frac * wmax * confidence);
}

export function keywordPainPoints(reviewTexts, wmax) {
  const text = reviewTexts.join(" ").toLowerCase();
  const groups = { fees: FEE_KEYWORDS, friction: FRICTION_KEYWORDS };
  const hits = Object.keys(groups).filter((g) => groups[g].some((kw) => text.includes(kw)));
  return [Math.min(wmax, hits.length * 6), hits];
}

// Review phrases that corroborate a genuinely absent website. This is the only
// route to "confirmed" available today: when websiteUri is null there is no URL
// to probe, so absence cannot be verified by fetching anything.
export const NO_SITE_KEYWORDS = ["cash only", "call to order", "no website", "call ahead to order"];

export const DEFAULT_WEBSITE_UNKNOWN = { tech_points: 8, setup_gap_factor: 0.5 };

// `website: null` conflates two very different things: "this business has no
// website" and "Places didn't give us one". Places' websiteUri is frequently
// unpopulated for businesses that do have a site, and lib/tabc.js hardcodes it
// to null because the TABC dataset has no website column at all. Treating that
// absence as fact was the single biggest source of invented points.
export function websiteStatus(website, reviewTexts = []) {
  if (website) return "present";
  const text = reviewTexts.join(" ").toLowerCase();
  if (NO_SITE_KEYWORDS.some((k) => text.includes(k))) return "absent_confirmed";
  return "unknown";
}

export function techPoints(website, reviewTexts, wmax, cfg = DEFAULT_WEBSITE_UNKNOWN) {
  const text = reviewTexts.join(" ").toLowerCase();
  const status = websiteStatus(website, reviewTexts);
  let pts = 0;
  if (status === "absent_confirmed") pts += 18;
  else if (status === "unknown") pts += cfg.tech_points;
  if (text.includes("cash only")) pts += 2;
  return Math.min(pts, wmax);
}

export function volumePoints(priceLevel, reviewCount, wmax) {
  const pl = priceLevel === null || priceLevel === undefined ? 1 : priceLevel;
  const pricePts = (pl / 4) * 10;
  const rcPts = Math.min(reviewCount / 200, 1.0) * 10;
  return pyRound(Math.min(pricePts + rcPts, wmax));
}

const TIER_RANK = { card_present: 2, ambiguous: 1, online_checkout: 0 };

// The strongest tier on the site wins: a Clover register plus Stripe gift cards
// is still a card-present target.
function bestProcessor(processors) {
  if (!processors || !processors.length) return null;
  return [...processors].sort((a, b) => TIER_RANK[tierOf(b)] - TIER_RANK[tierOf(a)])[0];
}

// Paid by acceptance channel, not by mere detection. Detecting *a* processor is
// not evidence we can win the account — only a card-present one is.
export function processorPoints(processors, cardPresentMax, ambiguousMax = 0) {
  const top = bestProcessor(processors);
  if (!top) return 0;
  const tier = tierOf(top);
  if (tier === "card_present") return cardPresentMax;
  if (tier === "ambiguous") return ambiguousMax;
  return 0;
}

export function processorChip(processors) {
  const top = bestProcessor(processors);
  if (!top) return null;
  const tier = tierOf(top);
  if (tier === "card_present") return `${top} POS detected — card-present`;
  if (tier === "ambiguous") return `${top} detected — channel unknown`;
  return `${top} on site (online checkout — not our lane)`;
}

export function recencyPoints(reviewCount, greenfieldCutoff, wmax) {
  if (reviewCount >= greenfieldCutoff) return 0;
  return pyRound(((greenfieldCutoff - reviewCount) / greenfieldCutoff) * wmax);
}

export function volumePotentialPoints(vertical, priceLevel, wmax) {
  const base = VERTICAL_VOLUME[vertical] ?? 0.6;
  const pl = (priceLevel === null || priceLevel === undefined ? 1 : priceLevel) / 4;
  return pyRound((0.6 * base + 0.4 * pl) * wmax);
}

export function setupGapPoints(website, reviewTexts, wmax, cfg = DEFAULT_WEBSITE_UNKNOWN) {
  const status = websiteStatus(website, reviewTexts);
  if (status === "present") return pyRound(wmax * 0.3);
  if (status === "unknown") return pyRound(wmax * cfg.setup_gap_factor);
  return wmax; // absent_confirmed
}

function bucketFor(score, buckets) {
  if (score >= buckets.hot) return "hot";
  if (score >= buckets.warm) return "warm";
  return "cold";
}

function label(category) {
  const spaced = category.replace(/_/g, " ");
  return spaced.charAt(0).toUpperCase() + spaced.slice(1).toLowerCase();
}

export function scoreBusiness(b, weights, icp) {
  const cutoff = weights.greenfield_review_cutoff;
  const track = classifyTrack(b, icp, cutoff);
  const why = [];

  if (track === "low_fit") {
    return scoredLead({
      business: b, track, score: 0, bucket: "cold",
      why: [`Low-fit • ${label(b.category)} • outside target verticals`],
    });
  }

  const wu = weights.website_unknown ?? DEFAULT_WEBSITE_UNKNOWN;
  const siteStatus = websiteStatus(b.website, b.review_texts);

  let score;
  if (track === "displacement") {
    const w = weights.displacement;
    const vc = weights.volume_confidence ?? DEFAULT_VOLUME_CONFIDENCE;
    const dis = dissatisfactionPoints(b.rating, b.review_count, w.dissatisfaction_max, vc);
    const [pain, hits] = keywordPainPoints(b.review_texts, w.keyword_pain_max);
    const tech = techPoints(b.website, b.review_texts, w.tech_max, wu);
    const vol = volumePoints(b.price_level, b.review_count, w.volume_max);
    const proc = processorPoints(b.processor, w.processor_max ?? 0, w.processor_ambiguous_max ?? 0);
    score = dis + pain + tech + vol + proc + w.icp_tiebreak;

    why.push(`Displacement • ${label(b.category)}`);
    const pchip = processorChip(b.processor);
    if (pchip) why.push(pchip);
    // Chip whenever the rating actually earned points — never a scoring signal
    // with no stated reason. Half-weight hits say so, so a thin sample doesn't
    // read with the same authority as 200 reviews.
    if (dis > 0) {
      const thin = volumeConfidence(b.review_count, vc) < 1;
      why.push(`rating ${b.rating} on ${b.review_count} reviews${thin ? " (thin sample — half weight)" : ""}`);
    }
    if (hits.includes("fees")) why.push('fee complaints in reviews ("surcharge"/"cash only")');
    if (hits.includes("friction")) why.push("payment-friction complaints in reviews");
    if (siteStatus === "absent_confirmed") why.push("no website — confirmed by reviews");
    else if (siteStatus === "unknown") why.push("no website listed (unconfirmed)");
  } else { // greenfield
    const w = weights.greenfield;
    const rec = recencyPoints(b.review_count, cutoff, w.recency_max);
    const volp = volumePotentialPoints(b.category, b.price_level, w.volume_potential_max);
    const gap = setupGapPoints(b.website, b.review_texts, w.setup_gap_max, wu);
    score = rec + volp + gap + w.icp_tiebreak;

    why.push(`Greenfield • ${label(b.category)}`);
    why.push(`${b.review_count} reviews (new, likely no processor yet)`);
    if (siteStatus === "absent_confirmed") why.push("no website — needs full setup");
    else if (siteStatus === "unknown") why.push("no website listed (unconfirmed)");
  }

  // Doesn't move the score — a temporarily closed business is worth the same
  // once it reopens. It's a "don't dial this today" warning, so it rides along
  // as a chip. CLOSED_PERMANENTLY never reaches scoring; pipeline drops it.
  if (b.business_status === "CLOSED_TEMPORARILY") {
    why.push("temporarily closed — verify before calling");
  }

  score = Math.max(0, Math.min(100, pyRound(score)));
  return scoredLead({ business: b, track, score, bucket: bucketFor(score, weights.buckets), why });
}
