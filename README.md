# Brain Dump: a voice-first to-do list

Open it on your phone, tap the mic, and say what's on your mind:

> “Make spreadsheet for Kathy under Transformation, high priority, tag it reporting. Also buy dog food.”

The AI turns that into two tasks, files each under the right list (and creates the list if it doesn't exist), and sets the priority and tags. You see what it understood, then tap **Save**. Every change has an **Undo**.

Open any task and **talk about it**:

> “Right now I'm waiting on Jordan for the report. Yesterday I talked with Michael and he said he'd get me the data on Thursday.”

The task changes to **Waiting · Jordan**. A dated line goes into its progress log ("Waiting on Jordan for the report. Michael will send the data Thu Nov 12."), and a follow-up step is added to its checklist. Whatever you actually said is kept alongside the log entry.

**Paste or screenshot anything.** Paste an email, or tap 📎 and pick a screenshot of a text thread. The AI works out what you need to do (or who you're waiting on), files each item in the right topic, and puts the key details and who it came from in the notes.

**Give each topic a background doc.** Open a topic's 📄 **Background** and ramble about it: what it is, who's involved, nicknames. Tap **✨ Organize** and it becomes a tidy brief. The AI reads these briefs every time, so "send Cathy the numbers" lands in Transformation because the brief says Kathy is its sponsor.

## Features

- **Two main branches, Work and Personal**, with lists and sub-lists nested as deep as you like. Lists can be closed (archived) and reopened.
- **Capture by voice or typing**, on your phone or computer. You can add several to-dos at once, name the list ("under X", "add to X") and say the priority, effort, urgency, tags, due date ("next Tuesday"), links or checklist steps. New tasks go into the list you're currently looking at unless you name another.
- **Screenshots and pasted text**: tap 📎 (or paste / drag an image in) to attach screenshots. Long scrolling screenshots are cut into readable pieces. Paste whole emails or chat logs into the box. Works in the main bar and inside a task ("here's Jordan's reply").
- **Background docs**: one for **About me**, one each for **Work** and **Personal**, and one for every list. Talk or type, then **✨ Organize**. You can also add to them from the main bar ("for Transformation, Lisa is taking over the vendor side"). The AI uses them to route to-dos and to fix mis-heard names.
- **Updates by voice**: mark tasks done, say who you're waiting on, move tasks, add notes. This works from the main bar or from inside a task.
- **Repeating tasks**: every N days/weeks/months/years; specific weekdays (Mon/Wed/Fri, weekdays, every other Tuesday); a day of the month (clamped for short months), the Nth or last weekday ("2nd Tuesday", "last Friday"), or the last day of the month; yearly on a date or "4th Thursday of November"; counted from the due date or from when you finish it ("3 months after I last changed the filter"); ending never, on a date, or after N times. Say it ("pay rent on the 1st of every month") or pick it in the task panel. Checking one off moves it to its next date, resets its checklist and logs the completion (with Undo).
- **Task fields**: status (to do, in progress, waiting on someone, blocked, done), waiting on, priority, effort and urgency (each 1–10), tags, links, checklist, notes, progress log and due date.
- **Priority score** from 0 to 100: `priority × urgency × (11 − effort) ÷ 10`. Important, urgent and easy tasks rise to the top.
- **Views**
  - **Lists**: the full tree, grouped and collapsible, with quick-add in every list.
  - **Focus**: every task in one ranked list, with presets: 🔥 Top, ⚡ Quick wins, ⏳ Waiting on (grouped by person), ▶ In progress, 📅 Due soon, ✅ Recently done.
  - **Board**: Kanban columns by status. Drag cards on desktop, or change the status from a menu on phone.
  - **Matrix**: Eisenhower grid (important/urgent) built from your priority and urgency scores.
  - **Mind map**: Everything → Work and Personal → lists → tasks. You can pan, zoom, fold lists and tap a task to open it.
- **Sorting** in every view by score, priority, urgency, effort, due date, recently updated, newest or A→Z. You can also search and filter by tag.
- **AI provider choice**: Claude (default **Haiku 5.5** at **high** effort), **OpenRouter** or **DeepInfra**. The model picker loads each provider's live model list with prices per 1M tokens and lets you search and sort by price.
- **Firebase sync** (Firestore and Auth) across your devices. It works offline and catches up when you reconnect. Without Firebase it runs in local-only mode.
- **Installable PWA**: add it to your home screen and it runs full-screen like a native app.
- **Hosted on GitHub Pages** at <https://fitzgerald21.github.io/to-do-list/>, redeployed on every push (see `.github/workflows/pages.yml`).
- **Backup**: export and import everything as JSON.

## Quick start

```bash
npm install
npm run dev
```

To set up Firebase sync, deploy, install on your phone and add API keys, see **[SETUP.md](SETUP.md)**.

## Development

```bash
npm test          # unit tests (parser, path matching, scoring, apply/undo)
npm run build     # type-check + production build
npm run deploy    # build + firebase deploy
```

Code layout:

```
src/
  App.tsx                 layout, scope (Everything / space / list), views
  types.ts                data model
  state/store.ts          data + settings store (optimistic, backend-agnostic)
  lib/storage/            local (browser) and Firebase backends
  lib/ai/prompt.ts        system prompt + context sent to the model
  lib/ai/schema.ts        JSON schema for the model's actions + normaliser
  lib/ai/providers.ts     Claude (Anthropic SDK), OpenRouter, DeepInfra
  lib/ai/models.ts        model lists + prices
  lib/ai/interpret.ts     run the AI, preview, apply with undo
  lib/ai/fallback.ts      no-key offline parser
  lib/recurrence.ts       repeat rules: next date, presets, plain-English labels
  lib/images.ts           shrink / slice screenshots before sending
  components/ContextPanel background ("About") doc editor
  lib/speech.ts           continuous dictation (Web Speech API)
  lib/score.ts, tree.ts   score/sorting, list tree + fuzzy path matching
  components/             UI
```

## Ideas borrowed from other apps

| App | Idea | Here |
|---|---|---|
| Todoist | Natural-language quick add | Voice and AI capture |
| Things 3 | Areas and projects | Work/Personal → nested lists |
| TickTick | Eisenhower matrix | Matrix view |
| Trello / Linear | Status board | Board view |
| GTD ("Waiting For" list) | Track what you're waiting on | Waiting status, plus the Focus → Waiting on view |
| MindNode / XMind | Mind map | Mind map view |

Ideas for later: an Android share-sheet target (share a screenshot straight into the app), PDF attachments, reminders and notifications, a Today/Upcoming calendar view, sharing a list with someone, a weekly AI review ("what's stale, what's waiting too long"), and Siri Shortcut / Android share-sheet capture.
