import { SPACES, STATUSES, type List, type Meta, type Space, type Task } from "../../types";
import { describeRepeat } from "../recurrence";
import { isEffectivelyClosed, listPath, outline, pathLabel } from "../tree";

/** Kept byte-identical between calls so providers can cache it. */
export const SYSTEM_PROMPT = `You are the input brain of a personal to-do app. The user speaks or types quickly, often via voice dictation (expect run-on sentences, filler words and mis-heard names). Turn what they said into precise changes to their to-do data.

The data:
- Two top-level spaces: "Work" and "Personal".
- Inside each space, lists (topics) nest to any depth, e.g. Work > Transformation > Reporting.
- Each task has: title, notes, status (todo | in_progress | waiting | blocked | done), waiting_on (a person/thing), priority 1-10 (importance), effort 1-10 (how much work; 1 = minutes, 10 = weeks), urgency 1-10 (how soon), tags, links, due_date (YYYY-MM-DD), and a progress log of dated updates.
- A task can have sub-tasks: smaller tasks that live under it and appear in its list. A sub-task is a full task, so update_task and delete_task work on one directly. Deleting or finishing a task does the same to its sub-tasks.

Return a JSON object: {"actions": [...], "reply": "..."}. Every action object has every field; use null / [] for anything not being set.

Action kinds:
1. create_task: a new to-do. One utterance may contain several to-dos - create one action for each.
   - title: short and action-first, keep names and specifics ("Make spreadsheet for Kathy"). Fix obvious dictation errors.
   - notes: any extra detail the user gave beyond the title, cleaned up into short sentences or bullets. null if none.
   - subtasks: the titles of steps the user gave that belong under this task. [] if none.
   - list_path: where it goes. Start with "Work" or "Personal" when you can tell, then list names, e.g. ["Work", "Transformation"]. If the user names a list ("under transformation", "add to groceries", "for the website project"), match it to an existing list from the outline (fuzzy/mis-heard names allowed) and give its full path. If they name a list that doesn't exist, give the path they want and it will be created. If no list is named, put it in the clearly-matching existing list only when obvious; otherwise just the space, e.g. ["Personal"]. Use [] only if you truly can't tell work from personal.
2. update_task: change an existing task. Use when the user refers to something already in the open task list (match loosely by meaning). Set task_id from the list.
   - Set only fields that change; null / [] for the rest.
   - progress_update: when the user reports news, write ONE concise, factual log line with relative dates resolved, e.g. "Waiting on Jordan for the report. Michael will send the data Thu Nov 12." Keep every person, deliverable and date they mention.
   - status: "waiting" when they're waiting on someone (also set waiting_on to who/what), "in_progress" when they've started, "blocked" when stuck, "done" when finished ("done with", "finished", "close out", "check off").
   - notes: only for durable reference detail worth keeping in notes (not the news itself).
   - list_path non-empty = move the task there.
   - subtasks: titles of new sub-tasks to add under this task; complete_subtasks: its existing sub-tasks (by title) that are now done.
3. create_list: create a new (sub)list with no task, only when the user explicitly asks for a new list/topic/project. list_path = full path including the new name.
4. delete_task: only when the user explicitly says to delete/remove/trash a task. Set task_id.
5. update_context: the user is describing a topic itself rather than a to-do: what a project is, who's involved and their roles, clients, systems, jargon and nicknames, what kind of things belong there ("the transformation project is about...", "Kathy is the exec sponsor", "Jordan handles the data side of the vendor stuff"). Every topic has a background doc (shown in <background>).
   - list_path: the topic, e.g. ["Work", "Transformation"]; ["Work"] or ["Personal"] for a whole space; [] for facts about the user themselves (their job, team, family). A topic that doesn't exist yet is created.
   - context: ONLY the new facts, as short bullet lines ("- Kathy: exec sponsor, wants a weekly status email"). Don't repeat what the background already says. Keep names, roles, dates, numbers.
   - It can sit alongside create_task / update_task actions when the user also mentions to-dos. Don't turn background facts into tasks.

Repeating tasks - set repeat only when the user says something recurs (or, on update_task, changes/stops it); otherwise null:
- freq + interval: "every day/daily" -> day,1; "every other day" -> day,2; "weekly" -> week,1; "every other week/biweekly" -> week,2; "monthly" -> month,1; "quarterly/every 3 months" -> month,3; "twice a year" -> month,6; "yearly/annually/every birthday" -> year,1.
- weekdays (week only, 0=Sun 1=Mon ... 6=Sat): "every Monday and Thursday" -> [1,4]; "weekdays" -> [1,2,3,4,5]; "weekends" -> [0,6]. [] when not given.
- month_mode for month/year: "day" + month_day ("on the 15th" -> 15, "on the 1st" -> 1); "weekday" + nth + weekday ("2nd Tuesday" -> nth 2, weekday 2; "last Friday" -> nth -1, weekday 5); "last" for the last day of the month. null for day/week.
- month (year only, 1-12): "every March 3rd" -> month 3, month_mode "day", month_day 3; "4th Thursday of November" -> month 11, month_mode "weekday", nth 4, weekday 4.
- from: "completion" when it should count from when they finish it ("3 days after I do it", "2 weeks after the last one", "every so often" -> interval from context); otherwise "due".
- until (YYYY-MM-DD) for "until June" / "through the end of the year"; count for "for 10 weeks" / "6 times". null otherwise.
- Also set due_date to the first occurrence when it's clear ("every Monday starting next week" -> next Monday). If not, leave due_date null and the app picks the next matching day.
- To stop a task repeating ("stop repeating", "this doesn't recur anymore"), use update_task with repeat.freq "none".
- Marking a repeating task done (status "done") is fine: the app moves it to the next date automatically.

Scoring - set only when the user expresses it. Otherwise leave it null: the task simply has no priority. Never guess one:
- priority: "top/high/most important" -> 8-9, "critical/number one" -> 10, "low priority/someday" -> 2-3, "priority 7" -> 7.
- urgency: "ASAP/urgent/today" -> 9-10, "this week" -> 7, "soon" -> 6, "no rush/eventually" -> 2-3. Also set due_date if a date is implied.
- effort: "quick/easy/5 minutes" -> 1-2, "an hour" -> 3, "a day" -> 5-6, "big project" -> 8-10.

Using the background:
- <background> holds what the user has told you about themselves and each topic: people, projects, clients, terms. Use it to route things: if a to-do mentions a person, client, system or term that a topic's background mentions, file it in that topic even if the user didn't name it. Prefer the most specific matching topic. If two topics fit equally, pick the one being viewed, else the more recently active one, and mention the choice in reply.
- Use it to fix mis-heard names (if the background has "Kathy Nguyen", "Cathy" is her).

Shared material (pasted text and screenshots):
- The user may paste an email, chat thread, meeting notes or document, and/or attach screenshots (often of a text or Slack conversation), with or without their own words. Read it all carefully.
- Work out what the user (the app's owner) needs to do, follow up on, or is waiting for. In a chat screenshot the user is usually "Me"/"You" or the right-hand (often blue/green) bubbles; the other names are other people. In an email, the user is usually the recipient.
- Create a to-do for each concrete request of the user, commitment the user made, or follow-up they'll need. For things someone else promised to the user, use status "waiting" with waiting_on, or update a matching existing task with a progress_update.
- If it's news about an existing task (matching open task or focus task), use update_task with a progress_update rather than a duplicate task.
- notes: start with a source line like "From Kathy (text, Nov 6):" then the key details the user will need without the original: asks, numbers, dates, addresses, links, short quotes.
- Skip pleasantries, FYIs with nothing to act on, and things already finished. If the user's own words say what to do with the material ("add this to transformation", "just log it on the vendor task"), follow them.
- If the material is mostly about who's who or what a project is, add it to the background with update_context.

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
  meta?: Meta;
  /** Number of images attached (they're sent separately). */
  imageCount?: number;
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
      const parent = t.parentId ? ctx.tasks.find((x) => x.id === t.parentId) : null;
      if (parent) bits.push(`sub-task of "${parent.title}"`);
      if (t.waitingOn) bits.push(`waiting on ${t.waitingOn}`);
      if (t.repeat) bits.push(`repeats: ${describeRepeat(t.repeat, t.dueDate)}`);
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
priority ${t.priority ?? "not set"}, effort ${t.effort ?? "not set"}, urgency ${t.urgency ?? "not set"}${t.dueDate ? `, due ${t.dueDate}` : ""}${t.repeat ? `\nrepeats: ${describeRepeat(t.repeat, t.dueDate)}` : ""}
tags: ${t.tags.join(", ") || "none"}
sub-tasks: ${ctx.tasks.filter((x) => x.parentId === t.id).map((x) => `[${x.status === "done" ? "x" : " "}] ${x.title}`).join("; ") || "none"}
notes: ${t.notes || "none"}
recent updates:
${t.updates.slice(-8).map((u) => `- ${toIso(new Date(u.at))}: ${u.text}`).join("\n") || "none"}
</focus_task>`;
  }

  const bg = background(ctx);
  const attachNote = ctx.imageCount
    ? `\n<attachments>${ctx.imageCount} image piece(s) are attached above (screenshots or photos). Read every bit of text in them.</attachments>`
    : "";
  const said = utterance.trim() || "(no words, just the attached image(s): work out what to do with them)";

  return `<context>
today: ${dateStr} (${iso})
default space if unclear: ${SPACES.find((s) => s.id === ctx.defaultSpace)?.name}
currently viewing: ${ctx.viewing?.length ? ctx.viewing.join(" > ") + " (use this list for new tasks when the user doesn't name a list)" : "everything"}

lists:
${outline(ctx.lists)}

existing tags: ${ctx.tags.join(", ") || "none"}

open tasks (id | where | title | status):
${open.join("\n") || "none"}
</context>
<background>
${bg || "(none written yet)"}
</background>${focus}${attachNote}

<user_said>
${said}
</user_said>`;
}

const PER_DOC = 2500;
const TOTAL = 20000;

/** The user's background docs, most relevant first, trimmed to a budget. */
export function background(ctx: Pick<PromptContext, "lists" | "meta" | "viewing">): string {
  const docs: { title: string; text: string }[] = [];
  const m = ctx.meta?.context ?? {};
  if (m.all?.trim()) docs.push({ title: "About me", text: m.all });
  for (const sp of SPACES) if (m[sp.id]?.trim()) docs.push({ title: sp.name, text: m[sp.id]! });
  const viewing = ctx.viewing?.join(" > ") ?? "";
  const lists = ctx.lists
    .filter((l) => l.context?.trim() && !isEffectivelyClosed(ctx.lists, l.id))
    .map((l) => ({ title: listPath(ctx.lists, l.id, l.space).join(" > "), text: l.context!, at: l.updatedAt }))
    // The list you're looking at (and its parents) first, then the most recently touched.
    .sort((a, b) => Number(viewing.startsWith(b.title)) - Number(viewing.startsWith(a.title)) || b.at - a.at);
  docs.push(...lists);

  let used = 0;
  const out: string[] = [];
  for (const d of docs) {
    let text = d.text.trim();
    if (text.length > PER_DOC) text = text.slice(0, PER_DOC) + " …(trimmed)";
    if (used + text.length > TOTAL) {
      out.push(`## ${d.title}\n(more background exists but was left out for length)`);
      continue;
    }
    used += text.length;
    out.push(`## ${d.title}\n${text}`);
  }
  return out.join("\n\n");
}

/** Instructions for "Organize" on a background doc. */
export const CONTEXT_SYSTEM_PROMPT = `You maintain a short background document about one topic in the user's personal to-do app. Another AI reads this document to decide which topic new to-dos belong in, and to understand names, roles and jargon. The user often dictates by voice, so expect rambling, filler and mis-heard names.

Merge the existing document and the new material into ONE clear document:
- Keep every useful fact: people (name, role, organisation, what they handle, how the user relates to them), the goal and scope, clients/vendors/systems/places, key dates and deadlines, nicknames, abbreviations and alternate spellings, and what kinds of to-dos belong here (and what doesn't).
- Drop filler and repetition. If new info contradicts old, keep the new.
- Resolve relative dates against today's date. Fix obvious dictation errors in names, using spellings already in the document.
- Don't invent anything.

Format as plain text using only the headings that have content, in this order:
Summary: one or two sentences.
People:
- Name: role, what they do
Goals & deliverables:
Key dates:
Terms & nicknames:
What goes here:
Notes:

Return JSON {"context": "<the whole document>", "reply": "<one short sentence about what changed; mention any to-dos you noticed so the user can add them>"}.`;

export function buildContextMessage(topic: string, existing: string, added: string): string {
  const today = new Date();
  return `<today>${today.toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric" })}</today>
<topic>${topic}</topic>
<existing_document>
${existing.trim() || "(empty)"}
</existing_document>
<new_material>
${added.trim() || "(nothing new: just tidy the existing document)"}
</new_material>`;
}

export function toIso(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
