// lib/processors.js
// Pure processor/POS fingerprint detection + a bounded site scrape. Fingerprints
// are payment-SDK/domain strings (far more reliable than visible badges).
import { fetchPage } from "./http.js";
import { VERTICAL_SOFTWARE, FINANCING } from "./verticals/index.js";

// Signatures are grouped by ACCEPTANCE CHANNEL, because that is what the pitch
// turns on. We sell card-present processing. A payment SDK on a website is only
// evidence about the terminal at the register for some of these.

// In-store POS platforms. Their presence on a site means a real register.
export const CARD_PRESENT = {
  Clover: ["clover.com", "clover.js"],
  Toast: ["toasttab.com"],
  Aloha: ["alohaenterprise", "ncrcloud"],
  Clearent: ["clearent"],
};

// Sells both channels, and the fingerprint cannot tell which. Square's SMB base
// leans heavily on the Square register, but squareup.com also fires on Square
// Online. Partial credit is the honest answer: full points would invent evidence,
// zero would discard a genuinely useful lead.
export const AMBIGUOUS = {
  Square: ["squareup.com", "web.squarecdn.com", "square-marketplace"],
};

// Online checkout. Tells us nothing about what's at the register — a restaurant
// running Stripe for online gift cards may well have a Clover on the counter.
// cdn.shopify.com fires on every Shopify storefront and only proves they sell
// online; Shopify POS is invisible from the front end.
export const ONLINE_CHECKOUT = {
  Stripe: ["js.stripe.com", "stripe.com/v3", "checkout.stripe.com"],
  PayPal: ["paypal.com/sdk", "paypalobjects.com"],
  "Shopify Payments": ["cdn.shopify.com", "shopify.com/payments", "shop_pay"],
};

// Vertical management platforms that bundle their own payments: Tekmetric for
// a repair shop, Boulevard for a med spa, ServiceTitan for an HVAC company.
// Stronger than a bare card-present hit, and the reason is commercial rather
// than technical: a business on one of these took the processor that came with
// the software. It was never quoted against anything, so there is usually no
// incumbent relationship to displace, only a default to replace. That makes
// these the highest-intent fingerprint we can see from outside.
//
// Each vertical pack declares its own platforms (lib/verticals/*.js). The name
// SHOP_MANAGEMENT predates packs and is kept so existing callers still work.
export const SHOP_MANAGEMENT = VERTICAL_SOFTWARE;

// Customer-financing widgets (CareCredit, Cherry, GreenSky, Wisetack). Not a
// processor and worth zero processor points. They are proof the business
// writes tickets big enough that customers finance them, which scoring reads
// as a high-ticket signal.
export { FINANCING };

// Merged view — detection is tier-agnostic; only scoring cares about the tier.
export const PROCESSOR_SIGNATURES = {
  ...CARD_PRESENT, ...AMBIGUOUS, ...ONLINE_CHECKOUT, ...SHOP_MANAGEMENT, ...FINANCING,
};

const TIER_BY_NAME = new Map([
  ...Object.keys(CARD_PRESENT).map((n) => [n, "card_present"]),
  ...Object.keys(AMBIGUOUS).map((n) => [n, "ambiguous"]),
  ...Object.keys(ONLINE_CHECKOUT).map((n) => [n, "online_checkout"]),
  ...Object.keys(SHOP_MANAGEMENT).map((n) => [n, "integrated_software"]),
  ...Object.keys(FINANCING).map((n) => [n, "financing"]),
]);

// True when a detected name is a management platform rather than a processor.
// Copy generation reads this: naming the platform in an email is specific and
// credible, naming a processor we merely fingerprinted is a guess out loud.
export function isShopManagement(name) {
  return Object.prototype.hasOwnProperty.call(SHOP_MANAGEMENT, name);
}

export function isFinancing(name) {
  return Object.prototype.hasOwnProperty.call(FINANCING, name);
}

// Split a detection list into the processors scoring weighs and the financing
// widgets it reads as ticket-size evidence.
export function splitDetections(names) {
  const list = names || [];
  return {
    processors: list.filter((n) => !isFinancing(n)),
    financing: list.filter((n) => isFinancing(n)),
  };
}

// Unknown names fall back to online_checkout (zero points) rather than earning
// card-present weight by default: a signature added without a tier should
// under-claim, not over-claim.
export function tierOf(name) {
  return TIER_BY_NAME.get(name) ?? "online_checkout";
}

export function detectProcessors(html, signatures = PROCESSOR_SIGNATURES) {
  const text = String(html || "").toLowerCase();
  const found = [];
  for (const [name, sigs] of Object.entries(signatures)) {
    if (sigs.some((s) => text.includes(s.toLowerCase()))) found.push(name);
  }
  return found;
}

// pathKeywords come from the vertical pack. Service businesses take money on a
// booking or payment page, not an order page. They are matched against the
// link's PATH only, because "book" anywhere in an href also hits facebook.com.
export function discoverCheckoutUrl(html, baseUrl, pathKeywords = []) {
  const kw = ["order", "checkout", "menu", "toasttab.com", "clover.com"];
  const re = /href\s*=\s*["']([^"']+)["']/gi;
  let m;
  while ((m = re.exec(String(html || "")))) {
    const href = m[1].toLowerCase();
    if (kw.some((k) => href.includes(k))) {
      try { return new URL(m[1], baseUrl).href; } catch { /* skip bad href */ }
    }
    if (pathKeywords.length) {
      let u;
      try { u = new URL(m[1], baseUrl); } catch { continue; }
      const path = u.pathname.toLowerCase();
      if (pathKeywords.some((k) => path.includes(k))) return u.href;
    }
  }
  return null;
}

export async function detectSiteProcessors(website, deps) {
  const { fetchImpl, cache, robotsCache, timeoutMs = 3000, checkCheckout = true, deadline = Infinity,
    checkoutKeywords = [] } = deps;
  if (!website) return [];
  const html = await fetchPage(website, { fetchImpl, cache, robotsCache, timeoutMs });
  if (!html) return [];
  const found = new Set(detectProcessors(html));
  if (checkCheckout && Date.now() < deadline) {
    const checkoutUrl = discoverCheckoutUrl(html, website, checkoutKeywords);
    if (checkoutUrl && checkoutUrl !== website) {
      const chtml = await fetchPage(checkoutUrl, { fetchImpl, cache, robotsCache, timeoutMs });
      for (const p of detectProcessors(chtml)) found.add(p);
    }
  }
  return [...found];
}
