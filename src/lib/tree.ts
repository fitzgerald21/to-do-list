import { LIST_COLORS, SPACES, type List, type Space, type Task } from "../types";

export const uid = () =>
  Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

export function childrenOf(lists: List[], parentId: string | null, space: Space): List[] {
  return lists
    .filter((l) => l.parentId === parentId && l.space === space)
    .sort((a, b) => a.order - b.order || a.name.localeCompare(b.name));
}

/** All list ids under (and including) `id`. */
export function descendantIds(lists: List[], id: string): Set<string> {
  const out = new Set<string>([id]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const l of lists) {
      if (l.parentId && out.has(l.parentId) && !out.has(l.id)) {
        out.add(l.id);
        grew = true;
      }
    }
  }
  return out;
}

/** All task ids under (and including) `id`: its sub-tasks, their sub-tasks and so on. */
export function taskDescendantIds(tasks: Task[], id: string): Set<string> {
  const out = new Set<string>([id]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const t of tasks) {
      if (t.parentId && out.has(t.parentId) && !out.has(t.id)) {
        out.add(t.id);
        grew = true;
      }
    }
  }
  return out;
}

/** The list's own color, else the nearest ancestor's, else the top-level list's turn in the palette. */
export function listColor(lists: List[], id: string): string {
  const byId = new Map(lists.map((l) => [l.id, l]));
  let cur = byId.get(id);
  let guard = 0;
  while (cur && guard++ < 50) {
    if (cur.color) return cur.color;
    if (!cur.parentId) break;
    cur = byId.get(cur.parentId);
  }
  if (!cur) return LIST_COLORS[0];
  const roots = lists.filter((l) => !l.parentId).sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id));
  return LIST_COLORS[Math.max(0, roots.findIndex((l) => l.id === cur!.id)) % LIST_COLORS.length];
}

/** The color of wherever a task lives. */
export function placeColor(lists: List[], listId: string | null, space: Space): string {
  return listId ? listColor(lists, listId) : SPACES.find((s) => s.id === space)!.color;
}

/** ["Work", "Transformation", "Q4"] */
export function listPath(lists: List[], id: string | null, space: Space): string[] {
  const names: string[] = [];
  const byId = new Map(lists.map((l) => [l.id, l]));
  let cur = id ? byId.get(id) : undefined;
  let guard = 0;
  while (cur && guard++ < 50) {
    names.unshift(cur.name);
    cur = cur.parentId ? byId.get(cur.parentId) : undefined;
  }
  names.unshift(SPACES.find((s) => s.id === space)!.name);
  return names;
}

/** Every place something can live: "Work", "Work › Transformation", … Values are "space:listId". */
export function placeOptions(lists: List[]): { value: string; label: string }[] {
  const out: { value: string; label: string }[] = [];
  for (const sp of SPACES) {
    out.push({ value: `${sp.id}:`, label: sp.name });
    const walk = (parent: string | null) =>
      childrenOf(lists, parent, sp.id).forEach((l) => {
        out.push({ value: `${sp.id}:${l.id}`, label: listPath(lists, l.id, sp.id).join(" › ") + (l.closed ? " (closed)" : "") });
        walk(l.id);
      });
    walk(null);
  }
  return out;
}

export function pathLabel(lists: List[], task: Pick<Task, "listId" | "space">): string {
  return listPath(lists, task.listId, task.space).join(" › ");
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/** Is the list closed itself or under a closed ancestor? */
export function isEffectivelyClosed(lists: List[], id: string | null): boolean {
  const byId = new Map(lists.map((l) => [l.id, l]));
  let cur = id ? byId.get(id) : undefined;
  let guard = 0;
  while (cur && guard++ < 50) {
    if (cur.closed) return true;
    cur = cur.parentId ? byId.get(cur.parentId) : undefined;
  }
  return false;
}

export interface ResolvedPath {
  space: Space;
  /** Deepest list that already exists (null = space root). */
  listId: string | null;
  /** Names still to be created below `listId`. */
  missing: string[];
}

/**
 * Turn a spoken path like ["Transformation"] or ["Work", "Transformation", "Kathy"]
 * into a real place in the tree. The first segment may be a space name. If the
 * first list name isn't found at the root, we search the whole space so you can
 * say just "Transformation" even if it's nested.
 */
export function resolvePath(
  lists: List[],
  rawPath: string[],
  fallbackSpace: Space,
): ResolvedPath {
  let path = rawPath.map((p) => p.trim()).filter(Boolean);
  let space: Space | null = null;
  if (path.length) {
    const sp = SPACES.find((s) => norm(s.name) === norm(path[0]) || s.id === norm(path[0]));
    if (sp) {
      space = sp.id;
      path = path.slice(1);
    }
  }
  if (!path.length) return { space: space ?? fallbackSpace, listId: null, missing: [] };

  const open = lists.filter((l) => !l.closed);
  const findIn = (candidates: List[], name: string) =>
    candidates.find((l) => norm(l.name) === norm(name)) ??
    candidates.find((l) => norm(l.name).startsWith(norm(name)) || norm(name).startsWith(norm(l.name)));

  // Find the first segment anywhere (preferring the given space, then the other one).
  const spaceOrder: Space[] = space ? [space] : [fallbackSpace, ...SPACES.map((s) => s.id).filter((s) => s !== fallbackSpace)];
  let start: List | undefined;
  for (const sp of spaceOrder) {
    const inSpace = open.filter((l) => l.space === sp);
    const roots = inSpace.filter((l) => l.parentId === null);
    start = findIn(roots, path[0]) ?? findIn(inSpace, path[0]);
    if (start) break;
  }
  if (!start) return { space: space ?? fallbackSpace, listId: null, missing: path };

  let cur = start;
  for (let i = 1; i < path.length; i++) {
    const next = findIn(open.filter((l) => l.parentId === cur.id), path[i]);
    if (!next) return { space: cur.space, listId: cur.id, missing: path.slice(i) };
    cur = next;
  }
  return { space: cur.space, listId: cur.id, missing: [] };
}

/** Indented outline of the whole tree for the AI prompt. */
export function outline(lists: List[]): string {
  const lines: string[] = [];
  for (const sp of SPACES) {
    lines.push(sp.name);
    const walk = (parent: string | null, depth: number) => {
      for (const l of childrenOf(lists, parent, sp.id)) {
        if (l.closed) continue;
        lines.push(`${"  ".repeat(depth)}- ${l.name}`);
        walk(l.id, depth + 1);
      }
    };
    walk(null, 1);
  }
  return lines.join("\n");
}

export function allTags(tasks: Task[]): string[] {
  const s = new Set<string>();
  tasks.forEach((t) => t.tags.forEach((x) => s.add(x)));
  return [...s].sort();
}
