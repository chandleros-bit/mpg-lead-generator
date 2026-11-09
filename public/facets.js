// public/facets.js
// The filter facets: what you can narrow a tab by, and the pure logic that
// does it. No DOM, no I/O — dashboard.js owns the panel, this owns the rules.
//
// Facets are ANDed with each other and ORed within one, which is what a set
// of filters is normally taken to mean: "Displacement or Greenfield" inside
// Track, but "Track AND no website" across them. Keeping that shape means
// applyFacets stays a reduction over predicates instead of the growing switch
// that applyFilter in desk-view.js had become.
//
// An absent key is not a filter. A facet turned off must leave no trace in
// the object, or an empty array would quietly match nothing and the list
// would go blank for no visible reason.

const DAY_MS = 86400000;

function nonEmpty(v) {
  return Array.isArray(v) ? v.length > 0 : !!v;
}

// Every facet, in the order the panel draws them. `kind` picks the control:
//   enum   — pick any of `options`, or of the values found in the rows
//   toggle — on or off
//   range  — [min, max] over a number
// `test` answers "does this lead pass", given the facet's current value.
export const FACETS = [
  {
    id: "track", label: "Track", kind: "enum", group: "Deal shape",
    options: [["displacement", "Displacement"], ["greenfield", "Greenfield"]],
    test: (l, v) => v.includes(l.track),
  },
  {
    id: "processor", label: "Processor found", kind: "toggle", group: "Deal shape",
    hint: "A payment SDK was detected on their site — a confirmed incumbent to displace.",
    test: (l) => nonEmpty(l.processor),
  },
  {
    id: "financing", label: "Financing found", kind: "toggle", group: "Deal shape",
    hint: "A customer-financing widget on their site. Ticket-size evidence.",
    test: (l) => nonEmpty(l.financing),
  },
  {
    id: "confidence", label: "Confidence", kind: "enum", group: "Deal shape",
    options: [["high", "High"], ["medium", "Medium"], ["low", "Low"]],
    test: (l, v) => v.includes(l.confidence),
  },
  {
    id: "never_called", label: "Never called", kind: "toggle", group: "Contact",
    test: (l) => l.status === "to_call" && !l.last_outcome,
  },
  {
    id: "stale_days", label: "Not touched in", kind: "enum", group: "Contact", single: true,
    options: [[7, "7 days"], [14, "14 days"], [30, "30 days"]],
    // A lead never touched at all is not stale, it is untouched — that is what
    // "Never called" is for, and rolling the two together would make this
    // facet mean "everything".
    test: (l, v, now) => !!l.last_touch_at && Date.parse(l.last_touch_at) <= now - v * DAY_MS,
  },
  {
    id: "has_phone", label: "Has phone", kind: "toggle", group: "Contact",
    test: (l) => !!String(l.phone || "").trim(),
  },
  {
    id: "no_website", label: "No website", kind: "toggle", group: "Contact",
    test: (l) => !String(l.website || "").trim(),
  },
  {
    id: "score", label: "Score", kind: "range", group: "Score", min: 0, max: 100,
    test: (l, v) => (l.score || 0) >= v[0] && (l.score || 0) <= v[1],
  },
  {
    id: "city", label: "Market", kind: "enum", group: "Place", from: "market_city",
    test: (l, v) => v.includes(l.market_city),
  },
  {
    id: "source", label: "Source", kind: "enum", group: "Place",
    options: [["places", "Google Places"], ["tabc", "TABC new licence"]],
    test: (l, v) => v.includes(l.source),
  },
];

const BY_ID = Object.fromEntries(FACETS.map((f) => [f.id, f]));

export function getFacet(id) {
  return BY_ID[id] || null;
}

// A facet is set when its key holds something that could exclude a lead. An
// empty array, a false toggle and a full-width score range are all "off", and
// normalizing them away here is what keeps the chips and the badge honest.
export function isSet(id, value) {
  const f = BY_ID[id];
  if (!f || value == null) return false;
  if (f.kind === "toggle") return value === true;
  if (f.kind === "range") return value[0] > f.min || value[1] < f.max;
  if (f.single) return true;
  return Array.isArray(value) && value.length > 0;
}

// In FACETS order, not the order they were clicked: the chip row should read
// the same whichever way you built the set, and an object's key order is the
// order you happened to pick things in.
export function activeFacets(facets) {
  const f = facets || {};
  return FACETS.map((x) => x.id).filter((id) => isSet(id, f[id]));
}

export function countActive(facets) {
  return activeFacets(facets).length;
}

export function applyFacets(leads, facets, nowMs = Date.now()) {
  const active = activeFacets(facets);
  if (!active.length) return leads;
  return (leads || []).filter((l) =>
    active.every((id) => BY_ID[id].test(l, facets[id], nowMs)));
}

// Counts for one facet's options, computed with that facet relaxed — the
// number says what picking it would give you, not what you already have.
// Counting against the already-filtered list would show zeros everywhere the
// moment you picked anything, which is the opposite of useful.
export function facetCounts(leads, facets, id, nowMs = Date.now()) {
  const f = BY_ID[id];
  if (!f) return {};
  const rest = { ...facets };
  delete rest[id];
  const pool = applyFacets(leads, rest, nowMs);
  if (f.kind === "toggle") return { true: pool.filter((l) => f.test(l, true, nowMs)).length };
  const out = {};
  for (const [value] of optionsFor(f, leads)) {
    out[value] = pool.filter((l) => f.test(l, f.single ? value : [value], nowMs)).length;
  }
  return out;
}

// Fixed options, or the values actually present in the loaded rows for a
// facet like Market that cannot be enumerated ahead of time.
export function optionsFor(facet, leads) {
  const f = typeof facet === "string" ? BY_ID[facet] : facet;
  if (!f) return [];
  if (f.options) return f.options;
  const seen = new Set();
  for (const l of leads || []) {
    const v = l[f.from];
    if (v) seen.add(v);
  }
  return [...seen].sort().map((v) => [v, v]);
}

// Set, unset or flip one facet, returning a new object. A facet turned off is
// deleted rather than left empty — see the header.
export function setFacet(facets, id, value) {
  const f = BY_ID[id];
  const out = { ...(facets || {}) };
  if (!f || !isSet(id, value)) delete out[id];
  else out[id] = value;
  return out;
}

export function toggleValue(facets, id, value) {
  const f = BY_ID[id];
  if (!f) return facets || {};
  if (f.kind === "toggle") return setFacet(facets, id, !(facets || {})[id]);
  if (f.single) return setFacet(facets, id, (facets || {})[id] === value ? null : value);
  const cur = ((facets || {})[id] || []).slice();
  const at = cur.indexOf(value);
  if (at >= 0) cur.splice(at, 1); else cur.push(value);
  return setFacet(facets, id, cur);
}

export function clearAll() {
  return {};
}

// What the removable chips under the toolbar say. One chip per value, so a
// two-value enum can be cut back one at a time rather than all or nothing.
export function activeChips(facets, leads) {
  const chips = [];
  for (const id of activeFacets(facets)) {
    const f = BY_ID[id];
    const v = facets[id];
    if (f.kind === "toggle") {
      chips.push({ id, value: true, label: f.label });
    } else if (f.kind === "range") {
      chips.push({ id, value: null, label: `${f.label} ${v[0]}–${v[1]}` });
    } else if (f.single) {
      const hit = optionsFor(f, leads).find(([o]) => o === v);
      chips.push({ id, value: v, label: `${f.label} ${hit ? hit[1] : v}` });
    } else {
      const opts = optionsFor(f, leads);
      for (const value of v) {
        const hit = opts.find(([o]) => o === value);
        chips.push({ id, value, label: hit ? hit[1] : value });
      }
    }
  }
  return chips;
}

// Remove what one chip stands for.
export function clearChip(facets, id, value) {
  const f = BY_ID[id];
  if (!f) return facets || {};
  if (f.kind === "toggle" || f.kind === "range" || f.single) return setFacet(facets, id, null);
  return toggleValue(facets, id, value);
}

// Drop anything a stored view carries that this build no longer has, so an
// old saved view opens with the facets that still exist instead of failing.
export function sanitize(facets) {
  const out = {};
  for (const [id, v] of Object.entries(facets || {})) {
    if (BY_ID[id] && isSet(id, v)) out[id] = v;
  }
  return out;
}
