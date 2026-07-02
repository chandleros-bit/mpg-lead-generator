// Pure builder for the "Who to ask for" research links. Browser-loaded from
// public/ (Netlify's publish dir) and unit-tested with node --test. No DOM here.
const COMPTROLLER_URL = "https://mycpa.cpa.state.tx.us/coa/";

export function buildResearchLinks(lead) {
  const name = lead.name || "";
  const address = lead.address || "";
  const links = [];

  // Google Business — deep-link straight to the Maps listing (reviews + owner
  // replies). Include the exact listing via place_id when we have it.
  const mapsQuery = encodeURIComponent(`${name} ${address}`.trim());
  let mapsHref = `https://www.google.com/maps/search/?api=1&query=${mapsQuery}`;
  if (lead.place_id) {
    mapsHref += `&query_place_id=${encodeURIComponent(lead.place_id)}`;
  }
  links.push({ label: "Google Business", href: mapsHref });

  // Website — direct link to the site (About / Meet the Owner). Omit when none.
  if (lead.website) {
    links.push({ label: "Website", href: lead.website });
  }

  // LinkedIn — Google search scoped to linkedin.com (avoids LinkedIn's login wall).
  const liQuery = encodeURIComponent(`site:linkedin.com "${name}" (owner OR founder OR "general manager")`);
  links.push({ label: "LinkedIn", href: `https://www.google.com/search?q=${liQuery}` });

  // TX Comptroller — Taxable Entity Search. The page is a POST form and cannot be
  // pre-filled via URL, so the click handler copies the name to the clipboard.
  links.push({ label: "TX Comptroller", href: COMPTROLLER_URL, copyName: name });

  return links;
}
