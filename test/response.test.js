// test/response.test.js
//
// The dashboard used to call r.json() unconditionally. Any non-JSON body — a
// platform error page, a gateway timeout, an empty 502 — threw inside the
// promise chain and landed in .catch, which reports "Could not reach the
// server." That is the wrong diagnosis: the server was reached and answered,
// it just did not answer with JSON. The whole point of this module is that a
// response is read once, as text, and never assumed to be anything.
import test from "node:test";
import assert from "node:assert/strict";
import { readResponse, errorMessage } from "../public/response.js";

function res(body, status = 200, type = "application/json") {
  return new Response(body, { status, headers: { "content-type": type } });
}

test("a JSON body is parsed and marked parsed", async () => {
  const r = await readResponse(res(JSON.stringify({ leads: [1, 2] })));
  assert.equal(r.ok, true);
  assert.equal(r.status, 200);
  assert.equal(r.parsed, true);
  assert.deepEqual(r.data.leads, [1, 2]);
});

// This is the exact production failure: Vercel's FUNCTION_INVOCATION_FAILED
// page. It must come back as data, not as a thrown SyntaxError.
test("a plain-text error page does not throw", async () => {
  const body = "A server error has occurred\n\nFUNCTION_INVOCATION_FAILED\n\niad1::abcde-1234567890";
  const r = await readResponse(res(body, 500, "text/plain"));
  assert.equal(r.ok, false);
  assert.equal(r.status, 500);
  assert.equal(r.parsed, false);
  assert.equal(r.data, null);
  assert.ok(r.raw.includes("FUNCTION_INVOCATION_FAILED"));
});

test("an empty body is not JSON and does not throw", async () => {
  const r = await readResponse(res("", 502, "text/html"));
  assert.equal(r.parsed, false);
  assert.equal(r.raw, "");
});

test("an HTML body does not throw", async () => {
  const r = await readResponse(res("<html><body>Bad Gateway</body></html>", 502, "text/html"));
  assert.equal(r.parsed, false);
  assert.equal(r.ok, false);
});

// The server's own error text is the best message available, so it wins.
test("the server's own error field is preferred", () => {
  assert.equal(
    errorMessage({ ok: false, status: 400, parsed: true, data: { error: "Couldn't find that location — try a ZIP or city." }, raw: "" }),
    "Couldn't find that location — try a ZIP or city.",
  );
});

// A wide radius fans out across a dozen upstream calls. A timeout is a
// realistic outcome and the advice for it is specific, so it gets its own case.
test("a timeout says so, and says what to do about it", () => {
  for (const status of [408, 504]) {
    const m = errorMessage({ ok: false, status, parsed: false, data: null, raw: "" });
    assert.match(m, /timed out/i);
    assert.match(m, /smaller radius|fewer verticals/i);
    assert.ok(m.includes(String(status)));
  }
});

test("a non-JSON server error reports the status and what the body said", () => {
  const m = errorMessage({
    ok: false, status: 500, parsed: false, data: null,
    raw: "A server error has occurred\n\nFUNCTION_INVOCATION_FAILED\n\niad1::abcde",
  });
  assert.ok(m.includes("500"));
  assert.match(m, /FUNCTION_INVOCATION_FAILED/);
  assert.doesNotMatch(m, /could not reach/i, "the server was reached — do not say otherwise");
});

test("a 4xx is described as rejected, not as a server fault", () => {
  const m = errorMessage({ ok: false, status: 403, parsed: false, data: null, raw: "Forbidden" });
  assert.ok(m.includes("403"));
  assert.match(m, /rejected/i);
});

// The body is attacker-influenced in the general case and is interpolated into
// innerHTML downstream, so tags never survive this function. esc() in the
// dashboard is the second layer, not the only one.
test("markup in the body is stripped, not passed through", () => {
  const m = errorMessage({
    ok: false, status: 500, parsed: false, data: null,
    raw: "<script>alert(1)</script><b>boom</b>",
  });
  assert.doesNotMatch(m, /<script>|<b>/);
  assert.match(m, /alert\(1\)|boom/);
});

test("a long body is truncated rather than dumped into the page", () => {
  const m = errorMessage({ ok: false, status: 500, parsed: false, data: null, raw: "x".repeat(5000) });
  assert.ok(m.length < 400, `message was ${m.length} chars`);
  assert.match(m, /…$|…/);
});

test("whitespace in the body is collapsed to one line", () => {
  const m = errorMessage({ ok: false, status: 500, parsed: false, data: null, raw: "line one\n\n\nline   two" });
  assert.doesNotMatch(m, /\n/);
  assert.match(m, /line one line two/);
});

// A 200 whose body is not JSON is not success — the caller would read .leads
// off null. It has to be treated as a failure, with a message that says what
// actually happened rather than a generic one.
test("a 200 that is not JSON is still an error", () => {
  const m = errorMessage({ ok: true, status: 200, parsed: false, data: null, raw: "<html>login</html>" });
  assert.ok(m.includes("200"));
  assert.match(m, /unexpected/i);
});

test("a JSON error body with no error field still names the status", () => {
  const m = errorMessage({ ok: false, status: 500, parsed: true, data: { nope: 1 }, raw: '{"nope":1}' });
  assert.ok(m.includes("500"));
});
