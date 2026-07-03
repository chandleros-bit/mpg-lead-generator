// lib/enrich.js
// Best-effort owner/decision-maker enrichment by scraping the lead's own site.
// Pure extraction + a bounded scrape. Surfaces a name/email for MANUAL outreach —
// nothing is ever sent (generate-only boundary preserved).
import { fetchPage } from "./http.js";

const CONTACT_KW = ["about", "team", "meet", "staff", "owner", "contact", "our-story", "ourstory"];
const ROLE_LOCAL = new Set(["info", "support", "contact", "hello", "admin", "sales", "office", "team"]);

export function findContactPage(html, baseUrl) {
  const re = /href\s*=\s*["']([^"']+)["']/gi;
  let m;
  while ((m = re.exec(String(html || "")))) {
    if (CONTACT_KW.some((k) => m[1].toLowerCase().includes(k))) {
      try { return new URL(m[1], baseUrl).href; } catch { /* skip bad href */ }
    }
  }
  return null;
}

export function extractOwner(html) {
  const text = String(html || "");
  const out = { name: null, email: null, title: null, confidence: "low" };

  const mailtos = [...text.matchAll(/mailto:([^"'?>\s]+)/gi)].map((m) => m[1]);
  const bare = [...text.matchAll(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g)].map((m) => m[0]);
  const emails = [...mailtos, ...bare];
  out.email = emails.find((e) => !ROLE_LOCAL.has(e.split("@")[0].toLowerCase())) || emails[0] || null;

  for (const m of text.matchAll(/<script[^>]*application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      const data = JSON.parse(m[1]);
      for (const n of Array.isArray(data) ? data : [data]) {
        const person = n.founder || n.owner || (n["@type"] === "Person" ? n : null);
        if (person && person.name) { out.name = person.name; out.title = "Owner"; out.confidence = "high"; break; }
      }
    } catch { /* ignore malformed JSON-LD */ }
    if (out.name) break;
  }

  if (!out.name) {
    const flat = text.replace(/<[^>]+>/g, " ");
    const a = flat.match(/(?:owner|founder|proprietor)[:\s,–-]+([A-Z][a-z]+\s+[A-Z][a-z]+)/i);
    const b = flat.match(/([A-Z][a-z]+\s+[A-Z][a-z]+)\s*[,–-]\s*(?:owner|founder|proprietor)/i);
    if (a || b) { out.name = (a || b)[1]; out.title = "Owner"; out.confidence = "low"; }
  }
  return out;
}

export async function enrichOwner(website, deps) {
  const { fetchImpl, cache, robotsCache, timeoutMs = 3000, deadline = Infinity } = deps;
  if (!website) return null;
  const home = await fetchPage(website, { fetchImpl, cache, robotsCache, timeoutMs });
  let best = home ? extractOwner(home) : { name: null, email: null, title: null, confidence: "low" };

  if ((!best.name || !best.email) && home && Date.now() < deadline) {
    const contact = findContactPage(home, website);
    if (contact && contact !== website) {
      const chtml = await fetchPage(contact, { fetchImpl, cache, robotsCache, timeoutMs });
      if (chtml) {
        const more = extractOwner(chtml);
        best = {
          name: best.name || more.name,
          email: best.email || more.email,
          title: best.title || more.title,
          confidence: best.confidence === "high" || more.confidence === "high" ? "high" : "low",
        };
      }
    }
  }
  return best.name || best.email ? best : null;
}
