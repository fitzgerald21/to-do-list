import { initializeApp, type FirebaseApp } from "firebase/app";
import {
  GoogleAuthProvider,
  getAuth,
  onAuthStateChanged,
  signInWithPopup,
  signInWithRedirect,
  signOut,
  type Auth,
  type User,
} from "firebase/auth";
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  initializeFirestore,
  onSnapshot,
  persistentLocalCache,
  persistentMultipleTabManager,
  setDoc,
  type Firestore,
} from "firebase/firestore";
import { EMPTY_META, type List, type Meta, type Task } from "../../types";
import type { Backend, Snapshot } from "./backend";

import { firebaseConfig, firebaseEnabled } from "./config";

let app: FirebaseApp | null = null;
let auth: Auth | null = null;
let db: Firestore | null = null;

function init() {
  if (!firebaseEnabled) throw new Error("Firebase is not configured");
  if (!app) {
    // Named, not the default app: Come back, Little Bites, One Line a Day and Recipe Book share this Firebase
    // project and this site's origin. The default name would share their browser sign-in and offline cache,
    // and this newer SDK would upgrade the cache past what theirs can read.
    app = initializeApp(firebaseConfig, "brain-dump");
    auth = getAuth(app);
    // Offline-first: works with no signal and syncs when back online.
    db = initializeFirestore(app, {
      ignoreUndefinedProperties: true,
      localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
    });
  }
  return { auth: auth!, db: db! };
}

export function watchUser(cb: (u: User | null) => void): () => void {
  return onAuthStateChanged(init().auth, cb);
}

export async function signInGoogle() {
  const { auth } = init();
  const provider = new GoogleAuthProvider();
  // Popup first, even in an installed (home-screen) app: Safari blocks the redirect flow when the app and
  // authDomain are on different sites, as they are here.
  try {
    await signInWithPopup(auth, provider);
  } catch (e) {
    const code = (e as { code?: string }).code ?? "";
    if (code === "auth/popup-closed-by-user" || code === "auth/cancelled-popup-request") return;
    if (code === "auth/popup-blocked" || code === "auth/operation-not-supported-in-this-environment") return signInWithRedirect(auth, provider);
    throw e;
  }
}

export function logOut() {
  return signOut(init().auth);
}

export function createFirebaseBackend(uidStr: string): Backend {
  const { db } = init();
  const listsCol = collection(db, "users", uidStr, "lists");
  const tasksCol = collection(db, "users", uidStr, "tasks");
  const settingsDoc = doc(db, "users", uidStr, "private", "settings");
  const metaDoc = doc(db, "users", uidStr, "private", "meta");

  return {
    kind: "firebase",
    subscribe(cb, onDenied) {
      const fail = (e: { code: string }) => {
        if (e.code === "permission-denied") onDenied?.();
      };
      let lists: List[] = [];
      let tasks: Task[] = [];
      let meta: Meta = EMPTY_META;
      let gotLists = false;
      let gotTasks = false;
      let gotMeta = false;
      const emit = () => gotLists && gotTasks && gotMeta && cb({ lists, tasks, meta } satisfies Snapshot);
      const u1 = onSnapshot(listsCol, (s) => {
        lists = s.docs.map((d) => d.data() as List);
        gotLists = true;
        emit();
      }, fail);
      const u2 = onSnapshot(tasksCol, (s) => {
        tasks = s.docs.map((d) => d.data() as Task);
        gotTasks = true;
        emit();
      }, fail);
      const u3 = onSnapshot(
        metaDoc,
        (s) => {
          meta = s.exists() ? { ...EMPTY_META, ...(s.data() as Meta) } : EMPTY_META;
          gotMeta = true;
          emit();
        },
        () => {
          gotMeta = true;
          emit();
        },
      );
      return () => {
        u1();
        u2();
        u3();
      };
    },
    // Writes resolve once queued locally, so the UI never waits on the network.
    async putList(l) {
      void setDoc(doc(listsCol, l.id), l);
    },
    async putTask(t) {
      void setDoc(doc(tasksCol, t.id), t);
    },
    async removeList(id) {
      void deleteDoc(doc(listsCol, id));
    },
    async removeTask(id) {
      void deleteDoc(doc(tasksCol, id));
    },
    async putMeta(m) {
      void setDoc(metaDoc, m);
    },
    async loadSyncedSettings() {
      try {
        const s = await getDoc(settingsDoc);
        return s.exists() ? (s.data() as never) : null;
      } catch {
        return null;
      }
    },
    async saveSyncedSettings(s) {
      if (s === null) void deleteDoc(settingsDoc);
      else void setDoc(settingsDoc, s, { merge: true });
    },
  };
}
