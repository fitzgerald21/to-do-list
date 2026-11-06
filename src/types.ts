export type Space = "work" | "personal";

export const SPACES: { id: Space; name: string; emoji: string }[] = [
  { id: "work", name: "Work", emoji: "💼" },
  { id: "personal", name: "Personal", emoji: "🏡" },
];

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

export interface Subtask {
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

export interface Task {
  id: string;
  title: string;
  notes: string;
  space: Space;
  /** null = sits directly under the space (Work / Personal) root. */
  listId: string | null;
  status: Status;
  waitingOn: string;
  /** 1–10, how important. */
  priority: number;
  /** 1–10, how much work (10 = huge). */
  effort: number;
  /** 1–10, how soon it needs to happen ("speed"). */
  urgency: number;
  tags: string[];
  links: Link[];
  subtasks: Subtask[];
  updates: UpdateEntry[];
  dueDate: string | null; // YYYY-MM-DD
  order: number;
  createdAt: number;
  updatedAt: number;
  completedAt: number | null;
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
