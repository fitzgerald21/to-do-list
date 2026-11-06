import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { score, scoreColor, sortTasks } from "../lib/score";
import { childrenOf, listColor, placeColor, placeOptions } from "../lib/tree";
import { dropAttrs, registerPanner, startDrag } from "../state/dnd";
import { newList, newTask, saveList, saveTask, useData, useSettings } from "../state/store";
import { SPACES, STATUSES, type List, type Space, type Task } from "../types";
import type { ViewProps } from "./ListView";

interface MNode {
  key: string;
  label: string;
  kind: "root" | "space" | "list" | "task";
  task?: Task;
  color: string;
  children: MNode[];
  hidden: number; // collapsed descendants count
  x: number;
  y: number;
}

const COL_W = 230;
const ROW_H = 38;
const NODE_W = 196;
const NODE_H = 28;

const trunc = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + "…" : s);

/** Where the add panel will put things: "space:listId" like placeOptions, or a task to add sub-tasks under. */
type AddTarget = { place: string } | { taskId: string };

function AddPanel({
  target,
  setTarget,
  onAdded,
  onClose,
}: {
  target: AddTarget;
  setTarget: (t: AddTarget) => void;
  onAdded: (foldKey: string) => void;
  onClose: () => void;
}) {
  const { lists, tasks } = useData();
  const [text, setText] = useState("");
  const [added, setAdded] = useState("");
  const input = useRef<HTMLInputElement>(null);
  const parent = "taskId" in target ? tasks.find((t) => t.id === target.taskId) : null;

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => input.current?.focus(), [JSON.stringify(target)]);

  const add = (kind: "task" | "list") => {
    const title = text.trim();
    if (!title) return input.current?.focus();
    if (parent) {
      void saveTask(newTask({ title, space: parent.space, listId: parent.listId, parentId: parent.id }));
    } else if ("place" in target) {
      const [space, listId] = target.place.split(":") as [Space, string];
      if (kind === "task") void saveTask(newTask({ title, space, listId: listId || null }));
      else void saveList(newList({ name: title, space, parentId: listId || null }));
      onAdded(listId || space);
    }
    setText("");
    setAdded(`Added “${title}”`);
    input.current?.focus();
  };

  return (
    <form
      className="map-add-panel"
      onSubmit={(e) => {
        e.preventDefault();
        add("task");
      }}
      onKeyDown={(e) => e.key === "Escape" && onClose()}
    >
      <div className="map-add-row">
        <label className="map-add-where">
          Add to
          <select
            value={parent ? "task" : "place" in target ? target.place : ""}
            onChange={(e) => e.target.value !== "task" && setTarget({ place: e.target.value })}
          >
            {parent && <option value="task">Sub-task of “{trunc(parent.title, 30)}”</option>}
            {placeOptions(lists).map((pl) => (
              <option key={pl.value} value={pl.value}>
                {pl.label}
              </option>
            ))}
          </select>
        </label>
        <button type="button" className="x" onClick={onClose} aria-label="Close">
          ✕
        </button>
      </div>
      <input ref={input} value={text} onChange={(e) => setText(e.target.value)} placeholder="Name" aria-label="Name" />
      <div className="map-add-row">
        <span className="muted small grow">{added}</span>
        {!parent && (
          <button type="button" className="btn" onClick={() => add("list")}>
            Add list
          </button>
        )}
        <button type="submit" className="btn primary">
          {parent ? "Add sub-task" : "Add task"}
        </button>
      </div>
    </form>
  );
}

export function MindMapView({ scope, tasks, onOpen }: ViewProps) {
  const { lists } = useData();
  const { defaultSpace } = useSettings();
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [adding, setAdding] = useState<AddTarget | null>(null);
  const [view, setView] = useState({ x: 40, y: 40, k: 1 });
  const svgRef = useRef<SVGSVGElement>(null);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const lastPinch = useRef<number | null>(null);
  const moved = useRef(false);

  const tree = useMemo(() => {
    const visible = new Set(tasks.map((t) => t.id));
    const taskNode = (t: Task): MNode => ({
      key: t.id,
      label: t.title,
      kind: "task",
      task: t,
      color: placeColor(lists, t.listId, t.space),
      children: sortTasks(
        tasks.filter((k) => k.parentId === t.id),
        "manual",
      ).map(taskNode),
      hidden: 0,
      x: 0,
      y: 0,
    });
    const taskNodes = (space: Space, listId: string | null): MNode[] =>
      sortTasks(
        tasks.filter((t) => t.space === space && t.listId === listId && !(t.parentId && visible.has(t.parentId))),
        "manual",
      ).map(taskNode);

    const listNode = (l: List): MNode | null => {
      if (l.closed && !(scope.kind === "list" && scope.id === l.id)) return null;
      const kids = [
        ...taskNodes(l.space, l.id),
        ...childrenOf(lists, l.id, l.space)
          .map(listNode)
          .filter((x): x is MNode => !!x),
      ];
      return collapse({ key: l.id, label: l.name, kind: "list", color: listColor(lists, l.id), children: kids, hidden: 0, x: 0, y: 0 });
    };
    const spaceNode = (space: Space): MNode => {
      const sp = SPACES.find((s) => s.id === space)!;
      const kids = [
        ...taskNodes(space, null),
        ...childrenOf(lists, null, space)
          .map(listNode)
          .filter((x): x is MNode => !!x),
      ];
      return collapse({ key: space, label: `${sp.emoji} ${sp.name}`, kind: "space", color: sp.color, children: kids, hidden: 0, x: 0, y: 0 });
    };
    const countAll = (n: MNode): number => n.children.reduce((s, c) => s + 1 + countAll(c), 0) + n.hidden;
    function collapse(n: MNode): MNode {
      if (collapsed[n.key] && n.children.length) {
        n.hidden = countAll(n);
        n.children = [];
      }
      return n;
    }

    let root: MNode;
    if (scope.kind === "all")
      root = { key: "root", label: "✨ Everything", kind: "root", color: "var(--accent)", children: SPACES.map((s) => spaceNode(s.id)), hidden: 0, x: 0, y: 0 };
    else if (scope.kind === "space") root = spaceNode(scope.space);
    else {
      const l = lists.find((x) => x.id === scope.id);
      root = (l && listNode(l)) ?? { key: "none", label: "Empty", kind: "root", color: "var(--accent)", children: [], hidden: 0, x: 0, y: 0 };
    }

    // Tidy horizontal layout: leaves stacked, parents centred on children.
    let row = 0;
    const place = (n: MNode, depth: number) => {
      n.x = depth * COL_W;
      if (!n.children.length) {
        n.y = row++ * ROW_H;
        return;
      }
      n.children.forEach((c) => place(c, depth + 1));
      n.y = (n.children[0].y + n.children[n.children.length - 1].y) / 2;
    };
    place(root, 0);
    return root;
  }, [lists, tasks, scope, collapsed]);

  const nodes: MNode[] = [];
  const edges: [MNode, MNode][] = [];
  const walk = (n: MNode) => {
    nodes.push(n);
    n.children.forEach((c) => {
      edges.push([n, c]);
      walk(c);
    });
  };
  walk(tree);

  const fit = () => {
    const el = svgRef.current;
    if (!el) return;
    const w = el.clientWidth;
    const h = el.clientHeight;
    const maxX = Math.max(...nodes.map((n) => n.x)) + NODE_W;
    const maxY = Math.max(...nodes.map((n) => n.y)) + NODE_H;
    const k = Math.min(1.2, Math.max(0.25, Math.min((w - 40) / maxX, (h - 40) / maxY)));
    setView({ k, x: 20, y: Math.max(20, (h - maxY * k) / 2) });
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(fit, [scope]);

  const zoomAt = (factor: number, cx: number, cy: number) =>
    setView((v) => {
      const k = Math.min(3, Math.max(0.2, v.k * factor));
      const f = k / v.k;
      return { k, x: cx - (cx - v.x) * f, y: cy - (cy - v.y) * f };
    });

  useEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = el.getBoundingClientRect();
      zoomAt(e.deltaY < 0 ? 1.1 : 1 / 1.1, e.clientX - r.left, e.clientY - r.top);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    registerPanner(el, (dx, dy) => setView((v) => ({ ...v, x: v.x + dx, y: v.y + dy })));
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  const onPointerDown = (e: React.PointerEvent) => {
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    moved.current = false;
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const prev = pointers.current.get(e.pointerId);
    if (!prev) return;
    const cur = { x: e.clientX, y: e.clientY };
    if (Math.abs(cur.x - prev.x) + Math.abs(cur.y - prev.y) > 2) moved.current = true;
    if (pointers.current.size === 1) {
      if (moved.current) (e.target as Element).setPointerCapture?.(e.pointerId);
      setView((v) => ({ ...v, x: v.x + cur.x - prev.x, y: v.y + cur.y - prev.y }));
    } else if (pointers.current.size === 2) {
      pointers.current.set(e.pointerId, cur);
      const [a, b] = [...pointers.current.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      if (lastPinch.current) {
        const r = svgRef.current!.getBoundingClientRect();
        zoomAt(d / lastPinch.current, (a.x + b.x) / 2 - r.left, (a.y + b.y) / 2 - r.top);
      }
      lastPinch.current = d;
      return;
    }
    pointers.current.set(e.pointerId, cur);
  };
  const onPointerUp = (e: React.PointerEvent) => {
    pointers.current.delete(e.pointerId);
    if (pointers.current.size < 2) lastPinch.current = null;
  };

  const click = (n: MNode) => {
    if (moved.current) return;
    if (n.kind === "task") onOpen(n.key);
    else if (n.kind !== "root") setCollapsed((c) => ({ ...c, [n.key]: !c[n.key] }));
  };

  return (
    <div className="view mindmap">
      <div className="map-controls">
        <button className="icon-btn" onClick={() => zoomAt(1.2, 200, 200)}>
          ＋
        </button>
        <button className="icon-btn" onClick={() => zoomAt(1 / 1.2, 200, 200)}>
          －
        </button>
        <button className="icon-btn" onClick={fit}>
          ⤢
        </button>
        <button
          className="btn map-add-btn"
          aria-expanded={!!adding}
          onClick={() =>
            setAdding(
              adding
                ? null
                : { place: scope.kind === "list" ? `${lists.find((l) => l.id === scope.id)?.space ?? defaultSpace}:${scope.id}` : `${scope.kind === "space" ? scope.space : defaultSpace}:` },
            )
          }
        >
          ＋ Add
        </button>
        <span className="muted small">Tap a list to fold it · tap a task to open · ＋ adds under it · drag to move (on a phone, press and hold first)</span>
      </div>
      {adding && (
        <AddPanel
          target={adding}
          setTarget={setAdding}
          onClose={() => setAdding(null)}
          onAdded={(key) => setCollapsed((c) => ({ ...c, [key]: false }))}
        />
      )}
      <svg
        ref={svgRef}
        className="map-svg"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        <g transform={`translate(${view.x},${view.y}) scale(${view.k})`}>
          {edges.map(([a, b]) => {
            const x1 = a.x + NODE_W;
            const y1 = a.y + NODE_H / 2;
            const x2 = b.x;
            const y2 = b.y + NODE_H / 2;
            const mx = (x1 + x2) / 2;
            return <path key={a.key + b.key} className="map-edge" style={{ stroke: b.color }} d={`M${x1},${y1} C${mx},${y1} ${mx},${y2} ${x2},${y2}`} />;
          })}
          {nodes.map((n) => {
            const t = n.task;
            const st = t ? STATUSES.find((s) => s.id === t.status)! : null;
            const s = t ? score(t) : null;
            return (
              <g
                key={n.key}
                transform={`translate(${n.x},${n.y})`}
                className={`map-node ${n.kind} ${t?.status === "done" ? "done" : ""}`}
                style={{ "--c": n.color } as CSSProperties}
                onClick={() => click(n)}
                {...(n.kind !== "root" ? dropAttrs(n.kind, n.key) : {})}
                onPointerDown={(e) => {
                  if (n.kind !== "task" && n.kind !== "list") return;
                  // A mouse on a node drags it. A finger may still be panning or pinching until a long press.
                  if (e.pointerType === "mouse") {
                    e.stopPropagation();
                    moved.current = false;
                  }
                  startDrag(e, { kind: n.kind, id: n.key, label: n.label, color: n.color }, {
                    onActivate: () => {
                      pointers.current.clear();
                      lastPinch.current = null;
                    },
                  });
                }}
              >
                <line className="drop-line before" x1={0} x2={NODE_W} y1={-4} y2={-4} />
                <line className="drop-line after" x1={0} x2={NODE_W} y1={NODE_H + 4} y2={NODE_H + 4} />
                <rect width={NODE_W} height={NODE_H} rx={n.kind === "task" ? 6 : 14} />
                {st && <circle cx={12} cy={NODE_H / 2} r={5} fill={st.color} />}
                <text x={t ? 24 : 12} y={NODE_H / 2 + 4.5}>
                  {trunc(n.label, t ? 22 : 24)}
                  {n.hidden ? ` (+${n.hidden})` : ""}
                </text>
                {t && s !== null && (
                  <text x={NODE_W - 14} y={NODE_H / 2 + 4.5} textAnchor="end" className="map-score" fill={scoreColor(s)}>
                    {s}
                  </text>
                )}
                {n.kind !== "root" && (
                  <g
                    className="map-add"
                    role="button"
                    aria-label={`Add under ${n.label}`}
                    transform={`translate(${NODE_W},${NODE_H / 2})`}
                    onPointerDown={(e) => e.stopPropagation()}
                    onClick={(e) => {
                      e.stopPropagation();
                      const home = n.kind === "list" ? `${lists.find((l) => l.id === n.key)?.space}:${n.key}` : `${n.key}:`;
                      setAdding(n.kind === "task" ? { taskId: n.key } : { place: home });
                    }}
                  >
                    <circle className="map-add-hit" r={16} />
                    <circle className="map-add-dot" r={9} />
                    <text textAnchor="middle" y={4.5}>
                      +
                    </text>
                  </g>
                )}
              </g>
            );
          })}
        </g>
      </svg>
    </div>
  );
}
