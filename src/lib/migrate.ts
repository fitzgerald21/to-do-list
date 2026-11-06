import { TASK_VERSION, type Task } from "../types";

/**
 * Brings tasks saved by an older version up to date: checklist items become real sub-tasks, and a task
 * left on the old default of 5 / 5 / 5 goes back to having no priority. Ids are derived from the original,
 * so running this on two devices, or twice after an interrupted save, gives the same result.
 * `changed` lists sub-tasks before their parents, so the checklist is only cleared once they exist.
 */
export function migrateTasks(tasks: Task[]): { tasks: Task[]; changed: Task[] } {
  if (tasks.every((t) => (t.v ?? 0) >= TASK_VERSION)) return { tasks, changed: [] };
  const out: Task[] = [];
  const changed: Task[] = [];
  const have = new Set(tasks.map((t) => t.id));
  for (const t of tasks) {
    if ((t.v ?? 0) >= TASK_VERSION) {
      out.push(t);
      continue;
    }
    (t.subtasks ?? []).forEach((item, i) => {
      const id = `${t.id}-${item.id}`;
      if (have.has(id)) return;
      have.add(id);
      const child: Task = {
        id,
        title: item.text,
        notes: "",
        space: t.space,
        listId: t.listId,
        parentId: t.id,
        status: item.done ? "done" : "todo",
        waitingOn: "",
        priority: null,
        effort: null,
        urgency: null,
        tags: [],
        links: [],
        updates: [],
        dueDate: null,
        order: i + 1,
        createdAt: t.createdAt,
        updatedAt: t.updatedAt,
        completedAt: item.done ? t.updatedAt : null,
        v: TASK_VERSION,
      };
      out.push(child);
      changed.push(child);
    });
    const { subtasks: _checklist, ...rest } = t;
    const unset = t.priority === 5 && t.effort === 5 && t.urgency === 5;
    const next: Task = {
      ...rest,
      parentId: t.parentId ?? null,
      priority: unset ? null : (t.priority ?? null),
      effort: unset ? null : (t.effort ?? null),
      urgency: unset ? null : (t.urgency ?? null),
      v: TASK_VERSION,
    };
    out.push(next);
    changed.push(next);
  }
  return { tasks: out, changed };
}
