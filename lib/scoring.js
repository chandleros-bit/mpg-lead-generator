import { scoredLead } from "./models.js";

export const FEE_KEYWORDS = ["surcharge", "cash only", "card fee", "adds 3", "card minimum",
  "convenience fee", "fee to use card", "extra to use card"];
export const FRICTION_KEYWORDS = ["card declined", "machine down", "card reader", "terminal",
  "system was down", "couldn't take card", "card wasn't working"];

export const VERTICAL_VOLUME = {
  restaurant: 1.0, bar: 1.0, cafe: 0.9, retail: 0.85,
  auto: 0.75, salon: 0.7, spa: 0.7, professional: 0.6,
};

// Match Python's round() (banker's rounding: half to even). JS Math.round rounds
// half toward +Infinity, which would diverge on exact .5 values.
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

export function dissatisfactionPoints(rating, reviewCount, wmax) {
  if (rating === null || rating === undefined || reviewCount < 20 || rating > 4.2) return 0;
  const r = Math.max(rating, 3.0);
  const frac = (4.2 - r) / (4.2 - 3.0); // 0 at 4.2, 1 at 3.0
  return pyRound(frac * wmax);
}

export function keywordPainPoints(reviewTexts, wmax) {
  const text = reviewTexts.join(" ").toLowerCase();
  const groups = { fees: FEE_KEYWORDS, friction: FRICTION_KEYWORDS };
  const hits = Object.keys(groups).filter((g) => groups[g].some((kw) => text.includes(kw)));
  return [Math.min(wmax, hits.length * 6), hits];
}

export function techPoints(website, reviewTexts, wmax) {
  const text = reviewTexts.join(" ").toLowerCase();
  let pts = 0;
  if (!website) pts += 18;
  if (text.includes("cash only")) pts += 2;
  return Math.min(pts, wmax);
}

export function volumePoints(priceLevel, reviewCount, wmax) {
  const pl = priceLevel === null || priceLevel === undefined ? 1 : priceLevel;
  const pricePts = (pl / 4) * 10;
  const rcPts = Math.min(reviewCount / 200, 1.0) * 10;
  return pyRound(Math.min(pricePts + rcPts, wmax));
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

export function setupGapPoints(website, wmax) {
  return website ? pyRound(wmax * 0.3) : wmax;
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

  let score;
  if (track === "displacement") {
    const w = weights.displacement;
    const dis = dissatisfactionPoints(b.rating, b.review_count, w.dissatisfaction_max);
    const [pain, hits] = keywordPainPoints(b.review_texts, w.keyword_pain_max);
    const tech = techPoints(b.website, b.review_texts, w.tech_max);
    const vol = volumePoints(b.price_level, b.review_count, w.volume_max);
    score = dis + pain + tech + vol + w.icp_tiebreak;

    why.push(`Displacement • ${label(b.category)}`);
    if (b.rating !== null && b.rating !== undefined && b.review_count >= 20) {
      why.push(`rating ${b.rating} on ${b.review_count} reviews`);
    }
    if (hits.includes("fees")) why.push('fee complaints in reviews ("surcharge"/"cash only")');
    if (hits.includes("friction")) why.push("payment-friction complaints in reviews");
    if (!b.website) why.push("no website");
  } else { // greenfield
    const w = weights.greenfield;
    const rec = recencyPoints(b.review_count, cutoff, w.recency_max);
    const volp = volumePotentialPoints(b.category, b.price_level, w.volume_potential_max);
    const gap = setupGapPoints(b.website, w.setup_gap_max);
    score = rec + volp + gap + w.icp_tiebreak;

    why.push(`Greenfield • ${label(b.category)}`);
    why.push(`${b.review_count} reviews (new, likely no processor yet)`);
    if (!b.website) why.push("no website — needs full setup");
  }

  score = Math.max(0, Math.min(100, pyRound(score)));
  return scoredLead({ business: b, track, score, bucket: bucketFor(score, weights.buckets), why });
}
