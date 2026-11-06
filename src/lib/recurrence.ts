import type { Repeat, Task } from "../types";
import { uid } from "./tree";

// Dates are handled as local calendar days ("YYYY-MM-DD"), at noon to dodge DST edges.

export function parseDay(s: string): Date {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d, 12);
}

export function fmtDay(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export const todayIso = () => fmtDay(new Date());

const addDays = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n, 12);
const daysIn = (y: number, m: number) => new Date(y, m + 1, 0).getDate();

/** The Nth (1-4, or -1 = last) given weekday in a month. Null if it doesn't exist (e.g. a 5th). */
function nthWeekday(y: number, m: number, nth: number, wd: number): Date | null {
  if (nth === -1) {
    const last = new Date(y, m, daysIn(y, m), 12);
    return addDays(last, -((last.getDay() - wd + 7) % 7));
  }
  const first = new Date(y, m, 1, 12);
  const d = 1 + ((wd - first.getDay() + 7) % 7) + (nth - 1) * 7;
  return d <= daysIn(y, m) ? new Date(y, m, d, 12) : null;
}

/** The day this rule lands on in a given month. */
function dayInMonth(r: Repeat, y: number, m: number, anchor: Date): Date | null {
  const mode = r.monthMode ?? "day";
  if (mode === "last") return new Date(y, m, daysIn(y, m), 12);
  if (mode === "weekday") return nthWeekday(y, m, r.nth ?? 1, r.weekday ?? anchor.getDay());
  return new Date(y, m, Math.min(r.monthDay ?? anchor.getDate(), daysIn(y, m)), 12);
}

const startOfWeek = (d: Date) => addDays(d, -d.getDay());

/** First date strictly after `after` that fits the rule (ignores until/count). */
export function nextAfter(r: Repeat, after: Date): Date {
  const n = Math.max(1, Math.round(r.interval || 1));
  switch (r.freq) {
    case "day":
      return addDays(after, n);
    case "week": {
      const days = r.weekdays?.length ? r.weekdays : [after.getDay()];
      if (!r.weekdays?.length) return addDays(after, 7 * n);
      const anchor = startOfWeek(after);
      for (let i = 1; i <= 7 * n + 7; i++) {
        const d = addDays(after, i);
        const weeks = Math.round((startOfWeek(d).getTime() - anchor.getTime()) / (7 * 86400000));
        if (days.includes(d.getDay()) && weeks % n === 0) return d;
      }
      return addDays(after, 7 * n);
    }
    case "month":
      for (let k = 0; k < 400; k++) {
        const total = after.getMonth() + k * n;
        const y = after.getFullYear() + Math.floor(total / 12);
        const d = dayInMonth(r, y, total % 12, after);
        if (d && d > after) return d;
      }
      break;
    case "year":
      for (let k = 0; k < 100; k++) {
        const y = after.getFullYear() + k * n;
        const d = dayInMonth(r, y, r.month ?? after.getMonth(), after);
        if (d && d > after) return d;
      }
      break;
  }
  return addDays(after, 1);
}

/** Next due date after completing it, or null if the series is over. */
export function nextDue(r: Repeat, dueDate: string | null, completedOn = todayIso()): string | null {
  const base = r.from === "completion" || !dueDate ? completedOn : dueDate;
  let next = nextAfter(r, parseDay(base));
  // A fixed schedule that's fallen behind skips ahead to the next date after today.
  if (r.from !== "completion") {
    const today = parseDay(completedOn);
    let guard = 0;
    while (next <= today && guard++ < 1000) next = nextAfter(r, next);
  }
  const iso = fmtDay(next);
  if (r.until && iso > r.until) return null;
  if (r.count && (r.done ?? 0) + 1 >= r.count) return null;
  return iso;
}

/** The first date on or after `from` that fits the rule (for a new repeating task without a date). */
export function firstDue(r: Repeat, from = todayIso()): string {
  if (r.freq === "day" || (r.freq === "week" && !r.weekdays?.length)) return from;
  return fmtDay(nextAfter(r, addDays(parseDay(from), -1)));
}

/**
 * Checking off a repeating task: instead of finishing it, roll it forward to the next
 * date, reset the checklist and log the completion. Null = series over, finish normally.
 */
export function rollForward(t: Task, now = Date.now()): Task | null {
  if (!t.repeat) return null;
  const next = nextDue(t.repeat, t.dueDate, fmtDay(new Date(now)));
  if (!next) return null;
  return {
    ...t,
    status: "todo",
    waitingOn: "",
    completedAt: null,
    dueDate: next,
    subtasks: t.subtasks.map((s) => ({ ...s, done: false })),
    repeat: { ...t.repeat, done: (t.repeat.done ?? 0) + 1 },
    updates: [...t.updates, { id: uid(), at: now, text: `✓ Done. Repeats, next due ${prettyDay(next)}.` }],
    updatedAt: now,
  };
}

// ------------------------------------------------------------- describing

const WD = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const WD_LONG = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
export const WEEKDAY_NAMES = WD_LONG;
export const MONTH_NAMES = MONTHS;

export const ordinal = (n: number) => {
  if (n === -1) return "last";
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
};

export function prettyDay(iso: string): string {
  return parseDay(iso).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
}

/** "Every 2 weeks on Mon, Thu", "Monthly on the last Friday", … */
export function describeRepeat(r: Repeat, dueDate?: string | null): string {
  const n = Math.max(1, r.interval || 1);
  const anchor = dueDate ? parseDay(dueDate) : new Date();
  const unit = { day: "day", week: "week", month: "month", year: "year" }[r.freq];
  const every = n === 1 ? { day: "Daily", week: "Weekly", month: "Monthly", year: "Yearly" }[r.freq] : `Every ${n} ${unit}s`;
  let out = every;
  if (r.from === "completion") {
    out = `${n} ${unit}${n === 1 ? "" : "s"} after each completion`;
  } else if (r.freq === "week" && r.weekdays?.length) {
    const days = [...r.weekdays].sort();
    const label =
      days.join() === "1,2,3,4,5" ? "weekdays" : days.join() === "0,6" ? "weekends" : days.length === 7 ? "every day" : days.map((d) => WD[d]).join(", ");
    out = n === 1 && label === "weekdays" ? "Every weekday" : `${every} on ${label}`;
  } else if (r.freq === "month" || r.freq === "year") {
    const mode = r.monthMode ?? "day";
    const inMonth = r.freq === "year" ? ` of ${MONTHS[r.month ?? anchor.getMonth()]}` : "";
    if (mode === "last") out = `${every} on the last day${inMonth}`;
    else if (mode === "weekday") out = `${every} on the ${ordinal(r.nth ?? 1)} ${WD_LONG[r.weekday ?? anchor.getDay()]}${inMonth}`;
    else
      out =
        r.freq === "year"
          ? `${every} on ${MONTHS[r.month ?? anchor.getMonth()].slice(0, 3)} ${r.monthDay ?? anchor.getDate()}`
          : `${every} on the ${ordinal(r.monthDay ?? anchor.getDate())}`;
  }
  if (r.until) out += `, until ${prettyDay(r.until)}`;
  if (r.count) out += `, ${r.count} times (${r.done ?? 0} done)`;
  return out;
}

/** Ready-made choices for the Repeat menu, based on the task's due date. */
export function presets(dueDate: string | null): { label: string; rule: Repeat }[] {
  const d = dueDate ? parseDay(dueDate) : new Date();
  const wd = d.getDay();
  const nth = Math.ceil(d.getDate() / 7);
  const isLastWeek = d.getDate() + 7 > daysIn(d.getFullYear(), d.getMonth());
  const base = { from: "due" as const };
  const list: { label: string; rule: Repeat }[] = [
    { label: "Every day", rule: { ...base, freq: "day", interval: 1 } },
    { label: "Every weekday (Mon–Fri)", rule: { ...base, freq: "week", interval: 1, weekdays: [1, 2, 3, 4, 5] } },
    { label: `Every week on ${WD_LONG[wd]}`, rule: { ...base, freq: "week", interval: 1, weekdays: [wd] } },
    { label: `Every 2 weeks on ${WD_LONG[wd]}`, rule: { ...base, freq: "week", interval: 2, weekdays: [wd] } },
    { label: `Every month on the ${ordinal(d.getDate())}`, rule: { ...base, freq: "month", interval: 1, monthMode: "day", monthDay: d.getDate() } },
  ];
  if (nth <= 4) list.push({ label: `Every month on the ${ordinal(nth)} ${WD_LONG[wd]}`, rule: { ...base, freq: "month", interval: 1, monthMode: "weekday", nth, weekday: wd } });
  if (isLastWeek) list.push({ label: `Every month on the last ${WD_LONG[wd]}`, rule: { ...base, freq: "month", interval: 1, monthMode: "weekday", nth: -1, weekday: wd } });
  list.push(
    { label: "Every month on the last day", rule: { ...base, freq: "month", interval: 1, monthMode: "last" } },
    { label: `Every 3 months on the ${ordinal(d.getDate())}`, rule: { ...base, freq: "month", interval: 3, monthMode: "day", monthDay: d.getDate() } },
    { label: `Every year on ${MONTHS[d.getMonth()].slice(0, 3)} ${d.getDate()}`, rule: { ...base, freq: "year", interval: 1, month: d.getMonth(), monthMode: "day", monthDay: d.getDate() } },
    { label: "1 week after I finish it", rule: { freq: "week", interval: 1, from: "completion" } },
  );
  return list;
}
