// Pure lead-list ordering. Browser-loaded from public/ (Netlify's publish dir)
// and unit-tested with node --test. No DOM here.

// Best first. Also drives the section dividers in the dashboard.
export const BUCKET_ORDER = ["hot", "warm", "cold"];

const BUCKET_RANK = { hot: 3, warm: 2, cold: 1 };
const CONFIDENCE_RANK = { high: 3, medium: 2, low: 1 };

// Anything unrecognised — a missing field, an older cached payload — ranks below
// every real value rather than above it. An unknown must never jump the queue.
export function bucketRank(bucket) {
  return BUCKET_RANK[bucket] ?? 0;
}

export function confidenceRank(confidence) {
  return CONFIDENCE_RANK[confidence] ?? 0;
}

// Confidence ordering is the alternative to re-tuning the bucket thresholds,
// and it's the better answer to the case this engine kept producing: a
// 72/hot/medium sitting one point above a 71/hot/low. No threshold separates
// those — they're adjacent numbers — but they are not the same lead, and only
// the evidence axis says so.
//
// Bucket still leads. Confidence orders *within* a bucket rather than across
// them, because sorting on evidence alone overshoots: it buries a 71/hot
// greenfield beneath a 25/cold that happens to carry one signal. A brand-new bar
// with no processor is a real opportunity whose evidence bar is inherently low.
// So: work the best opportunities first, and inside each band call the
// corroborated ones before the guesses.
export function sortLeads(leads, mode) {
  const rows = leads.slice();
  rows.sort((a, b) => {
    if (mode === "name") return a.name.localeCompare(b.name);
    if (mode === "confidence") {
      return (
        bucketRank(b.bucket) - bucketRank(a.bucket) ||
        confidenceRank(b.confidence) - confidenceRank(a.confidence) ||
        b.score - a.score
      );
    }
    return b.score - a.score;
  });
  return rows;
}
