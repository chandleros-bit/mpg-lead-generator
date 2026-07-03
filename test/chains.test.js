import test from "node:test";
import assert from "node:assert/strict";
import { isChain, normalizeName } from "../lib/chains.js";

const BRANDS = ["Starbucks", "Great Clips", "McDonald's", "Jiffy Lube"];

test("normalizeName lowercases, drops apostrophes, and spaces punctuation", () => {
  assert.equal(normalizeName("McDonald's"), "mcdonalds");
  assert.equal(normalizeName("Great  Clips!"), "great clips");
  assert.equal(normalizeName("Chili's-Bar & Grill"), "chilis bar grill");
  assert.equal(normalizeName(""), "");
  assert.equal(normalizeName(null), "");
});

test("isChain matches a brand as a whole word in the business name", () => {
  assert.equal(isChain("Starbucks Coffee #1234", BRANDS), true);
});

test("isChain is case-insensitive", () => {
  assert.equal(isChain("STARBUCKS on Main", BRANDS), true);
});

test("isChain matches across apostrophe/punctuation differences", () => {
  assert.equal(isChain("McDonalds", BRANDS), true);
  assert.equal(isChain("Dunkin' Donuts", ["Dunkin Donuts"]), true);
});

test("isChain matches a multi-word brand", () => {
  assert.equal(isChain("Great Clips of Cypress", BRANDS), true);
});

test("isChain does not match a brand inside a longer word", () => {
  assert.equal(isChain("Supersonic Car Wash", ["Sonic"]), false);
  assert.equal(isChain("Subs & Such Deli", ["Subway"]), false);
});

test("isChain returns false for an independent business", () => {
  assert.equal(isChain("Bayou City Nail Bar", BRANDS), false);
});

test("isChain returns false for empty brand list or empty name", () => {
  assert.equal(isChain("Starbucks", []), false);
  assert.equal(isChain("", BRANDS), false);
  assert.equal(isChain(null, BRANDS), false);
});

import { normalizeDomain, isChainDomain } from "../lib/chains.js";

test("normalizeDomain strips scheme, www, and path", () => {
  assert.equal(normalizeDomain("https://www.Loves.com/stores/123"), "loves.com");
  assert.equal(normalizeDomain("http://order.toasttab.com"), "order.toasttab.com");
  assert.equal(normalizeDomain(""), "");
  assert.equal(normalizeDomain(null), "");
});

test("isChainDomain matches exact domain and subdomains", () => {
  const domains = ["loves.com"];
  assert.equal(isChainDomain("https://www.loves.com", domains), true);
  assert.equal(isChainDomain("https://stores.loves.com/tx", domains), true);
  assert.equal(isChainDomain("https://joestacos.com", domains), false);
});

test("isChainDomain is false for empty inputs", () => {
  assert.equal(isChainDomain("", ["loves.com"]), false);
  assert.equal(isChainDomain("https://loves.com", []), false);
  assert.equal(isChainDomain(null, ["loves.com"]), false);
});
