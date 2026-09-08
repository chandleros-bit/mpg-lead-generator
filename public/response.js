// Reading a fetch Response without assuming what came back. Browser-loaded from
// public/ (the static output dir) and unit-tested with node --test. No DOM here.
//
// The dashboard used to do `r.json()` straight off the fetch. That throws on any
// non-JSON body, and the throw lands in the promise chain's .catch, which says
// "Could not reach the server." — a wrong diagnosis for a server that answered
// perfectly well with a 500 page. It cost a real debugging session: a Vercel
// FUNCTION_INVOCATION_FAILED page surfaced as
// "SyntaxError: Unexpected token 'A'".
//
// So: read the body once, as text, and treat JSON as a thing to attempt rather
// than a thing to assume.

const TIMEOUT_STATUSES = new Set([408, 504]);
const MAX_DETAIL = 200;

// Read a Response into a plain record. Never throws on body content — only a
// genuine transport failure can reject, which is what the caller's .catch is
// actually for.
export async function readResponse(response) {
  const raw = await response.text();
  let data = null;
  let parsed = false;
  if (raw) {
    try {
      data = JSON.parse(raw);
      parsed = true;
    } catch (_) {
      // Not JSON. That is information, not an exception.
    }
  }
  return { ok: response.ok, status: response.status, parsed, data, raw };
}

// The tail of an error body, made safe to interpolate and short enough to read.
// Tags are stripped here rather than only escaped downstream: this string ends
// up in innerHTML, and an error body is not always something we generated.
function detail(raw) {
  if (!raw) return "";
  const flat = String(raw).replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
  if (!flat) return "";
  return flat.length > MAX_DETAIL ? flat.slice(0, MAX_DETAIL) + "…" : flat;
}

// What to tell the user. The server's own error text wins when there is one —
// it is written for this audience and names the actual problem. Everything else
// is a fallback that at minimum states the status, so a failure is never
// reported as something it is not.
export function errorMessage(res) {
  if (res.parsed && res.data && res.data.error) return String(res.data.error);

  const suffix = detail(res.raw);
  const tail = suffix ? " " + suffix : "";

  if (TIMEOUT_STATUSES.has(res.status)) {
    return "The search timed out (" + res.status + "). Try a smaller radius or fewer verticals.";
  }
  if (res.status >= 500) return "The server errored (" + res.status + ")." + tail;
  if (res.status >= 400) return "The request was rejected (" + res.status + ")." + tail;
  return "Unexpected response (" + res.status + ") — expected JSON." + tail;
}
