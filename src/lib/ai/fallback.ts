import type { AiAction, AiResult } from "./schema";

const blank = (): AiAction => ({
  kind: "create_task",
  task_id: null,
  list_path: [],
  title: null,
  notes: null,
  progress_update: null,
  status: null,
  waiting_on: null,
  priority: null,
  effort: null,
  urgency: null,
  tags: [],
  links: [],
  due_date: null,
  subtasks: [],
  complete_subtasks: [],
  context: null,
});

const WORDS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
};
const toNum = (s: string) => (WORDS[s.toLowerCase()] ?? parseInt(s, 10)) || null;
const NUM = "(\\d+|one|two|three|four|five|six|seven|eight|nine|ten)";

/**
 * Offline / no-API-key parser. Understands the simple pattern:
 *   "add <title> under <list> [/ <sublist>] priority 8 effort 2 urgency 9 tag foo #bar"
 * Anything it can't place becomes the title.
 */
export function parseOffline(input: string, today = new Date()): AiResult {
  let text = input.trim().replace(/[.!]+$/, "");
  const a = blank();

  const grab = (re: RegExp, fn: (m: RegExpMatchArray) => void) => {
    const m = text.match(re);
    if (m) {
      fn(m);
      text = (text.slice(0, m.index) + " " + text.slice(m.index! + m[0].length)).replace(/\s+/g, " ").trim();
    }
  };

  grab(new RegExp(`\\b(?:with\\s+)?priority\\s+(?:of\\s+)?${NUM}\\b`, "i"), (m) => (a.priority = toNum(m[1])));
  grab(new RegExp(`\\b(?:with\\s+)?effort\\s+(?:of\\s+)?${NUM}\\b`, "i"), (m) => (a.effort = toNum(m[1])));
  grab(new RegExp(`\\b(?:with\\s+)?(?:urgency|speed)\\s+(?:of\\s+)?${NUM}\\b`, "i"), (m) => (a.urgency = toNum(m[1])));
  grab(/\b(?:high|top) priority\b/i, () => (a.priority = 8));
  grab(/\blow priority\b/i, () => (a.priority = 3));
  grab(/\b(?:asap|urgent(?:ly)?)\b/i, () => (a.urgency = 9));
  grab(/\b(?:quick|easy)\s+(?:one|task)\b/i, () => (a.effort = 2));
  grab(/\bdue\s+(today|tomorrow)\b/i, (m) => {
    const d = new Date(today);
    if (m[1].toLowerCase() === "tomorrow") d.setDate(d.getDate() + 1);
    a.due_date = d.toISOString().slice(0, 10);
  });
  // tags: "#foo" or "tag(ged) (it|with) foo"
  let m: RegExpMatchArray | null;
  while ((m = text.match(/#([\w-]+)/))) {
    a.tags.push(m[1].toLowerCase());
    text = text.replace(m[0], "").trim();
  }
  grab(/\b(?:and\s+)?tag(?:ged)?\s+(?:it\s+|with\s+|as\s+)?([\w-]+(?:\s*(?:,|and)\s*[\w-]+)*)$/i, (mm) => {
    a.tags.push(...mm[1].split(/\s*(?:,|and)\s*/).map((t) => t.toLowerCase()).filter(Boolean));
  });
  grab(/(https?:\/\/\S+)/i, (mm) => a.links.push({ url: mm[1], label: "" }));

  // "under X" / "to the X list" / "in X"
  grab(/\b(?:under|to the|into|in the|to)\s+([\w\s'&/>-]+?)(?:\s+(?:list|topic|project))?\s*$/i, (mm) => {
    a.list_path = mm[1].split(/\s*(?:\/|>|›)\s*/).map((s) => s.trim()).filter(Boolean);
  });

  text = text.replace(/^(?:please\s+)?(?:add|create|new task|remind me to|i need to|todo|to do)\s*[:,-]?\s*/i, "").trim();
  text = text.replace(/\s+(?:and|with)\s*$/i, "").trim();
  if (!text) return { actions: [], reply: "I didn't catch a to-do there." };
  a.title = text.charAt(0).toUpperCase() + text.slice(1);
  const where = a.list_path.length ? ` under ${a.list_path.join(" › ")}` : "";
  return { actions: [a], reply: `Added "${a.title}"${where}. (Offline parser — add an API key for smarter input.)` };
}
