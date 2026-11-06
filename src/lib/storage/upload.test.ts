import { beforeEach, describe, expect, it, vi } from "vitest";
import { EMPTY_META, type List, type Meta, type Task } from "../../types";

const server = vi.hoisted(() => ({
  lists: [] as { id: string }[],
  tasks: [] as { id: string }[],
  meta: null as unknown,
  readError: null as Error | null,
  commitError: null as Error | null,
  committed: [] as { path: string; data: unknown }[][],
}));

vi.mock("firebase/app", () => ({ initializeApp: () => ({}) }));
vi.mock("firebase/auth", () => ({ getAuth: () => ({}) }));
vi.mock("./config", () => ({ firebaseConfig: {}, firebaseEnabled: true }));
vi.mock("firebase/firestore", () => ({
  initializeFirestore: () => ({}),
  persistentLocalCache: () => ({}),
  persistentMultipleTabManager: () => ({}),
  collection: (_: unknown, ...p: string[]) => ({ path: p.join("/") }),
  doc: (parent: { path?: string }, ...p: string[]) => ({ path: [parent.path, ...p].filter(Boolean).join("/") }),
  getDocsFromServer: async (col: { path: string }) => {
    if (server.readError) throw server.readError;
    return { docs: col.path.endsWith("lists") ? server.lists : server.tasks };
  },
  getDocFromServer: async () => {
    if (server.readError) throw server.readError;
    return { exists: () => server.meta !== null, data: () => server.meta };
  },
  writeBatch: () => {
    const writes: { path: string; data: unknown }[] = [];
    return {
      set: (ref: { path: string }, data: unknown) => writes.push({ path: ref.path, data }),
      commit: async () => {
        if (server.commitError) throw server.commitError;
        server.committed.push(writes);
      },
    };
  },
}));

import { uploadLocalData } from "./firebase";
import { planUpload } from "./local";

const DATA_KEY = "braindump:data:v1";
const FLAG = "braindump:uploaded:me";
const list = (id: string) => ({ id, name: id }) as unknown as List;
const task = (id: string) => ({ id, title: id }) as unknown as Task;
const store = new Map<string, string>();
const saveLocal = (lists: List[], tasks: Task[], meta: Meta = EMPTY_META) => store.set(DATA_KEY, JSON.stringify({ lists, tasks, meta }));
const uploaded = () => server.committed.flat().map((w) => w.path);

beforeEach(() => {
  store.clear();
  Object.assign(server, { lists: [], tasks: [], meta: null, readError: null, commitError: null, committed: [] });
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => store.set(k, v),
    removeItem: (k: string) => store.delete(k),
  });
});

describe("uploading this browser's data on first sign-in", () => {
  it("uploads everything, marks it done and keeps the browser copy", async () => {
    saveLocal([list("l1")], [task("t1"), task("t2")], { context: { all: "About me" }, updatedAt: 1 });
    const before = store.get(DATA_KEY);
    expect(await uploadLocalData("me")).toEqual({ lists: 1, tasks: 2 });
    expect(uploaded()).toEqual(["users/me/lists/l1", "users/me/tasks/t1", "users/me/tasks/t2", "users/me/private/meta"]);
    expect(store.get(FLAG)).toBeTruthy();
    expect(store.get(DATA_KEY)).toBe(before);
  });

  it("runs only once per account on a device", async () => {
    saveLocal([], [task("t1")]);
    await uploadLocalData("me");
    server.committed = [];
    expect(await uploadLocalData("me")).toBeNull();
    expect(server.committed).toEqual([]);
  });

  it("never overwrites what the account already has", async () => {
    saveLocal([list("l1")], [task("old"), task("new")]);
    server.lists = [{ id: "l1" }];
    server.tasks = [{ id: "old" }];
    expect(await uploadLocalData("me")).toEqual({ lists: 0, tasks: 1 });
    expect(uploaded()).toEqual(["users/me/tasks/new"]);
  });

  it("writes nothing and tries again later when access is denied", async () => {
    saveLocal([], [task("t1")]);
    server.readError = new Error("permission-denied");
    await expect(uploadLocalData("me")).rejects.toThrow("permission-denied");
    expect(server.committed).toEqual([]);
    expect(store.get(FLAG)).toBeUndefined();
    expect(store.get(DATA_KEY)).toBeTruthy();
  });

  it("isn't marked done when the server rejects a write, and finishes on the retry", async () => {
    saveLocal([], [task("t1")]);
    server.commitError = new Error("unavailable");
    await expect(uploadLocalData("me")).rejects.toThrow("unavailable");
    expect(store.get(FLAG)).toBeUndefined();
    server.commitError = null;
    expect(await uploadLocalData("me")).toEqual({ lists: 0, tasks: 1 });
    expect(store.get(FLAG)).toBeTruthy();
  });

  it("uploads large browsers in several batches", async () => {
    saveLocal([], Array.from({ length: 450 }, (_, i) => task(`t${i}`)));
    expect(await uploadLocalData("me")).toEqual({ lists: 0, tasks: 450 });
    expect(server.committed.map((b) => b.length)).toEqual([200, 200, 50]);
  });

  it("does nothing when the browser has no data", async () => {
    expect(await uploadLocalData("me")).toBeNull();
    expect(server.committed).toEqual([]);
  });
});

describe("planUpload", () => {
  it("adds only the background notes the account is missing", () => {
    const { meta } = planUpload(
      { lists: [], tasks: [], meta: { context: { all: "browser", work: "browser" }, updatedAt: 1 } },
      { listIds: new Set(), taskIds: new Set(), meta: { context: { all: "account" }, updatedAt: 2 } },
    );
    expect(meta?.context).toEqual({ all: "account", work: "browser" });
  });

  it("leaves the notes alone when nothing is missing", () => {
    const { meta } = planUpload(
      { lists: [], tasks: [], meta: { context: { all: "browser" }, updatedAt: 1 } },
      { listIds: new Set(), taskIds: new Set(), meta: { context: { all: "account" }, updatedAt: 2 } },
    );
    expect(meta).toBeNull();
  });
});
