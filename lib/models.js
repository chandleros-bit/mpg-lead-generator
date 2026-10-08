// Plain-object factories mirroring the Python dataclasses. Uses `??` (not `||`)
// so that falsy-but-valid values like price_level 0 survive.
export function business(o) {
  return {
    place_id: o.place_id,
    name: o.name,
    category: o.category,
    // The raw Google primaryType, kept alongside the normalized category so a
    // Text Search result can be checked against the vertical it was searched
    // under. Nearby Search is type-constrained by the API; Text Search is not,
    // so without this a "brake shop" query could tag a car dealer as in-ICP.
    primary_type: o.primary_type ?? null,
    address: o.address,
    phone: o.phone ?? null,
    website: o.website ?? null,
    rating: o.rating ?? null,
    review_count: o.review_count ?? 0,
    price_level: o.price_level ?? null,
    business_status: o.business_status ?? "",
    review_texts: o.review_texts ?? [],
    source: o.source ?? "places",
    // Which specialty Text Search phrase surfaced this shop, when one did.
    // Worth carrying: "transmission repair shop" and "tire and lube shop" are
    // not the same lead even at the same score.
    matched_query: o.matched_query ?? null,
    licensed_on: o.licensed_on ?? null,
    processor: o.processor ?? [],
    // Customer-financing widgets found on the site. Ticket-size evidence, kept
    // apart from processor so it never earns processor points.
    financing: o.financing ?? [],
    owner: o.owner ?? null,
  };
}

export function scoredLead(o) {
  return {
    business: o.business,
    track: o.track,
    score: o.score,
    bucket: o.bucket,
    why: o.why ?? [],
    // The independent evidence behind the score, and how much of it to believe.
    // Orthogonal to score: a Hot lead can be Low confidence.
    signals: o.signals ?? [],
    confidence: o.confidence ?? "low",
  };
}
