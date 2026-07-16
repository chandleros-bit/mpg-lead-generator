import { buildResearchLinks } from "./research.js";
import { leadsToCsv } from "./csv.js";
import { sortLeads, BUCKET_ORDER } from "./sort.js";

(function () {
  "use strict";

  // Confidence is the default order: the list's job is "who do I call first",
  // and score alone can't answer that — a 72/medium and a 71/low are adjacent
  // numbers and completely different leads.
  var state = { leads: [], filter: "all", sort: "confidence", query: "", threshold: 40, verticals: [] };

  var DEMO = new URLSearchParams(location.search).get("demo") === "1";
  var PASS_KEY = "mpg_pass";
  var LOC_KEY = "mpg_loc";
  var MILES_KEY = "mpg_miles";

  function getPass() { return localStorage.getItem(PASS_KEY) || ""; }
  function ensurePass() {
    var p = getPass();
    if (!p) {
      p = window.prompt("Enter passphrase to fetch live leads:") || "";
      if (p) localStorage.setItem(PASS_KEY, p);
    }
    return p;
  }

  function milesFromMeters(m) { return Math.max(1, Math.round(m / 1609.344)); }

  function setContext(verticals, miles) {
    document.getElementById("context").innerHTML =
      "Searching <strong>" + esc(verticals.join(", ")) + "</strong> within " +
      "<strong>" + esc(miles) + " mi</strong>. Target score <strong>" + state.threshold +
      "+</strong>. Leads below target sit under the divider.";
  }

  function initShell() {
    if (DEMO) { el.locInput.disabled = true; el.milesInput.disabled = true; }
    var savedLoc = localStorage.getItem(LOC_KEY);
    if (savedLoc) el.locInput.value = savedLoc;
    var savedMiles = localStorage.getItem(MILES_KEY);
    fetch("config.json")
      .then(function (r) { return r.json(); })
      .then(function (cfg) {
        document.getElementById("brand-name").textContent = cfg.personal.company || "Lead Desk";
        document.title = (cfg.personal.company || "Lead Desk") + " — Lead Desk";
        var op = document.getElementById("operator");
        if (cfg.personal.name) { op.textContent = cfg.personal.name; op.hidden = false; }
        state.threshold = cfg.search.score_threshold || 40;
        state.verticals = cfg.search.verticals || [];
        var miles = savedMiles || String(milesFromMeters(cfg.search.radius_meters));
        el.milesInput.value = miles;
        setContext(state.verticals, miles);
      })
      .catch(function () { /* shell is best-effort; leads still load */ });
  }

  function setModeBadge(demo) {
    var badge = document.getElementById("mode");
    badge.textContent = demo ? "Demo data" : "Live · Places API";
    badge.className = "mode-badge " + (demo ? "mode-demo" : "mode-live");
    badge.hidden = false;
  }

  var el = {
    leads: document.getElementById("leads"),
    stats: document.getElementById("stats"),
    controls: document.getElementById("controls"),
    refresh: document.getElementById("refresh"),
    search: document.getElementById("search"),
    sort: document.getElementById("sort"),
    locInput: document.getElementById("loc-input"),
    milesInput: document.getElementById("miles-input"),
    downloadCsv: document.getElementById("download-csv"),
  };

  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  // Copper = real evidence worth dialing on. A card-present POS qualifies; an
  // online-checkout or channel-unknown hit does not, so it stays a plain chip
  // rather than dressing a Stripe tag up as displacement proof.
  //
  // Anything the engine marked unconfirmed is a proxy and never earns copper —
  // "no website listed (unconfirmed)" must not look like "no website —
  // confirmed by reviews", or the styling re-invents the certainty the score
  // just gave up.
  function isSignal(reason) {
    var r = reason.toLowerCase();
    if (r.indexOf("unconfirmed") >= 0) return false;
    return r.indexOf("complaint") >= 0 || r.indexOf("no website") >= 0 ||
           r.indexOf("surcharge") >= 0 || r.indexOf("cash only") >= 0 ||
           r.indexOf("card-present") >= 0;
  }

  function isWarning(reason) {
    return reason.toLowerCase().indexOf("temporarily closed") >= 0;
  }

  function whyChips(why) {
    return why.map(function (w) {
      var cls = "why-chip";
      if (isWarning(w)) cls += " warn";
      else if (isSignal(w)) cls += " signal";
      return '<span class="' + cls + '">' + esc(w) + "</span>";
    }).join("");
  }

  function touchBlock(label, subject, body) {
    var subj = subject ? '<p class="touch-subject">Subject: ' + esc(subject) + "</p>" : "";
    var payload = subject ? "Subject: " + subject + "\n\n" + body : body;
    return (
      '<div class="touch">' +
        '<div class="touch-head">' +
          '<span class="touch-label">' + esc(label) + "</span>" +
          '<button class="btn-copy" type="button" data-copy="' + esc(payload) + '">Copy</button>' +
        "</div>" +
        subj +
        '<pre class="touch-copy">' + esc(body) + "</pre>" +
      "</div>"
    );
  }

  function receipt(c) {
    return (
      '<div class="receipt-inner">' +
        '<div class="receipt-head">Outreach sequence · generate-only</div>' +
        touchBlock("Email 1 — opener", c.email1_subject, c.email1_body) +
        touchBlock("Email 2 — follow-up", c.email2_subject, c.email2_body) +
        touchBlock("SMS", "", c.sms) +
        touchBlock("Voicemail", "", c.voicemail) +
      "</div>"
    );
  }

  function researchLinkEl(link) {
    if (link.copyName) {
      // Comptroller: a button so the handler can copy-then-open with a confirmation.
      return '<button class="research-link" type="button" data-href="' + esc(link.href) +
        '" data-copy-name="' + esc(link.copyName) + '">' + esc(link.label) + "</button>";
    }
    return '<a class="research-link" href="' + esc(link.href) +
      '" target="_blank" rel="noopener">' + esc(link.label) + "</a>";
  }

  function ownerLine(lead) {
    var o = lead.owner;
    if (!o || (!o.name && !o.email)) return "";
    var bits = [];
    if (o.name) bits.push("<strong>" + esc(o.name) + "</strong>" + (o.title ? " · " + esc(o.title) : ""));
    if (o.email) bits.push('<a href="mailto:' + esc(o.email) + '">' + esc(o.email) + "</a>");
    return '<div class="research-owner">Owner: ' + bits.join(" · ") + "</div>";
  }

  function researchPanel(lead) {
    var links = buildResearchLinks(lead).map(researchLinkEl).join("");
    return (
      '<div class="research-inner">' +
        '<div class="research-head">Who to ask for · research before you call</div>' +
        ownerLine(lead) +
        '<div class="research-links">' + links + "</div>" +
      "</div>"
    );
  }

  function card(lead) {
    var below = lead.score < state.threshold ? " below-target" : "";
    var meta = [esc(lead.category)];
    if (lead.rating != null) meta.push(esc(lead.rating) + "★ (" + lead.review_count + ")");
    if (lead.phone) meta.push(esc(lead.phone));
    var site = lead.website ? ' · <a href="' + esc(lead.website) + '" target="_blank" rel="noopener">site</a>' : "";
    var trackCls = lead.track === "greenfield" ? "track-greenfield" : "track-displacement";

    var conf = lead.confidence || "low";
    var n = (lead.signals || []).length;
    var confLabel = conf.charAt(0).toUpperCase() + conf.slice(1);

    return (
      '<article class="lead-card' + below + '" data-track="' + lead.track +
        '" data-bucket="' + lead.bucket + '" data-confidence="' + conf +
        '" data-source="' + esc(lead.source || "places") +
        '" data-name="' + esc(lead.name.toLowerCase()) + '">' +
        '<div class="lead-head">' +
          '<div class="readout">' +
            '<div class="score ' + lead.bucket + '">' + lead.score + "</div>" +
            '<div class="score-cap">' + esc(lead.bucket) + "</div>" +
            // The second axis: how much of that score to believe, and on how
            // much evidence. A Hot lead can legitimately read Low here.
            '<div class="conf conf-' + conf + '">' + esc(confLabel) + "</div>" +
            '<div class="conf-count">' + n + " signal" + (n === 1 ? "" : "s") + "</div>" +
          "</div>" +
          '<div class="lead-body">' +
            '<h3 class="lead-name">' + esc(lead.name) + "</h3>" +
            '<div class="lead-meta">' + meta.join(" · ") + site + "<br>" + esc(lead.address) + "</div>" +
            '<div class="why">' + whyChips(lead.why) + "</div>" +
          "</div>" +
          '<div class="lead-actions">' +
            '<span class="track-tag ' + trackCls + '">' + esc(lead.track) + "</span>" +
            // Only TABC gets a tag: it's the one source that's a confirmed
            // public record rather than an inference off review count.
            (lead.source === "tabc" ? '<span class="source-tag">TABC confirmed</span>' : "") +
            '<button class="btn-research-open" type="button" aria-expanded="false">Who to ask for</button>' +
            '<button class="btn-copy-open" type="button" aria-expanded="false">Outreach</button>' +
          "</div>" +
        "</div>" +
        '<div class="receipt">' + receipt(lead.campaign) + "</div>" +
        '<div class="research">' + researchPanel(lead) + "</div>" +
      "</article>"
    );
  }

  function visibleLeads() {
    var rows = state.leads.slice();
    if (state.filter === "hot" || state.filter === "warm") {
      rows = rows.filter(function (r) { return r.bucket === state.filter; });
    } else if (state.filter === "displacement" || state.filter === "greenfield") {
      rows = rows.filter(function (r) { return r.track === state.filter; });
    }
    if (state.query) {
      rows = rows.filter(function (r) { return r.name.toLowerCase().indexOf(state.query) >= 0; });
    }
    return sortLeads(rows, state.sort);
  }

  function render() {
    var rows = visibleLeads();
    if (!rows.length) {
      el.leads.innerHTML =
        '<div class="empty"><strong>No leads match this view.</strong>' +
        "Clear the filter, or widen your search radius and verticals in config.json.</div>";
      return;
    }
    var BUCKET_DIVIDER = {
      hot: "Hot · corroborated first",
      warm: "Warm · corroborated first",
      cold: "Cold · corroborated first",
    };
    var html = "";
    var dividerShown = false;
    var lastBucket = null;
    for (var i = 0; i < rows.length; i++) {
      if (state.sort === "score" && !dividerShown && rows[i].score < state.threshold) {
        html += '<div class="divider">below target score ' + state.threshold + "</div>";
        dividerShown = true;
      }
      // Bucket sections, because confidence orders inside a bucket rather than
      // across buckets. The score-threshold divider is meaningless in this order:
      // score isn't monotonic once evidence outranks it within a band.
      if (state.sort === "confidence") {
        var bkt = BUCKET_ORDER.indexOf(rows[i].bucket) >= 0 ? rows[i].bucket : "cold";
        if (bkt !== lastBucket) {
          html += '<div class="divider divider-' + bkt + '">' + esc(BUCKET_DIVIDER[bkt]) + "</div>";
          lastBucket = bkt;
        }
      }
      html += card(rows[i]);
    }
    el.leads.innerHTML = html;
  }

  function paintStats(s) {
    document.getElementById("stat-hot").textContent = s.hot;
    document.getElementById("stat-warm").textContent = s.warm;
    document.getElementById("stat-disp").textContent = s.displacement;
    document.getElementById("stat-green").textContent = s.greenfield;
    el.stats.hidden = false;
    el.controls.hidden = false;
  }

  function load() {
    el.leads.innerHTML = '<div class="state">Scoring leads…</div>';
    el.refresh.disabled = true;

    var url;
    var opts = {};
    if (DEMO) {
      url = "/api/leads?demo=1";
    } else {
      var loc = el.locInput.value.trim();
      var miles = el.milesInput.value.trim();
      if (loc) { localStorage.setItem(LOC_KEY, loc); } else { localStorage.removeItem(LOC_KEY); }
      if (miles) { localStorage.setItem(MILES_KEY, miles); }
      var qs = [];
      if (loc) qs.push("location=" + encodeURIComponent(loc));
      if (miles) qs.push("miles=" + encodeURIComponent(miles));
      url = "/api/leads" + (qs.length ? "?" + qs.join("&") : "");
      if (state.verticals.length) setContext(state.verticals, miles || el.milesInput.value);
      var p = ensurePass();
      opts.headers = { "X-App-Passphrase": p };
    }

    fetch(url, opts)
      .then(function (r) { return r.json().then(function (d) { return { ok: r.ok, status: r.status, d: d }; }); })
      .then(function (res) {
        if (res.status === 401) {
          localStorage.removeItem(PASS_KEY);
          el.leads.innerHTML = '<div class="empty"><strong>Passphrase rejected.</strong>' +
            "Click Refresh leads to try again.</div>";
          return;
        }
        if (!res.ok) {
          el.leads.innerHTML = '<div class="empty"><strong>Could not load leads.</strong>' +
            esc(res.d.error || "Unknown error") + "</div>";
          return;
        }
        state.leads = res.d.leads || [];
        state.threshold = res.d.threshold || 40;
        setModeBadge(res.d.demo);
        paintStats(res.d.summary);
        var cf = (res.d.summary && res.d.summary.chainsFiltered) || 0;
        var clf = (res.d.summary && res.d.summary.closedFiltered) || 0;
        if (state.verticals.length) {
          setContext(state.verticals, el.milesInput.value);
          var ctx = document.getElementById("context");
          if (cf > 0) {
            ctx.innerHTML +=
              " · <strong>" + cf + "</strong> chain" + (cf === 1 ? "" : "s") + " filtered";
          }
          if (clf > 0) {
            ctx.innerHTML +=
              " · <strong>" + clf + "</strong> closed dropped";
          }
        }
        render();
      })
      .catch(function (e) {
        el.leads.innerHTML = '<div class="empty"><strong>Could not reach the server.</strong>' +
          esc(String(e)) + "</div>";
      })
      .then(function () { el.refresh.disabled = false; });
  }

  // ---- events (delegated) ----
  el.leads.addEventListener("click", function (e) {
    var openBtn = e.target.closest(".btn-copy-open");
    if (openBtn) {
      var panel = openBtn.closest(".lead-card").querySelector(".receipt");
      var open = panel.classList.toggle("open");
      openBtn.setAttribute("aria-expanded", open ? "true" : "false");
      return;
    }
    var researchBtn = e.target.closest(".btn-research-open");
    if (researchBtn) {
      var rpanel = researchBtn.closest(".lead-card").querySelector(".research");
      var ropen = rpanel.classList.toggle("open");
      researchBtn.setAttribute("aria-expanded", ropen ? "true" : "false");
      return;
    }
    var compBtn = e.target.closest(".research-link[data-copy-name]");
    if (compBtn) {
      navigator.clipboard.writeText(compBtn.getAttribute("data-copy-name"));
      window.open(compBtn.getAttribute("data-href"), "_blank", "noopener");
      var oldTxt = compBtn.textContent;
      compBtn.textContent = "Name copied → paste";
      compBtn.classList.add("copied");
      setTimeout(function () { compBtn.textContent = oldTxt; compBtn.classList.remove("copied"); }, 1600);
      return;
    }
    var copyBtn = e.target.closest(".btn-copy");
    if (copyBtn) {
      navigator.clipboard.writeText(copyBtn.getAttribute("data-copy")).then(function () {
        var old = copyBtn.textContent;
        copyBtn.textContent = "Copied";
        copyBtn.classList.add("copied");
        setTimeout(function () { copyBtn.textContent = old; copyBtn.classList.remove("copied"); }, 1400);
      });
    }
  });

  document.querySelector(".filters").addEventListener("click", function (e) {
    var chip = e.target.closest(".chip");
    if (!chip) return;
    document.querySelectorAll(".chip").forEach(function (c) { c.classList.remove("is-active"); });
    chip.classList.add("is-active");
    state.filter = chip.getAttribute("data-filter");
    render();
  });

  el.search.addEventListener("input", function () { state.query = el.search.value.toLowerCase().trim(); render(); });
  el.sort.addEventListener("change", function () { state.sort = el.sort.value; render(); });
  el.refresh.addEventListener("click", load);

  // Download the current (filtered/sorted/searched) view as a CSV the user can
  // open in a spreadsheet. No-op when the view is empty so we never save a
  // header-only file by accident.
  function downloadCsv() {
    var rows = visibleLeads();
    if (!rows.length) return;
    var blob = new Blob([leadsToCsv(rows)], { type: "text/csv;charset=utf-8;" });
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url;
    a.download = "mpg-leads-" + new Date().toISOString().slice(0, 10) + ".csv";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }
  el.downloadCsv.addEventListener("click", downloadCsv);

  initShell();
  load();
})();
