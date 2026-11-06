import { useState } from "react";
import { score, sortTasks } from "../lib/score";
import type { Task } from "../types";
import { SortSelect, useSort, type ViewProps } from "./ListView";
import { TaskRow } from "./TaskRow";

type Preset = "all" | "top" | "quick" | "waiting" | "due" | "progress" | "recent";

const PRESETS: { id: Preset; label: string; hint: string; filter: (t: Task) => boolean }[] = [
  { id: "all", label: "All", hint: "Every task, ranked", filter: () => true },
  { id: "top", label: "🔥 Top", hint: "Score 35+", filter: (t) => score(t) >= 35 },
  { id: "quick", label: "⚡ Quick wins", hint: "Effort ≤ 3 and priority ≥ 5", filter: (t) => t.effort <= 3 && t.priority >= 5 },
  { id: "waiting", label: "⏳ Waiting on", hint: "Waiting or blocked", filter: (t) => t.status === "waiting" || t.status === "blocked" },
  { id: "progress", label: "▶ In progress", hint: "Started", filter: (t) => t.status === "in_progress" },
  {
    id: "due",
    label: "📅 Due soon",
    hint: "Due within 7 days or overdue",
    filter: (t) => !!t.dueDate && new Date(t.dueDate + "T00:00:00").getTime() - Date.now() < 7 * 86400000,
  },
  { id: "recent", label: "✅ Recently done", hint: "Completed in the last 14 days", filter: (t) => t.status === "done" && !!t.completedAt && Date.now() - t.completedAt < 14 * 86400000 },
];

/** One flat, ranked list across every topic, with handy presets. */
export function FocusView({ tasks, onOpen, onTag }: ViewProps & { onTag: (t: string) => void }) {
  const [preset, setPreset] = useState<Preset>("all");
  const [sort, setSort] = useSort("focus", "score");
  const p = PRESETS.find((x) => x.id === preset)!;
  const pool = preset === "recent" ? tasks : tasks.filter((t) => t.status !== "done" || preset === "all");
  const list = sortTasks(pool.filter(p.filter), preset === "due" ? "due" : sort);

  const waitingPeople =
    preset === "waiting"
      ? Object.entries(
          list.reduce<Record<string, Task[]>>((acc, t) => {
            const k = t.waitingOn || "Someone";
            (acc[k] ??= []).push(t);
            return acc;
          }, {}),
        )
      : null;

  return (
    <div className="view">
      <div className="view-toolbar wrap">
        <div className="presets">
          {PRESETS.map((x) => (
            <button key={x.id} className={`chip preset ${preset === x.id ? "active" : ""}`} title={x.hint} onClick={() => setPreset(x.id)}>
              {x.label}
            </button>
          ))}
        </div>
        {preset !== "due" && <SortSelect value={sort} onChange={setSort} />}
      </div>
      {preset === "recent" && tasks.every((t) => t.status !== "done") && (
        <p className="muted">Turn on “Show done” to see completed tasks.</p>
      )}
      {list.length === 0 && <div className="empty">Nothing here. 🎉</div>}
      {waitingPeople
        ? waitingPeople.map(([who, ts]) => (
            <section key={who} className="group">
              <header className="group-head">
                <h3>⏳ {who}</h3>
                <span className="count">{ts.length}</span>
              </header>
              {ts.map((t) => (
                <TaskRow key={t.id} task={t} onOpen={onOpen} showPath onTag={onTag} />
              ))}
            </section>
          ))
        : list.map((t) => <TaskRow key={t.id} task={t} onOpen={onOpen} showPath onTag={onTag} />)}
    </div>
  );
}
