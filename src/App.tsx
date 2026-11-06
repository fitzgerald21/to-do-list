import { useEffect, useMemo, useState } from "react";
import type { User } from "firebase/auth";
import { AuthScreen } from "./components/AuthScreen";
import { BoardView } from "./components/BoardView";
import { CaptureBar } from "./components/CaptureBar";
import { ListView } from "./components/ListView";
import { MatrixView } from "./components/MatrixView";
import { MindMapView } from "./components/MindMapView";
import { SettingsView } from "./components/SettingsView";
import { Sidebar } from "./components/Sidebar";
import { TaskDetail } from "./components/TaskDetail";
import { Toasts } from "./components/Toasts";
import { FocusView } from "./components/FocusView";
import { ContextPanel } from "./components/ContextPanel";
import { fb, firebaseEnabled } from "./lib/storage/config";
import { createLocalBackend } from "./lib/storage/local";
import { descendantIds, isEffectivelyClosed, listPath } from "./lib/tree";
import { connect, disconnect, useData } from "./state/store";
import { toast } from "./state/ui";
import { SPACES, type Place, type Task } from "./types";

export type Scope = Place;
export type ViewId = "list" | "focus" | "board" | "matrix" | "map" | "settings";

const VIEWS: { id: Exclude<ViewId, "settings">; label: string; icon: string }[] = [
  { id: "list", label: "Lists", icon: "☰" },
  { id: "focus", label: "Focus", icon: "🎯" },
  { id: "board", label: "Board", icon: "▦" },
  { id: "matrix", label: "Matrix", icon: "⊞" },
  { id: "map", label: "Mind map", icon: "✺" },
];

function loadPref<T>(key: string, fallback: T): T {
  try {
    const v = localStorage.getItem(`braindump:ui:${key}`);
    return v ? (JSON.parse(v) as T) : fallback;
  } catch {
    return fallback;
  }
}
function savePref(key: string, v: unknown) {
  try {
    localStorage.setItem(`braindump:ui:${key}`, JSON.stringify(v));
  } catch {
    /* ignore */
  }
}

export default function App() {
  const [user, setUser] = useState<User | null | undefined>(firebaseEnabled ? undefined : null);
  const [denied, setDenied] = useState(false);

  useEffect(() => {
    if (!firebaseEnabled) {
      connect(createLocalBackend());
      return;
    }
    let unsub: (() => void) | undefined;
    let cancelled = false;
    void fb().then((m) => {
      if (cancelled) return;
      unsub = m.watchUser((u) => {
        setUser(u);
        setDenied(false);
        if (u) {
          connect(m.createFirebaseBackend(u.uid), () => setDenied(true));
          m.uploadLocalData(u.uid)
            .then((moved) => moved && toast(`Moved ${moved.tasks} tasks and ${moved.lists} lists from this browser to your account.`))
            .catch((e) => console.warn("Will retry uploading this browser's data next launch", e));
        }
        else disconnect();
      });
    });
    return () => {
      cancelled = true;
      unsub?.();
    };
  }, []);

  if (firebaseEnabled && user === undefined) return <div className="splash">Loading…</div>;
  if (firebaseEnabled && !user) return <AuthScreen />;
  if (denied) return <AuthScreen deniedEmail={user?.email ?? "This account"} />;
  return <Main user={user ?? null} />;
}

function Main({ user }: { user: User | null }) {
  const data = useData();
  const [scope, setScopeState] = useState<Scope>(() => loadPref("scope", { kind: "all" }));
  const [view, setViewState] = useState<ViewId>(() => loadPref("view", "list"));
  const [openTaskId, setOpenTaskId] = useState<string | null>(null);
  const [drawer, setDrawer] = useState(false);
  const [showDone, setShowDoneState] = useState<boolean>(() => loadPref("showDone", false));
  const [search, setSearch] = useState("");
  const [tagFilter, setTagFilter] = useState<string | null>(null);
  const [about, setAbout] = useState<Place | null>(null);

  const setScope = (s: Scope) => {
    setScopeState(s);
    savePref("scope", s);
    setDrawer(false);
    if (view === "settings") setView("list");
  };
  const setView = (v: ViewId) => {
    setViewState(v);
    savePref("view", v);
  };
  const setShowDone = (v: boolean) => {
    setShowDoneState(v);
    savePref("showDone", v);
  };

  // If the selected list was deleted, fall back to everything.
  useEffect(() => {
    if (data.ready && scope.kind === "list" && !data.lists.some((l) => l.id === scope.id)) setScopeState({ kind: "all" });
  }, [data.ready, data.lists, scope]);

  const scopedTasks = useMemo(() => {
    let ts: Task[] = data.tasks;
    if (scope.kind === "space") ts = ts.filter((t) => t.space === scope.space);
    if (scope.kind === "list") {
      const ids = descendantIds(data.lists, scope.id);
      ts = ts.filter((t) => t.listId && ids.has(t.listId));
    } else {
      // Hide tasks in closed lists unless you're looking inside that list.
      ts = ts.filter((t) => !isEffectivelyClosed(data.lists, t.listId));
    }
    if (!showDone) ts = ts.filter((t) => t.status !== "done");
    if (tagFilter) ts = ts.filter((t) => t.tags.includes(tagFilter));
    if (search.trim()) {
      const q = search.toLowerCase();
      ts = ts.filter(
        (t) =>
          t.title.toLowerCase().includes(q) ||
          t.notes.toLowerCase().includes(q) ||
          t.waitingOn.toLowerCase().includes(q) ||
          t.tags.some((x) => x.includes(q)) ||
          t.updates.some((u) => u.text.toLowerCase().includes(q)),
      );
    }
    return ts;
  }, [data.tasks, data.lists, scope, showDone, tagFilter, search]);

  const title =
    scope.kind === "all"
      ? "Everything"
      : scope.kind === "space"
        ? SPACES.find((s) => s.id === scope.space)!.name
        : listPath(data.lists, scope.id, data.lists.find((l) => l.id === scope.id)?.space ?? "work").join(" › ");

  const openTask = data.tasks.find((t) => t.id === openTaskId) ?? null;
  const ctx = { scope, tasks: scopedTasks, onOpen: setOpenTaskId, showDone };

  return (
    <div className={`app ${drawer ? "drawer-open" : ""}`}>
      <Sidebar
        scope={scope}
        setScope={setScope}
        onSettings={() => {
          setView("settings");
          setDrawer(false);
        }}
        settingsActive={view === "settings"}
        onAbout={(p) => {
          setAbout(p);
          setDrawer(false);
        }}
      />
      <div className="scrim" onClick={() => setDrawer(false)} />
      <main className="main">
        <header className="topbar">
          <button className="icon-btn menu-btn" onClick={() => setDrawer(true)} aria-label="Menu">
            ☰
          </button>
          <h1 className="title" title={title}>
            {view === "settings" ? "Settings" : title}
          </h1>
          {view !== "settings" && (
            <input
              className="search"
              placeholder="Search…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          )}
        </header>
        {view !== "settings" && (
          <nav className="viewbar">
            <div className="tabs">
              {VIEWS.map((v) => (
                <button key={v.id} className={`tab ${view === v.id ? "active" : ""}`} onClick={() => setView(v.id)}>
                  <span className="tab-icon">{v.icon}</span>
                  <span className="tab-label">{v.label}</span>
                </button>
              ))}
            </div>
            <div className="view-opts">
              {tagFilter && (
                <button className="chip tag active" onClick={() => setTagFilter(null)}>
                  #{tagFilter} ✕
                </button>
              )}
              <label className="toggle">
                <input type="checkbox" checked={showDone} onChange={(e) => setShowDone(e.target.checked)} /> Show done
              </label>
            </div>
          </nav>
        )}
        <section className="content">
          {!data.ready ? (
            <div className="empty">Loading your lists…</div>
          ) : view === "settings" ? (
            <SettingsView user={user} />
          ) : view === "list" ? (
            <ListView {...ctx} onTag={setTagFilter} onAbout={setAbout} />
          ) : view === "focus" ? (
            <FocusView {...ctx} onTag={setTagFilter} />
          ) : view === "board" ? (
            <BoardView {...ctx} />
          ) : view === "matrix" ? (
            <MatrixView {...ctx} />
          ) : (
            <MindMapView {...ctx} />
          )}
        </section>
        <CaptureBar scope={scope} onOpenTask={setOpenTaskId} />
      </main>
      {openTask && <TaskDetail key={openTask.id} task={openTask} onOpen={setOpenTaskId} onClose={() => setOpenTaskId(null)} onTag={(t) => { setTagFilter(t); setOpenTaskId(null); }} />}
      {about && <ContextPanel key={JSON.stringify(about)} place={about} onClose={() => setAbout(null)} />}
      <Toasts />
    </div>
  );
}
