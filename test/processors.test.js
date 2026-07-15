// test/processors.test.js
import test from "node:test";
import assert from "node:assert/strict";
import {
  detectProcessors, discoverCheckoutUrl, detectSiteProcessors,
  tierOf, PROCESSOR_SIGNATURES, CARD_PRESENT, AMBIGUOUS, ONLINE_CHECKOUT,
} from "../lib/processors.js";

function resp(text, ok = true) { return { ok, text: async () => text }; }

// ---------- acceptance-channel tiers ----------

test("every known signature has exactly one tier", () => {
  const names = Object.keys(PROCESSOR_SIGNATURES);
  assert.equal(names.length, 8, "8 known processors");
  for (const n of names) {
    const inGroups = [CARD_PRESENT, AMBIGUOUS, ONLINE_CHECKOUT].filter((g) => n in g);
    assert.equal(inGroups.length, 1, `${n} must belong to exactly one tier group`);
  }
});

test("tierOf classifies each known processor", () => {
  // Card-present: in-store POS. Real evidence about the register we're competing for.
  assert.equal(tierOf("Clover"), "card_present");
  assert.equal(tierOf("Toast"), "card_present");
  assert.equal(tierOf("Aloha"), "card_present");
  assert.equal(tierOf("Clearent"), "card_present");
  // Square sells both channels and the fingerprint can't tell them apart.
  assert.equal(tierOf("Square"), "ambiguous");
  // Online checkout: says nothing about the terminal at the register.
  assert.equal(tierOf("Stripe"), "online_checkout");
  assert.equal(tierOf("PayPal"), "online_checkout");
  assert.equal(tierOf("Shopify Payments"), "online_checkout");
});

test("tierOf fails safe on an unknown processor", () => {
  // A new signature added without a tier must not silently earn card-present
  // points. No points for evidence we don't have.
  assert.equal(tierOf("Some New Gateway"), "online_checkout");
});

test("detectProcessors finds Square by SDK domain", () => {
  assert.deepEqual(detectProcessors('<script src="https://web.squarecdn.com/v1/square.js"></script>'), ["Square"]);
});

test("detectProcessors finds Stripe by js.stripe.com", () => {
  assert.deepEqual(detectProcessors('<script src="https://js.stripe.com/v3"></script>'), ["Stripe"]);
});

test("detectProcessors returns [] when nothing matches", () => {
  assert.deepEqual(detectProcessors("<html>just a menu</html>"), []);
});

test("detectProcessors can find multiple processors", () => {
  const html = 'link to toasttab.com and js.stripe.com';
  assert.deepEqual(new Set(detectProcessors(html)), new Set(["Toast", "Stripe"]));
});

test("discoverCheckoutUrl resolves a relative order link", () => {
  const html = '<a href="/order-online">Order</a>';
  assert.equal(discoverCheckoutUrl(html, "https://joes.com"), "https://joes.com/order-online");
});

test("discoverCheckoutUrl returns null with no candidate", () => {
  assert.equal(discoverCheckoutUrl('<a href="/gallery">Photos</a>', "https://joes.com"), null);
});

test("detectSiteProcessors reads homepage then checkout page via cache", async () => {
  const cache = new Map(), robotsCache = new Map();
  const fetchImpl = async (url) => {
    if (url.endsWith("/robots.txt")) return resp("");
    if (url === "https://joes.com/") return resp('<a href="/order">Order</a>');
    if (url === "https://joes.com/order") return resp('<script src="https://clover.com/x.js">');
    return resp("");
  };
  const found = await detectSiteProcessors("https://joes.com/", { fetchImpl, cache, robotsCache, deadline: Infinity });
  assert.deepEqual(found, ["Clover"]);
});

test("detectSiteProcessors returns [] when the site is unreachable", async () => {
  const found = await detectSiteProcessors("https://down.com/", {
    fetchImpl: async () => { throw new Error("dead"); }, cache: new Map(), robotsCache: new Map(),
  });
  assert.deepEqual(found, []);
});
