import { sortTasks } from "../lib/score";
import type { Task } from "../types";
import type { ViewProps } from "./ListView";
import { ScoreBadge } from "./TaskRow";

const important = (t: Task) => (t.priority ?? 0) >= 6;
const urgent = (t: Task) => (t.urgency ?? 0) >= 6;

const Q = [
  { id: "do", title: "Do now", sub: "Important · Urgent", color: "#f43f5e", test: (t: Task) => important(t) && urgent(t) },
  { id: "plan", title: "Schedule", sub: "Important · Not urgent", color: "#38bdf8", test: (t: Task) => important(t) && !urgent(t) },
  { id: "quick", title: "Squeeze in / delegate", sub: "Less important · Urgent", color: "#f59e0b", test: (t: Task) => !important(t) && urgent(t) },
  { id: "later", title: "Later / drop", sub: "Less important · Not urgent", color: "#64748b", test: (t: Task) => !important(t) && !urgent(t) },
];

/** Eisenhower matrix from priority (importance) × urgency. */
export function MatrixView({ tasks, onOpen }: ViewProps) {
  const open = tasks.filter((t) => t.status !== "done");
  // A task with neither score set hasn't been judged, so it doesn't belong in "Later / drop".
  const unrated = sortTasks(
    open.filter((t) => t.priority == null && t.urgency == null),
    "manual",
  );
  const rated = open.filter((t) => t.priority != null || t.urgency != null);
  return (
    <div className="view matrix">
      {Q.map((q) => {
        const items = sortTasks(rated.filter(q.test), "score");
        return (
          <div key={q.id} className="quadrant" style={{ borderTopColor: q.color }}>
            <header>
              <strong style={{ color: q.color }}>{q.title}</strong>
              <span className="muted small">{q.sub}</span>
              <span className="count">{items.length}</span>
            </header>
            <div className="q-items">
              {items.map((t) => (
                <button key={t.id} className="q-item" onClick={() => onOpen(t.id)}>
                  <span className="q-title">{t.title}</span>
                  {(t.effort ?? 11) <= 3 && <span title="Low effort">⚡</span>}
                  <ScoreBadge task={t} />
                </button>
              ))}
              {!items.length && <div className="muted small">Empty</div>}
            </div>
          </div>
        );
      })}
      {unrated.length > 0 && (
        <div className="quadrant unrated" style={{ borderTopColor: "var(--line)" }}>
          <header>
            <strong>No priority yet</strong>
            <span className="muted small">Set a priority or urgency to place these</span>
            <span className="count">{unrated.length}</span>
          </header>
          <div className="q-items">
            {unrated.map((t) => (
              <button key={t.id} className="q-item" onClick={() => onOpen(t.id)}>
                <span className="q-title">{t.title}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
