// lib/verticals/index.js
// The vertical registry. Every niche the generator can hunt is one pack file in
// this folder; the engine (fetcher, scoring, processors, campaigns, pipeline)
// reads niche knowledge from here and holds none of its own. Adding a niche is
// adding a file and listing it below.
//
// Pack fields (all optional except id and label):
//   noun                  "dental practice": how copy refers to one of them
//   search.place_types    Google Table A types for Nearby Search. Empty means
//                         the niche has no Google type and is text-search only.
//   search.text_queries   Text Search phrasings, roughly highest ticket first
//   search.name_keywords  For niches Google cannot type: a Text Search result
//                         is kept only when its name carries one of these
//   search.reject_types   primaryTypes that disqualify a result outright
//   search.require_name_match  apply name_keywords to Nearby results too
//   exclude_chains        brand names dropped before enrichment
//   software              { Name: [signature, ...] } management platforms that
//                         bundle payments. Scored as integrated_software.
//   software_chip         how the lead card names that software
//   checkout_keywords     URL path words for the booking/payment page to scan
//   financing             { Name: [signature, ...] } customer-financing widgets.
//                         Proof of big tickets, not of a processor.
//   high_ticket_keywords  name/review words that mark bigger tickets ("x*" = prefix)
//   labor_rate            read posted hourly rates from reviews (auto only)
//   scoring_profile       name of a weights.displacement_profiles entry
//   volume                0..1 greenfield volume potential
//   decision_makers       who to ask for, in order
//   copy                  { ticket_label, ticket_example, customer, ... } for
//                         the shared high-ticket copy builder in campaigns.js

import autoRepair from "./auto_repair.js";
import dentist from "./dentist.js";
import medSpa from "./med_spa.js";
import hvac from "./hvac.js";
import remodeling from "./remodeling.js";
import pestControl from "./pest_control.js";
import { LEGACY_PACKS } from "./legacy.js";

const FEATURED = [autoRepair, dentist, medSpa, hvac, remodeling, pestControl];

function normalize(p) {
  const s = p.search ?? {};
  return {
    id: p.id,
    label: p.label,
    noun: p.noun ?? "business",
    search: {
      place_types: s.place_types ?? [],
      text_queries: s.text_queries ?? [],
      name_keywords: s.name_keywords ?? [],
      reject_types: s.reject_types ?? [],
      require_name_match: s.require_name_match ?? false,
    },
    exclude_chains: p.exclude_chains ?? [],
    exclude_domains: p.exclude_domains ?? [],
    software: p.software ?? {},
    software_chip: p.software_chip ?? "management software",
    checkout_keywords: p.checkout_keywords ?? [],
    financing: p.financing ?? {},
    high_ticket_keywords: p.high_ticket_keywords ?? [],
    labor_rate: p.labor_rate ?? false,
    scoring_profile: p.scoring_profile ?? null,
    volume: p.volume ?? 0.6,
    decision_makers: p.decision_makers ?? ["Owner"],
    copy: p.copy ?? null,
    featured: p.featured ?? false,
  };
}

// Featured packs are the deep ones (specialty search, fingerprints, copy) and
// lead the dashboard picker. Legacy packs follow.
const PACKS = FEATURED
  .map((p) => normalize({ ...p, featured: true }))
  .concat(LEGACY_PACKS.map(normalize));

export const VERTICALS = Object.freeze(Object.fromEntries(PACKS.map((p) => [p.id, p])));

export function getVertical(id) {
  return VERTICALS[id] ?? null;
}

export function verticalIds() {
  return PACKS.map((p) => p.id);
}

// What the dashboard picker needs, and nothing it doesn't.
export function listVerticals() {
  return PACKS.map((p) => ({ id: p.id, label: p.label, featured: p.featured }));
}

// Problems with a pack, as strings. Empty means valid. Tested over every pack
// so a malformed file fails the suite rather than a live search.
export function validatePack(p) {
  const errs = [];
  if (!p.id || !/^[a-z_]+$/.test(p.id)) errs.push("id must be lower_snake_case");
  if (!p.label) errs.push("label is required");
  const s = p.search;
  if (!s.place_types.length && !s.text_queries.length) {
    errs.push("needs place_types or text_queries");
  }
  // A text-only niche has no Google type to verify against, so its name
  // keywords are the only thing standing between a query and a wrong lead.
  if (!s.place_types.length && !s.name_keywords.length) {
    errs.push("text-only niche needs name_keywords");
  }
  if (s.require_name_match && !s.name_keywords.length) {
    errs.push("require_name_match needs name_keywords");
  }
  if (!(p.volume >= 0 && p.volume <= 1)) errs.push("volume must be 0..1");
  // "*" only works as a trailing prefix marker; anywhere else it is a literal.
  const kws = [...s.name_keywords, ...p.high_ticket_keywords];
  for (const k of kws) if (k.slice(0, -1).includes("*")) errs.push(`"${k}": * only at the end`);
  if (p.featured && !p.copy && p.id !== "auto_repair") errs.push("featured pack needs copy");
  return errs;
}

// Union of every pack's map for one field, signatures merged and deduped when
// two packs name the same platform (ServiceTitan runs HVAC and pest shops).
function mergeMaps(field) {
  const out = {};
  for (const p of PACKS) {
    for (const [name, sigs] of Object.entries(p[field])) {
      out[name] = [...new Set([...(out[name] ?? []), ...sigs])];
    }
  }
  return out;
}

export const VERTICAL_SOFTWARE = Object.freeze(mergeMaps("software"));
export const FINANCING = Object.freeze(mergeMaps("financing"));

// Chains and domains to drop for a run: the global config list plus every
// selected pack's own.
export function exclusionsFor(verticals, cfgSearch = {}) {
  const brands = new Set(cfgSearch.exclude_chains ?? []);
  const domains = new Set(cfgSearch.exclude_domains ?? []);
  for (const id of verticals) {
    const p = getVertical(id);
    if (!p) continue;
    p.exclude_chains.forEach((b) => brands.add(b));
    p.exclude_domains.forEach((d) => domains.add(d));
  }
  return { brands: [...brands], domains: [...domains] };
}
