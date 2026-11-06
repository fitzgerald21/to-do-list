import type { PointerEvent as ReactPointerEvent } from "react";
import { canDrop, type DragItem, type DropPos, type DropTarget } from "../lib/move";
import { dropItem, getData } from "./store";

/**
 * Drag and drop for every view, built on pointer events because the browser's own drag and drop doesn't work
 * on phones or inside the mind map's SVG. Anything with `dropAttrs` is a target, HTML or SVG alike.
 *
 * A mouse drags as soon as it moves. A finger drags at once from a handle, or after a long press anywhere
 * else, so that ordinary swipes still scroll.
 */

const MOVE_PX = 5;
const HANDLE_MOVE_PX = 3;
const LONG_PRESS_MS = 350;
const LONG_PRESS_SLOP_PX = 10;
const EDGE_PX = 48;
const EDGE_MAX_SPEED = 10;
/** Picking something up near an edge shouldn't scroll until it's actually being carried somewhere. */
const EDGE_AFTER_PX = 20;

interface Session {
  item: DragItem;
  label: string;
  color?: string;
  source: Element;
  pointerId: number;
  startX: number;
  startY: number;
  x: number;
  y: number;
  /** Mouse or handle: moves this far to start. Null = waiting for a long press. */
  threshold: number | null;
  active: boolean;
  carried: boolean;
  timer?: number;
  frame?: number;
  ghost?: HTMLElement;
  hover?: { el: Element; target: DropTarget } | null;
  onActivate?: () => void;
}

let session: Session | null = null;
const reorderListeners = new Set<() => void>();
const panners = new WeakMap<Element, (dx: number, dy: number) => void>();

/** Called when a task is dropped at a specific position, so a view can start showing "My order". */
export function onTaskPlaced(fn: () => void) {
  reorderListeners.add(fn);
  return () => {
    reorderListeners.delete(fn);
  };
}

/** Lets an element that pans rather than scrolls (the mind map) move while something is dragged near its edge. */
export function registerPanner(el: Element, fn: (dx: number, dy: number) => void) {
  panners.set(el, fn);
}

export function dropAttrs(kind: DropTarget["kind"], id: string, insideOnly = false) {
  return { "data-drop": `${kind}:${id}`, ...(insideOnly ? { "data-drop-inside": "" } : {}) };
}

function positionIn(el: Element, y: number): DropPos {
  const r = el.getBoundingClientRect();
  const f = (y - r.top) / (r.height || 1);
  return f < 0.28 ? "before" : f > 0.72 ? "after" : "inside";
}

function hitTest(s: Session): Session["hover"] {
  const { lists, tasks } = getData();
  for (const node of document.elementsFromPoint(s.x, s.y)) {
    const el = node.closest("[data-drop]");
    if (!el) continue;
    const [kind, ...rest] = el.getAttribute("data-drop")!.split(":");
    const sameKind = kind === s.item.kind;
    const target: DropTarget = { kind: kind as DropTarget["kind"], id: rest.join(":"), pos: sameKind && !el.hasAttribute("data-drop-inside") ? positionIn(el, s.y) : "inside" };
    return canDrop(s.item, target, lists, tasks) ? { el, target } : null;
  }
  return null;
}

function setHover(s: Session, hover: Session["hover"]) {
  if (s.hover?.el !== hover?.el || s.hover?.target.pos !== hover?.target.pos) {
    s.hover?.el.removeAttribute("data-drop-pos");
    hover?.el.setAttribute("data-drop-pos", hover.target.pos);
  }
  s.hover = hover;
}

/** How far to move this frame: nothing outside the edge zone, faster the closer to the edge. */
const edgeSpeed = (gap: number) => (gap >= EDGE_PX ? 0 : Math.ceil(EDGE_MAX_SPEED * (1 - Math.max(gap, 0) / EDGE_PX)));

/** Scrolls or pans whatever is under the pointer when it's near that thing's edge. */
function edgeScroll(s: Session) {
  if (!s.carried) return;
  let node = document.elementFromPoint(s.x, s.y);
  let needX = true;
  let needY = true;
  for (; node && (needX || needY); node = node.parentElement) {
    const r = node.getBoundingClientRect();
    const dx = edgeSpeed(r.right - s.x) - edgeSpeed(s.x - r.left);
    const dy = edgeSpeed(r.bottom - s.y) - edgeSpeed(s.y - r.top);
    const pan = panners.get(node);
    if (pan) {
      if (dx || dy) pan(-dx, -dy);
      return;
    }
    const st = getComputedStyle(node);
    if (needY && /auto|scroll/.test(st.overflowY) && node.scrollHeight > node.clientHeight) {
      if (dy) node.scrollTop += dy;
      needY = false;
    }
    if (needX && /auto|scroll/.test(st.overflowX) && node.scrollWidth > node.clientWidth) {
      if (dx) node.scrollLeft += dx;
      needX = false;
    }
  }
}

function tick() {
  const s = session;
  if (!s?.active) return;
  edgeScroll(s);
  setHover(s, hitTest(s));
  s.frame = requestAnimationFrame(tick);
}

function moveGhost(s: Session) {
  if (s.ghost) s.ghost.style.transform = `translate(${s.x + 14}px, ${s.y + 14}px)`;
}

function activate(s: Session) {
  s.active = true;
  window.clearTimeout(s.timer);
  const ghost = document.createElement("div");
  ghost.className = "drag-ghost";
  ghost.textContent = s.label;
  if (s.color) ghost.style.setProperty("--c", s.color);
  document.body.appendChild(ghost);
  s.ghost = ghost;
  moveGhost(s);
  document.body.classList.add("is-dragging");
  s.source.setAttribute("data-dragging", "");
  navigator.vibrate?.(15);
  s.onActivate?.();
  s.frame = requestAnimationFrame(tick);
}

function finish(drop: boolean) {
  const s = session;
  if (!s) return;
  session = null;
  window.clearTimeout(s.timer);
  window.removeEventListener("pointermove", onMove);
  window.removeEventListener("pointerup", onUp);
  window.removeEventListener("pointercancel", onCancel);
  window.removeEventListener("keydown", onKey);
  window.removeEventListener("contextmenu", onContextMenu);
  if (!s.active) return;
  if (s.frame) cancelAnimationFrame(s.frame);
  const hover = hitTest(s);
  s.hover?.el.removeAttribute("data-drop-pos");
  s.ghost?.remove();
  s.source.removeAttribute("data-dragging");
  document.body.classList.remove("is-dragging");
  // The release mustn't also count as a tap on whatever is underneath.
  const swallow = (e: Event) => {
    e.stopPropagation();
    e.preventDefault();
  };
  window.addEventListener("click", swallow, { capture: true, once: true });
  window.setTimeout(() => window.removeEventListener("click", swallow, { capture: true }), 80);
  if (drop && hover) {
    const placed = s.item.kind === "task" && hover.target.pos !== "inside";
    void dropItem(s.item, hover.target).then((plan) => {
      if (plan && placed) reorderListeners.forEach((fn) => fn());
    });
  }
}

function onMove(e: PointerEvent) {
  const s = session;
  if (!s || e.pointerId !== s.pointerId) return;
  s.x = e.clientX;
  s.y = e.clientY;
  const dist = Math.hypot(s.x - s.startX, s.y - s.startY);
  if (s.active) {
    if (dist > EDGE_AFTER_PX) s.carried = true;
    return moveGhost(s);
  }
  if (s.threshold === null) {
    // A finger that moves before the long press is a scroll.
    if (dist > LONG_PRESS_SLOP_PX) finish(false);
  } else if (dist > s.threshold) activate(s);
}

const onUp = (e: PointerEvent) => {
  if (e.pointerId === session?.pointerId) finish(true);
};
const onCancel = (e: PointerEvent) => {
  if (e.pointerId === session?.pointerId) finish(false);
};
const onKey = (e: KeyboardEvent) => {
  if (e.key === "Escape") finish(false);
};
const onContextMenu = (e: Event) => e.preventDefault();

// Has to exist before the touch starts for it to be able to stop the page scrolling mid-drag.
if (typeof document !== "undefined") {
  document.addEventListener(
    "touchmove",
    (e) => {
      if (session?.active) e.preventDefault();
    },
    { passive: false },
  );
}

/** Call from a draggable's onPointerDown. `data-drag-ok` marks a button that may also start a drag. */
export function startDrag(
  e: ReactPointerEvent,
  item: DragItem & { label: string; color?: string },
  opts: { onActivate?: () => void } = {},
) {
  if (session || e.button !== 0 || !e.isPrimary) return;
  const el = e.target as Element;
  const onHandle = !!el.closest("[data-drag-handle]");
  if (!onHandle && el.closest("input,select,textarea,a,button:not([data-drag-ok])")) return;

  const longPress = e.pointerType !== "mouse" && !onHandle;
  const s: Session = {
    item: { kind: item.kind, id: item.id },
    label: item.label,
    color: item.color,
    source: e.currentTarget as Element,
    pointerId: e.pointerId,
    startX: e.clientX,
    startY: e.clientY,
    x: e.clientX,
    y: e.clientY,
    threshold: longPress ? null : onHandle ? HANDLE_MOVE_PX : MOVE_PX,
    active: false,
    carried: false,
    onActivate: opts.onActivate,
  };
  session = s;
  window.addEventListener("pointermove", onMove);
  window.addEventListener("pointerup", onUp);
  window.addEventListener("pointercancel", onCancel);
  window.addEventListener("keydown", onKey);
  window.addEventListener("contextmenu", onContextMenu);
  if (longPress) s.timer = window.setTimeout(() => activate(s), LONG_PRESS_MS);
}
