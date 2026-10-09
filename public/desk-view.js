// public/desk-view.js
// Pure view logic for the call desk: which leads a tab and filter show, and
// how a row reads. Browser-loaded and unit-tested with node --test. No DOM.
import { openStatus } from "./hours.js";

export const OUTCOME_LABELS = {
  no_answer: "No answer",
  voicemail: "Voicemail",
  talked: "Talked",
  meeting_set: "Meeting set",
  not_a_fit: "Not a fit",
  dnc: "Do not contact",
};

export const CONVERSATION_OUTCOMES = ["talked", "meeting_set", "not_a_fit", "dnc"];
export const ATTEMPT_OUTCOMES = ["no_answer", "voicemail"];

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function shortDate(iso) {
  if (!iso) return "";
  const [, m, d] = String(iso).slice(0, 10).split("-").map(Number);
  return `${MONTHS[m - 1]} ${d}`;
}

// "Katy 77494" from "123 Main St, Katy, TX 77494, USA".
export function areaFrom(address) {
  const parts = String(address || "").split(",").map((s) => s.trim()).filter(Boolean);
  const stateZip = parts.findIndex((p) => /^[A-Z]{2}\s+\d{5}/.test(p));
  if (stateZip > 0) {
    const zip = (parts[stateZip].match(/\d{5}/) || [""])[0];
    return `${parts[stateZip - 1]} ${zip}`.trim();
  }
  return parts.length > 1 ? parts[parts.length - 2] : parts[0] || "";
}

export function isNewLead(lead, lastRunId) {
  if (typeof lead.is_new === "boolean") return lead.is_new;
  return lastRunId != null && lead.first_run_id === lastRunId;
}

export function isDue(lead, today) {
  return !!lead.callback_on && lead.callback_on <= today && lead.status !== "dnc";
}

export function lastTouch(lead, today) {
  if (lead.callback_on && lead.status !== "dnc") {
    if (lead.callback_on <= today) return { kind: "due", text: lead.callback_on < today ? `Callback ${shortDate(lead.callback_on)}` : "Callback today" };
    return { kind: "tried", text: `Callback ${shortDate(lead.callback_on)}` };
  }
  if (!lead.last_outcome) return { kind: "none", text: "Not called yet" };
  const label = OUTCOME_LABELS[lead.last_outcome] || lead.last_outcome;
  const when = lead.last_touch_at ? ` · ${shortDate(lead.last_touch_at)}` : "";
  return { kind: lead.status === "worked" ? "done" : "tried", text: label + when };
}

// The engine's first why entry restates the track and vertical, which the
// row already shows. Strong chips are evidence worth dialing on.
const STRONG = /software|bundled|pos detected|financing|high-ticket|fee complaints|dual pricing|confirmed new|labor rate/i;

export function rowChips(why, max = 3) {
  return (why || [])
    .filter((w) => !/^(displacement|greenfield) •/i.test(w))
    .slice(0, max)
    .map((w) => ({
      // Engine chips carry an explanation after an em dash, sometimes inside
      // parentheses. The row shows the fact; the explanation is in the tooltip.
      text: w.replace(/\s*\([^)]*—[^)]*\)/g, "").replace(/ — .*$/, "").replace(/ \(unconfirmed\)$/, ""),
      kind: /temporarily closed/i.test(w) ? "warn" : STRONG.test(w) ? "sig" : "plain",
    }));
}

export function hoursLabel(lead, nowMs) {
  return openStatus(lead.hours, nowMs);
}

// Which leads a tab shows before the filter row applies.
export function tabLeads(leads, tab, today, now = Date.now()) {
  const live = leads.filter((l) => l.status !== "dnc");
  if (tab === "due") return live.filter((l) => isDue(l, today));
  if (tab === "new_week") {
    const weekAgo = now - 7 * 86400000;
    return live.filter((l) => l.is_new || (l.first_seen_at && Date.parse(l.first_seen_at) >= weekAgo));
  }
  if (tab === "all") return live;
  return live.filter((l) => l.vertical === tab);
}

export const FILTERS = [
  ["to_call", "To call"], ["hot", "Hot"], ["warm", "Warm"], ["new", "New"], ["worked", "Worked"],
];

export function applyFilter(leads, filter, lastRunId) {
  switch (filter) {
    case "hot": return leads.filter((l) => l.status === "to_call" && l.bucket === "hot");
    case "warm": return leads.filter((l) => l.status === "to_call" && l.bucket === "warm");
    case "new": return leads.filter((l) => isNewLead(l, lastRunId));
    case "worked": return leads.filter((l) => l.status === "worked");
    case "to_call":
    default: return leads.filter((l) => l.status === "to_call");
  }
}

export function filterCounts(leads, lastRunId) {
  const out = {};
  for (const [id] of FILTERS) out[id] = applyFilter(leads, id, lastRunId).length;
  return out;
}

// Open-now only keeps leads with unknown hours: missing data is not a reason
// to skip a business.
export function applyOpenOnly(leads, on, nowMs) {
  if (!on) return leads;
  return leads.filter((l) => {
    const s = openStatus(l.hours, nowMs);
    return !s || s.open;
  });
}

export function applySearch(leads, query) {
  const q = String(query || "").trim().toLowerCase();
  if (!q) return leads;
  return leads.filter((l) =>
    String(l.name || "").toLowerCase().includes(q) ||
    String(l.notes || "").toLowerCase().includes(q) ||
    String(l.address || "").toLowerCase().includes(q));
}

// Due callbacks first, then by score. Inside the Due tab, oldest callback first.
export function orderLeads(leads, tab, today) {
  return leads.slice().sort((a, b) => {
    if (tab === "due") {
      const c = String(a.callback_on).localeCompare(String(b.callback_on));
      if (c) return c;
    } else {
      const ad = isDue(a, today) ? 1 : 0;
      const bd = isDue(b, today) ? 1 : 0;
      if (ad !== bd) return bd - ad;
    }
    return (b.score || 0) - (a.score || 0);
  });
}

export function visibleLeads(leads, opts) {
  const { tab, filter, openOnly, query, today, lastRunId, nowMs } = opts;
  let rows = tabLeads(leads, tab, today, nowMs);
  if (tab !== "due") rows = applyFilter(rows, filter, lastRunId);
  rows = applyOpenOnly(rows, openOnly, nowMs);
  rows = applySearch(rows, query);
  return orderLeads(rows, tab, today);
}

export function telHref(phone) {
  const digits = String(phone || "").replace(/\D/g, "");
  if (digits.length === 10) return `tel:+1${digits}`;
  if (digits.length === 11 && digits[0] === "1") return `tel:+${digits}`;
  return digits ? `tel:${digits}` : "";
}
