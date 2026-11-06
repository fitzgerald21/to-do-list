# Brain Dump: a voice-first to-do list

Open it on your phone, tap the mic, and say what's on your mind:

> “Make spreadsheet for Kathy under Transformation, high priority, tag it reporting. Also buy dog food.”

The AI turns that into two tasks, files each under the right list (and creates the list if it doesn't exist), and sets the priority and tags. You see what it understood, then tap **Save**. Every change has an **Undo**.

Open any task and **talk about it**:

> “Right now I'm waiting on Jordan for the report. Yesterday I talked with Michael and he said he'd get me the data on Thursday.”

The task changes to **Waiting · Jordan**. A dated line goes into its progress log ("Waiting on Jordan for the report. Michael will send the data Thu Nov 12."), and a follow-up step is added to its checklist. Whatever you actually said is kept alongside the log entry.

## Features

- **Two main branches, Work and Personal**, with lists and sub-lists nested as deep as you like. Lists can be closed (archived) and reopened.
- **Capture by voice or typing**, on your phone or computer. You can add several to-dos at once, name the list ("under X", "add to X") and say the priority, effort, urgency, tags, due date ("next Tuesday"), links or checklist steps. New tasks go into the list you're currently looking at unless you name another.
- **Updates by voice**: mark tasks done, say who you're waiting on, move tasks, add notes. This works from the main bar or from inside a task.
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

Ideas for later: recurring tasks, reminders and notifications, a Today/Upcoming calendar view, sharing a list with someone, a weekly AI review ("what's stale, what's waiting too long"), and Siri Shortcut / Android share-sheet capture.
