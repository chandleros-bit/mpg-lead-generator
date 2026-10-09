// public/dashboard.js — the call desk.
//
// Two modes. "desk": leads, outcomes and the conversation count live in the
// database through /api/desk. "local": no database yet (or demo), so a run's
// leads and any outcomes live in this page only and vanish on reload. The
// banner says which one you are in.
import { buildResearchLinks } from "./research.js";
import { leadsToCsv } from "./csv.js";
import { readResponse, errorMessage } from "./response.js";
import { openStatus } from "./hours.js";
import {
  OUTCOME_LABELS, CONVERSATION_OUTCOMES, ATTEMPT_OUTCOMES, FILTERS, areaFrom, isNewLead,
  lastTouch, rowChips, visibleLeads, filterCounts, tabLeads, telHref,
} from "./desk-view.js";

(function () {
  "use strict";

  var DEMO = new URLSearchParams(location.search).get("demo") === "1";
  var TZ = "America/Chicago";
  var KEYS = { pass: "mpg_pass", tab: "mpg_tab", city: "mpg_city", state: "mpg_state", miles: "mpg_miles", open: "mpg_open_only" };
  var STATES = "AL AK AZ AR CA CO CT DE DC FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY".split(" ");
  var CONVERSATION = new Set(CONVERSATION_OUTCOMES);

  var state = {
    mode: DEMO ? "local" : "desk",
    tab: "due",
    filter: "to_call",
    openOnly: false,
    query: "",
    leads: [],          // what the current tab loaded (desk) or everything (local)
    localLeads: [],     // local mode's store
    localCalls: [],     // local mode's outcomes, for the counter
    lastRun: null,
    goal: 40,
    today: dayIn(new Date()),
    counts: null,
    conv: { total: 0, talked: 0, meeting_set: 0, not_a_fit: 0, dnc: 0 },
    openId: null,
    detail: {},         // lead id → { campaign, calls } (desk mode)
    draft: {},          // lead id → in-progress outcome form
    labels: {},
    niches: [],
    broad: [],
    defaultMarket: null,
    busy: false,
  };

  var el = {};
  ["rows", "tab-title", "tab-meta", "run-line", "conv-total", "conv-of", "conv-bar", "conv-break", "goal-label",
   "copy-tracker", "runbar", "run-btn", "run-hint", "city-input", "state-input", "miles-input", "banner", "filters",
   "open-only", "search", "download-csv", "tabs-niches", "tabs-broad", "count-due", "count-all", "count-new",
   "mode", "operator", "avatar", "brand-co", "toast"].forEach(function (id) {
    el[id.replace(/-([a-z])/g, function (_, c) { return c.toUpperCase(); })] = document.getElementById(id);
  });

  // ---------- small helpers ----------

  function store(k, v) { try { if (v == null || v === "") localStorage.removeItem(k); else localStorage.setItem(k, v); } catch (e) { /* storage off */ } }
  function recall(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }

  function dayIn(d) {
    return new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
  }

  function esc(s) {
    return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  function getPass() { return recall(KEYS.pass) || ""; }
  function ensurePass() {
    var p = getPass();
    if (!p && !DEMO) {
      p = window.prompt("Enter passphrase to open your lead desk:") || "";
      if (p) store(KEYS.pass, p);
    }
    return p;
  }

  function api(path, opts) {
    opts = opts || {};
    var headers = Object.assign({}, opts.headers || {});
    if (!DEMO) headers["X-App-Passphrase"] = ensurePass();
    if (opts.body) headers["Content-Type"] = "application/json";
    return fetch(path, { method: opts.method || "GET", headers: headers, body: opts.body ? JSON.stringify(opts.body) : undefined })
      .then(readResponse)
      .then(function (res) {
        if (res.status === 401) store(KEYS.pass, null);
        return res;
      });
  }

  var toastTimer = null;
  function toast(msg) {
    el.toast.textContent = msg;
    el.toast.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.toast.hidden = true; }, 3200);
  }

  function banner(msg, kind) {
    if (!msg) { el.banner.hidden = true; return; }
    el.banner.className = "banner" + (kind ? " " + kind : "");
    el.banner.innerHTML = msg;
    el.banner.hidden = false;
  }

  function copyText(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) return navigator.clipboard.writeText(text);
    var ta = document.createElement("textarea");
    ta.value = text; document.body.appendChild(ta); ta.select();
    try { document.execCommand("copy"); } finally { document.body.removeChild(ta); }
    return Promise.resolve();
  }

  function isVerticalTab(tab) { return tab !== "due" && tab !== "all" && tab !== "new_week"; }
  function labelFor(id) { return state.labels[id] || String(id || "").replace(/_/g, " "); }

  function tabTitle(tab) {
    if (tab === "due") return "Due today";
    if (tab === "all") return "All leads";
    if (tab === "new_week") return "New this week";
    return labelFor(tab);
  }

  // ---------- counts ----------

  function localCounts() {
    var counts = { all: 0, due: 0, new_week: 0, verticals: {} };
    var weekAgo = Date.now() - 7 * 86400000;
    state.localLeads.forEach(function (l) {
      if (l.status === "dnc") return;
      counts.all++;
      counts.verticals[l.vertical] = (counts.verticals[l.vertical] || 0) + 1;
      if (l.callback_on && l.callback_on <= state.today) counts.due++;
      if (l.is_new || (l.first_seen_at && Date.parse(l.first_seen_at) >= weekAgo)) counts.new_week++;
    });
    return counts;
  }

  function localConv() {
    var c = { total: 0, talked: 0, meeting_set: 0, not_a_fit: 0, dnc: 0 };
    state.localCalls.forEach(function (call) {
      if (call.call_date === state.today && CONVERSATION.has(call.outcome)) { c.total++; c[call.outcome]++; }
    });
    return c;
  }

  // ---------- rendering ----------

  function renderSidebar() {
    var counts = state.mode === "local" ? localCounts() : (state.counts || { all: 0, due: 0, new_week: 0, verticals: {} });
    el.countDue.textContent = counts.due;
    el.countAll.textContent = counts.all;
    el.countNew.textContent = counts.new_week;
    function tabs(list) {
      return list.map(function (v) {
        return '<button class="tab" type="button" data-tab="' + esc(v.id) + '"><span class="tab-label">' + esc(v.label) +
          '</span><span class="tab-count">' + (counts.verticals[v.id] || 0) + "</span></button>";
      }).join("");
    }
    el.tabsNiches.innerHTML = tabs(state.niches);
    el.tabsBroad.innerHTML = tabs(state.broad);
    document.querySelectorAll(".tab").forEach(function (b) {
      b.classList.toggle("is-active", b.getAttribute("data-tab") === state.tab);
      b.setAttribute("aria-current", b.getAttribute("data-tab") === state.tab ? "page" : "false");
    });
  }

  function renderCounter() {
    var conv = state.mode === "local" ? localConv() : state.conv;
    var goal = state.goal || 40;
    el.convTotal.textContent = conv.total;
    el.convOf.textContent = "/ " + goal;
    el.goalLabel.textContent = "Goal " + goal;
    el.convBar.style.width = Math.min(100, Math.round((conv.total / goal) * 100)) + "%";
    el.convTotal.parentNode.parentNode.classList.toggle("hit", conv.total >= goal);
    el.convBreak.innerHTML =
      "<span><b>" + conv.talked + "</b> talked</span>" +
      "<span><b>" + conv.meeting_set + "</b> meeting set</span>" +
      "<span><b>" + conv.not_a_fit + "</b> not a fit</span>" +
      "<span><b>" + conv.dnc + "</b> do not contact</span>";
  }

  function fmtRunTime(iso) {
    try {
      return new Intl.DateTimeFormat("en-US", { timeZone: TZ, weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(iso));
    } catch (e) { return ""; }
  }

  function renderHead() {
    el.tabTitle.textContent = tabTitle(state.tab);
    var inTab = tabLeads(currentPool(), state.tab, state.today);
    var toCall = inTab.filter(function (l) { return l.status === "to_call"; }).length;
    var bits = [inTab.length + " lead" + (inTab.length === 1 ? "" : "s")];
    if (state.tab !== "due") bits.push(toCall + " to call");
    var r = state.lastRun;
    if (r && r.city) bits.push(r.city + (r.state ? ", " + r.state : ""));
    el.tabMeta.textContent = bits.join(" · ");

    var vt = isVerticalTab(state.tab);
    el.runbar.hidden = !vt;
    el.runHint.hidden = vt;
    el.runBtn.textContent = vt ? "Run " + labelFor(state.tab) + " search" : "Run search";

    if (r && vt) {
      el.runLine.innerHTML = '<span class="run-dot">Last run ' + esc(fmtRunTime(r.created_at)) + "</span>" +
        "<span><b>" + (r.new_count || 0) + " new</b> added</span>" +
        "<span>" + (r.existing_count || 0) + " already saved, skipped</span>";
    } else {
      el.runLine.innerHTML = "";
    }
  }

  function renderFilters() {
    var pool = tabLeads(currentPool(), state.tab, state.today);
    var counts = filterCounts(pool, lastRunId());
    el.filters.hidden = state.tab === "due";
    el.filters.innerHTML = FILTERS.map(function (f) {
      return '<button type="button" data-filter="' + f[0] + '" class="' + (state.filter === f[0] ? "is-active" : "") +
        '" aria-pressed="' + (state.filter === f[0]) + '">' + f[1] + " <span>" + counts[f[0]] + "</span></button>";
    }).join("");
  }

  function currentPool() { return state.mode === "local" ? state.localLeads : state.leads; }
  function lastRunId() { return state.lastRun ? state.lastRun.id : null; }

  function visible() {
    return visibleLeads(currentPool(), {
      tab: state.tab, filter: state.filter, openOnly: state.openOnly, query: state.query,
      today: state.today, lastRunId: lastRunId(), nowMs: Date.now(),
    });
  }

  var PHONE_SVG = '<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1.9.4 1.8.7 2.7a2 2 0 0 1-.5 2.1L8 9.8a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.7.7a2 2 0 0 1 1.7 2z"/></svg>';
  var CHEVRON = '<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>';

  function rowHtml(l) {
    var open = state.openId === l.id;
    var hours = openStatus(l.hours, Date.now());
    var touch = lastTouch(l, state.today);
    var tel = telHref(l.phone);
    var sub = [areaFrom(l.address), l.track === "greenfield" ? "Greenfield" : "Displacement"];
    if (state.tab === "all" || state.tab === "due" || state.tab === "new_week") sub.push(labelFor(l.vertical));
    var chips = rowChips(l.why).map(function (c) {
      return '<span class="chip' + (c.kind === "plain" ? "" : " " + c.kind) + '" title="' + esc(c.text) + '">' + esc(c.text) + "</span>";
    }).join("");
    return (
      '<div class="row' + (open ? " is-open" : "") + '" data-id="' + esc(l.id) + '">' +
        '<div class="row-main">' +
          '<span class="score ' + esc(l.bucket) + '" aria-label="Score ' + esc(l.score) + ", " + esc(l.bucket) + '">' + esc(l.score) + "</span>" +
          '<div class="biz"><span class="biz-name"><span class="nm">' + esc(l.name) + "</span>" +
            (isNewLead(l, lastRunId()) ? '<span class="badge-new">New</span>' : "") + "</span>" +
            '<span class="biz-sub">' + esc(sub.filter(Boolean).join(" · ")) + "</span></div>" +
          '<div class="chips">' + chips + "</div>" +
          '<div class="phone"><span class="phone-num">' + esc(l.phone || "No phone listed") + "</span>" +
            (hours ? '<span class="hours' + (hours.open ? " open" : "") + '">' + esc(hours.label) + "</span>" : "") + "</div>" +
          '<span class="touch ' + touch.kind + '">' + esc(touch.text) + "</span>" +
          '<span class="acts">' +
            (tel ? '<a class="call" href="' + esc(tel) + '" data-call="1">' + PHONE_SVG + "Call</a>"
                 : '<span class="call none">' + PHONE_SVG + "Call</span>") +
            '<button class="exp" type="button" aria-expanded="' + open + '" aria-label="' + (open ? "Hide" : "Show") + ' details for ' + esc(l.name) + '">' + CHEVRON + "</button>" +
          "</span>" +
        "</div>" +
        (open ? detailHtml(l) : "") +
      "</div>"
    );
  }

  function draftFor(l) {
    if (!state.draft[l.id]) {
      state.draft[l.id] = { outcome: null, dm: true, contact: "", callback: l.callback_on || "", notes: l.notes || "" };
    }
    return state.draft[l.id];
  }

  function researchLinks(l) {
    return buildResearchLinks({ name: l.name, address: l.address, website: l.website, place_id: l.place_id }).map(function (link) {
      if (link.copyName) {
        return '<button type="button" data-href="' + esc(link.href) + '" data-copy-name="' + esc(link.copyName) + '">' + esc(link.label) + "</button>";
      }
      return '<a href="' + esc(link.href) + '" target="_blank" rel="noopener">' + esc(link.label) + "</a>";
    }).join("");
  }

  function campaignFor(l) {
    if (l.campaign) return l.campaign;
    var d = state.detail[l.id];
    return d && d.campaign;
  }

  function detailHtml(l) {
    var d = draftFor(l);
    var camp = campaignFor(l);
    var who = (l.decision_makers || []).join(", then ") || "Owner";
    var owner = l.owner && (l.owner.name || l.owner.email)
      ? '<span class="owner">Owner on site: <strong>' + esc(l.owner.name || "") + "</strong>" +
        (l.owner.email ? ' · <a href="mailto:' + esc(l.owner.email) + '">' + esc(l.owner.email) + "</a>" : "") + "</span>"
      : "";
    var talk = camp ? '<p class="talk">' + esc(camp.voicemail) + "</p>" : '<p class="talk">Loading outreach…</p>';
    var copies = camp
      ? '<button class="btn btn-sm" type="button" data-copy="' + esc("Subject: " + camp.email1_subject + "\n\n" + camp.email1_body) + '">Copy email 1</button>' +
        '<button class="btn btn-sm" type="button" data-copy="' + esc("Subject: " + camp.email2_subject + "\n\n" + camp.email2_body) + '">Email 2</button>' +
        '<button class="btn btn-sm" type="button" data-copy="' + esc(camp.sms) + '">SMS</button>' +
        '<button class="btn btn-sm" type="button" data-copy="' + esc(camp.voicemail) + '">Voicemail</button>'
      : "";
    function ob(o) {
      return '<button class="ob' + (o === "dnc" ? " dnc" : "") + '" type="button" data-outcome="' + o + '" aria-pressed="' + (d.outcome === o) + '">' +
        esc(o === "voicemail" ? "Left voicemail" : OUTCOME_LABELS[o]) + "</button>";
    }
    var conv = d.outcome && CONVERSATION.has(d.outcome);
    return (
      '<div class="detail">' +
        '<div class="dcol">' +
          '<span class="dlabel">Ask for</span><span class="ask">' + esc(who) + "</span>" + owner +
          '<span class="links">' + researchLinks(l) + "</span>" +
          '<label class="dlabel" for="notes-' + esc(l.id) + '">Notes</label>' +
          '<textarea class="notes" id="notes-' + esc(l.id) + '" data-field="notes" placeholder="Who you talked to, what they use, contract end date">' + esc(d.notes) + "</textarea>" +
        "</div>" +
        '<div class="dcol">' +
          '<span class="dlabel">What to say</span>' + talk +
          (copies ? '<span class="dlabel">Follow-up</span><div class="copies">' + copies + "</div>" : "") +
          (l.website ? '<a class="dlabel" href="' + esc(l.website) + '" target="_blank" rel="noopener">Open website</a>' : "") +
        "</div>" +
        '<div class="dcol outcome">' +
          '<span class="out-title">Call outcome</span>' +
          '<div class="out-group"><span class="out-sub">No conversation</span><div class="out-btns">' + ATTEMPT_OUTCOMES.map(ob).join("") + "</div></div>" +
          '<div class="out-group"><span class="out-sub">Conversation · counts toward today\'s goal</span><div class="out-btns">' + CONVERSATION_OUTCOMES.map(ob).join("") + "</div></div>" +
          '<div class="out-fields">' +
            (conv ? '<label class="dm"><input type="checkbox" data-field="dm"' + (d.dm ? " checked" : "") + '>Spoke with the decision maker</label>' : "") +
            (conv ? '<label>Spoke with<input type="text" data-field="contact" placeholder="Mike / Owner" value="' + esc(d.contact) + '"></label>' : "") +
            '<label>Call back on<input type="date" data-field="callback" value="' + esc(d.callback) + '"></label>' +
            '<button class="btn btn-dark save-next" type="button" data-save="1"' + (d.outcome ? "" : " disabled") + ">Save and next lead " + CHEVRON + "</button>" +
          "</div>" +
        "</div>" +
      "</div>"
    );
  }

  function renderRows() {
    var rows = visible();
    if (!rows.length) {
      var msg = state.tab === "due" ? "<strong>Nothing due today.</strong>Callbacks you set show up here on their day."
        : currentPool().length === 0 && isVerticalTab(state.tab)
          ? "<strong>No saved leads in " + esc(labelFor(state.tab)) + " yet.</strong>Pick a city and run a search."
          : "<strong>No leads match.</strong>Try another filter, or turn off Open now only.";
      el.rows.innerHTML = '<div class="empty">' + msg + "</div>";
      return;
    }
    el.rows.innerHTML = rows.map(rowHtml).join("");
  }

  function render() {
    renderSidebar();
    renderHead();
    renderFilters();
    renderCounter();
    renderRows();
  }

  function rerenderRow(id) {
    var node = el.rows.querySelector('.row[data-id="' + cssEsc(id) + '"]');
    var lead = findLead(id);
    if (!node || !lead) { renderRows(); return; }
    var tmp = document.createElement("div");
    tmp.innerHTML = rowHtml(lead);
    node.replaceWith(tmp.firstChild);
  }

  function cssEsc(s) { return String(s).replace(/["\\]/g, "\\$&"); }

  function findLead(id) {
    var pool = currentPool();
    for (var i = 0; i < pool.length; i++) if (String(pool[i].id) === String(id)) return pool[i];
    return null;
  }

  // ---------- loading ----------

  function loadTab() {
    state.today = dayIn(new Date());
    if (state.mode === "local") { render(); return Promise.resolve(); }
    var v = isVerticalTab(state.tab) ? state.tab : "all";
    el.rows.innerHTML = '<div class="state">Loading…</div>';
    return api("/api/desk?vertical=" + encodeURIComponent(v)).then(function (res) {
      if (res.status === 503 && res.parsed && res.data.configured === false) {
        state.mode = "local";
        banner("<strong>Saving is not set up yet.</strong> Searches still work, but leads and call outcomes on this page are lost when you reload.", "");
        render();
        return;
      }
      if (res.status === 401) {
        el.rows.innerHTML = '<div class="empty"><strong>Passphrase rejected.</strong>Reload the page to try again.</div>';
        return;
      }
      if (!res.ok || !res.parsed) {
        el.rows.innerHTML = '<div class="empty"><strong>Could not load leads.</strong>' + esc(errorMessage(res)) + "</div>";
        return;
      }
      var d = res.data;
      state.leads = d.leads || [];
      state.counts = d.counts;
      state.conv = d.conversations || state.conv;
      state.goal = d.goal || state.goal;
      state.today = d.today || state.today;
      state.lastRun = d.last_run || null;
      render();
    }).catch(function () {
      el.rows.innerHTML = '<div class="empty"><strong>Could not reach the server.</strong>Check your connection and reload.</div>';
    });
  }

  function runSearch() {
    if ((!isVerticalTab(state.tab) && !DEMO) || state.busy) return;
    var city = el.cityInput.value.trim();
    var st = el.stateInput.value;
    var miles = el.milesInput.value.trim();
    store(KEYS.city, city); store(KEYS.state, st); if (miles) store(KEYS.miles, miles);
    var qs = ["vertical=" + encodeURIComponent(state.tab)];
    if (DEMO) qs = ["demo=1"];
    else {
      if (city) { qs.push("city=" + encodeURIComponent(city)); qs.push("state=" + encodeURIComponent(st)); }
      if (miles) qs.push("miles=" + encodeURIComponent(miles));
    }
    state.busy = true;
    el.runBtn.disabled = true;
    el.runBtn.textContent = "Searching…";
    banner("");
    api("/api/leads?" + qs.join("&")).then(function (res) {
      if (!res.ok || !res.parsed) { banner("<strong>The search failed.</strong> " + esc(errorMessage(res)), "err"); return; }
      var d = res.data;
      var save = d.save || {};
      if (save.saved) {
        toast((save.new_count || 0) + " new leads added. " + (save.existing_count || 0) + " were already saved.");
        return loadTab();
      }
      if (save.configured && save.error) {
        banner("<strong>Found " + d.leads.length + " leads, but saving failed:</strong> " + esc(save.error) + " They are shown below for now.", "err");
      }
      mergeLocal(d.leads || [], d.market);
      if (state.mode !== "local") state.mode = "local";
      render();
    }).catch(function () {
      banner("<strong>Could not reach the server.</strong> Check your connection and try again.", "err");
    }).then(function () {
      state.busy = false;
      el.runBtn.disabled = false;
      renderHead();
    });
  }

  // Local mode: dedupe by Google listing id, exactly like the database does.
  function mergeLocal(rows, market) {
    var byPlace = {};
    state.localLeads.forEach(function (l) { byPlace[l.place_id] = l; });
    var added = 0;
    var runId = Date.now();
    rows.forEach(function (r) {
      var v = r.vertical || state.tab;
      var existing = byPlace[r.place_id];
      if (existing) {
        Object.assign(existing, { score: r.score, bucket: r.bucket, why: r.why, signals: r.signals, processor: r.processor,
          financing: r.financing, campaign: r.campaign, hours: r.hours || existing.hours, is_new: false });
        return;
      }
      added++;
      var l = Object.assign({}, r, { id: r.place_id, vertical: v, status: "to_call", notes: "", callback_on: null,
        last_outcome: null, is_new: true, first_seen_at: new Date().toISOString(), first_run_id: runId });
      byPlace[r.place_id] = l;
      state.localLeads.push(l);
    });
    state.lastRun = { id: runId, created_at: new Date().toISOString(), new_count: added,
      existing_count: rows.length - added, city: market && market.city, state: market && market.state };
  }

  // ---------- outcomes ----------

  function saveOutcome(id) {
    var lead = findLead(id);
    var d = state.draft[id];
    if (!lead || !d || !d.outcome) return;
    var list = visible();
    var idx = list.findIndex(function (l) { return String(l.id) === String(id); });
    var next = list[idx + 1] || null;
    var conv = CONVERSATION.has(d.outcome);
    var payload = { action: "outcome", lead_id: lead.id, outcome: d.outcome, decision_maker: conv && d.dm,
      contact: conv ? d.contact : "", notes: d.notes, callback_on: d.callback || null };

    function applyLocal() {
      var statusFor = { no_answer: "to_call", voicemail: "to_call", talked: "worked", meeting_set: "worked", not_a_fit: "worked", dnc: "dnc" };
      Object.assign(lead, { status: statusFor[d.outcome], last_outcome: d.outcome, last_touch_at: new Date().toISOString(),
        callback_on: d.callback || null, notes: d.notes });
      state.localCalls.push({ lead_id: lead.id, outcome: d.outcome, call_date: state.today });
    }

    function after() {
      delete state.draft[id];
      state.openId = next ? next.id : null;
      render();
      if (next) fetchDetail(next);
      toast(OUTCOME_LABELS[d.outcome] + " saved" + (conv ? ". Conversation counted." : "."));
      var row = next && el.rows.querySelector('.row[data-id="' + cssEsc(next.id) + '"]');
      if (row) row.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }

    if (state.mode === "local") { applyLocal(); after(); return; }

    var btn = el.rows.querySelector('.row[data-id="' + cssEsc(id) + '"] [data-save]');
    if (btn) { btn.disabled = true; btn.textContent = "Saving…"; }
    api("/api/desk", { method: "POST", body: payload }).then(function (res) {
      if (!res.ok || !res.parsed) { toast("Could not save: " + errorMessage(res)); rerenderRow(id); return; }
      Object.assign(lead, res.data.lead || {});
      if (res.data.conversations) state.conv = res.data.conversations;
      after();
      refreshCounts();
    }).catch(function () { toast("Could not reach the server. Nothing was saved."); rerenderRow(id); });
  }

  function saveNotes(id, notes) {
    var lead = findLead(id);
    if (!lead || (lead.notes || "") === notes) return;
    if (state.mode === "local") { lead.notes = notes; return; }
    api("/api/desk", { method: "POST", body: { action: "update", lead_id: lead.id, notes: notes } }).then(function (res) {
      if (res.ok && res.parsed && res.data.lead) lead.notes = res.data.lead.notes;
      else toast("Notes not saved: " + errorMessage(res));
    });
  }

  // Sidebar numbers after a save: callbacks and do-not-contact move them.
  function refreshCounts() {
    api("/api/desk").then(function (res) {
      if (res.ok && res.parsed && res.data.counts) {
        state.counts = res.data.counts;
        if (res.data.conversations) state.conv = res.data.conversations;
        renderSidebar();
        renderCounter();
      }
    });
  }

  function fetchDetail(l) {
    if (!l || campaignFor(l) || state.mode === "local") return;
    api("/api/desk?lead=" + encodeURIComponent(l.id)).then(function (res) {
      if (!res.ok || !res.parsed) return;
      state.detail[l.id] = { campaign: res.data.lead && res.data.lead.campaign, calls: res.data.calls || [] };
      if (state.openId === l.id) rerenderRow(l.id);
    });
  }

  function toggleRow(id, forceOpen) {
    var wasOpen = String(state.openId) === String(id);
    var prev = state.openId;
    state.openId = forceOpen || !wasOpen ? findLead(id) && findLead(id).id : null;
    if (prev != null && String(prev) !== String(id)) rerenderRow(prev);
    rerenderRow(id);
    if (state.openId != null) fetchDetail(findLead(id));
  }

  // ---------- events ----------

  document.querySelector(".side").addEventListener("click", function (e) {
    var b = e.target.closest(".tab");
    if (!b) return;
    state.tab = b.getAttribute("data-tab");
    state.openId = null;
    if (state.tab !== "due" && state.filter === "worked" && !isVerticalTab(state.tab)) state.filter = "to_call";
    store(KEYS.tab, state.tab);
    loadTab();
  });

  el.filters.addEventListener("click", function (e) {
    var b = e.target.closest("[data-filter]");
    if (!b) return;
    state.filter = b.getAttribute("data-filter");
    state.openId = null;
    renderFilters();
    renderRows();
  });

  el.openOnly.addEventListener("change", function () {
    state.openOnly = el.openOnly.checked;
    store(KEYS.open, state.openOnly ? "1" : "");
    renderRows();
  });

  el.search.addEventListener("input", function () { state.query = el.search.value; renderRows(); });

  el.runbar.addEventListener("submit", function (e) { e.preventDefault(); runSearch(); });

  el.rows.addEventListener("click", function (e) {
    var row = e.target.closest(".row");
    if (!row) return;
    var id = row.getAttribute("data-id");

    if (e.target.closest("[data-call]")) {
      // Let the tel: link dial, and open the row so the outcome is one click away.
      if (String(state.openId) !== String(id)) toggleRow(id, true);
      return;
    }
    var copy = e.target.closest("[data-copy]");
    if (copy) { copyText(copy.getAttribute("data-copy")).then(function () { toast("Copied."); }); return; }
    var comp = e.target.closest("[data-copy-name]");
    if (comp) {
      copyText(comp.getAttribute("data-copy-name")).then(function () {
        toast("Business name copied. Paste it into the Comptroller search.");
        window.open(comp.getAttribute("data-href"), "_blank", "noopener");
      });
      return;
    }
    var out = e.target.closest("[data-outcome]");
    if (out) {
      var d = draftFor(findLead(id));
      var o = out.getAttribute("data-outcome");
      d.outcome = d.outcome === o ? null : o;
      rerenderRow(id);
      return;
    }
    if (e.target.closest("[data-save]")) { saveOutcome(id); return; }
    if (e.target.closest(".detail")) return;
    if (e.target.closest("a")) return;
    toggleRow(id);
  });

  el.rows.addEventListener("input", function (e) {
    var row = e.target.closest(".row");
    var field = e.target.getAttribute("data-field");
    if (!row || !field) return;
    var d = draftFor(findLead(row.getAttribute("data-id")));
    if (field === "dm") d.dm = e.target.checked;
    else if (field === "callback") d.callback = e.target.value;
    else d[field] = e.target.value;
  });

  el.rows.addEventListener("change", function (e) {
    var row = e.target.closest(".row");
    if (row && e.target.getAttribute("data-field") === "dm") draftFor(findLead(row.getAttribute("data-id"))).dm = e.target.checked;
  });

  el.rows.addEventListener("focusout", function (e) {
    if (e.target.getAttribute && e.target.getAttribute("data-field") === "notes") {
      var row = e.target.closest(".row");
      if (row) saveNotes(row.getAttribute("data-id"), e.target.value);
    }
  });

  el.copyTracker.addEventListener("click", function () {
    if (state.mode === "local") { toast("Saving is not set up, so there is no call history to copy yet."); return; }
    api("/api/desk?export=today").then(function (res) {
      if (!res.ok || !res.parsed) { toast("Could not build the tracker rows: " + errorMessage(res)); return; }
      if (!res.data.rows) { toast("No conversations logged today yet."); return; }
      copyText(res.data.tsv).then(function () {
        toast("Copied " + res.data.rows + " row" + (res.data.rows === 1 ? "" : "s") + ". Paste into the first empty row on the Visits tab.");
      });
    });
  });

  el.downloadCsv.addEventListener("click", function () {
    var rows = visible().map(function (l) { return Object.assign({ category: labelFor(l.vertical) }, l); });
    var blob = new Blob([leadsToCsv(rows)], { type: "text/csv;charset=utf-8" });
    var a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "leads-" + state.tab + "-" + state.today + ".csv";
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
  });

  // ---------- start ----------

  function init() {
    el.stateInput.innerHTML = STATES.map(function (s) { return "<option>" + s + "</option>"; }).join("");
    el.cityInput.value = recall(KEYS.city) || "";
    state.openOnly = recall(KEYS.open) === "1";
    el.openOnly.checked = state.openOnly;
    if (DEMO) {
      el.mode.textContent = "Demo data";
      el.mode.classList.add("demo");
      banner("<strong>Demo mode.</strong> Sample leads, nothing is saved. Run a search to load them.", "");
    }

    var shell = Promise.all([
      fetch("verticals.json").then(function (r) { return r.json(); }).catch(function () { return []; }),
      fetch("config.json").then(function (r) { return r.json(); }).catch(function () { return null; }),
    ]).then(function (out) {
      var list = out[0] || [];
      var cfg = out[1];
      list.forEach(function (v) { state.labels[v.id] = v.label; });
      state.niches = list.filter(function (v) { return v.featured; });
      state.broad = list.filter(function (v) { return !v.featured; });
      if (cfg) {
        if (cfg.personal && cfg.personal.name) {
          el.operator.textContent = cfg.personal.name;
          el.avatar.textContent = cfg.personal.name.split(/\s+/).map(function (w) { return w[0]; }).join("").slice(0, 2).toUpperCase();
        }
        if (cfg.personal && cfg.personal.company) el.brandCo.textContent = cfg.personal.company;
        state.defaultMarket = cfg.search && cfg.search.market;
        if (state.defaultMarket) el.cityInput.placeholder = state.defaultMarket.city;
        el.stateInput.value = recall(KEYS.state) || (state.defaultMarket && state.defaultMarket.state) || "TX";
        var m = cfg.search && cfg.search.radius_meters;
        el.milesInput.value = recall(KEYS.miles) || (m ? Math.max(1, Math.round(m / 1609.344)) : 9);
      }
      var saved = recall(KEYS.tab);
      var known = saved && (state.labels[saved] || saved === "due" || saved === "all" || saved === "new_week");
      state.tab = DEMO ? "all" : known ? saved : "due";
    });

    shell.then(loadTab).then(function () { if (DEMO) runSearch(); });
  }

  init();
})();
