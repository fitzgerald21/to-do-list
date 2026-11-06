import { useSyncExternalStore } from "react";
import type { Backend, Snapshot } from "../lib/storage/backend";
import { migrateTasks } from "../lib/migrate";
import { planMove, type DragItem, type DropTarget, type MovePlan } from "../lib/move";
import { prettyDay, rollForward } from "../lib/recurrence";
import { descendantIds, taskDescendantIds, uid } from "../lib/tree";
import { toast } from "./ui";
import { DEFAULT_SETTINGS, EMPTY_META, TASK_VERSION, type List, type Meta, type Place, type Settings, type Space, type Status, type Task } from "../types";

// ---------------------------------------------------------------- data store

let backend: Backend | null = null;
let snap: Snapshot & { ready: boolean } = { lists: [], tasks: [], meta: EMPTY_META, ready: false };
const subs = new Set<() => void>();
const notify = () => subs.forEach((f) => f());
let unsub: (() => void) | null = null;

export function connect(b: Backend, onDenied?: () => void) {
  unsub?.();
  backend = b;
  snap = { lists: [], tasks: [], meta: EMPTY_META, ready: false };
  notify();
  const converted = new Set<string>();
  unsub = b.subscribe((s) => {
    const { tasks, changed } = migrateTasks(s.tasks);
    snap = { ...s, tasks, ready: true };
    notify();
    // Save each conversion once: saving can call straight back into here.
    for (const t of changed) {
      if (converted.has(t.id)) continue;
      converted.add(t.id);
      void b.putTask(t);
    }
  }, onDenied);
  void loadSynced();
}

export function disconnect() {
  unsub?.();
  unsub = null;
  backend = null;
  snap = { lists: [], tasks: [], meta: EMPTY_META, ready: false };
  notify();
}

export function getBackend() {
  return backend;
}

export function useData() {
  return useSyncExternalStore(
    (f) => {
      subs.add(f);
      return () => subs.delete(f);
    },
    () => snap,
  );
}

export const getData = () => snap;

const now = () => Date.now();

export function newTask(partial: Partial<Task> & { title: string; space: Space }): Task {
  const t = now();
  return {
    id: uid(),
    notes: "",
    listId: null,
    status: "todo",
    waitingOn: "",
    parentId: null,
    priority: null,
    effort: null,
    urgency: null,
    tags: [],
    links: [],
    updates: [],
    dueDate: null,
    order: t,
    createdAt: t,
    updatedAt: t,
    completedAt: null,
    v: TASK_VERSION,
    ...partial,
  };
}

export function newList(partial: Partial<List> & { name: string; space: Space }): List {
  const t = now();
  return {
    id: uid(),
    parentId: null,
    closed: false,
    order: t,
    createdAt: t,
    updatedAt: t,
    ...partial,
  };
}

/** Optimistic local update so the UI responds instantly, then persist. */
function localPut<K extends "lists" | "tasks">(key: K, item: Snapshot[K][number]) {
  const arr = [...(snap[key] as { id: string }[])];
  const i = arr.findIndex((x) => x.id === item.id);
  if (i >= 0) arr[i] = item;
  else arr.push(item);
  snap = { ...snap, [key]: arr };
  notify();
}

export async function saveTask(t: Task) {
  localPut("tasks", t);
  await backend?.putTask(t);
}

export async function saveList(l: List) {
  localPut("lists", l);
  await backend?.putList(l);
}

export async function saveMeta(m: Meta) {
  snap = { ...snap, meta: m };
  notify();
  await backend?.putMeta(m);
}

/** The background doc for a place ("About me", Work, Personal or a list). */
export function getContext(p: Place): string {
  if (p.kind === "list") return snap.lists.find((l) => l.id === p.id)?.context ?? "";
  return snap.meta.context[p.kind === "all" ? "all" : p.space] ?? "";
}

export async function setContext(p: Place, text: string) {
  if (p.kind === "list") return patchList(p.id, { context: text });
  const key = p.kind === "all" ? "all" : p.space;
  await saveMeta({ ...snap.meta, context: { ...snap.meta.context, [key]: text }, updatedAt: now() });
}

/**
 * What happens to a task's sub-tasks when it changes: finishing it finishes them, and starting
 * a repeating task's next round starts its finished sub-tasks again.
 */
export function settleSubtasks(id: string, mode: "done" | "reset"): { before: Task[]; after: Task[] } {
  const ids = taskDescendantIds(snap.tasks, id);
  const before = snap.tasks.filter(
    (t) => t.id !== id && ids.has(t.id) && (mode === "done" ? t.status !== "done" && !t.repeat : t.status === "done"),
  );
  const t = now();
  const after = before.map((c) =>
    mode === "done"
      ? { ...c, status: "done" as Status, waitingOn: "", completedAt: t, updatedAt: t }
      : { ...c, status: "todo" as Status, completedAt: null, updatedAt: t },
  );
  return { before, after };
}

export async function patchTask(id: string, patch: Partial<Task>) {
  const cur = snap.tasks.find((t) => t.id === id);
  if (!cur) return;
  // Checking off a repeating task rolls it on to its next date instead.
  if (patch.status === "done" && cur.status !== "done" && cur.repeat) {
    const rolled = rollForward({ ...cur, ...patch });
    if (rolled) {
      const kids = settleSubtasks(id, "reset");
      await Promise.all([saveTask(rolled), ...kids.after.map(saveTask)]);
      toast(`🔁 Done. Next: ${prettyDay(rolled.dueDate!)}`, {
        action: { label: "Undo", run: () => void Promise.all([cur, ...kids.before].map(saveTask)) },
      });
      return;
    }
  }
  const next: Task = { ...cur, ...patch, updatedAt: now() };
  if (patch.status) {
    if (patch.status === "done" && cur.status !== "done") next.completedAt = now();
    if (patch.status !== "done") next.completedAt = null;
    if (patch.status !== "waiting" && patch.waitingOn === undefined) next.waitingOn = "";
  }
  const finishing = patch.status === "done" && cur.status !== "done";
  const kids = finishing ? settleSubtasks(id, "done") : { before: [], after: [] };
  await Promise.all([saveTask(next), ...kids.after.map(saveTask)]);
  if (kids.after.length) {
    toast(`Also finished ${kids.after.length} sub-task${kids.after.length === 1 ? "" : "s"}`, {
      action: { label: "Undo", run: () => void Promise.all([cur, ...kids.before].map(saveTask)) },
    });
  }
}

/** Carries out a drag and drop. Moving somewhere new offers Undo; re-ordering among the same siblings doesn't need it. */
export async function dropItem(item: DragItem, target: DropTarget): Promise<MovePlan | null> {
  if (target.kind === "status") {
    await patchTask(item.id, { status: target.id as Status });
    return null;
  }
  const plan = planMove(item, target, snap.lists, snap.tasks);
  if (!plan) return null;
  const oldTasks = snap.tasks.filter((t) => plan.tasks.some((x) => x.id === t.id));
  const oldLists = snap.lists.filter((l) => plan.lists.some((x) => x.id === l.id));
  await Promise.all([...plan.lists.map(saveList), ...plan.tasks.map(saveTask)]);
  if (plan.moved) {
    toast(plan.label, {
      ms: 5000,
      action: { label: "Undo", run: () => void Promise.all([...oldLists.map(saveList), ...oldTasks.map(saveTask)]) },
    });
  }
  return plan;
}

export async function patchList(id: string, patch: Partial<List>) {
  const cur = snap.lists.find((l) => l.id === id);
  if (!cur) return;
  await saveList({ ...cur, ...patch, updatedAt: now() });
}

/** Deletes a task and its sub-tasks. Returns what it removed, so it can be put back. */
export async function deleteTask(id: string): Promise<Task[]> {
  const ids = taskDescendantIds(snap.tasks, id);
  const removed = snap.tasks.filter((t) => ids.has(t.id));
  snap = { ...snap, tasks: snap.tasks.filter((t) => !ids.has(t.id)) };
  notify();
  await Promise.all(removed.map((t) => backend?.removeTask(t.id)));
  return removed;
}

export async function removeListOnly(id: string) {
  snap = { ...snap, lists: snap.lists.filter((l) => l.id !== id) };
  notify();
  await backend?.removeList(id);
}

/** Deletes a list, its sub-lists and every task inside them. */
export async function deleteListDeep(id: string) {
  const ids = descendantIds(snap.lists, id);
  const tasks = snap.tasks.filter((t) => t.listId && ids.has(t.listId));
  snap = {
    ...snap,
    lists: snap.lists.filter((l) => !ids.has(l.id)),
    tasks: snap.tasks.filter((t) => !(t.listId && ids.has(t.listId))),
  };
  notify();
  await Promise.all([
    ...tasks.map((t) => backend?.removeTask(t.id)),
    ...[...ids].map((i) => backend?.removeList(i)),
  ]);
}

// ------------------------------------------------------------ settings store

const SETTINGS_KEY = "braindump:settings:v1";

function readSettings(): Settings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (raw) {
      const s = JSON.parse(raw);
      return {
        ...DEFAULT_SETTINGS,
        ...s,
        models: { ...DEFAULT_SETTINGS.models, ...s.models },
        keys: { ...DEFAULT_SETTINGS.keys, ...s.keys },
      };
    }
  } catch {
    /* ignore */
  }
  return DEFAULT_SETTINGS;
}

let settings = readSettings();
const settingsSubs = new Set<() => void>();

export function useSettings(): Settings {
  return useSyncExternalStore(
    (f) => {
      settingsSubs.add(f);
      return () => settingsSubs.delete(f);
    },
    () => settings,
  );
}

export const getSettings = () => settings;

export function updateSettings(patch: Partial<Settings>) {
  settings = { ...settings, ...patch };
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    /* ignore */
  }
  settingsSubs.forEach((f) => f());
  if (backend?.kind === "firebase") {
    if (settings.syncKeys) void backend.saveSyncedSettings(settings);
    else if (patch.syncKeys === false) void backend.saveSyncedSettings(null);
  }
}

async function loadSynced() {
  const b = backend;
  if (!b || b.kind !== "firebase") return;
  const remote = await b.loadSyncedSettings();
  if (remote && remote.syncKeys) {
    settings = {
      ...settings,
      ...remote,
      models: { ...settings.models, ...remote.models },
      keys: { ...settings.keys, ...remote.keys },
    };
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    } catch {
      /* ignore */
    }
    settingsSubs.forEach((f) => f());
  }
}
