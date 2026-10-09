// lib/db.js
// A small Supabase (PostgREST) client over fetch. No SDK: the repo has no
// dependencies, and the handful of calls the desk needs do not justify one.
//
// Server-only. It uses the service role key, which bypasses row level
// security, so it must never reach the browser.

export function dbConfig(env = process.env) {
  const url = (env.SUPABASE_URL || "").trim().replace(/\/+$/, "");
  const key = (env.SUPABASE_SERVICE_KEY || env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
  if (!url || !key) return null;
  return { url, key };
}

export class DbError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

async function request(db, path, { method = "GET", body, prefer, fetchImpl = fetch } = {}) {
  const headers = {
    apikey: db.key,
    Authorization: `Bearer ${db.key}`,
    "Content-Type": "application/json",
  };
  if (prefer) headers.Prefer = prefer;
  const resp = await fetchImpl(`${db.url}/rest/v1/${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await resp.text();
  if (!resp.ok) {
    let detail = text;
    try { detail = JSON.parse(text).message || text; } catch { /* keep raw */ }
    throw new DbError(`Database error ${resp.status}: ${detail}`, resp.status);
  }
  return text ? JSON.parse(text) : null;
}

export function select(db, table, query, opts = {}) {
  return request(db, `${table}?${query}`, opts);
}

export function insert(db, table, rows, opts = {}) {
  return request(db, table, { ...opts, method: "POST", body: rows, prefer: "return=representation" });
}

export function update(db, table, query, patch, opts = {}) {
  return request(db, `${table}?${query}`, { ...opts, method: "PATCH", body: patch, prefer: "return=representation" });
}

export function rpc(db, fn, args, opts = {}) {
  return request(db, `rpc/${fn}`, { ...opts, method: "POST", body: args });
}

// Supabase caps a response at 1000 rows by default, so read in pages.
export async function selectAll(db, table, query, opts = {}, pageSize = 1000) {
  const out = [];
  for (let offset = 0; ; offset += pageSize) {
    const page = await select(db, table, `${query}&limit=${pageSize}&offset=${offset}`, opts);
    out.push(...page);
    if (page.length < pageSize) return out;
  }
}
