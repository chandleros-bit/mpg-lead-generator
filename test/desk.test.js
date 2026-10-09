// test/desk.test.js — call desk logic, the desk API, and saving runs.
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import {
  OUTCOMES, dayIn, leadPatchForOutcome, conversationCounts, sidebarCounts,
  visitsRow, visitsTsv, excelDate, leadToDbRow,
} from "../lib/desk.js";
import { dbConfig, selectAll } from "../lib/db.js";
import * as desk from "../api/desk.js";
import * as leadsApi from "../api/leads.js";

const require = createRequire(import.meta.url);
const DEMO_RAW = require("../public/demo_places.json");

// ---------- pure logic ----------

test("the four conversation outcomes are exactly the ones that count", () => {
  const conv = Object.keys(OUTCOMES).filter((k) => OUTCOMES[k].conversation).sort();
  assert.deepEqual(conv, ["dnc", "meeting_set", "not_a_fit", "talked"]);
});

test("outcomes move the lead to the right list", () => {
  const now = "2026-10-08T15:00:00.000Z";
  assert.equal(leadPatchForOutcome({ outcome: "voicemail" }, now).status, "to_call");
  assert.equal(leadPatchForOutcome({ outcome: "no_answer" }, now).status, "to_call");
  assert.equal(leadPatchForOutcome({ outcome: "talked" }, now).status, "worked");
  assert.equal(leadPatchForOutcome({ outcome: "meeting_set" }, now).status, "worked");
  assert.equal(leadPatchForOutcome({ outcome: "not_a_fit" }, now).status, "worked");
  assert.equal(leadPatchForOutcome({ outcome: "dnc" }, now).status, "dnc");
  const p = leadPatchForOutcome({ outcome: "talked", callback_on: "2026-10-13", notes: "Mike, Clover" }, now);
  assert.deepEqual(p, { status: "worked", last_outcome: "talked", last_touch_at: now, callback_on: "2026-10-13", notes: "Mike, Clover" });
  assert.ok(!("notes" in leadPatchForOutcome({ outcome: "talked" }, now)), "no notes sent means notes untouched");
});

test("conversation counts ignore attempts", () => {
  const c = conversationCounts([
    { outcome: "talked" }, { outcome: "talked" }, { outcome: "meeting_set" },
    { outcome: "voicemail" }, { outcome: "no_answer" }, { outcome: "dnc" }, { outcome: "not_a_fit" },
  ]);
  assert.deepEqual(c, { total: 5, dials: 7, talked: 2, meeting_set: 1, not_a_fit: 1, dnc: 1 });
});

test("the day rolls over at midnight Central, not UTC", () => {
  // 11:30 PM Central on Oct 8 is already Oct 9 in UTC.
  assert.equal(dayIn("America/Chicago", new Date("2026-10-09T04:30:00Z")), "2026-10-08");
  assert.equal(dayIn("America/Chicago", new Date("2026-10-09T05:30:00Z")), "2026-10-09");
});

test("sidebar counts skip do-not-contact and find due and new leads", () => {
  const now = new Date("2026-10-08T15:00:00Z");
  const counts = sidebarCounts([
    { vertical: "hvac", status: "to_call", callback_on: null, first_seen_at: "2026-10-08T02:00:00Z" },
    { vertical: "hvac", status: "worked", callback_on: "2026-10-08", first_seen_at: "2026-09-01T00:00:00Z" },
    { vertical: "hvac", status: "to_call", callback_on: "2026-10-01", first_seen_at: "2026-09-01T00:00:00Z" },
    { vertical: "dentist", status: "to_call", callback_on: "2026-10-20", first_seen_at: "2026-10-05T00:00:00Z" },
    { vertical: "hvac", status: "dnc", callback_on: "2026-10-08", first_seen_at: "2026-10-08T00:00:00Z" },
  ], "2026-10-08", now);
  assert.deepEqual(counts, { all: 4, due: 2, new_week: 2, verticals: { hvac: 3, dentist: 1 } });
});

test("a tracker row lines up with the Visits tab, A through M", () => {
  const row = visitsRow(
    { outcome: "talked", call_date: "2026-10-08", contact: "Mike / Owner", notes: "On Clover,\ncontract ends March",
      callback_on: "2026-10-13", decision_maker: true },
    { name: "Arctic Air", phone: "(281) 555-0118", bucket: "hot" },
  );
  assert.deepEqual(row, ["10/8/2026", "Arctic Air", "Mike / Owner", "(281) 555-0118",
    "Talked. On Clover, contract ends March", "Call back 10/13/2026", "10/13/2026", "Hot", "Yes",
    "No", "No", "No", "No"]);
  assert.equal(row.length, 13);
});

test("the tracker paste holds conversations only, oldest first, one row per line", () => {
  const leads = { 1: { name: "A", phone: "1", bucket: "warm" }, 2: { name: "B", phone: "2", bucket: "cold" } };
  const tsv = visitsTsv([
    { lead_id: 2, outcome: "not_a_fit", call_date: "2026-10-08", called_at: "2026-10-08T16:00:00Z", decision_maker: false },
    { lead_id: 1, outcome: "voicemail", call_date: "2026-10-08", called_at: "2026-10-08T14:00:00Z" },
    { lead_id: 1, outcome: "meeting_set", call_date: "2026-10-08", called_at: "2026-10-08T15:00:00Z", decision_maker: true },
  ], leads);
  const lines = tsv.split("\n");
  assert.equal(lines.length, 2);
  assert.ok(lines[0].startsWith("10/8/2026\tA\t"));
  assert.ok(lines[0].includes("\tMeeting\t"));
  assert.ok(lines[1].startsWith("10/8/2026\tB\t"));
  assert.ok(lines.every((l) => l.split("\t").length === 13));
  assert.equal(excelDate(null), "");
});

test("leadToDbRow keeps the raw vertical id and the market", () => {
  const r = leadToDbRow({ place_id: "p", name: "X", vertical: "auto_repair", score: 70, bucket: "hot", track: "displacement" },
    "mixed", { city: "Katy", state: "TX" });
  assert.equal(r.vertical, "auto_repair");
  assert.equal(r.market_city, "Katy");
  assert.deepEqual(r.why, []);
});

// ---------- a fake Supabase over fetch ----------

function fakeSupabase(handlers) {
  const log = [];
  const fetchImpl = async (url, opts = {}) => {
    const u = new URL(String(url));
    const path = u.pathname.replace("/rest/v1/", "");
    const entry = { method: opts.method || "GET", path, query: u.search, body: opts.body ? JSON.parse(opts.body) : undefined, headers: opts.headers };
    log.push(entry);
    for (const h of handlers) {
      if (h.method === entry.method && entry.path === h.path && (!h.match || h.match(entry))) {
        const out = typeof h.reply === "function" ? h.reply(entry) : h.reply;
        return new Response(JSON.stringify(out), { status: h.status || 200 });
      }
    }
    return new Response(JSON.stringify([]), { status: 200 });
  };
  return { log, fetchImpl };
}

function withEnv(fn) {
  return async () => {
    const saved = { ...process.env };
    process.env.APP_PASSPHRASE = "right";
    process.env.SUPABASE_URL = "https://db.example.co";
    process.env.SUPABASE_SERVICE_KEY = "service";
    const orig = globalThis.fetch;
    try { await fn(); } finally {
      globalThis.fetch = orig;
      for (const k of ["APP_PASSPHRASE", "SUPABASE_URL", "SUPABASE_SERVICE_KEY", "GOOGLE_PLACES_API_KEY"]) {
        if (k in saved) process.env[k] = saved[k]; else delete process.env[k];
      }
    }
  };
}

const H = { "x-app-passphrase": "right" };

test("dbConfig needs both the URL and the service key", () => {
  assert.equal(dbConfig({}), null);
  assert.equal(dbConfig({ SUPABASE_URL: "https://x.co" }), null);
  assert.deepEqual(dbConfig({ SUPABASE_URL: "https://x.co/", SUPABASE_SERVICE_KEY: "k" }), { url: "https://x.co", key: "k" });
});

test("selectAll pages past Supabase's 1000-row cap", async () => {
  let calls = 0;
  const fetchImpl = async (url) => {
    calls++;
    const offset = Number(new URL(url).searchParams.get("offset"));
    const n = offset === 0 ? 2 : 1;
    return new Response(JSON.stringify(Array.from({ length: n }, (_, i) => ({ i: offset + i }))), { status: 200 });
  };
  const rows = await selectAll({ url: "https://x.co", key: "k" }, "leads", "select=id", { fetchImpl }, 2);
  assert.equal(rows.length, 3);
  assert.equal(calls, 2);
});

test("desk API: passphrase first, then a clear not-set-up answer", withEnv(async () => {
  const r1 = await desk.GET(new Request("http://x/api/desk?vertical=hvac"));
  assert.equal(r1.status, 401);
  delete process.env.SUPABASE_URL;
  const r2 = await desk.GET(new Request("http://x/api/desk?vertical=hvac", { headers: H }));
  assert.equal(r2.status, 503);
  assert.equal((await r2.json()).configured, false);
}));

test("desk API: a tab returns its saved leads, counts, and conversations today", withEnv(async () => {
  const { log, fetchImpl } = fakeSupabase([
    { method: "GET", path: "leads", match: (e) => e.query.includes("select=vertical"), reply: [
      { vertical: "hvac", status: "to_call", callback_on: null, first_seen_at: new Date().toISOString() },
    ] },
    { method: "GET", path: "leads", match: (e) => e.query.includes("select=id"), reply: [{ id: 1, name: "Arctic Air", vertical: "hvac" }] },
    { method: "GET", path: "calls", reply: [{ outcome: "talked" }, { outcome: "voicemail" }] },
    { method: "GET", path: "runs", reply: [{ id: 9, vertical: "hvac", new_count: 14 }] },
  ]);
  globalThis.fetch = fetchImpl;
  const res = await desk.GET(new Request("http://x/api/desk?vertical=hvac", { headers: H }));
  assert.equal(res.status, 200);
  const d = await res.json();
  assert.equal(d.goal, 40);
  assert.equal(d.leads.length, 1);
  assert.equal(d.conversations.total, 1);
  assert.equal(d.counts.verticals.hvac, 1);
  assert.equal(d.last_run.new_count, 14);
  const list = log.find((e) => e.path === "leads" && e.query.includes("select=id"));
  assert.ok(decodeURIComponent(list.query).includes("status=neq.dnc"), "do-not-contact never comes back");
  assert.ok(list.query.includes("vertical=eq.hvac"));
  assert.ok(!list.query.includes("campaign"), "copy is fetched per lead, not in the list");
  assert.equal(list.headers.Authorization, "Bearer service");
}));

test("desk API: an unknown tab is a 400", withEnv(async () => {
  globalThis.fetch = fakeSupabase([]).fetchImpl;
  const res = await desk.GET(new Request("http://x/api/desk?vertical=plumbers_on_mars", { headers: H }));
  assert.equal(res.status, 400);
}));

test("desk API: logging an outcome writes the call for today and moves the lead", withEnv(async () => {
  const { log, fetchImpl } = fakeSupabase([
    { method: "POST", path: "calls", reply: [{ id: 1 }] },
    { method: "PATCH", path: "leads", reply: (e) => [{ id: 7, ...e.body }] },
    { method: "GET", path: "calls", reply: [{ outcome: "meeting_set" }] },
  ]);
  globalThis.fetch = fetchImpl;
  const res = await desk.POST(new Request("http://x/api/desk", {
    method: "POST", headers: H,
    body: JSON.stringify({ action: "outcome", lead_id: 7, outcome: "meeting_set", contact: "Mike / Owner",
      notes: "Statement Tuesday", callback_on: "2026-10-13", decision_maker: true }),
  }));
  assert.equal(res.status, 200);
  const d = await res.json();
  assert.equal(d.lead.status, "worked");
  assert.equal(d.conversations.total, 1);
  const call = log.find((e) => e.method === "POST" && e.path === "calls").body[0];
  assert.equal(call.outcome, "meeting_set");
  assert.equal(call.contact, "Mike / Owner");
  assert.equal(call.decision_maker, true);
  assert.equal(call.call_date, dayIn("America/Chicago"));
  const patch = log.find((e) => e.method === "PATCH");
  assert.equal(patch.query, "?id=eq.7");
  assert.equal(patch.body.callback_on, "2026-10-13");
}));

test("desk API: a voicemail is never a decision-maker conversation", withEnv(async () => {
  const { log, fetchImpl } = fakeSupabase([{ method: "PATCH", path: "leads", reply: [{ id: 7 }] }]);
  globalThis.fetch = fetchImpl;
  await desk.POST(new Request("http://x/api/desk", { method: "POST", headers: H,
    body: JSON.stringify({ action: "outcome", lead_id: 7, outcome: "voicemail" }) }));
  assert.equal(log.find((e) => e.path === "calls" && e.method === "POST").body[0].decision_maker, false);
}));

test("desk API: bad input is refused before touching the database", withEnv(async () => {
  const { log, fetchImpl } = fakeSupabase([]);
  globalThis.fetch = fetchImpl;
  for (const body of [
    { action: "outcome", lead_id: 7, outcome: "hung_up" },
    { action: "outcome", lead_id: "7; drop", outcome: "talked" },
    { action: "outcome", lead_id: 7, outcome: "talked", callback_on: "next week" },
    { action: "nope", lead_id: 7 },
  ]) {
    const res = await desk.POST(new Request("http://x/api/desk", { method: "POST", headers: H, body: JSON.stringify(body) }));
    assert.equal(res.status, 400, JSON.stringify(body));
  }
  assert.equal(log.length, 0);
}));

test("desk API: the export returns the tracker rows for a day", withEnv(async () => {
  globalThis.fetch = fakeSupabase([
    { method: "GET", path: "calls", reply: [
      { lead_id: 1, outcome: "talked", call_date: "2026-10-08", called_at: "2026-10-08T15:00:00Z", decision_maker: true, contact: "Mike", notes: "" },
    ] },
    { method: "GET", path: "leads", reply: [{ id: 1, name: "Arctic Air", phone: "(281) 555-0118", bucket: "hot" }] },
  ]).fetchImpl;
  const res = await desk.GET(new Request("http://x/api/desk?export=2026-10-08", { headers: H }));
  const d = await res.json();
  assert.equal(d.rows, 1);
  assert.ok(d.tsv.startsWith("10/8/2026\tArctic Air\tMike\t(281) 555-0118\tTalked\t"));
}));

// ---------- saving a run ----------

test("a live run is saved through save_run and leads come back tagged new or saved", withEnv(async () => {
  process.env.GOOGLE_PLACES_API_KEY = "key";
  let rpcBody = null;
  globalThis.fetch = async (url, opts = {}) => {
    const u = String(url);
    if (u.includes("/rest/v1/rpc/save_run")) {
      rpcBody = JSON.parse(opts.body);
      return new Response(JSON.stringify({ run_id: 3, new_count: 1, existing_count: rpcBody.p_leads.length - 1,
        leads: rpcBody.p_leads.map((l, i) => ({ id: 100 + i, place_id: l.place_id, status: "to_call", is_new: i === 0 })) }), { status: 200 });
    }
    return new Response(JSON.stringify(DEMO_RAW), { status: 200 });
  };
  const res = await leadsApi.GET(new Request("http://x/api/leads?vertical=salon", { headers: H }));
  assert.equal(res.status, 200);
  const d = await res.json();
  assert.equal(d.save.saved, true);
  assert.equal(d.save.new_count, 1);
  assert.equal(rpcBody.p_run.vertical, "salon");
  assert.ok(rpcBody.p_leads.every((l) => l.place_id && l.vertical));
  assert.ok(d.leads.every((l) => typeof l.lead_id === "number"));
  assert.equal(d.leads.filter((l) => l.is_new).length, 1);
}));

test("a database failure never loses the run", withEnv(async () => {
  process.env.GOOGLE_PLACES_API_KEY = "key";
  globalThis.fetch = async (url) => String(url).includes("/rest/v1/")
    ? new Response(JSON.stringify({ message: "relation \"leads\" does not exist" }), { status: 404 })
    : new Response(JSON.stringify(DEMO_RAW), { status: 200 });
  const res = await leadsApi.GET(new Request("http://x/api/leads?vertical=salon", { headers: H }));
  assert.equal(res.status, 200);
  const d = await res.json();
  assert.ok(d.leads.length > 0);
  assert.equal(d.save.saved, false);
  assert.ok(d.save.error.includes("does not exist"));
}));

test("without a database the run still works and says it was not saved", withEnv(async () => {
  process.env.GOOGLE_PLACES_API_KEY = "key";
  delete process.env.SUPABASE_URL;
  globalThis.fetch = async () => new Response(JSON.stringify(DEMO_RAW), { status: 200 });
  const d = await (await leadsApi.GET(new Request("http://x/api/leads?vertical=salon", { headers: H }))).json();
  assert.deepEqual(d.save, { saved: false, configured: false });
}));

test("the desk module keeps Vercel's named-export shape", () => {
  assert.equal(typeof desk.GET, "function");
  assert.equal(typeof desk.POST, "function");
  assert.equal(desk.default, undefined);
});
