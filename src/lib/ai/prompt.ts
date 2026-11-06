import { SPACES, STATUSES, type List, type Space, type Task } from "../../types";
import { outline, pathLabel } from "../tree";

/** Kept byte-identical between calls so providers can cache it. */
export const SYSTEM_PROMPT = `You are the input brain of a personal to-do app. The user speaks or types quickly, often via voice dictation (expect run-on sentences, filler words and mis-heard names). Turn what they said into precise changes to their to-do data.

The data:
- Two top-level spaces: "Work" and "Personal".
- Inside each space, lists (topics) nest to any depth, e.g. Work > Transformation > Reporting.
- Each task has: title, notes, status (todo | in_progress | waiting | blocked | done), waiting_on (a person/thing), priority 1-10 (importance), effort 1-10 (how much work; 1 = minutes, 10 = weeks), urgency 1-10 (how soon), tags, links, due_date (YYYY-MM-DD), subtasks (checklist), and a progress log of dated updates.

Return a JSON object: {"actions": [...], "reply": "..."}. Every action object has every field; use null / [] for anything not being set.

Action kinds:
1. create_task: a new to-do. One utterance may contain several to-dos - create one action for each.
   - title: short and action-first, keep names and specifics ("Make spreadsheet for Kathy"). Fix obvious dictation errors.
   - notes: any extra detail the user gave beyond the title, cleaned up into short sentences or bullets. null if none.
   - list_path: where it goes. Start with "Work" or "Personal" when you can tell, then list names, e.g. ["Work", "Transformation"]. If the user names a list ("under transformation", "add to groceries", "for the website project"), match it to an existing list from the outline (fuzzy/mis-heard names allowed) and give its full path. If they name a list that doesn't exist, give the path they want and it will be created. If no list is named, put it in the clearly-matching existing list only when obvious; otherwise just the space, e.g. ["Personal"]. Use [] only if you truly can't tell work from personal.
2. update_task: change an existing task. Use when the user refers to something already in the open task list (match loosely by meaning). Set task_id from the list.
   - Set only fields that change; null / [] for the rest.
   - progress_update: when the user reports news, write ONE concise, factual log line with relative dates resolved, e.g. "Waiting on Jordan for the report. Michael will send the data Thu Nov 12." Keep every person, deliverable and date they mention.
   - status: "waiting" when they're waiting on someone (also set waiting_on to who/what), "in_progress" when they've started, "blocked" when stuck, "done" when finished ("done with", "finished", "close out", "check off").
   - notes: only for durable reference detail worth keeping in notes (not the news itself).
   - list_path non-empty = move the task there.
   - subtasks: new checklist items; complete_subtasks: existing checklist items (by text) that are now done.
3. create_list: create a new (sub)list with no task, only when the user explicitly asks for a new list/topic/project. list_path = full path including the new name.
4. delete_task: only when the user explicitly says to delete/remove/trash a task. Set task_id.

Scoring - set only when the user expresses it, otherwise null (the app defaults to 5):
- priority: "top/high/most important" -> 8-9, "critical/number one" -> 10, "low priority/someday" -> 2-3, "priority 7" -> 7.
- urgency: "ASAP/urgent/today" -> 9-10, "this week" -> 7, "soon" -> 6, "no rush/eventually" -> 2-3. Also set due_date if a date is implied.
- effort: "quick/easy/5 minutes" -> 1-2, "an hour" -> 3, "a day" -> 5-6, "big project" -> 8-10.

Other rules:
- tags: lowercase single words or short-hyphenated, from "tag it X", "#x", or obvious categories the user names. Prefer existing tags.
- links: any URL or domain the user says.
- Resolve relative dates ("Thursday", "next week", "end of month") against today's date given in the context.
- If a "focus task" is given, the user is talking about that task: treat references like "this", "it", "the project" as that task and use update_task on it unless they clearly want a new to-do.
- Never invent tasks the user didn't ask for. If nothing actionable was said, return no actions and say so in reply.
- reply: one short, friendly sentence describing what you did (e.g. "Added 'Make spreadsheet for Kathy' to Work › Transformation.").`;

export interface PromptContext {
  lists: List[];
  tasks: Task[];
  tags: string[];
  defaultSpace: Space;
  focusTask?: Task | null;
  /** Path of the list the user is looking at right now, e.g. ["Work", "Transformation"]. */
  viewing?: string[] | null;
}

export function buildUserMessage(utterance: string, ctx: PromptContext): string {
  const today = new Date();
  const dateStr = today.toLocaleDateString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });
  const iso = toIso(today);

  const open = ctx.tasks
    .filter((t) => t.status !== "done")
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, 250)
    .map((t) => {
      const bits = [`${t.id} | ${pathLabel(ctx.lists, t)} | ${t.title} | ${t.status}`];
      if (t.waitingOn) bits.push(`waiting on ${t.waitingOn}`);
      return bits.join(" | ");
    });

  let focus = "";
  if (ctx.focusTask) {
    const t = ctx.focusTask;
    focus = `\n<focus_task>
id: ${t.id}
title: ${t.title}
where: ${pathLabel(ctx.lists, t)}
status: ${STATUSES.find((s) => s.id === t.status)?.label}${t.waitingOn ? ` (waiting on ${t.waitingOn})` : ""}
priority ${t.priority}, effort ${t.effort}, urgency ${t.urgency}${t.dueDate ? `, due ${t.dueDate}` : ""}
tags: ${t.tags.join(", ") || "none"}
checklist: ${t.subtasks.map((s) => `[${s.done ? "x" : " "}] ${s.text}`).join("; ") || "none"}
notes: ${t.notes || "none"}
recent updates:
${t.updates.slice(-8).map((u) => `- ${toIso(new Date(u.at))}: ${u.text}`).join("\n") || "none"}
</focus_task>`;
  }

  return `<context>
today: ${dateStr} (${iso})
default space if unclear: ${SPACES.find((s) => s.id === ctx.defaultSpace)?.name}
currently viewing: ${ctx.viewing?.length ? ctx.viewing.join(" > ") + " (use this list for new tasks when the user doesn't name a list)" : "everything"}

lists:
${outline(ctx.lists)}

existing tags: ${ctx.tags.join(", ") || "none"}

open tasks (id | where | title | status):
${open.join("\n") || "none"}
</context>${focus}

<user_said>
${utterance.trim()}
</user_said>`;
}

export function toIso(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
