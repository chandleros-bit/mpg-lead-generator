// test/processors.test.js
import test from "node:test";
import assert from "node:assert/strict";
import { detectProcessors, discoverCheckoutUrl, detectSiteProcessors } from "../lib/processors.js";

function resp(text, ok = true) { return { ok, text: async () => text }; }

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
