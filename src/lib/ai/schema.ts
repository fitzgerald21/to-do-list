import type { Status } from "../../types";

export type ActionKind = "create_task" | "update_task" | "create_list" | "delete_task" | "update_context";

/** One change the assistant wants to make. Flat on purpose so every provider can produce it. */
export interface AiAction {
  kind: ActionKind;
  /** Existing task id (update_task / delete_task). */
  task_id: string | null;
  /** Where it goes, e.g. ["Work", "Transformation"]. For update_task, non-empty = move it. */
  list_path: string[];
  title: string | null;
  /** create_task: full notes. update_task: text appended to notes. */
  notes: string | null;
  /** update_task: one tidy line for the progress log. */
  progress_update: string | null;
  status: Status | null;
  waiting_on: string | null;
  priority: number | null;
  effort: number | null;
  urgency: number | null;
  /** Tags to add. */
  tags: string[];
  links: { url: string; label: string }[];
  due_date: string | null;
  /** Checklist items to add. */
  subtasks: string[];
  /** Checklist items (by text) to tick off. */
  complete_subtasks: string[];
  /** update_context: new background facts to add to the topic's About doc. */
  context: string | null;
}

export interface AiResult {
  actions: AiAction[];
  /** One short sentence to show the user. */
  reply: string;
}

const nullable = (type: string, extra: Record<string, unknown> = {}) => ({ type: [type, "null"], ...extra });
const strArr = { type: "array", items: { type: "string" } };

export const RESULT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["actions", "reply"],
  properties: {
    reply: { type: "string" },
    actions: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "kind", "task_id", "list_path", "title", "notes", "progress_update", "status",
          "waiting_on", "priority", "effort", "urgency", "tags", "links", "due_date",
          "subtasks", "complete_subtasks", "context",
        ],
        properties: {
          kind: { type: "string", enum: ["create_task", "update_task", "create_list", "delete_task", "update_context"] },
          task_id: nullable("string"),
          list_path: strArr,
          title: nullable("string"),
          notes: nullable("string"),
          progress_update: nullable("string"),
          status: { type: ["string", "null"], enum: ["todo", "in_progress", "waiting", "blocked", "done", null] },
          waiting_on: nullable("string"),
          priority: nullable("integer"),
          effort: nullable("integer"),
          urgency: nullable("integer"),
          tags: strArr,
          links: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              required: ["url", "label"],
              properties: { url: { type: "string" }, label: { type: "string" } },
            },
          },
          due_date: nullable("string"),
          subtasks: strArr,
          complete_subtasks: strArr,
          context: nullable("string"),
        },
      },
    },
  },
} as const;

const STATUS_SET = new Set(["todo", "in_progress", "waiting", "blocked", "done"]);
const KINDS = new Set(["create_task", "update_task", "create_list", "delete_task", "update_context"]);

const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);
const num = (v: unknown): number | null => {
  const n = typeof v === "string" ? parseFloat(v) : v;
  return typeof n === "number" && Number.isFinite(n) ? Math.min(10, Math.max(1, Math.round(n))) : null;
};
const strs = (v: unknown): string[] =>
  Array.isArray(v) ? v.map((x) => (typeof x === "string" ? x.trim() : "")).filter(Boolean) : [];

/**
 * Models that don't support strict JSON (some OpenRouter/DeepInfra ones) can
 * return slightly-off shapes. Coerce whatever came back into a safe AiResult.
 */
export function normalizeResult(raw: unknown): AiResult {
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const acts = Array.isArray(o.actions) ? o.actions : [];
  const actions: AiAction[] = [];
  for (const a of acts) {
    if (!a || typeof a !== "object") continue;
    const r = a as Record<string, unknown>;
    const kind = String(r.kind ?? "create_task");
    if (!KINDS.has(kind)) continue;
    const status = str(r.status);
    const due = str(r.due_date);
    actions.push({
      kind: kind as ActionKind,
      task_id: str(r.task_id),
      list_path: strs(r.list_path),
      title: str(r.title),
      notes: str(r.notes),
      progress_update: str(r.progress_update),
      status: status && STATUS_SET.has(status) ? (status as Status) : null,
      waiting_on: str(r.waiting_on),
      priority: num(r.priority),
      effort: num(r.effort),
      urgency: num(r.urgency),
      tags: strs(r.tags).map((t) => t.replace(/^#/, "").toLowerCase()),
      links: Array.isArray(r.links)
        ? r.links
            .map((l) =>
              typeof l === "string"
                ? { url: l, label: "" }
                : { url: String((l as Record<string, unknown>)?.url ?? ""), label: String((l as Record<string, unknown>)?.label ?? "") },
            )
            .filter((l) => /^https?:\/\/|^[\w-]+\.[\w.-]+/.test(l.url))
        : [],
      due_date: due && /^\d{4}-\d{2}-\d{2}$/.test(due) ? due : null,
      subtasks: strs(r.subtasks),
      complete_subtasks: strs(r.complete_subtasks),
      context: str(r.context),
    });
  }
  return { actions, reply: str(o.reply) ?? "" };
}

/** Reply shape for "Organize" on a background doc. */
export const CONTEXT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["context", "reply"],
  properties: { context: { type: "string" }, reply: { type: "string" } },
} as const;

/** Pull the first JSON object out of a model reply (handles ```json fences and chatter). */
export function extractJson(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = fenced ? fenced[1] : text;
  const start = body.indexOf("{");
  const end = body.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("The model didn't return JSON.");
  return JSON.parse(body.slice(start, end + 1));
}
