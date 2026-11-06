import type { List, Meta, Settings, Task } from "../../types";

export interface Snapshot {
  lists: List[];
  tasks: Task[];
  meta: Meta;
}

export interface Backend {
  kind: "local" | "firebase";
  subscribe(cb: (s: Snapshot) => void): () => void;
  putList(l: List): Promise<void>;
  putTask(t: Task): Promise<void>;
  removeList(id: string): Promise<void>;
  removeTask(id: string): Promise<void>;
  putMeta(m: Meta): Promise<void>;
  loadSyncedSettings(): Promise<Partial<Settings> | null>;
  saveSyncedSettings(s: Partial<Settings> | null): Promise<void>;
}
