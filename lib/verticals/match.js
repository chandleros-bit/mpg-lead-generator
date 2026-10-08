// lib/verticals/match.js
// Keyword matching shared by every vertical pack. Pure, no config.
//
// A keyword ending in "*" is a prefix: "remodel*" reaches "remodeling" and
// "remodeled". Everything else takes a whole word with an optional plural, so
// "bath" does not fire on "bathe" and "pest" does not fire on "pestle". The
// matched keyword is printed back to the rep on the lead card, so a hit inside
// an unrelated word is a wrong claim, not a harmless one.

const cache = new Map();

export function keywordPattern(kw) {
  let re = cache.get(kw);
  if (!re) {
    const prefix = kw.endsWith("*");
    const base = prefix ? kw.slice(0, -1) : kw;
    const lit = base.replace(/[^\w\s]/g, "\\$&");
    // No /g: membership tests only, so there is no lastIndex to reset.
    re = new RegExp(prefix ? `\\b${lit}\\w*` : `\\b${lit}(?:e?s)?\\b`, "i");
    cache.set(kw, re);
  }
  return re;
}

// The keyword as it should read on a chip: "remodel*" prints as "remodel".
export function keywordLabel(kw) {
  return kw.endsWith("*") ? kw.slice(0, -1) : kw;
}

// Every keyword from the list that appears in the text, in list order.
export function keywordHits(keywords, text) {
  if (!keywords || !keywords.length) return [];
  return keywords.filter((k) => keywordPattern(k).test(text)).map(keywordLabel);
}

export function anyKeyword(keywords, text) {
  return keywordHits(keywords, text).length > 0;
}
