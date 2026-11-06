import type { CSSProperties } from "react";
import { score, scoreColor } from "../lib/score";
import { describeRepeat } from "../lib/recurrence";
import { pathLabel, placeColor } from "../lib/tree";
import { dropAttrs, startDrag } from "../state/dnd";
import { patchTask, useData } from "../state/store";
import { STATUSES, type Task } from "../types";

export function ScoreBadge({ task }: { task: Task }) {
  const s = score(task);
  if (s === null) return null;
  return (
    <span
      className="score"
      style={{ borderColor: scoreColor(s), color: scoreColor(s) }}
      title={`Score ${s}, from priority ${task.priority ?? "not set"}, urgency ${task.urgency ?? "not set"} and effort ${task.effort ?? "not set"}`}
    >
      {s}
    </span>
  );
}

export function DragHandle() {
  return (
    <span className="drag-handle" data-drag-handle aria-hidden="true">
      ⠿
    </span>
  );
}

export function StatusChip({ task }: { task: Task }) {
  if (task.status === "todo") return null;
  const st = STATUSES.find((s) => s.id === task.status)!;
  const label = task.status === "waiting" && task.waitingOn ? `Waiting · ${task.waitingOn}` : st.label;
  return (
    <span className="chip status" style={{ background: st.color + "22", color: st.color, borderColor: st.color + "55" }}>
      {label}
    </span>
  );
}

export function dueLabel(d: string | null): { text: string; cls: string } | null {
  if (!d) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const due = new Date(d + "T00:00:00");
  const days = Math.round((due.getTime() - today.getTime()) / 86400000);
  const text =
    days === 0 ? "Today" : days === 1 ? "Tomorrow" : days === -1 ? "Yesterday" : days < 0 ? `${-days}d overdue` : days < 7 ? due.toLocaleDateString(undefined, { weekday: "short" }) : due.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  return { text, cls: days < 0 ? "overdue" : days <= 1 ? "soon" : "" };
}

export function TaskRow({
  task,
  onOpen,
  showPath = false,
  onTag,
  nested = false,
  droppable = false,
  folded,
  onFold,
}: {
  task: Task;
  onOpen: (id: string) => void;
  showPath?: boolean;
  onTag?: (t: string) => void;
  /** Shown under its parent, so it doesn't need to say whose sub-task it is. */
  nested?: boolean;
  /** Other tasks can be dropped on it. */
  droppable?: boolean;
  folded?: boolean;
  onFold?: () => void;
}) {
  const { lists, tasks } = useData();
  const done = task.status === "done";
  const due = dueLabel(task.dueDate);
  const kids = tasks.filter((t) => t.parentId === task.id);
  const kidsDone = kids.filter((t) => t.status === "done").length;
  const parent = !nested && task.parentId ? tasks.find((t) => t.id === task.parentId) : null;
  const color = placeColor(lists, task.listId, task.space);
  const pew = (
    [
      ["P", task.priority],
      ["E", task.effort],
      ["U", task.urgency],
    ] as const
  )
    .filter(([, v]) => v != null)
    .map(([k, v]) => `${k}${v}`)
    .join(" ");
  return (
    <div
      className={`task-row ${done ? "done" : ""}`}
      style={{ "--c": color } as CSSProperties}
      onClick={() => onOpen(task.id)}
      onPointerDown={(e) => startDrag(e, { kind: "task", id: task.id, label: task.title, color })}
      {...(droppable ? dropAttrs("task", task.id) : {})}
    >
      <DragHandle />
      {onFold && (
        <button
          className="caret"
          aria-label={folded ? "Show sub-tasks" : "Hide sub-tasks"}
          onClick={(e) => {
            e.stopPropagation();
            onFold();
          }}
        >
          {folded ? "▸" : "▾"}
        </button>
      )}
      <button
        className={`check ${done ? "checked" : ""}`}
        aria-label={done ? "Mark not done" : "Mark done"}
        onClick={(e) => {
          e.stopPropagation();
          void patchTask(task.id, { status: done ? "todo" : "done" });
        }}
      >
        {done ? "✓" : ""}
      </button>
      <div className="task-main">
        <div className="task-title">{task.title}</div>
        <div className="task-meta">
          {parent && <span className="path">↳ {parent.title}</span>}
          {showPath && <span className="path">{pathLabel(lists, task)}</span>}
          <StatusChip task={task} />
          {due && <span className={`chip due ${due.cls}`}>📅 {due.text}</span>}
          {task.repeat && <RepeatChip task={task} />}
          {kids.length > 0 && (
            <span className="chip" title="Sub-tasks done">
              ☑ {kidsDone}/{kids.length}
            </span>
          )}
          {task.links.length > 0 && <span className="chip">🔗 {task.links.length}</span>}
          {task.updates.length > 0 && <span className="chip muted">📝 {task.updates.length}</span>}
          {task.tags.map((t) => (
            <button
              key={t}
              className="chip tag"
              onClick={(e) => {
                e.stopPropagation();
                onTag?.(t);
              }}
            >
              #{t}
            </button>
          ))}
        </div>
      </div>
      {(score(task) !== null || pew) && (
        <div className="task-side">
          <ScoreBadge task={task} />
          <span className="pew" title="Priority · Effort · Urgency">
            {pew}
          </span>
        </div>
      )}
    </div>
  );
}

export function RepeatChip({ task }: { task: Task }) {
  if (!task.repeat) return null;
  return (
    <span className="chip" title={describeRepeat(task.repeat, task.dueDate)}>
      🔁
    </span>
  );
}
