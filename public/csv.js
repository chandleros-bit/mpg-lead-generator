// Pure lead-list → CSV serializer. Browser-loaded from public/ (Netlify's publish
// dir) and unit-tested with node --test. No DOM here.
//
// RFC 4180: a field is wrapped in double quotes when it contains a comma, a
// double quote, or a line break; embedded quotes are doubled. Rows are joined
// with CRLF so spreadsheets (Excel/Sheets) open the file cleanly.

// [label, accessor] pairs — this list defines both the header row and the
// column order of every data row.
const COLUMNS = [
  ["Name", (r) => r.name],
  ["Category", (r) => r.category],
  ["Address", (r) => r.address],
  ["Phone", (r) => r.phone],
  ["Website", (r) => r.website],
  ["Rating", (r) => r.rating],
  ["Review Count", (r) => r.review_count],
  ["Score", (r) => r.score],
  ["Track", (r) => r.track],
  ["Bucket", (r) => r.bucket],
  ["Signals", (r) => (r.why || []).join("; ")],
  ["Processors", (r) => (r.processor || []).join("; ")],
  ["Owner Name", (r) => (r.owner && r.owner.name) || ""],
  ["Owner Email", (r) => (r.owner && r.owner.email) || ""],
  ["Source", (r) => r.source],
];

function cell(value) {
  if (value === null || value === undefined) return "";
  const s = String(value);
  return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

export function leadsToCsv(rows) {
  const header = COLUMNS.map((c) => cell(c[0])).join(",");
  const lines = (rows || []).map((r) => COLUMNS.map((c) => cell(c[1](r))).join(","));
  return [header, ...lines].join("\r\n");
}
