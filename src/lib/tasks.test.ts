import { beforeEach, describe, expect, it } from "vitest";
import { connect, deleteTask, dropItem, getData, newList, newTask, patchTask, saveList, saveTask } from "../state/store";
import { EMPTY_META, LIST_COLORS, TASK_VERSION, type List, type Task } from "../types";
import { applyResult } from "./ai/interpret";
import type { AiAction } from "./ai/schema";
import { migrateTasks } from "./migrate";
import { canDrop, planMove, type DropTarget } from "./move";
import { sortTasks } from "./score";
import type { Backend, Snapshot } from "./storage/backend";
import { listColor, placeColor } from "./tree";

function memoryBackend(start: Partial<Snapshot> = {}): Backend & { data: () => Snapshot } {
  let data: Snapshot = { lists: [], tasks: [], meta: EMPTY_META, ...start };
  const subs = new Set<(s: Snapshot) => void>();
  const emit = () => subs.forEach((f) => f({ ...data }));
  return {
    kind: "local",
    data: () => data,
    subscribe(cb) {
      subs.add(cb);
      cb({ ...data });
      return () => subs.delete(cb);
    },
    async putList(l) {
      data = { ...data, lists: [...data.lists.filter((x) => x.id !== l.id), l] };
      emit();
    },
    async putTask(t) {
      data = { ...data, tasks: [...data.tasks.filter((x) => x.id !== t.id), t] };
      emit();
    },
    async removeList(id) {
      data = { ...data, lists: data.lists.filter((x) => x.id !== id) };
      emit();
    },
    async removeTask(id) {
      data = { ...data, tasks: data.tasks.filter((x) => x.id !== id) };
      emit();
    },
    async putMeta(m) {
      data = { ...data, meta: m };
      emit();
    },
    async loadSyncedSettings() {
      return null;
    },
    async saveSyncedSettings() {},
  };
}

const legacy = (p: Partial<Task> = {}): Task =>
  ({ id: "a", title: "A", notes: "", space: "work", listId: "l", status: "todo", waitingOn: "", priority: 5, effort: 5, urgency: 5, tags: [], links: [], subtasks: [], updates: [], dueDate: null, order: 100, createdAt: 1, updatedAt: 2, completedAt: null, ...p }) as Task;
const task = (id: string, p: Partial<Task> = {}): Task => newTask({ id, title: id, space: "work", listId: "l", ...p });
const list = (id: string, p: Partial<List> = {}): List => newList({ id, name: id, space: "work", ...p });
const ids = (ts: { id: string }[]) => ts.map((t) => t.id);
const inside = (kind: DropTarget["kind"], id: string): DropTarget => ({ kind, id, pos: "inside" });
const act = (p: Partial<AiAction>): AiAction => ({
  kind: "create_task", task_id: null, list_path: [], title: null, notes: null, progress_update: null,
  status: null, waiting_on: null, priority: null, effort: null, urgency: null, tags: [], links: [],
  due_date: null, subtasks: [], complete_subtasks: [], context: null, repeat: null, repeat_off: false, ...p,
});

describe("converting saved tasks", () => {
  it("turns checklist items into real sub-tasks and keeps their done state", () => {
    const { tasks } = migrateTasks([legacy({ subtasks: [{ id: "s1", text: "Step one", done: true }, { id: "s2", text: "Step two", done: false }] })]);
    const kids = tasks.filter((t) => t.parentId === "a");
    expect(kids.map((k) => [k.title, k.status, k.listId, k.space])).toEqual([["Step one", "done", "l", "work"], ["Step two", "todo", "l", "work"]]);
    expect(kids[0].completedAt).not.toBeNull();
    expect(tasks.find((t) => t.id === "a")).not.toHaveProperty("subtasks");
  });

  it("clears the old 5/5/5 default but keeps priorities someone chose", () => {
    const { tasks } = migrateTasks([legacy(), legacy({ id: "b", priority: 8 }), legacy({ id: "c", priority: 5, effort: 2, urgency: 5 })]);
    expect(tasks.find((t) => t.id === "a")).toMatchObject({ priority: null, effort: null, urgency: null });
    expect(tasks.find((t) => t.id === "b")).toMatchObject({ priority: 8, effort: 5, urgency: 5 });
    expect(tasks.find((t) => t.id === "c")).toMatchObject({ priority: 5, effort: 2, urgency: 5 });
  });

  it("leaves everything else on the task untouched", () => {
    const t = legacy({ notes: "n", tags: ["x"], dueDate: "2026-12-01", updates: [{ id: "u", at: 1, text: "log" }], links: [{ url: "https://a.b" }] });
    const { tasks } = migrateTasks([t]);
    expect(tasks[0]).toMatchObject({ notes: "n", tags: ["x"], dueDate: "2026-12-01", updates: t.updates, links: t.links, order: 100, createdAt: 1, updatedAt: 2 });
  });

  it("gives the same result if it runs twice, including after an interrupted save", () => {
    const start = legacy({ subtasks: [{ id: "s", text: "Step", done: false }] });
    const first = migrateTasks([start]);
    expect(migrateTasks(first.tasks).changed).toEqual([]);
    const child = first.changed[0];
    const retry = migrateTasks([start, child]);
    expect(retry.tasks.filter((t) => t.id === child.id)).toHaveLength(1);
    expect(retry.tasks.find((t) => t.id === "a")!.v).toBe(TASK_VERSION);
  });

  it("saves sub-tasks before clearing the checklist they came from", () => {
    const { changed } = migrateTasks([legacy({ subtasks: [{ id: "s", text: "Step", done: false }] })]);
    expect(ids(changed)).toEqual(["a-s", "a"]);
  });

  it("converts and saves on connect, without looping", () => {
    const b = memoryBackend({ tasks: [legacy({ subtasks: [{ id: "s", text: "Step", done: false }] })] });
    connect(b);
    expect(ids(b.data().tasks).sort()).toEqual(["a", "a-s"]);
    expect(b.data().tasks.find((t) => t.id === "a")!.v).toBe(TASK_VERSION);
    expect(getData().tasks).toHaveLength(2);
  });
});

describe("no priority by default", () => {
  it("new tasks start with nothing set", () => {
    expect(task("x")).toMatchObject({ priority: null, effort: null, urgency: null });
  });

  it("sorts tasks with no priority after those with one, in every direction", () => {
    const none = task("none");
    const low = task("low", { priority: 1, effort: 10, urgency: 1 });
    expect(ids(sortTasks([none, low], "score"))).toEqual(["low", "none"]);
    expect(ids(sortTasks([none, low], "priority"))).toEqual(["low", "none"]);
    expect(ids(sortTasks([none, low], "effort"))).toEqual(["low", "none"]);
  });

  it("the AI leaves it blank unless told", async () => {
    connect(memoryBackend());
    await applyResult({ reply: "", actions: [act({ title: "Plain" }), act({ title: "Urgent", urgency: 9 })] }, { raw: "" });
    expect(getData().tasks.find((t) => t.title === "Plain")).toMatchObject({ priority: null, urgency: null, effort: null });
    expect(getData().tasks.find((t) => t.title === "Urgent")).toMatchObject({ priority: null, urgency: 9, effort: null });
  });
});

describe("moving tasks", () => {
  const lists = [list("l"), list("m", { space: "personal" })];

  it("reorders among siblings", () => {
    const tasks = [task("a", { order: 10 }), task("b", { order: 20 }), task("c", { order: 30 })];
    const plan = planMove({ kind: "task", id: "c" }, { kind: "task", id: "a", pos: "after" }, lists, tasks)!;
    expect(plan.moved).toBe(false);
    expect(plan.tasks[0].order).toBe(15);
  });

  it("reports no change when dropped where it already is", () => {
    const tasks = [task("a", { order: 10 }), task("b", { order: 20 })];
    expect(planMove({ kind: "task", id: "b" }, { kind: "task", id: "a", pos: "after" }, lists, tasks)).toBeNull();
    expect(planMove({ kind: "task", id: "a" }, { kind: "task", id: "b", pos: "before" }, lists, tasks)).toBeNull();
  });

  it("makes room when two tasks have the same order", () => {
    const tasks = [task("a", { order: 5 }), task("b", { order: 5 }), task("c", { order: 9 })];
    const plan = planMove({ kind: "task", id: "c" }, { kind: "task", id: "a", pos: "after" }, lists, tasks)!;
    const after = tasks.map((t) => plan.tasks.find((x) => x.id === t.id) ?? t);
    expect(ids(after.sort((x, y) => x.order - y.order))).toEqual(["a", "c", "b"]);
  });

  it("dropping onto a task's middle makes it a sub-task", () => {
    const tasks = [task("a"), task("b", { listId: "m", space: "personal" })];
    const plan = planMove({ kind: "task", id: "a" }, inside("task", "b"), lists, tasks)!;
    expect(plan.tasks[0]).toMatchObject({ id: "a", parentId: "b", listId: "m", space: "personal" });
    expect(plan.moved).toBe(true);
  });

  it("brings sub-tasks along to a new list, in a new space", () => {
    const tasks = [task("a"), task("kid", { parentId: "a" }), task("grandkid", { parentId: "kid" })];
    const plan = planMove({ kind: "task", id: "a" }, inside("list", "m"), lists, tasks)!;
    for (const id of ["a", "kid", "grandkid"]) expect(plan.tasks.find((t) => t.id === id)).toMatchObject({ listId: "m", space: "personal" });
    expect(plan.tasks.find((t) => t.id === "kid")!.parentId).toBe("a");
  });

  it("dropping a sub-task onto a list makes it its own task", () => {
    const tasks = [task("a"), task("kid", { parentId: "a" })];
    const plan = planMove({ kind: "task", id: "kid" }, inside("list", "m"), lists, tasks)!;
    expect(plan.tasks[0]).toMatchObject({ parentId: null, listId: "m" });
  });

  it("dropping a sub-task beside another task places it at that level", () => {
    const tasks = [task("a", { order: 10 }), task("b", { order: 20 }), task("kid", { parentId: "a" })];
    const plan = planMove({ kind: "task", id: "kid" }, { kind: "task", id: "a", pos: "after" }, lists, tasks)!;
    expect(plan.tasks[0]).toMatchObject({ parentId: null, order: 15 });
  });

  it("refuses to put a task under itself or its own sub-tasks", () => {
    const tasks = [task("a"), task("kid", { parentId: "a" })];
    expect(canDrop({ kind: "task", id: "a" }, inside("task", "a"), lists, tasks)).toBe(false);
    expect(canDrop({ kind: "task", id: "a" }, inside("task", "kid"), lists, tasks)).toBe(false);
    expect(planMove({ kind: "task", id: "a" }, inside("task", "kid"), lists, tasks)).toBeNull();
  });
});

describe("moving lists", () => {
  it("nests a list and refuses to nest it inside itself", () => {
    const lists = [list("a"), list("b"), list("a1", { parentId: "a" })];
    expect(planMove({ kind: "list", id: "b" }, inside("list", "a"), lists, [])!.lists[0]).toMatchObject({ id: "b", parentId: "a" });
    expect(canDrop({ kind: "list", id: "a" }, inside("list", "a1"), lists, [])).toBe(false);
    expect(canDrop({ kind: "list", id: "a" }, inside("list", "a"), lists, [])).toBe(false);
  });

  it("carries sub-lists and every task to the new space", () => {
    const lists = [list("a"), list("a1", { parentId: "a" }), list("other", { space: "personal" })];
    const tasks = [task("t", { listId: "a1" }), task("kid", { listId: "a1", parentId: "t" }), task("stay", { listId: "other", space: "personal" })];
    const plan = planMove({ kind: "list", id: "a" }, inside("space", "personal"), lists, tasks)!;
    expect(plan.lists.find((l) => l.id === "a")).toMatchObject({ space: "personal", parentId: null });
    expect(plan.lists.find((l) => l.id === "a1")!.space).toBe("personal");
    expect(ids(plan.tasks).sort()).toEqual(["kid", "t"]);
    expect(plan.tasks.every((t) => t.space === "personal")).toBe(true);
  });

  it("reorders siblings, and a task can't be dropped into a position among lists", () => {
    const lists = [list("a", { order: 10 }), list("b", { order: 20 }), list("c", { order: 30 })];
    expect(planMove({ kind: "list", id: "c" }, { kind: "list", id: "a", pos: "before" }, lists, [])!.lists[0].order).toBe(10 - 1024);
    expect(canDrop({ kind: "list", id: "a" }, inside("task", "t"), lists, [task("t")])).toBe(false);
    expect(canDrop({ kind: "list", id: "a" }, inside("status", "done"), lists, [])).toBe(false);
  });
});

describe("sub-tasks through the store", () => {
  beforeEach(() => connect(memoryBackend()));

  it("finishing a task finishes its open sub-tasks", async () => {
    await saveTask(task("p"));
    await saveTask(task("k1", { parentId: "p" }));
    await saveTask(task("k2", { parentId: "k1" }));
    await patchTask("p", { status: "done" });
    expect(getData().tasks.map((t) => t.status)).toEqual(["done", "done", "done"]);
  });

  it("a repeating task's next round reopens its sub-tasks", async () => {
    await saveTask(task("p", { dueDate: "2026-11-06", repeat: { freq: "week", interval: 1, from: "due" } }));
    await saveTask(task("k", { parentId: "p", status: "done", completedAt: 1 }));
    await patchTask("p", { status: "done" });
    expect(getData().tasks.find((t) => t.id === "p")!.status).toBe("todo");
    expect(getData().tasks.find((t) => t.id === "k")).toMatchObject({ status: "todo", completedAt: null });
  });

  it("deleting a task deletes its sub-tasks and returns them for undo", async () => {
    await saveTask(task("p"));
    await saveTask(task("k", { parentId: "p" }));
    await saveTask(task("other"));
    expect(ids(await deleteTask("p")).sort()).toEqual(["k", "p"]);
    expect(ids(getData().tasks)).toEqual(["other"]);
  });

  it("a drop saves every change", async () => {
    await saveList(list("l"));
    await saveList(list("m"));
    await saveTask(task("p"));
    await saveTask(task("k", { parentId: "p" }));
    await dropItem({ kind: "task", id: "p" }, inside("list", "m"));
    expect(getData().tasks.every((t) => t.listId === "m")).toBe(true);
  });

  it("a status drop goes through the normal status change", async () => {
    await saveTask(task("p"));
    await dropItem({ kind: "task", id: "p" }, inside("status", "in_progress"));
    expect(getData().tasks[0].status).toBe("in_progress");
  });
});

describe("the AI and sub-tasks", () => {
  beforeEach(() => connect(memoryBackend()));

  it("creates sub-tasks as real tasks, and undo removes them", async () => {
    const r = await applyResult({ reply: "", actions: [act({ title: "Plan offsite", list_path: ["Work", "Events"], subtasks: ["Book venue", "Send invites"] })] }, { raw: "" });
    const parent = getData().tasks.find((t) => t.title === "Plan offsite")!;
    const kids = getData().tasks.filter((t) => t.parentId === parent.id);
    expect(kids.map((k) => k.title)).toEqual(["Book venue", "Send invites"]);
    expect(kids.every((k) => k.listId === parent.listId)).toBe(true);
    await r.undo();
    expect(getData().tasks).toEqual([]);
  });

  it("ticks off sub-tasks by title and undo reopens them", async () => {
    await saveTask(task("p", { title: "Plan" }));
    await saveTask(task("k", { title: "Book venue", parentId: "p" }));
    const r = await applyResult({ reply: "", actions: [act({ kind: "update_task", task_id: "p", complete_subtasks: ["book the venue", "venue"] })] }, { raw: "" });
    expect(getData().tasks.find((t) => t.id === "k")!.status).toBe("done");
    await r.undo();
    expect(getData().tasks.find((t) => t.id === "k")!.status).toBe("todo");
  });

  it("moving a task brings its sub-tasks, and undo puts them back", async () => {
    await saveList(list("l", { name: "Old" }));
    await saveTask(task("p", { title: "Plan" }));
    await saveTask(task("k", { parentId: "p" }));
    const r = await applyResult({ reply: "", actions: [act({ kind: "update_task", task_id: "p", list_path: ["Personal", "Home"] })] }, { raw: "" });
    expect(getData().tasks.every((t) => t.space === "personal")).toBe(true);
    await r.undo();
    expect(getData().tasks.every((t) => t.listId === "l" && t.space === "work")).toBe(true);
  });

  it("deleting a task through the AI can be undone, sub-tasks included", async () => {
    await saveTask(task("p"));
    await saveTask(task("k", { parentId: "p" }));
    const r = await applyResult({ reply: "", actions: [act({ kind: "delete_task", task_id: "p" })] }, { raw: "" });
    expect(getData().tasks).toEqual([]);
    await r.undo();
    expect(ids(getData().tasks).sort()).toEqual(["k", "p"]);
  });
});

describe("list colors", () => {
  it("gives top-level lists different colors, in the order they were made", () => {
    const lists = [list("a", { createdAt: 1 }), list("b", { createdAt: 2 }), list("c", { createdAt: 3, space: "personal" })];
    expect(lists.map((l) => listColor(lists, l.id))).toEqual(LIST_COLORS.slice(0, 3));
  });

  it("sub-lists inherit until they pick their own, and that passes down", () => {
    const lists = [list("a", { createdAt: 1 }), list("a1", { parentId: "a" }), list("a2", { parentId: "a", color: "#111111" }), list("a2x", { parentId: "a2" })];
    expect(listColor(lists, "a1")).toBe(LIST_COLORS[0]);
    expect(listColor(lists, "a2")).toBe("#111111");
    expect(listColor(lists, "a2x")).toBe("#111111");
  });

  it("tasks take the color of where they live", () => {
    const lists = [list("a", { color: "#222222" })];
    expect(placeColor(lists, "a", "work")).toBe("#222222");
    expect(placeColor(lists, null, "work")).not.toBe("#222222");
  });
});
