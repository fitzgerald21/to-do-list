import { sortTasks } from "../lib/score";
import type { Task } from "../types";
import type { ViewProps } from "./ListView";
import { ScoreBadge } from "./TaskRow";

const Q = [
  { id: "do", title: "Do now", sub: "Important · Urgent", color: "#f43f5e", test: (t: Task) => t.priority >= 6 && t.urgency >= 6 },
  { id: "plan", title: "Schedule", sub: "Important · Not urgent", color: "#38bdf8", test: (t: Task) => t.priority >= 6 && t.urgency < 6 },
  { id: "quick", title: "Squeeze in / delegate", sub: "Less important · Urgent", color: "#f59e0b", test: (t: Task) => t.priority < 6 && t.urgency >= 6 },
  { id: "later", title: "Later / drop", sub: "Less important · Not urgent", color: "#64748b", test: (t: Task) => t.priority < 6 && t.urgency < 6 },
];

/** Eisenhower matrix from priority (importance) × urgency. */
export function MatrixView({ tasks, onOpen }: ViewProps) {
  const open = tasks.filter((t) => t.status !== "done");
  return (
    <div className="view matrix">
      {Q.map((q) => {
        const items = sortTasks(open.filter(q.test), "score");
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
                  {t.effort <= 3 && <span title="Low effort">⚡</span>}
                  <ScoreBadge task={t} />
                </button>
              ))}
              {!items.length && <div className="muted small">Empty</div>}
            </div>
          </div>
        );
      })}
    </div>
  );
}
