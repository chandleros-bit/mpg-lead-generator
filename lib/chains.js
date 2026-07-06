// Pure known-chain detection. No DOM, no config loading — the caller passes the
// brand list. Unit-tested with node --test. Mirrors the lib/research.js pattern.

// Lowercase, drop apostrophes so "McDonald's" == "McDonalds", turn any other
// punctuation run into a single space, then trim.
export function normalizeName(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/['']/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

// True when any brand appears as a whole word/phrase in the business name.
// Pad both the name and each brand with spaces and test for " brand " as a
// substring, so a brand only matches on word boundaries.
export function isChain(name, brands) {
  const norm = normalizeName(name);
  if (!norm || !brands || brands.length === 0) return false;
  const padded = ` ${norm} `;
  for (const brand of brands) {
    const nb = normalizeName(brand);
    if (nb && padded.includes(` ${nb} `)) return true;
  }
  return false;
}

// Bare host of a URL: drop scheme, leading www., and any path/query/hash.
export function normalizeDomain(url) {
  let s = String(url || "").trim().toLowerCase();
  if (!s) return "";
  s = s.replace(/^[a-z]+:\/\//, "").replace(/^www\./, "");
  return s.split(/[/?#]/)[0];
}

// True when the lead's domain equals, or is a subdomain of, any blocked domain.
export function isChainDomain(website, domains) {
  const d = normalizeDomain(website);
  if (!d || !domains || domains.length === 0) return false;
  return domains.some((dom) => {
    const nd = normalizeDomain(dom);
    return nd && (d === nd || d.endsWith(`.${nd}`));
  });
}
