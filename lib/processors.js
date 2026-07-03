// lib/processors.js
// Pure processor/POS fingerprint detection + a bounded site scrape. Fingerprints
// are payment-SDK/domain strings (far more reliable than visible badges).
import { fetchPage } from "./http.js";

export const PROCESSOR_SIGNATURES = {
  Square: ["squareup.com", "web.squarecdn.com", "square-marketplace"],
  Clover: ["clover.com", "clover.js"],
  Toast: ["toasttab.com"],
  Stripe: ["js.stripe.com", "stripe.com/v3", "checkout.stripe.com"],
  Clearent: ["clearent"],
  "Shopify Payments": ["cdn.shopify.com", "shopify.com/payments", "shop_pay"],
  PayPal: ["paypal.com/sdk", "paypalobjects.com"],
  Aloha: ["alohaenterprise", "ncrcloud"],
};

export function detectProcessors(html, signatures = PROCESSOR_SIGNATURES) {
  const text = String(html || "").toLowerCase();
  const found = [];
  for (const [name, sigs] of Object.entries(signatures)) {
    if (sigs.some((s) => text.includes(s.toLowerCase()))) found.push(name);
  }
  return found;
}

export function discoverCheckoutUrl(html, baseUrl) {
  const kw = ["order", "checkout", "menu", "toasttab.com", "clover.com"];
  const re = /href\s*=\s*["']([^"']+)["']/gi;
  let m;
  while ((m = re.exec(String(html || "")))) {
    if (kw.some((k) => m[1].toLowerCase().includes(k))) {
      try { return new URL(m[1], baseUrl).href; } catch { /* skip bad href */ }
    }
  }
  return null;
}

export async function detectSiteProcessors(website, deps) {
  const { fetchImpl, cache, robotsCache, timeoutMs = 3000, checkCheckout = true, deadline = Infinity } = deps;
  if (!website) return [];
  const html = await fetchPage(website, { fetchImpl, cache, robotsCache, timeoutMs });
  if (!html) return [];
  const found = new Set(detectProcessors(html));
  if (checkCheckout && Date.now() < deadline) {
    const checkoutUrl = discoverCheckoutUrl(html, website);
    if (checkoutUrl && checkoutUrl !== website) {
      const chtml = await fetchPage(checkoutUrl, { fetchImpl, cache, robotsCache, timeoutMs });
      for (const p of detectProcessors(chtml)) found.add(p);
    }
  }
  return [...found];
}
