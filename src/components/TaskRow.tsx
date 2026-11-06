import { score, scoreColor } from "../lib/score";
import { pathLabel } from "../lib/tree";
import { patchTask, useData } from "../state/store";
import { STATUSES, type Task } from "../types";

export function ScoreBadge({ task }: { task: Task }) {
  const s = score(task);
  return (
    <span
      className="score"
      style={{ borderColor: scoreColor(s), color: scoreColor(s) }}
      title={`Score ${s} = priority ${task.priority} × urgency ${task.urgency} × ease ${11 - task.effort} ÷ 10`}
    >
      {s}
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
}: {
  task: Task;
  onOpen: (id: string) => void;
  showPath?: boolean;
  onTag?: (t: string) => void;
}) {
  const { lists } = useData();
  const done = task.status === "done";
  const due = dueLabel(task.dueDate);
  const subDone = task.subtasks.filter((s) => s.done).length;
  return (
    <div className={`task-row ${done ? "done" : ""}`} onClick={() => onOpen(task.id)}>
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
          {showPath && <span className="path">{pathLabel(lists, task)}</span>}
          <StatusChip task={task} />
          {due && <span className={`chip due ${due.cls}`}>📅 {due.text}</span>}
          {task.subtasks.length > 0 && (
            <span className="chip">
              ☑ {subDone}/{task.subtasks.length}
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
      <div className="task-side">
        <ScoreBadge task={task} />
        <span className="pew" title="Priority · Effort · Urgency">
          P{task.priority} E{task.effort} U{task.urgency}
        </span>
      </div>
    </div>
  );
}
