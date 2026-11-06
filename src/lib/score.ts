import type { Task } from "../types";

/**
 * Priority score, 0–100.
 *
 * priority × urgency × ease, where ease = 11 − effort, so low-effort work
 * floats up (a quick, important, urgent task beats a huge one). The raw
 * product runs 1–1000; we divide by 10 so it reads like a percentage.
 */
export function score(t: Pick<Task, "priority" | "urgency" | "effort">): number {
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

export type SortKey = "score" | "priority" | "urgency" | "effort" | "due" | "created" | "updated" | "title";

export const SORTS: { id: SortKey; label: string }[] = [
  { id: "score", label: "Priority score" },
  { id: "priority", label: "Priority" },
  { id: "urgency", label: "Urgency" },
  { id: "effort", label: "Effort (least first)" },
  { id: "due", label: "Due date" },
  { id: "updated", label: "Recently updated" },
  { id: "created", label: "Newest" },
  { id: "title", label: "A → Z" },
];

export function sortTasks(tasks: Task[], key: SortKey): Task[] {
  const arr = [...tasks];
  const cmp: Record<SortKey, (a: Task, b: Task) => number> = {
    score: (a, b) => score(b) - score(a),
    priority: (a, b) => b.priority - a.priority,
    urgency: (a, b) => b.urgency - a.urgency,
    effort: (a, b) => a.effort - b.effort,
    due: (a, b) => (a.dueDate ?? "9999").localeCompare(b.dueDate ?? "9999"),
    created: (a, b) => b.createdAt - a.createdAt,
    updated: (a, b) => b.updatedAt - a.updatedAt,
    title: (a, b) => a.title.localeCompare(b.title),
  };
  return arr.sort((a, b) => cmp[key](a, b) || score(b) - score(a) || a.order - b.order);
}
