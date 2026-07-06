// lib/tabc.js
// Recently issued TABC (alcohol) licenses as a "new establishment, no processor
// yet" greenfield source. Pure parse + injectable fetch. NOTE: the Socrata
// dataset id and column names are best-known-but-UNVERIFIED and must be checked
// against a live payload before production use; tests are fixture-based.
import { business } from "./models.js";

export const DEFAULT_DATASET = "naix-2893"; // TABC License Information — VERIFY

export function tabcUrl({ dataset = DEFAULT_DATASET, counties, sinceDays }) {
  const since = new Date(Date.now() - sinceDays * 86400000).toISOString().slice(0, 10);
  const inList = counties.map((c) => `'${String(c).toUpperCase()}'`).join(",");
  const where = `license_issue_date >= '${since}' AND upper(location_county) in (${inList})`;
  return `https://data.texas.gov/resource/${dataset}.json?$where=${encodeURIComponent(where)}&$limit=1000`;
}

function categoryFor(licenseType) {
  const t = String(licenseType || "").toLowerCase();
  return /beer|wine|mixed|bar|beverage/.test(t) ? "bar" : "restaurant";
}

export function parseTabcRows(rows) {
  if (!Array.isArray(rows)) return [];
  const out = [];
  for (const r of rows) {
    const name = r.trade_name || r.location_name || r.owner_name || "";
    if (!name) continue;
    const address = [r.location_address, r.location_city, "TX", r.location_zip].filter(Boolean).join(", ");
    out.push(business({
      place_id: `tabc:${r.license_number || r.taxpayer_number || name}`,
      name,
      category: categoryFor(r.license_type || r.permit_type),
      address,
      phone: r.location_phone || null,
      website: null,
      rating: null,
      review_count: 0,
      price_level: null,
      business_status: "OPERATIONAL",
      review_texts: [],
      source: "tabc",
      licensed_on: r.license_issue_date || null,
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
