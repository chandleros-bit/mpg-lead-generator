// lib/tabc.js
// Recently issued TABC (alcohol) licenses as a "new establishment, no processor
// yet" greenfield source. Pure parse + injectable fetch.
//
// Dataset + fields verified 2026-07-06 against the live SODA API:
//   https://data.texas.gov/resource/7hf9-qc9f.json  ("TABC License Information")
// Real columns used: trade_name, owner, license_type, license_id, address, city,
// state, zip, county, current_issued_date. (There is no phone column.)
import { business } from "./models.js";

export const DEFAULT_DATASET = "7hf9-qc9f"; // TABC License Information

export function tabcUrl({ dataset = DEFAULT_DATASET, counties, sinceDays }) {
  const since = new Date(Date.now() - sinceDays * 86400000).toISOString().slice(0, 10);
  const inList = counties.map((c) => `'${String(c).toUpperCase()}'`).join(",");
  const where = `current_issued_date >= '${since}' AND upper(county) in (${inList})`;
  return `https://data.texas.gov/resource/${dataset}.json?$where=${encodeURIComponent(where)}&$limit=1000`;
}

// TABC license-type codes → ICP category. Only ON-PREMISE consumption permits
// (real bars/restaurants) are kept. Off-premise retail codes (BQ, Q, package
// stores, etc.) are convenience/grocery/liquor stores — not ICP — and are
// dropped by returning null. BG is on/off-premise and mostly restaurants, though
// it can include some retailers (accepted false-positive; the user reviews leads).
const TABC_CATEGORY = {
  MB: "bar", // Mixed Beverage Permit (on-premise, spirits)
  BE: "bar", // Retail Dealer's On-Premise License (malt beverages)
  RM: "restaurant", // Mixed Beverage Restaurant Permit
  BG: "restaurant", // Wine and Malt Beverage Retailer's Permit (on/off-premise)
};

function categoryFor(licenseType) {
  const code = String(licenseType || "").trim().toUpperCase();
  return TABC_CATEGORY[code] ?? null; // null → not ICP, skip the row
}

export function parseTabcRows(rows) {
  if (!Array.isArray(rows)) return [];
  const out = [];
  for (const r of rows) {
    const name = r.trade_name || r.owner || "";
    if (!name) continue;
    const category = categoryFor(r.license_type);
    if (!category) continue; // off-premise / non-ICP license type
    const zip = String(r.zip || "").slice(0, 5); // real ZIPs may be ZIP+4
    const address = [r.address, r.city, r.state || "TX", zip].filter(Boolean).join(", ");
    out.push(business({
      place_id: `tabc:${r.license_id || name}`,
      name,
      category,
      address,
      phone: null,
      website: null,
      rating: null,
      review_count: 0,
      price_level: null,
      business_status: "OPERATIONAL",
      review_texts: [],
      source: "tabc",
      licensed_on: String(r.current_issued_date || "").slice(0, 10) || null,
    }));
  }
  return out;
}

export async function fetchTabcNew({ counties, sinceDays, appToken, fetchImpl = fetch } = {}) {
  if (!counties || !counties.length) return [];
  try {
    const headers = appToken ? { "X-App-Token": appToken } : {};
    const resp = await fetchImpl(tabcUrl({ counties, sinceDays }), { headers });
    if (!resp || !resp.ok) return [];
    return parseTabcRows(await resp.json());
  } catch {
    return [];
  }
}
