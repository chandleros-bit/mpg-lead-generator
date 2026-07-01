// Plain-object factories mirroring the Python dataclasses. Uses `??` (not `||`)
// so that falsy-but-valid values like price_level 0 survive.
export function business(o) {
  return {
    place_id: o.place_id,
    name: o.name,
    category: o.category,
    address: o.address,
    phone: o.phone ?? null,
    website: o.website ?? null,
    rating: o.rating ?? null,
    review_count: o.review_count ?? 0,
    price_level: o.price_level ?? null,
    business_status: o.business_status ?? "",
    review_texts: o.review_texts ?? [],
  };
}

export function scoredLead(o) {
  return {
    business: o.business,
    track: o.track,
    score: o.score,
    bucket: o.bucket,
    why: o.why ?? [],
  };
}
