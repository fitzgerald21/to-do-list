import { useState } from "react";
import type { Scope } from "../App";
import { childrenOf, descendantIds } from "../lib/tree";
import { deleteListDeep, newList, patchList, saveList, useData } from "../state/store";
import { toast } from "../state/ui";
import { SPACES, type List, type Place, type Space } from "../types";

function loadCollapsed(): Record<string, boolean> {
  try {
    return JSON.parse(localStorage.getItem("braindump:ui:collapsed") ?? "{}");
  } catch {
    return {};
  }
}

export async function promptNewList(space: Space, parentId: string | null) {
  const name = window.prompt(parentId ? "New sub-list name" : "New list name")?.trim();
  if (!name) return null;
  const l = newList({ name, space, parentId });
  await saveList(l);
  return l;
}

export function Sidebar({
  scope,
  setScope,
  onSettings,
  settingsActive,
  onAbout,
}: {
  scope: Scope;
  setScope: (s: Scope) => void;
  onSettings: () => void;
  settingsActive: boolean;
  onAbout: (p: Place) => void;
}) {
  const { lists, tasks } = useData();
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>(loadCollapsed);
  const [showClosed, setShowClosed] = useState(false);
  const [menu, setMenu] = useState<string | null>(null);

  const toggle = (id: string) => {
    const next = { ...collapsed, [id]: !collapsed[id] };
    setCollapsed(next);
    try {
      localStorage.setItem("braindump:ui:collapsed", JSON.stringify(next));
    } catch {
      /* ignore */
    }
  };

  const openCount = (ids: Set<string>) => tasks.filter((t) => t.status !== "done" && t.listId && ids.has(t.listId)).length;
  const isActive = (s: Scope) => !settingsActive && JSON.stringify(s) === JSON.stringify(scope);

  const renderList = (l: List, depth: number): React.ReactNode => {
    if (l.closed && !showClosed) return null;
    const kids = childrenOf(lists, l.id, l.space).filter((k) => showClosed || !k.closed);
    const count = openCount(descendantIds(lists, l.id));
    const sc: Scope = { kind: "list", id: l.id };
    return (
      <div key={l.id}>
        <div className={`tree-item ${isActive(sc) ? "active" : ""} ${l.closed ? "closed" : ""}`} style={{ paddingLeft: 8 + depth * 14 }}>
          <button className="caret" onClick={() => toggle(l.id)} style={{ visibility: kids.length ? "visible" : "hidden" }}>
            {collapsed[l.id] ? "▸" : "▾"}
          </button>
          <button className="tree-name" onClick={() => setScope(sc)}>
            {l.closed ? "🔒 " : ""}
            {l.name}
            {l.context?.trim() ? <span className="muted small" title="Has background"> 📄</span> : null}
          </button>
          {count > 0 && <span className="count">{count}</span>}
          <button className="dots" onClick={() => setMenu(menu === l.id ? null : l.id)} aria-label="List options">
            ⋯
          </button>
        </div>
        {menu === l.id && (
          <div className="tree-menu" style={{ marginLeft: 8 + depth * 14 }}>
            <button
              onClick={async () => {
                setMenu(null);
                const nl = await promptNewList(l.space, l.id);
                if (nl && collapsed[l.id]) toggle(l.id);
              }}
            >
              ＋ Sub-list
            </button>
            <button
              onClick={() => {
                setMenu(null);
                onAbout({ kind: "list", id: l.id });
              }}
            >
              📄 Background
            </button>
            <button
              onClick={() => {
                setMenu(null);
                const name = window.prompt("Rename list", l.name)?.trim();
                if (name) void patchList(l.id, { name });
              }}
            >
              Rename
            </button>
            <button
              onClick={() => {
                setMenu(null);
                void patchList(l.id, { closed: !l.closed });
                toast(l.closed ? `Reopened “${l.name}”` : `Closed “${l.name}” — find it under “Show closed lists”`);
              }}
            >
              {l.closed ? "Reopen" : "Close list"}
            </button>
            <button
              className="danger"
              onClick={() => {
                setMenu(null);
                const ids = descendantIds(lists, l.id);
                const n = tasks.filter((t) => t.listId && ids.has(t.listId)).length;
                if (window.confirm(`Delete “${l.name}”, its ${ids.size - 1} sub-list(s) and ${n} task(s)? This can't be undone.`)) {
                  void deleteListDeep(l.id);
                }
              }}
            >
              Delete
            </button>
          </div>
        )}
        {!collapsed[l.id] && kids.map((k) => renderList(k, depth + 1))}
      </div>
    );
  };

  return (
    <aside className="sidebar">
      <div className="brand">
        <img src={`${import.meta.env.BASE_URL}icon.svg`} alt="" width={28} height={28} />
        <span>Brain Dump</span>
      </div>
      <div className="tree">
        <div className={`tree-item top ${isActive({ kind: "all" }) ? "active" : ""}`}>
          <button className="tree-name" onClick={() => setScope({ kind: "all" })}>
            ✨ Everything
          </button>
          <span className="count">{tasks.filter((t) => t.status !== "done").length || ""}</span>
        </div>
        {SPACES.map((sp) => {
          const sc: Scope = { kind: "space", space: sp.id };
          const roots = childrenOf(lists, null, sp.id);
          return (
            <div key={sp.id} className="space-block">
              <div className={`tree-item top ${isActive(sc) ? "active" : ""}`}>
                <button className="caret" onClick={() => toggle(sp.id)}>
                  {collapsed[sp.id] ? "▸" : "▾"}
                </button>
                <button className="tree-name" onClick={() => setScope(sc)}>
                  {sp.emoji} {sp.name}
                </button>
                <span className="count">{tasks.filter((t) => t.space === sp.id && t.status !== "done").length || ""}</span>
                <button className="dots" title={`New list in ${sp.name}`} onClick={() => void promptNewList(sp.id, null)}>
                  ＋
                </button>
              </div>
              {!collapsed[sp.id] && roots.map((l) => renderList(l, 1))}
            </div>
          );
        })}
      </div>
      <div className="sidebar-foot">
        <label className="toggle small">
          <input type="checkbox" checked={showClosed} onChange={(e) => setShowClosed(e.target.checked)} /> Show closed lists
        </label>
        <button className={`tree-item settings ${settingsActive ? "active" : ""}`} onClick={onSettings}>
          ⚙️ Settings
        </button>
      </div>
    </aside>
  );
}
