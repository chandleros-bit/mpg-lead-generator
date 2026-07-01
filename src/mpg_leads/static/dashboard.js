(function () {
  "use strict";

  var state = { leads: [], filter: "all", sort: "score", query: "", threshold: 40 };

  var el = {
    leads: document.getElementById("leads"),
    stats: document.getElementById("stats"),
    controls: document.getElementById("controls"),
    refresh: document.getElementById("refresh"),
    search: document.getElementById("search"),
    sort: document.getElementById("sort"),
  };

  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function isSignal(reason) {
    var r = reason.toLowerCase();
    return r.indexOf("complaint") >= 0 || r.indexOf("no website") >= 0 ||
           r.indexOf("surcharge") >= 0 || r.indexOf("cash only") >= 0;
  }

  function whyChips(why) {
    return why.map(function (w) {
      var cls = isSignal(w) ? "why-chip signal" : "why-chip";
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

  function card(lead) {
    var below = lead.score < state.threshold ? " below-target" : "";
    var meta = [esc(lead.category)];
    if (lead.rating != null) meta.push(esc(lead.rating) + "★ (" + lead.review_count + ")");
    if (lead.phone) meta.push(esc(lead.phone));
    var site = lead.website ? ' · <a href="' + esc(lead.website) + '" target="_blank" rel="noopener">site</a>' : "";
    var trackCls = lead.track === "greenfield" ? "track-greenfield" : "track-displacement";

    return (
      '<article class="lead-card' + below + '" data-track="' + lead.track +
        '" data-bucket="' + lead.bucket + '" data-name="' + esc(lead.name.toLowerCase()) + '">' +
        '<div class="lead-head">' +
          '<div class="readout">' +
            '<div class="score ' + lead.bucket + '">' + lead.score + "</div>" +
            '<div class="score-cap">' + esc(lead.bucket) + "</div>" +
          "</div>" +
          '<div class="lead-body">' +
            '<h3 class="lead-name">' + esc(lead.name) + "</h3>" +
            '<div class="lead-meta">' + meta.join(" · ") + site + "<br>" + esc(lead.address) + "</div>" +
            '<div class="why">' + whyChips(lead.why) + "</div>" +
          "</div>" +
          '<div class="lead-actions">' +
            '<span class="track-tag ' + trackCls + '">' + esc(lead.track) + "</span>" +
            '<button class="btn-copy-open" type="button" aria-expanded="false">Outreach</button>' +
          "</div>" +
        "</div>" +
        '<div class="receipt">' + receipt(lead.campaign) + "</div>" +
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
    rows.sort(function (a, b) {
      if (state.sort === "name") return a.name.localeCompare(b.name);
      return b.score - a.score;
    });
    return rows;
  }

  function render() {
    var rows = visibleLeads();
    if (!rows.length) {
      el.leads.innerHTML =
        '<div class="empty"><strong>No leads match this view.</strong>' +
        "Clear the filter, or widen your search radius and verticals in config.yaml.</div>";
      return;
    }
    var html = "";
    var dividerShown = false;
    for (var i = 0; i < rows.length; i++) {
      if (state.sort === "score" && !dividerShown && rows[i].score < state.threshold) {
        html += '<div class="divider">below target score ' + state.threshold + "</div>";
        dividerShown = true;
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
    fetch("/api/leads")
      .then(function (r) { return r.json().then(function (d) { return { ok: r.ok, d: d }; }); })
      .then(function (res) {
        if (!res.ok) {
          el.leads.innerHTML = '<div class="empty"><strong>Could not load leads.</strong>' +
            esc(res.d.error || "Unknown error") + "</div>";
          return;
        }
        state.leads = res.d.leads || [];
        state.threshold = res.d.threshold || 40;
        paintStats(res.d.summary);
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

  load();
})();
