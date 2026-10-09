// public/hours.js
// "Open now" from Google's regular opening hours. Pure, shared by the browser
// and the tests. Google numbers days 0 (Sunday) to 6 and gives each business
// a UTC offset, so the check runs in the business's own local time.

const WEEK = 7 * 24 * 60;
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function minuteOfWeek(p) {
  return p.day * 1440 + (p.hour || 0) * 60 + (p.minute || 0);
}

export function clockLabel(hour, minute) {
  const h = hour % 12 === 0 ? 12 : hour % 12;
  const ampm = hour < 12 ? "AM" : "PM";
  return minute ? `${h}:${String(minute).padStart(2, "0")} ${ampm}` : `${h} ${ampm}`;
}

// { open: true|false, label } or null when Google gave no hours. A lead with
// unknown hours is never treated as closed.
export function openStatus(hours, nowMs = Date.now()) {
  if (!hours || !Array.isArray(hours.periods) || !hours.periods.length) return null;
  if (typeof hours.utc_offset !== "number") return null;
  const periods = hours.periods.filter((p) => p && p.open);
  if (!periods.length) return null;
  if (periods.some((p) => !p.close)) return { open: true, label: "Open 24 hours" };

  const local = new Date(nowMs + hours.utc_offset * 60000);
  const t = local.getUTCDay() * 1440 + local.getUTCHours() * 60 + local.getUTCMinutes();

  for (const p of periods) {
    const start = minuteOfWeek(p.open);
    let end = minuteOfWeek(p.close);
    if (end <= start) end += WEEK;
    if ((t >= start && t < end) || (t + WEEK >= start && t + WEEK < end)) {
      return { open: true, label: `Open until ${clockLabel(p.close.hour || 0, p.close.minute || 0)}` };
    }
  }

  let best = null;
  for (const p of periods) {
    const wait = (minuteOfWeek(p.open) - t + WEEK) % WEEK;
    if (best === null || wait < best.wait) best = { wait, p };
  }
  const o = best.p.open;
  const sameDay = o.day === local.getUTCDay() && best.wait < 1440;
  const when = clockLabel(o.hour || 0, o.minute || 0);
  return { open: false, label: sameDay ? `Closed · opens ${when}` : `Closed · opens ${DAYS[o.day]} ${when}` };
}
