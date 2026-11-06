import type { List, Settings, Task } from "../../types";

export interface Snapshot {
  lists: List[];
  tasks: Task[];
}

export interface Backend {
  kind: "local" | "firebase";
  subscribe(cb: (s: Snapshot) => void): () => void;
  putList(l: List): Promise<void>;
  putTask(t: Task): Promise<void>;
  removeList(id: string): Promise<void>;
  removeTask(id: string): Promise<void>;
  loadSyncedSettings(): Promise<Partial<Settings> | null>;
  saveSyncedSettings(s: Partial<Settings> | null): Promise<void>;
}
