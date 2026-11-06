import { useState } from "react";
import { sortTasks } from "../lib/score";
import { pathLabel } from "../lib/tree";
import { patchTask, useData } from "../state/store";
import { STATUSES, type Status } from "../types";
import type { ViewProps } from "./ListView";
import { RepeatChip, ScoreBadge, dueLabel } from "./TaskRow";

/** Kanban by status. Drag cards on desktop, or use the status menu on phone. */
export function BoardView({ tasks, onOpen, showDone }: ViewProps) {
  const { lists } = useData();
  const [over, setOver] = useState<Status | null>(null);
  const cols = STATUSES.filter((s) => showDone || s.id !== "done");

  return (
    <div className="view board">
      {cols.map((col) => {
        const items = sortTasks(
          tasks.filter((t) => t.status === col.id),
          "score",
        );
        return (
          <div
            key={col.id}
            className={`column ${over === col.id ? "over" : ""}`}
            onDragOver={(e) => {
              e.preventDefault();
              setOver(col.id);
            }}
            onDragLeave={() => setOver(null)}
            onDrop={(e) => {
              e.preventDefault();
              setOver(null);
              const id = e.dataTransfer.getData("text/plain");
              if (id) void patchTask(id, { status: col.id });
            }}
          >
            <header style={{ borderColor: col.color }}>
              <span className="dot" style={{ background: col.color }} />
              {col.label}
              <span className="count">{items.length}</span>
            </header>
            <div className="cards">
              {items.map((t) => {
                const due = dueLabel(t.dueDate);
                return (
                  <div
                    key={t.id}
                    className="card"
                    draggable
                    onDragStart={(e) => e.dataTransfer.setData("text/plain", t.id)}
                    onClick={() => onOpen(t.id)}
                  >
                    <div className="card-top">
                      <span className="card-title">{t.title}</span>
                      <ScoreBadge task={t} />
                    </div>
                    <div className="path small">{pathLabel(lists, t)}</div>
                    {t.waitingOn && <div className="small waiting">⏳ {t.waitingOn}</div>}
                    {t.updates.length > 0 && <div className="small muted clamp2">📝 {t.updates[t.updates.length - 1].text}</div>}
                    <div className="card-foot">
                      {due && <span className={`chip due ${due.cls}`}>📅 {due.text}</span>}
                      <RepeatChip task={t} />
                      {t.tags.slice(0, 3).map((x) => (
                        <span key={x} className="chip tag">
                          #{x}
                        </span>
                      ))}
                      <select
                        className="status-select"
                        value={t.status}
                        onClick={(e) => e.stopPropagation()}
                        onChange={(e) => void patchTask(t.id, { status: e.target.value as Status })}
                      >
                        {STATUSES.map((s) => (
                          <option key={s.id} value={s.id}>
                            {s.label}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}
