# "Who to ask for" Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a collapsible "Who to ask for" panel to each lead card that launches four pre-filled research tabs (Google Business, Website, LinkedIn, TX Comptroller) so the user can find an owner/manager name before calling.

**Architecture:** Entirely client-side — every field needed (`name`, `address`, `website`, `place_id`) is already in the lead payload from `lib/pipeline.js`. URL-building logic lives in a pure ESM module `public/research.js` (unit-tested with `node --test`); `public/dashboard.js` becomes a module that imports it and renders the panel. No changes to the Netlify function, `lib/`, or config.

**Tech Stack:** Vanilla ES modules (browser + Node), `node --test`, static assets served from `public/`.

---

## Design note: why `public/research.js` (not `lib/research.js`)

The approved spec named `lib/research.js`. But Netlify's publish directory is `public/`, so files under `lib/` are **not** served to the browser (they're only bundled into the Netlify function by esbuild). Placing the pure module at `public/research.js` makes it reachable by the browser (`./research.js` relative to `public/dashboard.js`) **and** importable by Node tests (`../public/research.js`). This satisfies the spec's intent — pure ESM, `node --test`-covered, loaded in `index.html` — while being deployable.

## File structure

- **Create** `public/research.js` — pure `buildResearchLinks(lead)` (URL construction only).
- **Create** `test/research.test.js` — `node --test` coverage for `buildResearchLinks`.
- **Modify** `public/dashboard.js` — import the builder; add `researchPanel()`/`researchLinkEl()`; add the toggle button + panel in `card()`; extend the delegated click handler.
- **Modify** `public/index.html` — load `dashboard.js` as `type="module"`.
- **Modify** `public/dashboard.css` — styles for the research toggle button, panel, and links.

---

## Task 1: Pure link builder (`public/research.js`) + tests

**Files:**
- Create: `public/research.js`
- Test: `test/research.test.js`

- [ ] **Step 1: Write the failing test**

Create `test/research.test.js`:

```javascript
import test from "node:test";
import assert from "node:assert/strict";
import { buildResearchLinks } from "../public/research.js";

function lead(over = {}) {
  return {
    name: "Joe's Tacos & Bar",
    address: "123 Main St, Cypress, TX 77433",
    website: "https://joestacos.com",
    place_id: "ChIJ_abc123",
    ...over,
  };
}

function byLabel(links, label) {
  return links.find((l) => l.label === label);
}

test("Google Business link deep-links via place_id and encodes name+address", () => {
  const g = byLabel(buildResearchLinks(lead()), "Google Business");
  assert.ok(g.href.startsWith("https://www.google.com/maps/search/?api=1"));
  assert.ok(g.href.includes("query_place_id=ChIJ_abc123"));
  assert.ok(g.href.includes(encodeURIComponent("Joe's Tacos & Bar")));
  assert.ok(g.href.includes(encodeURIComponent("123 Main St, Cypress, TX 77433")));
});

test("Google Business link omits query_place_id when place_id is missing", () => {
  const g = byLabel(buildResearchLinks(lead({ place_id: "" })), "Google Business");
  assert.ok(!g.href.includes("query_place_id="));
  assert.ok(g.href.includes(encodeURIComponent("Joe's Tacos & Bar")));
});

test("LinkedIn link is a Google search scoped to linkedin.com with the name", () => {
  const l = byLabel(buildResearchLinks(lead()), "LinkedIn");
  assert.ok(l.href.startsWith("https://www.google.com/search?q="));
  assert.ok(l.href.includes(encodeURIComponent("site:linkedin.com")));
  assert.ok(l.href.includes(encodeURIComponent('"Joe\'s Tacos & Bar"')));
  assert.ok(l.href.includes(encodeURIComponent("general manager")));
});

test("Website link is a direct link when website is present", () => {
  const w = byLabel(buildResearchLinks(lead()), "Website");
  assert.equal(w.href, "https://joestacos.com");
  assert.ok(!w.copyName);
});

test("Website entry is omitted when the lead has no website", () => {
  assert.equal(byLabel(buildResearchLinks(lead({ website: "" })), "Website"), undefined);
  assert.equal(byLabel(buildResearchLinks(lead({ website: null })), "Website"), undefined);
});

test("TX Comptroller entry has the fixed COA URL and copies the business name", () => {
  const c = byLabel(buildResearchLinks(lead()), "TX Comptroller");
  assert.equal(c.href, "https://mycpa.cpa.state.tx.us/coa/");
  assert.equal(c.copyName, "Joe's Tacos & Bar");
});

test("builder returns 4 entries with a website, 3 without", () => {
  assert.equal(buildResearchLinks(lead()).length, 4);
  assert.equal(buildResearchLinks(lead({ website: "" })).length, 3);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- test/research.test.js`
Expected: FAIL — `buildResearchLinks` is not exported / module not found.

- [ ] **Step 3: Write minimal implementation**

Create `public/research.js`:

```javascript
// Pure builder for the "Who to ask for" research links. Browser-loaded from
// public/ (Netlify's publish dir) and unit-tested with node --test. No DOM here.
const COMPTROLLER_URL = "https://mycpa.cpa.state.tx.us/coa/";

export function buildResearchLinks(lead) {
  const name = lead.name || "";
  const address = lead.address || "";
  const links = [];

  // Google Business — deep-link straight to the Maps listing (reviews + owner
  // replies). Include the exact listing via place_id when we have it.
  const mapsQuery = encodeURIComponent(`${name} ${address}`.trim());
  let mapsHref = `https://www.google.com/maps/search/?api=1&query=${mapsQuery}`;
  if (lead.place_id) {
    mapsHref += `&query_place_id=${encodeURIComponent(lead.place_id)}`;
  }
  links.push({ label: "Google Business", href: mapsHref });

  // Website — direct link to the site (About / Meet the Owner). Omit when none.
  if (lead.website) {
    links.push({ label: "Website", href: lead.website });
  }

  // LinkedIn — Google search scoped to linkedin.com (avoids LinkedIn's login wall).
  const liQuery = encodeURIComponent(`site:linkedin.com "${name}" (owner OR founder OR "general manager")`);
  links.push({ label: "LinkedIn", href: `https://www.google.com/search?q=${liQuery}` });

  // TX Comptroller — Taxable Entity Search. The page is a POST form and cannot be
  // pre-filled via URL, so the click handler copies the name to the clipboard.
  links.push({ label: "TX Comptroller", href: COMPTROLLER_URL, copyName: name });

  return links;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- test/research.test.js`
Expected: PASS — all 7 tests green.

- [ ] **Step 5: Commit**

```bash
git add public/research.js test/research.test.js
git commit -m "feat: pure buildResearchLinks for 'Who to ask for' pre-call research"
```

---

## Task 2: Render the panel and wire the browser (`dashboard.js`, `index.html`)

**Files:**
- Modify: `public/dashboard.js`
- Modify: `public/index.html:74`

No unit test — this is DOM wiring, verified manually in Step 5.

- [ ] **Step 1: Import the builder at the top of `dashboard.js`**

Add as the very first line of `public/dashboard.js` (before the `(function () {` IIFE — `import` must be top-level):

```javascript
import { buildResearchLinks } from "./research.js";
```

- [ ] **Step 2: Add the panel renderers**

In `public/dashboard.js`, immediately after the `receipt()` function (ends around line 113, before `function card(lead)`), add:

```javascript
  function researchLinkEl(link) {
    if (link.copyName) {
      // Comptroller: a button so the handler can copy-then-open with a confirmation.
      return '<button class="research-link" type="button" data-href="' + esc(link.href) +
        '" data-copy-name="' + esc(link.copyName) + '">' + esc(link.label) + "</button>";
    }
    return '<a class="research-link" href="' + esc(link.href) +
      '" target="_blank" rel="noopener">' + esc(link.label) + "</a>";
  }

  function researchPanel(lead) {
    var links = buildResearchLinks(lead).map(researchLinkEl).join("");
    return (
      '<div class="research-inner">' +
        '<div class="research-head">Who to ask for · research before you call</div>' +
        '<div class="research-links">' + links + "</div>" +
      "</div>"
    );
  }
```

- [ ] **Step 3: Add the toggle button and panel in `card()`**

In `public/dashboard.js`, inside `card()`'s returned template:

(a) In the `.lead-actions` block, add the research toggle button after the existing Outreach button:

```javascript
          '<div class="lead-actions">' +
            '<span class="track-tag ' + trackCls + '">' + esc(lead.track) + "</span>" +
            '<button class="btn-research-open" type="button" aria-expanded="false">Who to ask for</button>' +
            '<button class="btn-copy-open" type="button" aria-expanded="false">Outreach</button>' +
          "</div>" +
```

(b) After the receipt panel div, add the research panel div (both are direct children of `.lead-card`):

```javascript
        '<div class="receipt">' + receipt(lead.campaign) + "</div>" +
        '<div class="research">' + researchPanel(lead) + "</div>" +
      "</article>"
```

- [ ] **Step 4: Extend the delegated click handler**

In `public/dashboard.js`, inside the `el.leads.addEventListener("click", ...)` handler, add these two blocks immediately after the existing `.btn-copy-open` block (the one that toggles `.receipt`) and before the `.btn-copy` block:

```javascript
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
```

- [ ] **Step 5: Load `dashboard.js` as a module**

In `public/index.html`, change line 74 from:

```html
  <script src="dashboard.js"></script>
```

to:

```html
  <script type="module" src="dashboard.js"></script>
```

- [ ] **Step 6: Manual verification**

Run: `npx netlify dev`
Open: `http://localhost:8888/?demo=1`
Verify:
- Each card shows a **Who to ask for** button next to **Outreach**.
- Clicking it expands a panel with **Google Business**, **LinkedIn**, **TX Comptroller**, and **Website** (Website appears only on cards that have a site; find a demo lead with no website and confirm it's absent).
- Opening the research panel does **not** close the Outreach panel and vice versa (independent toggles).
- **Google Business** / **LinkedIn** open new tabs with the business name pre-filled.
- Clicking **TX Comptroller** opens `mycpa.cpa.state.tx.us/coa/` in a new tab, the button briefly reads "Name copied → paste", and pasting (Ctrl+V) into the search box yields the business name.
- Browser console shows no module-load errors.

- [ ] **Step 7: Commit**

```bash
git add public/dashboard.js public/index.html
git commit -m "feat: 'Who to ask for' research panel + toggle on lead cards"
```

---

## Task 3: Style the panel, links, and toggle (`dashboard.css`)

**Files:**
- Modify: `public/dashboard.css`

No unit test — visual, verified manually in Step 3.

- [ ] **Step 1: Add the styles**

In `public/dashboard.css`, after the receipt-panel section (after the `.btn-copy.copied` rule near line 232), append:

```css
/* ---------- Who-to-ask-for research panel ---------- */
.btn-research-open {
  font: inherit; font-size: 13px; font-weight: 600; cursor: pointer;
  background: var(--paper); border: 1px solid var(--line);
  border-radius: 8px; padding: 8px 14px; color: var(--ink);
  transition: border-color .12s ease;
}
.btn-research-open:hover { border-color: #CFC9BB; }
.btn-research-open[aria-expanded="true"] { background: var(--ink); color: #F3F1EC; border-color: var(--ink); }

.research { display: none; border-top: 1px dashed var(--line); background: var(--receipt); }
.research.open { display: block; }
.research-inner {
  max-width: 560px; margin: 0 auto; padding: 18px 26px 22px;
  font-family: "JetBrains Mono", monospace;
}
.research-head {
  text-align: center; font-size: 11px; letter-spacing: .14em;
  text-transform: uppercase; color: var(--muted);
  padding-bottom: 14px; border-bottom: 1px dashed var(--line); margin-bottom: 16px;
}
.research-links { display: flex; flex-wrap: wrap; gap: 10px; justify-content: center; }
.research-link {
  font: inherit; font-size: 12px; font-weight: 600; cursor: pointer;
  background: var(--paper); border: 1px solid var(--line); border-radius: 8px;
  padding: 8px 14px; color: var(--ink); text-decoration: none;
  transition: border-color .12s ease;
}
.research-link:hover { border-color: #CFC9BB; }
.research-link.copied { background: var(--ink); color: #F3F1EC; border-color: var(--ink); }
```

- [ ] **Step 2: Verify `--paper` exists**

Run: `grep -n -- "--paper" public/dashboard.css`
Expected: at least one match in `:root` (already used by `.btn-copy-open`). If missing, use `var(--receipt)` as the button background instead.

- [ ] **Step 3: Manual verification**

Run: `npx netlify dev` (if not already running)
Open: `http://localhost:8888/?demo=1`
Verify:
- The **Who to ask for** button matches the **Outreach** button's look and shows the dark "active" state when its panel is open.
- The expanded panel is a receipt-style block with a centered header and a centered, wrapping row of link buttons.
- On narrow/mobile width the link row wraps cleanly and the `.lead-actions` row still lays out sensibly.

- [ ] **Step 4: Commit**

```bash
git add public/dashboard.css
git commit -m "style: research panel, links, and toggle button"
```

---

## Final verification

- [ ] **Run the full test suite**

Run: `npm test`
Expected: all suites PASS, including `test/research.test.js`.

- [ ] **Confirm no backend touched**

Run: `git diff --name-only <first-task-commit>~1 HEAD`
Expected: only `public/research.js`, `public/dashboard.js`, `public/index.html`, `public/dashboard.css`, `test/research.test.js`, and the plan/spec docs. No changes under `lib/`, `netlify/`, or config files.

---

## Spec coverage check

- Collapsible "Who to ask for" panel next to Outreach → Task 2 Steps 3–4, Task 3.
- Four links with exact behavior (Google Business via place_id, Website hidden when absent, LinkedIn site:linkedin.com search, TX Comptroller copy-then-open) → Task 1 (`buildResearchLinks`) + Task 2 Step 4 (Comptroller handler).
- Client-only, no backend change → Final verification "no backend touched".
- Pure logic extracted and `node --test`-covered → Task 1 (`public/research.js`, corrected location per design note).
- Independent panels (opening one doesn't close the other) → Task 2 Step 4 + Step 6 verification.
- New tab + `rel="noopener"` + `encodeURIComponent` → Task 1 builder + Task 2 renderer.
