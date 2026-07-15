import { business } from "../lib/models.js";

export const ICP = new Set(["restaurant", "bar", "cafe", "retail", "salon", "spa", "auto", "professional"]);

export const WEIGHTS = {
  displacement: { dissatisfaction_max: 35, keyword_pain_max: 12, tech_max: 20, volume_max: 20, processor_max: 25, processor_ambiguous_max: 10, icp_tiebreak: 3 },
  greenfield: { recency_max: 40, volume_potential_max: 30, setup_gap_max: 27, icp_tiebreak: 3 },
  website_unknown: { tech_points: 8, setup_gap_factor: 0.5 },
  volume_confidence: { full_at: 20, half_at: 10 },
  buckets: { hot: 70, warm: 40 },
  greenfield_review_cutoff: 8,
};

export const PERSONAL = {
  name: "Chandler Atkinson",
  company: "Media Payments Group",
  callback_number: "(555) 555-5555",
  email: "c@mpg.com",
  canspam_footer: { business_address: "1 St, Cypress TX", optout_line: "Reply STOP to opt out." },
};

export const CFG = { search: { verticals: [...ICP] }, personal: PERSONAL, weights: WEIGHTS };

export function makeBusiness(kw = {}) {
  return business({
    place_id: "p1", name: "Test Co", category: "restaurant", address: "1 Main St",
    phone: null, website: null, rating: null, review_count: 0,
    price_level: null, business_status: "OPERATIONAL", review_texts: [],
    ...kw,
  });
}
