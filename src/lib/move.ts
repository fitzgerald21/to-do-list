import type { List, Space, Task } from "../types";
import { descendantIds, listPath, taskDescendantIds } from "./tree";

export interface DragItem {
  kind: "task" | "list";
  id: string;
}

export type DropPos = "before" | "inside" | "after";

export interface DropTarget {
  kind: "task" | "list" | "space" | "status";
  id: string;
  pos: DropPos;
}

export interface MovePlan {
  tasks: Task[];
  lists: List[];
  /** False when it only changed position among the same siblings. */
  moved: boolean;
  label: string;
}

/** A list can't go inside itself, nor a task under itself or its own sub-tasks. */
export function canDrop(item: DragItem, target: DropTarget, lists: List[], tasks: Task[]): boolean {
  if (target.kind === "status") return item.kind === "task";
  if (item.kind === "task") return target.kind !== "task" || !taskDescendantIds(tasks, item.id).has(target.id);
  if (target.kind === "space") return true;
  return target.kind === "list" && !descendantIds(lists, item.id).has(target.id);
}

const byOrder = <T extends { id: string; order: number }>(a: T, b: T) => a.order - b.order || a.id.localeCompare(b.id);

/** The order value that puts something at `index` among `siblings`, renumbering them if there's no gap left. */
function orderAt<T extends { order: number }>(siblings: T[], index: number, now: number): { order: number; renumbered: T[] } {
  const prev = siblings[index - 1];
  const next = siblings[index];
  if (!prev && !next) return { order: now, renumbered: [] };
  if (!prev) return { order: next.order - 1024, renumbered: [] };
  if (!next) return { order: prev.order + 1024, renumbered: [] };
  const mid = (prev.order + next.order) / 2;
  if (mid > prev.order && mid < next.order) return { order: mid, renumbered: [] };
  const renumbered = siblings.map((s, i) => ({ ...s, order: (i < index ? i : i + 1) * 1024 }));
  return { order: index * 1024, renumbered };
}

function planTask(id: string, target: DropTarget, lists: List[], tasks: Task[], now: number): MovePlan | null {
  const t = tasks.find((x) => x.id === id);
  if (!t) return null;
  let parentId: string | null = null;
  let listId: string | null = null;
  let space: Space = t.space;
  let anchor: Task | undefined;
  if (target.kind === "task") {
    const tt = tasks.find((x) => x.id === target.id);
    if (!tt) return null;
    listId = tt.listId;
    space = tt.space;
    if (target.pos === "inside") parentId = tt.id;
    else {
      parentId = tt.parentId ?? null;
      anchor = tt;
    }
  } else if (target.kind === "list") {
    const l = lists.find((x) => x.id === target.id);
    if (!l) return null;
    listId = l.id;
    space = l.space;
  } else {
    space = target.id as Space;
  }

  const inContainer = (x: Task) => (parentId ? x.parentId === parentId : !x.parentId && x.space === space && x.listId === listId);
  const siblings = tasks.filter((x) => x.id !== t.id && inContainer(x)).sort(byOrder);
  const index = anchor ? siblings.findIndex((x) => x.id === anchor!.id) + (target.pos === "after" ? 1 : 0) : siblings.length;
  const same = inContainer(t);
  if (same && siblings.filter((x) => byOrder(x, t) < 0).length === index) return null;

  const { order, renumbered } = orderAt(siblings, index, now);
  const moved = !same;
  const out: Task[] = [...renumbered, { ...t, parentId, listId, space, order, ...(moved ? { updatedAt: now } : {}) }];
  if (t.listId !== listId || t.space !== space) {
    const kids = taskDescendantIds(tasks, t.id);
    for (const k of tasks) if (k.id !== t.id && kids.has(k.id)) out.push({ ...k, listId, space, updatedAt: now });
  }
  const parent = parentId ? tasks.find((x) => x.id === parentId) : null;
  const where = parent ? `under “${parent.title}”` : `to ${listPath(lists, listId, space).join(" › ")}`;
  return { tasks: out, lists: [], moved, label: `Moved “${t.title}” ${where}` };
}

function planList(id: string, target: DropTarget, lists: List[], tasks: Task[], now: number): MovePlan | null {
  const l = lists.find((x) => x.id === id);
  if (!l) return null;
  let parentId: string | null = null;
  let space: Space = l.space;
  let anchor: List | undefined;
  if (target.kind === "list") {
    const tl = lists.find((x) => x.id === target.id);
    if (!tl) return null;
    space = tl.space;
    if (target.pos === "inside") parentId = tl.id;
    else {
      parentId = tl.parentId;
      anchor = tl;
    }
  } else {
    space = target.id as Space;
  }

  const siblings = lists.filter((x) => x.id !== l.id && x.parentId === parentId && x.space === space).sort(byOrder);
  const index = anchor ? siblings.findIndex((x) => x.id === anchor!.id) + (target.pos === "after" ? 1 : 0) : siblings.length;
  const same = l.parentId === parentId && l.space === space;
  if (same && siblings.filter((x) => byOrder(x, l) < 0).length === index) return null;

  const { order, renumbered } = orderAt(siblings, index, now);
  const outLists: List[] = [...renumbered, { ...l, parentId, space, order, ...(same ? {} : { updatedAt: now }) }];
  const outTasks: Task[] = [];
  if (l.space !== space) {
    const ids = descendantIds(lists, l.id);
    for (const k of lists) if (k.id !== l.id && ids.has(k.id)) outLists.push({ ...k, space, updatedAt: now });
    for (const t of tasks) if (t.listId && ids.has(t.listId)) outTasks.push({ ...t, space, updatedAt: now });
  }
  return { tasks: outTasks, lists: outLists, moved: !same, label: `Moved “${l.name}” to ${listPath(lists, parentId, space).join(" › ")}` };
}

/** Everything that has to change for a drop, or null if it changes nothing. Status drops are handled by the caller. */
export function planMove(item: DragItem, target: DropTarget, lists: List[], tasks: Task[], now = Date.now()): MovePlan | null {
  if (!canDrop(item, target, lists, tasks) || target.kind === "status") return null;
  return item.kind === "task" ? planTask(item.id, target, lists, tasks, now) : planList(item.id, target, lists, tasks, now);
}

