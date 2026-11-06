import { EMPTY_META, type List, type Meta, type Task } from "../../types";
import type { Backend, Snapshot } from "./backend";

const KEY = "braindump:data:v1";

export function readLocalData(): Snapshot {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const d = JSON.parse(raw);
      return { lists: d.lists ?? [], tasks: d.tasks ?? [], meta: d.meta ?? EMPTY_META };
    }
  } catch {
    /* ignore */
  }
  return { lists: [], tasks: [], meta: EMPTY_META };
}

/** What this browser has that the account doesn't. The account's copy wins on any clash. */
export function planUpload(local: Snapshot, cloud: { listIds: Set<string>; taskIds: Set<string>; meta: Meta | null }) {
  const lists = local.lists.filter((l: List) => !cloud.listIds.has(l.id));
  const tasks = local.tasks.filter((t: Task) => !cloud.taskIds.has(t.id));
  const cloudContext = cloud.meta?.context ?? {};
  const missing = Object.fromEntries(
    Object.entries(local.meta?.context ?? {}).filter(([k, v]) => v && !cloudContext[k as keyof Meta["context"]]),
  );
  const meta: Meta | null = Object.keys(missing).length
    ? { ...EMPTY_META, ...cloud.meta, context: { ...cloudContext, ...missing }, updatedAt: Date.now() }
    : null;
  return { lists, tasks, meta };
}

/** Saves everything in this browser only. Used until Firebase is configured. */
export function createLocalBackend(): Backend {
  let data = readLocalData();
  const subs = new Set<(s: Snapshot) => void>();
  const emit = () => {
    try {
      localStorage.setItem(KEY, JSON.stringify(data));
    } catch {
      /* storage full / blocked */
    }
    const snap = { lists: [...data.lists], tasks: [...data.tasks], meta: data.meta };
    subs.forEach((cb) => cb(snap));
  };
  const upsert = <T extends { id: string }>(arr: T[], item: T) => {
    const i = arr.findIndex((x) => x.id === item.id);
    if (i >= 0) arr[i] = item;
    else arr.push(item);
  };

  // Keep two open tabs in sync.
  window.addEventListener("storage", (e) => {
    if (e.key === KEY) {
      data = readLocalData();
      subs.forEach((cb) => cb({ ...data }));
    }
  });

  return {
    kind: "local",
    subscribe(cb) {
      subs.add(cb);
      cb({ ...data });
      return () => subs.delete(cb);
    },
    async putList(l: List) {
      upsert(data.lists, l);
      emit();
    },
    async putTask(t: Task) {
      upsert(data.tasks, t);
      emit();
    },
    async removeList(id) {
      data.lists = data.lists.filter((l) => l.id !== id);
      emit();
    },
    async removeTask(id) {
      data.tasks = data.tasks.filter((t) => t.id !== id);
      emit();
    },
    async putMeta(m) {
      data.meta = m;
      emit();
    },
    async loadSyncedSettings() {
      return null;
    },
    async saveSyncedSettings() {},
  };
}
