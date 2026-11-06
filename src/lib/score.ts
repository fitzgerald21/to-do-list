import type { Task } from "../types";

/**
 * Priority score, 0–100, or null when none of the three is set.
 *
 * priority × urgency × ease, where ease = 11 − effort, so low-effort work
 * floats up (a quick, important, urgent task beats a huge one). The raw
 * product runs 1–1000; we divide by 10 so it reads like a percentage. Any of
 * the three left blank counts as a middling 5.
 */
export function score(t: Pick<Task, "priority" | "urgency" | "effort">): number | null {
  if (t.priority == null && t.urgency == null && t.effort == null) return null;
  const p = clamp(t.priority);
  const u = clamp(t.urgency);
  const ease = 11 - clamp(t.effort);
  return Math.round((p * u * ease) / 10);
}

export function clamp(n: number | null | undefined, lo = 1, hi = 10): number {
  if (typeof n !== "number" || Number.isNaN(n)) return 5;
  return Math.min(hi, Math.max(lo, Math.round(n)));
}

export function scoreColor(s: number): string {
  if (s >= 60) return "#f43f5e";
  if (s >= 35) return "#f59e0b";
  if (s >= 15) return "#38bdf8";
  return "#64748b";
}

export type SortKey = "manual" | "score" | "priority" | "urgency" | "effort" | "due" | "created" | "updated" | "title";

export const SORTS: { id: SortKey; label: string }[] = [
  { id: "manual", label: "My order" },
  { id: "score", label: "Priority score" },
  { id: "priority", label: "Priority" },
  { id: "urgency", label: "Urgency" },
  { id: "effort", label: "Effort (least first)" },
  { id: "due", label: "Due date" },
  { id: "updated", label: "Recently updated" },
  { id: "created", label: "Newest" },
  { id: "title", label: "A → Z" },
];

/** Tasks with nothing set sort after any that have a value. */
const rank = (t: Task) => score(t) ?? -1;

export function sortTasks(tasks: Task[], key: SortKey): Task[] {
  const arr = [...tasks];
  const cmp: Record<SortKey, (a: Task, b: Task) => number> = {
    manual: (a, b) => a.order - b.order,
    score: (a, b) => rank(b) - rank(a),
    priority: (a, b) => (b.priority ?? 0) - (a.priority ?? 0),
    urgency: (a, b) => (b.urgency ?? 0) - (a.urgency ?? 0),
    effort: (a, b) => (a.effort ?? 11) - (b.effort ?? 11),
    due: (a, b) => (a.dueDate ?? "9999").localeCompare(b.dueDate ?? "9999"),
    created: (a, b) => b.createdAt - a.createdAt,
    updated: (a, b) => b.updatedAt - a.updatedAt,
    title: (a, b) => a.title.localeCompare(b.title),
  };
  return arr.sort((a, b) => cmp[key](a, b) || rank(b) - rank(a) || a.order - b.order);
}
