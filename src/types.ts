export type Space = "work" | "personal";

export const SPACES: { id: Space; name: string; emoji: string; color: string }[] = [
  { id: "work", name: "Work", emoji: "💼", color: "#6366f1" },
  { id: "personal", name: "Personal", emoji: "🏡", color: "#10b981" },
];

/** Colors for lists. Top-level lists take these in turn until you pick one. */
export const LIST_COLORS = [
  "#3b82f6", "#f97316", "#8b5cf6", "#14b8a6", "#ec4899", "#eab308",
  "#ef4444", "#06b6d4", "#84cc16", "#d946ef", "#a16207", "#64748b",
];

/** Bumped when a saved task needs converting. See lib/migrate.ts. */
export const TASK_VERSION = 2;

export type Status = "todo" | "in_progress" | "waiting" | "blocked" | "done";

export const STATUSES: { id: Status; label: string; color: string }[] = [
  { id: "todo", label: "To do", color: "#94a3b8" },
  { id: "in_progress", label: "In progress", color: "#38bdf8" },
  { id: "waiting", label: "Waiting on someone", color: "#f59e0b" },
  { id: "blocked", label: "Blocked", color: "#f43f5e" },
  { id: "done", label: "Done", color: "#22c55e" },
];

/** A topic / sub-topic. Lists nest without limit via parentId. */
export interface List {
  id: string;
  name: string;
  space: Space;
  parentId: string | null;
  /** Empty = inherit from the parent list, or take the next color in LIST_COLORS at the top level. */
  color?: string;
  /** "Closed" lists are hidden from the main views but kept. */
  closed: boolean;
  /** Background on this topic ("who's involved, what it's for") that the AI reads. */
  context?: string;
  order: number;
  createdAt: number;
  updatedAt: number;
}

/** Somewhere in the tree: everything, a whole space, or one list. */
export type Place = { kind: "all" } | { kind: "space"; space: Space } | { kind: "list"; id: string };

/** Data that isn't a list or task: background docs for "About me" and the two spaces. */
export interface Meta {
  context: { all?: string; work?: string; personal?: string };
  updatedAt: number;
}

export const EMPTY_META: Meta = { context: {}, updatedAt: 0 };

export interface Link {
  url: string;
  label?: string;
}

/** The old checklist item. Saved tasks may still have these until lib/migrate.ts converts them. */
export interface LegacyChecklistItem {
  id: string;
  text: string;
  done: boolean;
}

/** One timestamped progress entry ("Waiting on Jordan for the report"). */
export interface UpdateEntry {
  id: string;
  at: number;
  text: string;
  /** What you actually said, if it came from voice/AI. */
  raw?: string;
}

/**
 * How a task repeats. Examples:
 *  every 3 days                 { freq: "day", interval: 3 }
 *  Mon/Wed/Fri                  { freq: "week", interval: 1, weekdays: [1,3,5] }
 *  15th of every month          { freq: "month", interval: 1, monthMode: "day", monthDay: 15 }
 *  2nd Tuesday every quarter    { freq: "month", interval: 3, monthMode: "weekday", nth: 2, weekday: 2 }
 *  last day of the month        { freq: "month", interval: 1, monthMode: "last" }
 *  every Mar 3                  { freq: "year", interval: 1, month: 2, monthMode: "day", monthDay: 3 }
 *  2 weeks after I finish it    { freq: "week", interval: 2, from: "completion" }
 */
export interface Repeat {
  freq: "day" | "week" | "month" | "year";
  /** Every N days/weeks/months/years. */
  interval: number;
  /** freq "week": days of the week, 0 = Sunday … 6 = Saturday. Empty = same weekday as the due date. */
  weekdays?: number[];
  /** freq "month"/"year": on a day number, on the Nth weekday, or on the last day. */
  monthMode?: "day" | "weekday" | "last";
  monthDay?: number;
  /** 1–4, or -1 for "last". */
  nth?: number;
  weekday?: number;
  /** freq "year": 0 = January … 11 = December. */
  month?: number;
  /** Count from the due date (fixed schedule) or from when you complete it. */
  from: "due" | "completion";
  /** Stop after this date (YYYY-MM-DD). */
  until?: string | null;
  /** Stop after this many completions in total. */
  count?: number | null;
  /** How many times it's been completed so far. */
  done?: number;
}

export interface Task {
  id: string;
  title: string;
  notes: string;
  space: Space;
  /** null = sits directly under the space (Work / Personal) root. */
  listId: string | null;
  /** Set = this is a sub-task of that task. It shares the parent's list and space. */
  parentId?: string | null;
  status: Status;
  waitingOn: string;
  /** 1–10, how important. null = not set. */
  priority: number | null;
  /** 1–10, how much work (10 = huge). null = not set. */
  effort: number | null;
  /** 1–10, how soon it needs to happen ("speed"). null = not set. */
  urgency: number | null;
  tags: string[];
  links: Link[];
  subtasks?: LegacyChecklistItem[];
  updates: UpdateEntry[];
  dueDate: string | null; // YYYY-MM-DD
  /** Recurring: checking it off rolls it forward to the next date. */
  repeat?: Repeat | null;
  order: number;
  createdAt: number;
  updatedAt: number;
  completedAt: number | null;
  v?: number;
}

export type ProviderId = "anthropic" | "openrouter" | "deepinfra";

export interface Settings {
  provider: ProviderId;
  models: Record<ProviderId, string>;
  /** Anthropic effort level (Claude only). */
  effort: "low" | "medium" | "high" | "xhigh" | "max";
  keys: Record<ProviderId, string>;
  /** Store API keys in Firestore so all your devices get them. */
  syncKeys: boolean;
  /** Show a confirm step before AI changes are saved. */
  reviewBeforeSaving: boolean;
  defaultSpace: Space;
  /** Speech recognition language. */
  speechLang: string;
}

export const DEFAULT_SETTINGS: Settings = {
  provider: "anthropic",
  models: {
    anthropic: "claude-haiku-5-5",
    openrouter: "anthropic/claude-haiku-5.5",
    deepinfra: "",
  },
  effort: "high",
  keys: { anthropic: "", openrouter: "", deepinfra: "" },
  syncKeys: false,
  reviewBeforeSaving: true,
  defaultSpace: "work",
  speechLang: "en-US",
};
