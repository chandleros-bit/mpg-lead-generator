import { scoreBusiness } from "./scoring.js";
import { generateCampaign } from "./campaigns.js";

export function buildLeads(cfg, businesses) {
  const icp = new Set(cfg.search.verticals);
  const personal = cfg.personal;
  const weights = cfg.weights;

  const rows = [];
  for (const b of businesses) {
    const lead = scoreBusiness(b, weights, icp);
    if (lead.track === "low_fit") continue;
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
  return rows;
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
