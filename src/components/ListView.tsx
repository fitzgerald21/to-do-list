import { useEffect, useState, type CSSProperties } from "react";
import type { Scope } from "../App";
import { SORTS, sortTasks, type SortKey } from "../lib/score";
import { childrenOf, listColor } from "../lib/tree";
import { dropAttrs, onTaskPlaced, startDrag } from "../state/dnd";
import { newTask, patchList, saveTask, useData } from "../state/store";
import { SPACES, type List, type Place, type Space, type Task } from "../types";
import { ListColorDot } from "./ColorPicker";
import { AboutCard } from "./ContextPanel";
import { promptNewList } from "./Sidebar";
import { DragHandle, TaskRow } from "./TaskRow";

export interface ViewProps {
  scope: Scope;
  tasks: Task[];
  onOpen: (id: string) => void;
  showDone: boolean;
}

export function useSort(key: string, fallback: SortKey) {
  const [sort, setSortState] = useState<SortKey>(() => {
    try {
      return (localStorage.getItem(`braindump:ui:sort:${key}`) as SortKey) || fallback;
    } catch {
      return fallback;
    }
  });
  const setSort = (s: SortKey) => {
    setSortState(s);
    try {
      localStorage.setItem(`braindump:ui:sort:${key}`, s);
    } catch {
      /* ignore */
    }
  };
  return [sort, setSort] as const;
}

export function SortSelect({ value, onChange }: { value: SortKey; onChange: (s: SortKey) => void }) {
  return (
    <label className="sort">
      Sort
      <select value={value} onChange={(e) => onChange(e.target.value as SortKey)}>
        {SORTS.map((s) => (
          <option key={s.id} value={s.id}>
            {s.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function QuickAdd({ space, listId }: { space: Space; listId: string | null }) {
  const [v, setV] = useState("");
  return (
    <form
      className="quick-add"
      {...(listId ? dropAttrs("list", listId, true) : dropAttrs("space", space))}
      onSubmit={(e) => {
        e.preventDefault();
        if (!v.trim()) return;
        void saveTask(newTask({ title: v.trim(), space, listId }));
        setV("");
      }}
    >
      <span className="plus">＋</span>
      <input value={v} onChange={(e) => setV(e.target.value)} placeholder="Add a task here" />
    </form>
  );
}

export function ListView({
  scope,
  tasks,
  onOpen,
  onTag,
  onAbout,
}: ViewProps & { onTag: (t: string) => void; onAbout: (p: Place) => void }) {
  const { lists } = useData();
  const [sort, setSort] = useSort("list", "manual");
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  // Dropping a task in a specific spot only makes sense if the view then keeps it there.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => onTaskPlaced(() => setSort("manual")), []);

  // A sub-task sits under its parent, unless the parent is hidden (done, or filtered out by a search).
  const visible = new Set(tasks.map((t) => t.id));
  const tasksIn = (space: Space, listId: string | null) =>
    sortTasks(
      tasks.filter((t) => t.space === space && t.listId === listId && !(t.parentId && visible.has(t.parentId))),
      sort,
    );
  const countUnder = (l: List): number =>
    tasks.filter((t) => t.listId === l.id).length + childrenOf(lists, l.id, l.space).reduce((n, c) => n + countUnder(c), 0);

  const renderTask = (t: Task, nested = false): React.ReactNode => {
    const kids = sortTasks(
      tasks.filter((k) => k.parentId === t.id),
      sort,
    );
    return (
      <div key={t.id}>
        <TaskRow
          task={t}
          onOpen={onOpen}
          onTag={onTag}
          nested={nested}
          droppable
          folded={collapsed[t.id]}
          onFold={kids.length ? () => setCollapsed({ ...collapsed, [t.id]: !collapsed[t.id] }) : undefined}
        />
        {kids.length > 0 && !collapsed[t.id] && <div className="subtasks">{kids.map((k) => renderTask(k, true))}</div>}
      </div>
    );
  };

  const insideClosed = scope.kind === "list";
  const renderList = (l: List, depth: number): React.ReactNode => {
    if (l.closed && !insideClosed) return null;
    const kids = childrenOf(lists, l.id, l.space);
    const own = tasksIn(l.space, l.id);
    const isCollapsed = collapsed[l.id];
    const color = listColor(lists, l.id);
    return (
      <section key={l.id} className="group" style={{ marginLeft: depth ? 12 : 0, "--c": color } as CSSProperties}>
        <header
          className="group-head"
          {...dropAttrs("list", l.id)}
          onPointerDown={(e) => startDrag(e, { kind: "list", id: l.id, label: l.name, color })}
        >
          <DragHandle />
          <button className="caret" onClick={() => setCollapsed({ ...collapsed, [l.id]: !isCollapsed })}>
            {isCollapsed ? "▸" : "▾"}
          </button>
          <ListColorDot list={l} />
          <h3>
            {l.closed && "🔒 "}
            {l.name}
          </h3>
          {l.context?.trim() && (
            <button className="about-dot" title="Background (what the AI knows about this)" onClick={() => onAbout({ kind: "list", id: l.id })}>
              📄
            </button>
          )}
          <span className="count">{countUnder(l)}</span>
          <div className="group-actions">
            <button className="link small" onClick={() => onAbout({ kind: "list", id: l.id })}>
              about
            </button>
            <button className="link small" onClick={() => void promptNewList(l.space, l.id)}>
              ＋ sub-list
            </button>
            <button className="link small" onClick={() => void patchList(l.id, { closed: !l.closed })}>
              {l.closed ? "reopen" : "close"}
            </button>
          </div>
        </header>
        {!isCollapsed && (
          <div className="group-body">
            {own.map((t) => renderTask(t))}
            <QuickAdd space={l.space} listId={l.id} />
            {kids.map((k) => renderList(k, depth + 1))}
          </div>
        )}
      </section>
    );
  };

  const renderSpace = (space: Space, showHeader: boolean) => {
    const sp = SPACES.find((s) => s.id === space)!;
    const loose = tasksIn(space, null);
    const roots = childrenOf(lists, null, space);
    return (
      <div key={space} className="space-section">
        {showHeader && (
          <h2 className="space-head" style={{ color: sp.color }} {...dropAttrs("space", space)}>
            {sp.emoji} {sp.name}
          </h2>
        )}
        {loose.map((t) => renderTask(t))}
        <QuickAdd space={space} listId={null} />
        {roots.map((l) => renderList(l, 0))}
        <button className="link small add-list" onClick={() => void promptNewList(space, null)}>
          ＋ New list in {sp.name}
        </button>
      </div>
    );
  };

  const noData = lists.length === 0 && tasks.length === 0;

  return (
    <div className="view list-view">
      <div className="view-toolbar">
        <SortSelect value={sort} onChange={setSort} />
      </div>
      {noData && scope.kind !== "list" && <Welcome />}
      <AboutCard place={scope} onOpen={onAbout} />
      {scope.kind === "all" && SPACES.map((s) => renderSpace(s.id, true))}
      {scope.kind === "space" && renderSpace(scope.space, false)}
      {scope.kind === "list" &&
        (() => {
          const l = lists.find((x) => x.id === scope.id);
          return l ? renderList(l, 0) : null;
        })()}
    </div>
  );
}

function Welcome() {
  return (
    <div className="welcome">
      <h2>👋 Just say it.</h2>
      <p>
        Tap the 🎙 at the bottom and talk, or type. Try things like:
      </p>
      <ul>
        <li>“Make spreadsheet for Kathy under Transformation, high priority, tag it reporting.”</li>
        <li>“Buy dog food and book a dentist appointment for next Tuesday.”</li>
        <li>“For the vendor contract, I'm waiting on Jordan for the redlines. Michael said he'd send pricing Thursday.”</li>
      </ul>
      <p className="muted">
        Work and Personal are your two main branches. Lists and sub-lists get created automatically when you mention them,
        or add them with ＋ in the sidebar.
      </p>
    </div>
  );
}
