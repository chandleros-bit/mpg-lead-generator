// lib/desk.js
// Pure call-desk logic: outcomes and what they do to a lead, the daily
// conversation count, the sidebar counts, and the Visits-tab export. No I/O;
// api/desk.js does the database calls and hands the rows here.

export const DEFAULT_TIMEZONE = "America/Chicago";
export const DEFAULT_GOAL = 40;

// Every outcome, what it means for the lead, and whether it is a conversation.
// A conversation is a real exchange with the business: it counts toward the
// daily goal and becomes a row on the tracker's Visits tab. No answer and
// voicemail are attempts: the lead stays on the call list.
export const OUTCOMES = {
  no_answer:   { label: "No answer",      status: "to_call", conversation: false, nextStep: "Call again" },
  voicemail:   { label: "Left voicemail", status: "to_call", conversation: false, nextStep: "Call again" },
  talked:      { label: "Talked",         status: "worked",  conversation: true,  nextStep: "Follow up" },
  meeting_set: { label: "Meeting set",    status: "worked",  conversation: true,  nextStep: "Meeting" },
  not_a_fit:   { label: "Not a fit",      status: "worked",  conversation: true,  nextStep: "None" },
  dnc:         { label: "Do not contact", status: "dnc",     conversation: true,  nextStep: "Do not contact" },
};

export function isOutcome(o) {
  return Object.prototype.hasOwnProperty.call(OUTCOMES, o);
}

// YYYY-MM-DD for the given instant in the desk's time zone. en-CA formats as
// ISO dates, which is the whole reason for the locale.
export function dayIn(tz = DEFAULT_TIMEZONE, now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit",
  }).format(now);
}

export function isIsoDate(s) {
  return typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s));
}

// A scored display row from the pipeline → the columns save_run inserts.
export function leadToDbRow(row, vertical, market) {
  return {
    place_id: row.place_id,
    vertical: row.vertical || vertical,
    name: row.name,
    address: row.address || null,
    phone: row.phone || null,
    website: row.website || null,
    rating: row.rating ?? null,
    review_count: row.review_count ?? 0,
    score: row.score,
    bucket: row.bucket,
    track: row.track,
    confidence: row.confidence || null,
    why: row.why || [],
    signals: row.signals || [],
    processor: row.processor || [],
    financing: row.financing || [],
    owner: row.owner || null,
    decision_makers: row.decision_makers || [],
    campaign: row.campaign || null,
    hours: row.hours || null,
    source: row.source || null,
    market_city: (market && market.city) || null,
    market_state: (market && market.state) || null,
  };
}

// What logging an outcome writes to the lead itself.
export function leadPatchForOutcome({ outcome, callback_on, notes }, nowIso) {
  const o = OUTCOMES[outcome];
  const patch = {
    status: o.status,
    last_outcome: outcome,
    last_touch_at: nowIso,
    callback_on: callback_on || null,
  };
  if (typeof notes === "string") patch.notes = notes;
  return patch;
}

// Conversations on a day, broken out by outcome.
export function conversationCounts(calls) {
  const by = { talked: 0, meeting_set: 0, not_a_fit: 0, dnc: 0 };
  let total = 0;
  let dials = 0;
  for (const c of calls) {
    dials++;
    if (OUTCOMES[c.outcome] && OUTCOMES[c.outcome].conversation) {
      by[c.outcome]++;
      total++;
    }
  }
  return { total, dials, ...by };
}

// Sidebar numbers from the light lead list (vertical, status, callback_on,
// first_seen_at). Do-not-contact leads are never counted anywhere.
export function sidebarCounts(leads, today, now = new Date()) {
  const weekAgo = now.getTime() - 7 * 86400000;
  const verticals = {};
  let all = 0;
  let due = 0;
  let newWeek = 0;
  for (const l of leads) {
    if (l.status === "dnc") continue;
    all++;
    verticals[l.vertical] = (verticals[l.vertical] || 0) + 1;
    if (l.callback_on && l.callback_on <= today) due++;
    if (l.first_seen_at && Date.parse(l.first_seen_at) >= weekAgo) newWeek++;
  }
  return { all, due, new_week: newWeek, verticals };
}

// M/D/YYYY: what Excel reads as a date when pasted, in a US-locale workbook.
export function excelDate(iso) {
  if (!iso) return "";
  const [y, m, d] = iso.split("-").map(Number);
  return `${m}/${d}/${y}`;
}

function cell(v) {
  // Tabs and newlines would split the pasted row; flatten them.
  return String(v == null ? "" : v).replace(/[\t\r\n]+/g, " ").trim();
}

function quality(bucket) {
  const b = String(bucket || "").toLowerCase();
  if (b === "hot") return "Hot";
  if (b === "warm") return "Warm";
  if (b === "cold") return "Cold";
  return "";
}

// One tracker row per conversation, in the Visits tab's column order (A to M):
// Visit date, Business, Contact / role, Phone / email, Meeting notes / pain
// points, Next step, Follow-up date, Prospect quality, Decision-maker
// conversation?, Statement received?, Demo / proposal?, Application
// submitted?, Merchant boarded?
export function visitsRow(call, lead) {
  const o = OUTCOMES[call.outcome];
  const note = [o.label, cell(call.notes)].filter(Boolean).join(". ");
  return [
    excelDate(call.call_date),
    cell(lead.name),
    cell(call.contact),
    cell(lead.phone),
    note,
    call.callback_on ? `Call back ${excelDate(call.callback_on)}` : o.nextStep,
    excelDate(call.callback_on),
    quality(lead.bucket),
    call.decision_maker ? "Yes" : "No",
    "No", "No", "No", "No",
  ];
}

// The paste-ready block for the tracker: conversations only, oldest first.
export function visitsTsv(calls, leadsById) {
  return calls
    .filter((c) => OUTCOMES[c.outcome] && OUTCOMES[c.outcome].conversation && leadsById[c.lead_id])
    .sort((a, b) => String(a.called_at).localeCompare(String(b.called_at)))
    .map((c) => visitsRow(c, leadsById[c.lead_id]).join("\t"))
    .join("\n");
}
