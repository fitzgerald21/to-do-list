import { useEffect, useMemo, useRef, useState } from "react";
import { score, scoreColor, sortTasks } from "../lib/score";
import { childrenOf } from "../lib/tree";
import { useData } from "../state/store";
import { SPACES, STATUSES, type List, type Space, type Task } from "../types";
import type { ViewProps } from "./ListView";

interface MNode {
  key: string;
  label: string;
  kind: "root" | "space" | "list" | "task";
  task?: Task;
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

export function MindMapView({ scope, tasks, onOpen }: ViewProps) {
  const { lists } = useData();
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [view, setView] = useState({ x: 40, y: 40, k: 1 });
  const svgRef = useRef<SVGSVGElement>(null);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const lastPinch = useRef<number | null>(null);
  const moved = useRef(false);

  const tree = useMemo(() => {
    const taskNodes = (space: Space, listId: string | null): MNode[] =>
      sortTasks(
        tasks.filter((t) => t.space === space && t.listId === listId),
        "score",
      ).map((t) => ({ key: t.id, label: t.title, kind: "task", task: t, children: [], hidden: 0, x: 0, y: 0 }));

    const listNode = (l: List): MNode | null => {
      if (l.closed && !(scope.kind === "list" && scope.id === l.id)) return null;
      const kids = [
        ...taskNodes(l.space, l.id),
        ...childrenOf(lists, l.id, l.space)
          .map(listNode)
          .filter((x): x is MNode => !!x),
      ];
      return collapse({ key: l.id, label: l.name, kind: "list", children: kids, hidden: 0, x: 0, y: 0 });
    };
    const spaceNode = (space: Space): MNode => {
      const sp = SPACES.find((s) => s.id === space)!;
      const kids = [
        ...taskNodes(space, null),
        ...childrenOf(lists, null, space)
          .map(listNode)
          .filter((x): x is MNode => !!x),
      ];
      return collapse({ key: space, label: `${sp.emoji} ${sp.name}`, kind: "space", children: kids, hidden: 0, x: 0, y: 0 });
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
      root = { key: "root", label: "✨ Everything", kind: "root", children: SPACES.map((s) => spaceNode(s.id)), hidden: 0, x: 0, y: 0 };
    else if (scope.kind === "space") root = spaceNode(scope.space);
    else {
      const l = lists.find((x) => x.id === scope.id);
      root = (l && listNode(l)) ?? { key: "none", label: "Empty", kind: "root", children: [], hidden: 0, x: 0, y: 0 };
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
        <span className="muted small">Tap a list to fold it · tap a task to open</span>
      </div>
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
            return <path key={a.key + b.key} className="map-edge" d={`M${x1},${y1} C${mx},${y1} ${mx},${y2} ${x2},${y2}`} />;
          })}
          {nodes.map((n) => {
            const t = n.task;
            const st = t ? STATUSES.find((s) => s.id === t.status)! : null;
            const s = t ? score(t) : 0;
            return (
              <g key={n.key} transform={`translate(${n.x},${n.y})`} className={`map-node ${n.kind} ${t?.status === "done" ? "done" : ""}`} onClick={() => click(n)}>
                <rect width={NODE_W} height={NODE_H} rx={n.kind === "task" ? 6 : 14} />
                {st && <circle cx={12} cy={NODE_H / 2} r={5} fill={st.color} />}
                <text x={t ? 24 : 12} y={NODE_H / 2 + 4.5}>
                  {trunc(n.label, t ? 22 : 24)}
                  {n.hidden ? ` (+${n.hidden})` : ""}
                </text>
                {t && (
                  <text x={NODE_W - 8} y={NODE_H / 2 + 4.5} textAnchor="end" className="map-score" fill={scoreColor(s)}>
                    {s}
                  </text>
                )}
              </g>
            );
          })}
        </g>
      </svg>
    </div>
  );
}
