// api/desk.js — the call desk: saved leads, call outcomes, the daily
// conversation count, and the tracker export. Vercel serves this at /api/desk.
//
// Named GET/POST exports, never a default export: see the long note in
// api/leads.js on how Vercel picks the calling convention.
import { loadConfig } from "../lib/config.js";
import { dbConfig, select, selectAll, insert, update, remove, DbUnreachable } from "../lib/db.js";
import {
  DEFAULT_GOAL, DEFAULT_TIMEZONE, OUTCOMES, isOutcome, isIsoDate, dayIn,
  leadPatchForOutcome, conversationCounts, sidebarCounts, visitsTsv,
} from "../lib/desk.js";
import { getVertical } from "../lib/verticals/index.js";
// The Today rules live in public/ because the browser is served them; see the
// header of that file. Importing them here is what keeps the list the server
// stamps and the list the browser draws the same list.
import { selectToday } from "../public/today.js";
import { sanitize as sanitizeFacets } from "../public/facets.js";

const VIEW_COLUMNS = "id,name,tab,filter,facets,open_only,position";
const MAX_VIEWS = 40;

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { "content-type": "application/json" } });
}

// Everything the table and the expanded row need, minus the outreach copy,
// which is fetched per lead when a row opens.
const LIST_COLUMNS = [
  "id", "place_id", "vertical", "name", "address", "phone", "website", "rating",
  "review_count", "score", "bucket", "track", "confidence", "why", "signals",
  "processor", "financing", "owner", "decision_makers", "hours", "source",
  "market_city", "market_state", "status", "last_outcome", "last_touch_at",
  "callback_on", "notes", "today_on", "first_seen_at", "first_run_id", "last_run_id",
].join(",");

// A configured database that is not answering degrades to the same local mode
// as one that was never configured: searches still work, nothing persists. The
// shape differs so the dashboard can say which it is — "not set up yet" would
// send the user to their environment variables when the real answer is a
// paused project. Anything else is a genuine fault and keeps its 502.
function dbFailure(e) {
  if (!(e instanceof DbUnreachable)) return null;
  return json({
    configured: true,
    reachable: false,
    error: "The database is not responding. It may be paused.",
  }, 503);
}

function context(req) {
  const cfg = loadConfig();
  const provided = req.headers.get("x-app-passphrase") || "";
  if (!cfg.passphrase || provided !== cfg.passphrase) {
    return { error: json({ error: "Invalid or missing passphrase." }, 401) };
  }
  const db = dbConfig();
  if (!db) return { error: json({ configured: false, error: "Saving is not set up yet." }, 503) };
  const tz = (cfg.desk && cfg.desk.timezone) || DEFAULT_TIMEZONE;
  const goal = Number(cfg.desk && cfg.desk.conversation_goal) || DEFAULT_GOAL;
  return { db, tz, goal, today: dayIn(tz) };
}

// Everything sidebarCounts needs, plus everything selectToday needs. One read
// serves both, so composing the day costs no extra round trip.
const LIGHT_COLUMNS =
  "id,vertical,status,bucket,score,callback_on,last_outcome,today_on,first_seen_at";

// Make sure today's list exists, and return the light rows with the stamp
// applied. Composing is lazy but unconditional: the first desk request of any
// day builds the list, whichever tab asked, so the count in the sidebar is
// right before the tab is ever opened. Once stamped it is never recomposed —
// that is what freezes the list for the day.
export async function ensureToday(db, today, goal, light) {
  if (light.some((l) => l.today_on === today)) return light;
  const picked = selectToday(light, { today, goal });
  if (!picked.length) return light;
  const ids = picked.map((l) => l.id).filter((id) => id != null);
  if (!ids.length) return light;
  // select=id keeps PostgREST from echoing forty whole rows we already hold.
  await update(db, "leads", `id=in.(${ids.join(",")})&select=id`, { today_on: today });
  const chosen = new Set(ids);
  return light.map((l) => (chosen.has(l.id) ? { ...l, today_on: today } : l));
}

async function summary(db, today, goal) {
  const [rows, calls, views] = await Promise.all([
    selectAll(db, "leads", `select=${LIGHT_COLUMNS}&order=id.asc`),
    select(db, "calls", `select=outcome&call_date=eq.${today}`),
    select(db, "saved_views", `select=${VIEW_COLUMNS}&order=position.asc,id.asc`),
  ]);
  const light = await ensureToday(db, today, goal, rows);
  return {
    configured: true,
    today,
    goal,
    counts: sidebarCounts(light, today),
    conversations: conversationCounts(calls),
    views: views || [],
  };
}

export async function GET(req) {
  const ctx = context(req);
  if (ctx.error) return ctx.error;
  const { db, today, goal } = ctx;
  const url = new URL(req.url);

  try {
    // One lead in full, including its outreach copy.
    const leadId = url.searchParams.get("lead");
    if (leadId) {
      if (!/^\d+$/.test(leadId)) return json({ error: "Bad lead id." }, 400);
      const [lead] = await select(db, "leads", `select=*&id=eq.${leadId}`);
      if (!lead) return json({ error: "Lead not found." }, 404);
      const calls = await select(db, "calls", `select=*&lead_id=eq.${leadId}&order=called_at.desc&limit=20`);
      return json({ lead, calls });
    }

    // The tracker paste for one day: conversations only.
    const exportDay = url.searchParams.get("export");
    if (exportDay) {
      const day = exportDay === "today" ? today : exportDay;
      if (!isIsoDate(day)) return json({ error: "Bad date." }, 400);
      const calls = await select(db, "calls", `select=*&call_date=eq.${day}&order=called_at.asc`);
      const ids = [...new Set(calls.map((c) => c.lead_id))];
      const leads = ids.length
        ? await select(db, "leads", `select=id,name,phone,bucket&id=in.(${ids.join(",")})`)
        : [];
      const byId = Object.fromEntries(leads.map((l) => [l.id, l]));
      const tsv = visitsTsv(calls, byId);
      return json({ day, tsv, rows: tsv ? tsv.split("\n").length : 0 });
    }

    const out = await summary(db, today, goal);

    // A tab's saved leads. "all" spans every vertical; "today" is the day's
    // composed sheet, which summary() has already made sure exists. The
    // browser orders and sections it — the stamp records membership only.
    const vertical = url.searchParams.get("vertical");
    if (vertical) {
      const isToday = vertical === "today";
      if (!isToday && vertical !== "all" && !getVertical(vertical)) {
        return json({ error: `Unknown vertical "${vertical}".` }, 400);
      }
      const filter = isToday ? `&today_on=eq.${today}` : vertical === "all" ? "" : `&vertical=eq.${vertical}`;
      out.leads = await selectAll(db, "leads",
        `select=${LIST_COLUMNS}&status=neq.dnc${filter}&order=score.desc,id.asc`);
      // "Last run" belongs to a vertical's own search. The composed tabs span
      // every vertical, so there is no single run behind them.
      if (!isToday && vertical !== "all") {
        const [last] = await select(db, "runs", `select=*&vertical=eq.${vertical}&order=id.desc&limit=1`);
        out.last_run = last || null;
      }
    }
    return json(out);
  } catch (e) {
    return dbFailure(e) ?? json({ error: e.message }, 502);
  }
}

// Save or delete one view, and answer with the whole list either way — it is
// short, the client redraws the pills from it, and that spares a reload after
// every change.
async function viewAction(db, body) {
  const list = () => select(db, "saved_views", `select=${VIEW_COLUMNS}&order=position.asc,id.asc`);

  if (body.action === "delete_view") {
    const id = Number(body.view_id);
    if (!Number.isInteger(id) || id <= 0) return json({ error: "Bad view id." }, 400);
    await remove(db, "saved_views", `id=eq.${id}&select=id`);
    return json({ views: await list() });
  }

  const name = String(body.name || "").trim().slice(0, 60);
  if (!name) return json({ error: "A view needs a name." }, 400);
  const existing = await list();
  if (existing.length >= MAX_VIEWS) {
    return json({ error: `That is ${MAX_VIEWS} saved views. Delete one first.` }, 400);
  }
  // Facets are sanitized against this build's own facet table, so a payload
  // naming a filter that does not exist cannot be stored and read back as one.
  const row = {
    name,
    tab: body.tab ? String(body.tab).slice(0, 40) : null,
    filter: body.filter ? String(body.filter).slice(0, 40) : null,
    facets: sanitizeFacets(body.facets),
    open_only: body.open_only === true,
    position: existing.length,
  };
  // One name, one view: saving over a name you already used replaces it,
  // which is what "save" means when the name is how you find it again.
  const clash = existing.find((v) => v.name.toLowerCase() === name.toLowerCase());
  if (clash) {
    await update(db, "saved_views", `id=eq.${clash.id}&select=id`,
      { ...row, position: clash.position });
  } else {
    await insert(db, "saved_views", [row]);
  }
  return json({ views: await list() });
}

export async function POST(req) {
  const ctx = context(req);
  if (ctx.error) return ctx.error;
  const { db, today, goal } = ctx;

  let body;
  try { body = await req.json(); } catch { return json({ error: "Body must be JSON." }, 400); }

  // Saved views come first: they carry no lead_id, and the check below would
  // turn every one of them into a 400.
  if (body.action === "save_view" || body.action === "delete_view") {
    try { return await viewAction(db, body); } catch (e) {
      return dbFailure(e) ?? json({ error: e.message }, 502);
    }
  }

  const leadId = Number(body && body.lead_id);
  if (!Number.isInteger(leadId) || leadId <= 0) return json({ error: "Bad lead id." }, 400);
  if (body.callback_on != null && body.callback_on !== "" && !isIsoDate(body.callback_on)) {
    return json({ error: "Bad callback date." }, 400);
  }
  const callbackOn = body.callback_on || null;
  const notes = typeof body.notes === "string" ? body.notes.slice(0, 4000) : undefined;

  try {
    if (body.action === "outcome") {
      if (!isOutcome(body.outcome)) return json({ error: "Unknown outcome." }, 400);
      const conversation = OUTCOMES[body.outcome].conversation;
      await insert(db, "calls", [{
        lead_id: leadId,
        outcome: body.outcome,
        // Only a conversation can be with a decision maker.
        decision_maker: conversation && body.decision_maker !== false,
        contact: String(body.contact || "").slice(0, 200),
        notes: notes ?? "",
        callback_on: callbackOn,
        call_date: today,
      }]);
      const [lead] = await update(db, "leads", `id=eq.${leadId}`,
        leadPatchForOutcome({ outcome: body.outcome, callback_on: callbackOn, notes }, new Date().toISOString()));
      const calls = await select(db, "calls", `select=outcome&call_date=eq.${today}`);
      return json({ lead: lead || null, conversations: conversationCounts(calls), goal });
    }

    if (body.action === "update") {
      const patch = {};
      if (notes !== undefined) patch.notes = notes;
      if ("callback_on" in body) patch.callback_on = callbackOn;
      if (!Object.keys(patch).length) return json({ error: "Nothing to update." }, 400);
      const [lead] = await update(db, "leads", `id=eq.${leadId}`, patch);
      return json({ lead: lead || null });
    }

    return json({ error: "Unknown action." }, 400);
  } catch (e) {
    return dbFailure(e) ?? json({ error: e.message }, 502);
  }
}
