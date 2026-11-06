import type { CSSProperties } from "react";
import { sortTasks } from "../lib/score";
import { pathLabel, placeColor } from "../lib/tree";
import { dropAttrs, startDrag } from "../state/dnd";
import { patchTask, useData } from "../state/store";
import { STATUSES, type Status } from "../types";
import type { ViewProps } from "./ListView";
import { DragHandle, RepeatChip, ScoreBadge, dueLabel } from "./TaskRow";

/** Kanban by status. Drag cards between columns, or use the status menu. */
export function BoardView({ tasks, onOpen, showDone }: ViewProps) {
  const { lists, tasks: allTasks } = useData();
  const cols = STATUSES.filter((s) => showDone || s.id !== "done");

  return (
    <div className="view board">
      {cols.map((col) => {
        const items = sortTasks(
          tasks.filter((t) => t.status === col.id),
          "score",
        );
        return (
          <div key={col.id} className="column" {...dropAttrs("status", col.id)}>
            <header style={{ borderColor: col.color }}>
              <span className="dot" style={{ background: col.color }} />
              {col.label}
              <span className="count">{items.length}</span>
            </header>
            <div className="cards">
              {items.map((t) => {
                const due = dueLabel(t.dueDate);
                const color = placeColor(lists, t.listId, t.space);
                const parent = t.parentId ? allTasks.find((x) => x.id === t.parentId) : null;
                return (
                  <div
                    key={t.id}
                    className="card"
                    style={{ "--c": color } as CSSProperties}
                    onPointerDown={(e) => startDrag(e, { kind: "task", id: t.id, label: t.title, color })}
                    onClick={() => onOpen(t.id)}
                  >
                    <div className="card-top">
                      <DragHandle />
                      <span className="card-title">{t.title}</span>
                      <ScoreBadge task={t} />
                    </div>
                    {parent && <div className="path small">↳ {parent.title}</div>}
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
