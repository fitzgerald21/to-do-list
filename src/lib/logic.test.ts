import { beforeEach, describe, expect, it } from "vitest";
import { connect, getData, newList, saveList } from "../state/store";
import type { Backend, Snapshot } from "./storage/backend";
import { applyResult } from "./ai/interpret";
import { parseOffline } from "./ai/fallback";
import { buildUserMessage } from "./ai/prompt";
import { extractJson, normalizeResult, type AiAction } from "./ai/schema";
import { score, sortTasks } from "./score";
import { listPath, resolvePath } from "./tree";
import type { Task } from "../types";

function memoryBackend(): Backend {
  let data: Snapshot = { lists: [], tasks: [] };
  const subs = new Set<(s: Snapshot) => void>();
  const emit = () => subs.forEach((f) => f({ ...data }));
  return {
    kind: "local",
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
    async loadSyncedSettings() {
      return null;
    },
    async saveSyncedSettings() {},
  };
}

const action = (p: Partial<AiAction>): AiAction => ({
  kind: "create_task", task_id: null, list_path: [], title: null, notes: null, progress_update: null,
  status: null, waiting_on: null, priority: null, effort: null, urgency: null, tags: [], links: [],
  due_date: null, subtasks: [], complete_subtasks: [], ...p,
});

describe("score", () => {
  it("rewards important, urgent, easy work", () => {
    expect(score({ priority: 10, urgency: 10, effort: 1 })).toBe(100);
    expect(score({ priority: 1, urgency: 1, effort: 10 })).toBe(0);
    expect(score({ priority: 5, urgency: 5, effort: 5 })).toBe(15);
    expect(score({ priority: 8, urgency: 8, effort: 2 })).toBeGreaterThan(score({ priority: 8, urgency: 8, effort: 9 }));
  });
  it("sorts by score then others", () => {
    const mk = (id: string, p: number, e: number, u: number) => ({ id, priority: p, effort: e, urgency: u, order: 0 }) as Task;
    expect(sortTasks([mk("a", 3, 3, 3), mk("b", 9, 2, 9), mk("c", 9, 9, 9)], "score").map((t) => t.id)).toEqual(["b", "c", "a"]);
    expect(sortTasks([mk("a", 3, 3, 3), mk("b", 9, 2, 9), mk("c", 9, 9, 9)], "effort").map((t) => t.id)).toEqual(["b", "a", "c"]);
  });
});

describe("offline parser", () => {
  it("parses list, priority and tags", () => {
    const r = parseOffline("add spreadsheet for Kathy under transformation priority 8 #reporting");
    expect(r.actions[0]).toMatchObject({ title: "Spreadsheet for Kathy", list_path: ["transformation"], priority: 8, tags: ["reporting"] });
  });
  it("handles a bare to-do", () => {
    expect(parseOffline("Make spreadsheet for Kathy.").actions[0]).toMatchObject({ title: "Make spreadsheet for Kathy", list_path: [] });
  });
  it("handles spoken numbers and nested paths", () => {
    const r = parseOffline("add call vendor to Work / Transformation / Vendors with priority nine effort two");
    expect(r.actions[0]).toMatchObject({ title: "Call vendor", list_path: ["Work", "Transformation", "Vendors"], priority: 9, effort: 2 });
  });
});

describe("schema normalisation", () => {
  it("coerces sloppy model output", () => {
    const r = normalizeResult(
      extractJson('Sure!\n```json\n{"actions":[{"kind":"create_task","title":"X","priority":"12","tags":["#Foo"],"status":"bogus","links":["example.com"],"due_date":"tomorrow"}],"reply":"ok"}\n```'),
    );
    expect(r.actions[0]).toMatchObject({ title: "X", priority: 10, tags: ["foo"], status: null, due_date: null, links: [{ url: "example.com" }] });
    expect(r.reply).toBe("ok");
  });
  it("drops unknown kinds", () => {
    expect(normalizeResult({ actions: [{ kind: "explode" }] }).actions).toHaveLength(0);
  });
});

describe("tree + apply", () => {
  beforeEach(() => connect(memoryBackend()));

  it("resolves spoken list names, even nested ones", async () => {
    const t = newList({ name: "Transformation", space: "work" });
    await saveList(t);
    const r = newList({ name: "Reporting", space: "work", parentId: t.id });
    await saveList(r);
    const { lists } = getData();
    expect(resolvePath(lists, ["transformation"], "personal")).toEqual({ space: "work", listId: t.id, missing: [] });
    expect(resolvePath(lists, ["Reporting"], "work")).toEqual({ space: "work", listId: r.id, missing: [] });
    expect(resolvePath(lists, ["Work", "Transformation", "Kathy"], "work")).toEqual({ space: "work", listId: t.id, missing: ["Kathy"] });
    expect(resolvePath(lists, ["Personal"], "work")).toEqual({ space: "personal", listId: null, missing: [] });
    expect(listPath(lists, r.id, "work")).toEqual(["Work", "Transformation", "Reporting"]);
  });

  it("creates tasks (and missing lists), then undoes cleanly", async () => {
    const receipt = await applyResult(
      {
        reply: "",
        actions: [
          action({ title: "Make spreadsheet for Kathy", list_path: ["Work", "Transformation"], priority: 8, tags: ["reporting"] }),
          action({ title: "Buy dog food", list_path: ["Personal", "Errands"] }),
        ],
      },
      { raw: "test" },
    );
    let d = getData();
    expect(d.lists.map((l) => l.name).sort()).toEqual(["Errands", "Transformation"]);
    const t = d.tasks.find((x) => x.title === "Make spreadsheet for Kathy")!;
    expect(t).toMatchObject({ space: "work", priority: 8, tags: ["reporting"], status: "todo" });
    expect(listPath(d.lists, t.listId, t.space)).toEqual(["Work", "Transformation"]);

    await receipt.undo();
    d = getData();
    expect(d.tasks).toHaveLength(0);
    expect(d.lists).toHaveLength(0);
  });

  it("applies a spoken project update to the focus task", async () => {
    await applyResult({ reply: "", actions: [action({ title: "Vendor contract", list_path: ["Work"] })] }, { raw: "" });
    const id = getData().tasks[0].id;
    const before = getData().tasks[0];
    const receipt = await applyResult(
      {
        reply: "",
        actions: [
          action({
            kind: "update_task",
            waiting_on: "Jordan",
            progress_update: "Waiting on Jordan for the report. Michael will send pricing Thu Nov 12.",
            subtasks: ["Review pricing"],
          }),
        ],
      },
      { raw: "I'm waiting on Jordan for the report and Michael said Thursday", focusTaskId: id },
    );
    const t = getData().tasks[0];
    expect(t.status).toBe("waiting");
    expect(t.waitingOn).toBe("Jordan");
    expect(t.updates).toHaveLength(1);
    expect(t.updates[0].raw).toContain("Michael");
    expect(t.subtasks.map((s) => s.text)).toEqual(["Review pricing"]);

    await receipt.undo();
    expect(getData().tasks[0]).toEqual(before);
  });

  it("builds a prompt with lists, open tasks and today's date", async () => {
    await saveList(newList({ name: "Transformation", space: "work" }));
    const msg = buildUserMessage("add x", { lists: getData().lists, tasks: [], tags: [], defaultSpace: "work", viewing: ["Work", "Transformation"] });
    expect(msg).toContain("- Transformation");
    expect(msg).toContain("currently viewing: Work > Transformation");
    expect(msg).toMatch(/today: \w+day/);
  });
});
