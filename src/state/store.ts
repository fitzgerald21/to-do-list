import { useSyncExternalStore } from "react";
import type { Backend, Snapshot } from "../lib/storage/backend";
import { prettyDay, rollForward } from "../lib/recurrence";
import { descendantIds, uid } from "../lib/tree";
import { toast } from "./ui";
import { DEFAULT_SETTINGS, EMPTY_META, type List, type Meta, type Place, type Settings, type Space, type Task } from "../types";

// ---------------------------------------------------------------- data store

let backend: Backend | null = null;
let snap: Snapshot & { ready: boolean } = { lists: [], tasks: [], meta: EMPTY_META, ready: false };
const subs = new Set<() => void>();
const notify = () => subs.forEach((f) => f());
let unsub: (() => void) | null = null;

export function connect(b: Backend) {
  unsub?.();
  backend = b;
  snap = { lists: [], tasks: [], meta: EMPTY_META, ready: false };
  notify();
  unsub = b.subscribe((s) => {
    snap = { ...s, ready: true };
    notify();
  });
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
    priority: 5,
    effort: 5,
    urgency: 5,
    tags: [],
    links: [],
    subtasks: [],
    updates: [],
    dueDate: null,
    order: t,
    createdAt: t,
    updatedAt: t,
    completedAt: null,
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

export async function patchTask(id: string, patch: Partial<Task>) {
  const cur = snap.tasks.find((t) => t.id === id);
  if (!cur) return;
  // Checking off a repeating task rolls it on to its next date instead.
  if (patch.status === "done" && cur.status !== "done" && cur.repeat) {
    const rolled = rollForward({ ...cur, ...patch });
    if (rolled) {
      await saveTask(rolled);
      toast(`🔁 Done. Next: ${prettyDay(rolled.dueDate!)}`, {
        action: { label: "Undo", run: () => void saveTask(cur) },
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
  await saveTask(next);
}

export async function patchList(id: string, patch: Partial<List>) {
  const cur = snap.lists.find((l) => l.id === id);
  if (!cur) return;
  await saveList({ ...cur, ...patch, updatedAt: now() });
}

export async function deleteTask(id: string) {
  snap = { ...snap, tasks: snap.tasks.filter((t) => t.id !== id) };
  notify();
  await backend?.removeTask(id);
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
