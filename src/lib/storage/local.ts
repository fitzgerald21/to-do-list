import type { List, Task } from "../../types";
import type { Backend, Snapshot } from "./backend";

const KEY = "braindump:data:v1";

function read(): Snapshot {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const d = JSON.parse(raw);
      return { lists: d.lists ?? [], tasks: d.tasks ?? [] };
    }
  } catch {
    /* ignore */
  }
  return { lists: [], tasks: [] };
}

/** Saves everything in this browser only. Used until Firebase is configured. */
export function createLocalBackend(): Backend {
  let data = read();
  const subs = new Set<(s: Snapshot) => void>();
  const emit = () => {
    try {
      localStorage.setItem(KEY, JSON.stringify(data));
    } catch {
      /* storage full / blocked */
    }
    const snap = { lists: [...data.lists], tasks: [...data.tasks] };
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
      data = read();
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
    async loadSyncedSettings() {
      return null;
    },
    async saveSyncedSettings() {},
  };
}
