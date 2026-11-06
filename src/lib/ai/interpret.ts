import {
  deleteTask,
  getContext,
  getData,
  getSettings,
  newList,
  newTask,
  removeListOnly,
  saveList,
  saveMeta,
  saveTask,
  setContext,
} from "../../state/store";
import type { List, Meta, Place, Space, Task } from "../../types";
import { toModelImages, type Attachment } from "../images";
import { clamp } from "../score";
import { allTags, listPath, resolvePath, uid } from "../tree";
import { parseOffline } from "./fallback";
import { buildContextMessage, buildUserMessage, CONTEXT_SYSTEM_PROMPT, SYSTEM_PROMPT } from "./prompt";
import { AiError, callModel } from "./providers";
import { CONTEXT_SCHEMA, normalizeResult, RESULT_SCHEMA, type AiAction, type AiResult } from "./schema";

export interface InterpretOptions {
  focusTaskId?: string | null;
  viewing?: string[] | null;
}

const hasKey = () => {
  const s = getSettings();
  return !!s.keys[s.provider]?.trim();
};

/** Ask the selected AI to turn what you said (plus any screenshots) into actions. */
export async function interpret(
  utterance: string,
  opts: InterpretOptions = {},
  attachments: Attachment[] = [],
): Promise<AiResult & { offline: boolean }> {
  const settings = getSettings();
  const { lists, tasks, meta } = getData();
  if (!hasKey()) {
    if (attachments.length) throw new AiError("Reading screenshots needs an AI key. Add one in Settings.");
    const r = parseOffline(utterance);
    // Offline: drop into the list you're looking at when none was named.
    if (opts.viewing?.length) r.actions.forEach((a) => !a.list_path.length && (a.list_path = [...opts.viewing!]));
    return { ...r, offline: true };
  }
  const images = toModelImages(attachments);
  const user = buildUserMessage(utterance, {
    lists,
    tasks,
    meta,
    imageCount: images.length,
    tags: allTags(tasks),
    defaultSpace: settings.defaultSpace,
    focusTask: opts.focusTaskId ? tasks.find((t) => t.id === opts.focusTaskId) : null,
    viewing: opts.viewing,
  });
  const raw = await callModel(settings, { system: SYSTEM_PROMPT, user, images, schema: RESULT_SCHEMA, schemaName: "todo_actions" });
  return { ...normalizeResult(raw), offline: false };
}

/** "Organize": merge a rambling spiel into a topic's background doc. */
export async function organizeContext(topic: string, existing: string, added: string): Promise<{ context: string; reply: string }> {
  if (!hasKey()) throw new AiError("Organizing needs an AI key. Add one in Settings.");
  const raw = (await callModel(getSettings(), {
    system: CONTEXT_SYSTEM_PROMPT,
    user: buildContextMessage(topic, existing, added),
    schema: CONTEXT_SCHEMA,
    schemaName: "background_doc",
  })) as { context?: unknown; reply?: unknown };
  const context = typeof raw?.context === "string" ? raw.context.trim() : "";
  if (!context) throw new AiError("The AI didn't return a document. Try again.");
  return { context, reply: typeof raw.reply === "string" ? raw.reply : "" };
}

/** Where an update_context action points: [] = About me, ["Work"] = the space, deeper = a list. */
function contextPlace(path: string[], defaultSpace: Space): { place: Place | null; label: string; isNew: boolean } {
  if (!path.length) return { place: { kind: "all" }, label: "About me", isNew: false };
  const { lists } = getData();
  const r = resolvePath(lists, path, defaultSpace);
  const label = [...listPath(lists, r.listId, r.space), ...r.missing].join(" › ");
  if (r.missing.length) return { place: null, label, isNew: true };
  return { place: r.listId ? { kind: "list", id: r.listId } : { kind: "space", space: r.space }, label, isNew: false };
}

// ------------------------------------------------------------ previewing

export interface ActionPreview {
  icon: string;
  headline: string;
  details: string[];
  /** Action can't be applied (e.g. task id not found). */
  invalid?: string;
}

export function describe(a: AiAction, defaultSpace: Space, focusTaskId?: string | null): ActionPreview {
  const { lists, tasks } = getData();
  const where = (path: string[]) => {
    const r = resolvePath(lists, path, defaultSpace);
    const base = listPath(lists, r.listId, r.space);
    return [...base, ...r.missing].join(" › ") + (r.missing.length ? "  (new list)" : "");
  };
  const fields = (): string[] => {
    const d: string[] = [];
    if (a.status) d.push(`Status → ${a.status.replace("_", " ")}${a.waiting_on ? ` (${a.waiting_on})` : ""}`);
    else if (a.waiting_on) d.push(`Waiting on ${a.waiting_on}`);
    const scores = [
      a.priority && `priority ${a.priority}`,
      a.effort && `effort ${a.effort}`,
      a.urgency && `urgency ${a.urgency}`,
    ].filter(Boolean);
    if (scores.length) d.push(scores.join(" · "));
    if (a.due_date) d.push(`Due ${a.due_date}`);
    if (a.tags.length) d.push(a.tags.map((t) => `#${t}`).join(" "));
    a.links.forEach((l) => d.push(`🔗 ${l.label || l.url}`));
    a.subtasks.forEach((s) => d.push(`☐ ${s}`));
    a.complete_subtasks.forEach((s) => d.push(`☑ ${s}`));
    if (a.progress_update) d.push(`📝 ${a.progress_update}`);
    if (a.notes) d.push(`Notes: ${a.notes}`);
    return d;
  };

  switch (a.kind) {
    case "create_task":
      return {
        icon: "➕",
        headline: `${a.title ?? "(untitled)"}`,
        details: [`→ ${where(a.list_path)}`, ...fields()],
        invalid: a.title ? undefined : "No title",
      };
    case "create_list":
      return { icon: "🗂️", headline: `New list`, details: [where(a.list_path)], invalid: a.list_path.length ? undefined : "No name" };
    case "update_task": {
      const t = tasks.find((x) => x.id === (a.task_id ?? focusTaskId));
      const d = fields();
      if (a.title && t && a.title !== t.title) d.unshift(`Rename → ${a.title}`);
      if (a.list_path.length) d.unshift(`Move → ${where(a.list_path)}`);
      return { icon: "✏️", headline: t ? t.title : "Unknown task", details: d, invalid: t ? undefined : "Couldn't find that task" };
    }
    case "update_context": {
      const c = contextPlace(a.list_path, defaultSpace);
      return {
        icon: "📄",
        headline: `Background for ${c.label}${c.isNew ? "  (new list)" : ""}`,
        details: (a.context ?? "").split("\n").filter((x) => x.trim()),
        invalid: a.context ? undefined : "Nothing to add",
      };
    }
    case "delete_task": {
      const t = tasks.find((x) => x.id === a.task_id);
      return { icon: "🗑️", headline: t ? `Delete “${t.title}”` : "Delete unknown task", details: [], invalid: t ? undefined : "Couldn't find that task" };
    }
  }
}

// --------------------------------------------------------------- applying

export interface ApplyReceipt {
  undo: () => Promise<void>;
  touchedTaskIds: string[];
}

async function ensurePath(path: string[], defaultSpace: Space, createdLists: string[]) {
  const r = resolvePath(getData().lists, path, defaultSpace);
  let parent = r.listId;
  for (const name of r.missing) {
    const l: List = newList({ name, space: r.space, parentId: parent });
    await saveList(l);
    createdLists.push(l.id);
    parent = l.id;
  }
  return { space: r.space, listId: parent };
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

export async function applyResult(
  result: AiResult,
  opts: { raw: string; focusTaskId?: string | null; skip?: Set<number> },
): Promise<ApplyReceipt> {
  const settings = getSettings();
  const createdLists: string[] = [];
  const createdTasks: string[] = [];
  const before = new Map<string, Task>();
  const beforeLists = new Map<string, List>();
  let beforeMeta: Meta | null = null;
  const touched: string[] = [];

  for (const [i, a] of result.actions.entries()) {
    if (opts.skip?.has(i)) continue;
    if (a.kind === "create_list" && a.list_path.length) {
      await ensurePath(a.list_path, settings.defaultSpace, createdLists);
    } else if (a.kind === "create_task" && a.title) {
      const place = await ensurePath(a.list_path, settings.defaultSpace, createdLists);
      const t = newTask({
        title: a.title,
        space: place.space,
        listId: place.listId,
        notes: a.notes ?? "",
        status: a.status ?? (a.waiting_on ? "waiting" : "todo"),
        waitingOn: a.waiting_on ?? "",
        priority: clamp(a.priority ?? 5),
        effort: clamp(a.effort ?? 5),
        urgency: clamp(a.urgency ?? 5),
        tags: [...new Set(a.tags)],
        links: a.links.map((l) => ({ url: withScheme(l.url), label: l.label || undefined })),
        subtasks: a.subtasks.map((text) => ({ id: uid(), text, done: false })),
        dueDate: a.due_date,
        updates: a.progress_update ? [{ id: uid(), at: Date.now(), text: a.progress_update, raw: opts.raw }] : [],
      });
      if (t.status === "done") t.completedAt = Date.now();
      await saveTask(t);
      createdTasks.push(t.id);
      touched.push(t.id);
    } else if (a.kind === "update_task") {
      const id = a.task_id ?? opts.focusTaskId;
      const cur = getData().tasks.find((x) => x.id === id);
      if (!cur) continue;
      if (!before.has(cur.id)) before.set(cur.id, cur);
      const next: Task = { ...cur, updatedAt: Date.now() };
      if (a.title) next.title = a.title;
      if (a.status) {
        next.status = a.status;
        next.completedAt = a.status === "done" ? (cur.completedAt ?? Date.now()) : null;
        if (a.status !== "waiting" && !a.waiting_on) next.waitingOn = "";
      }
      if (a.waiting_on) {
        next.waitingOn = a.waiting_on;
        if (!a.status && cur.status !== "done") next.status = "waiting";
      }
      if (a.priority) next.priority = clamp(a.priority);
      if (a.effort) next.effort = clamp(a.effort);
      if (a.urgency) next.urgency = clamp(a.urgency);
      if (a.due_date) next.dueDate = a.due_date;
      if (a.tags.length) next.tags = [...new Set([...cur.tags, ...a.tags])];
      if (a.links.length) next.links = [...cur.links, ...a.links.map((l) => ({ url: withScheme(l.url), label: l.label || undefined }))];
      if (a.notes) next.notes = cur.notes ? `${cur.notes.trimEnd()}\n\n${a.notes}` : a.notes;
      if (a.subtasks.length) next.subtasks = [...cur.subtasks, ...a.subtasks.map((text) => ({ id: uid(), text, done: false }))];
      if (a.complete_subtasks.length) {
        next.subtasks = next.subtasks.map((s) =>
          a.complete_subtasks.some((c) => norm(s.text).includes(norm(c)) || norm(c).includes(norm(s.text)))
            ? { ...s, done: true }
            : s,
        );
      }
      if (a.progress_update) next.updates = [...cur.updates, { id: uid(), at: Date.now(), text: a.progress_update, raw: opts.raw }];
      if (a.list_path.length) {
        const place = await ensurePath(a.list_path, cur.space, createdLists);
        next.space = place.space;
        next.listId = place.listId;
      }
      await saveTask(next);
      touched.push(next.id);
    } else if (a.kind === "update_context" && a.context) {
      let place = contextPlace(a.list_path, settings.defaultSpace).place;
      if (!place) {
        const made = await ensurePath(a.list_path, settings.defaultSpace, createdLists);
        place = made.listId ? { kind: "list", id: made.listId } : { kind: "space", space: made.space };
      }
      if (place.kind === "list") {
        const l = getData().lists.find((x) => x.id === (place as { id: string }).id);
        if (l && !beforeLists.has(l.id) && !createdLists.includes(l.id)) beforeLists.set(l.id, l);
      } else if (!beforeMeta) beforeMeta = getData().meta;
      const cur = getContext(place).trimEnd();
      await setContext(place, cur ? `${cur}\n${a.context}` : a.context);
    } else if (a.kind === "delete_task" && a.task_id) {
      const cur = getData().tasks.find((x) => x.id === a.task_id);
      if (!cur) continue;
      if (!before.has(cur.id)) before.set(cur.id, cur);
      await deleteTask(cur.id);
    }
  }

  return {
    touchedTaskIds: touched,
    undo: async () => {
      for (const id of createdTasks) await deleteTask(id);
      for (const t of before.values()) await saveTask(t);
      for (const l of beforeLists.values()) await saveList(l);
      if (beforeMeta) await saveMeta(beforeMeta);
      for (const id of createdLists.reverse()) await removeListOnly(id);
    },
  };
}

function withScheme(url: string) {
  return /^https?:\/\//i.test(url) ? url : `https://${url}`;
}
