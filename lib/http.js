// lib/http.js
// Bounded, robots-aware fetch utilities for best-effort scraping. The only
// impurity is the injected fetchImpl, so everything here is testable offline.

export const BOT_UA = "MPG-LeadBot/1.0 (+https://mediapaymentsgroup.com/bot)";
export const BOT_UA_TOKEN = "mpg-leadbot";

export async function fetchWithTimeout(url, { timeoutMs = 3000, fetchImpl = fetch, userAgent = BOT_UA } = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const resp = await fetchImpl(url, { signal: ctrl.signal, headers: { "User-Agent": userAgent } });
    if (!resp || !resp.ok) return null;
    return await resp.text();
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

// Run fn over items with bounded concurrency, stopping at the wall-clock
// deadline. Items not reached by the deadline stay null (graceful skip).
export async function mapWithBudget(items, fn, { concurrency = 5, deadline = Infinity } = {}) {
  const results = new Array(items.length).fill(null);
  let i = 0;
  async function worker() {
    while (i < items.length) {
      const idx = i++;
      if (Date.now() >= deadline) return;
      results[idx] = await fn(items[idx], idx);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
  return results;
}

// Map user-agent → array of Disallow prefixes. Pragmatic grouping: a run of
// consecutive User-agent lines shares the rules that follow.
export function parseRobots(text) {
  const map = {};
  let agents = [], expectingAgents = true;
  for (const raw of String(text || "").split(/\r?\n/)) {
    const line = raw.replace(/#.*/, "").trim();
    if (!line) continue;
    const idx = line.indexOf(":");
    if (idx === -1) continue;
    const field = line.slice(0, idx).trim().toLowerCase();
    const value = line.slice(idx + 1).trim();
    if (field === "user-agent") {
      if (!expectingAgents) { agents = []; expectingAgents = true; }
      const a = value.toLowerCase();
      agents.push(a); map[a] ??= [];
    } else if (field === "disallow") {
      expectingAgents = false;
      for (const a of agents) (map[a] ??= []).push(value);
    } else {
      expectingAgents = false;
    }
  }
  return map;
}

export function robotsDisallows(map, path, userAgent = "*") {
  const ua = userAgent.toLowerCase();
  const rules = map[ua] || map["*"] || [];
  return rules.some((p) => p && path.startsWith(p));
}

// Robots-aware, cached page fetch shared by processor + owner scraping.
export async function fetchPage(url, { fetchImpl = fetch, cache, robotsCache, timeoutMs = 3000, userAgent = BOT_UA, uaToken = BOT_UA_TOKEN } = {}) {
  if (cache && cache.has(url)) return cache.get(url);
  let origin, path;
  try { const u = new URL(url); origin = u.origin; path = u.pathname; }
  catch { cache?.set(url, null); return null; }

  if (robotsCache) {
    let robots = robotsCache.get(origin);
    if (robots === undefined) {
      const txt = await fetchWithTimeout(`${origin}/robots.txt`, { timeoutMs, fetchImpl, userAgent });
      robots = txt ? parseRobots(txt) : {};
      robotsCache.set(origin, robots);
    }
    if (robotsDisallows(robots, path, uaToken)) { cache?.set(url, null); return null; }
  }

  const html = await fetchWithTimeout(url, { timeoutMs, fetchImpl, userAgent });
  cache?.set(url, html);
  return html;
}
