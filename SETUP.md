# Setup guide

The app is published at **<https://fitzgerald21.github.io/to-do-list/>**. Every push to `main` (or `claude/voice-todo-app`) rebuilds it via `.github/workflows/pages.yml`, which publishes to the `gh-pages` branch.

## Firebase: the shared project

Brain Dump lives in the **`come-back-fitz21`** Firebase project, shared with Come back, Little Bites, One Line a Day and Recipe Book. It has its own web app registration ("Brain Dump"). Its config is stored as `VITE_FIREBASE_…` repository variables (**Settings → Secrets and variables → Actions → Variables**), and in `.env.local` for local work. These values aren't secrets: access is controlled by the rules and the authorized domains.

Sharing the project comes with four rules:

- **Rules are shared.** Firestore has one ruleset per project, so `firestore.rules` is kept **identical** in all five repos. If you edit one, copy it to the others. Deploy with `npm run deploy:rules`.
- **Never run a bare deploy of hosting from here.** The project has one Hosting site, and this app doesn't use it. `firebase.json` only lists the rules, so keep it that way.
- **Keep the named Firebase app** in `src/lib/storage/firebase.ts`. All of these apps are on `fitzgerald21.github.io`, so the default app name would share a browser cache and sign-in with the others, on a different SDK version.
- **Only fitzgeraldryan21@gmail.com can use this app's data** (`isBrainDump` in `firestore.rules`). Sign-in is Google only, like the other apps. To add someone, edit the email check in all five repos and redeploy the rules.

Data lives at `users/{uid}/lists`, `users/{uid}/tasks` and `users/{uid}/private/{settings,meta}`, which don't overlap with the other apps.

Anything saved in a browser before sign-in uploads automatically the first time you sign in on that browser. It only adds what the account doesn't already have, and the browser's copy stays in place as a backup.

## Run it locally

You need [Node.js](https://nodejs.org) 20 or newer.

```bash
npm install
npm run dev
```

Open the URL it prints (e.g. `http://localhost:5173`). `localhost` is already an authorized domain. To run without Firebase, in **local mode** where everything saves to the browser, leave the values in `.env.local` blank (see `.env.example`).

## Put it on your phone

- **iPhone (Safari):** open your URL → Share → **Add to Home Screen**.
- **Android (Chrome):** open your URL → ⋮ → **Install app** / **Add to Home screen**.

It opens full-screen like a normal app and works offline (changes sync when you're back online).

## Add your AI key

In the app: **⚙️ Settings → AI**.

| Provider | Where to get a key | Notes |
|---|---|---|
| **Claude (default)** | <https://platform.claude.com/settings/keys> | Default model **Claude Haiku 5.5**, effort **high**. |
| OpenRouter | <https://openrouter.ai/settings/keys> | Hundreds of models; the picker shows live prices. |
| DeepInfra | <https://deepinfra.com/dash/api_keys> | Open models; the picker shows live prices. |

Keys are stored on the device. Turn on **Sync my AI settings & API keys** to have them follow you to your other devices (stored in your own Firestore document, readable only by your account).

Without a key the app still works with a simple built-in parser: `add <task> under <list> priority 8 effort 2 #tag`.

## Voice input notes

- Tap 🎙, talk as long as you like (it keeps listening through pauses), tap ■ to send.
- Uses the browser's built-in speech recognition (Chrome, Edge, Safari). If it isn't available — e.g. Firefox, or some iPhone home-screen setups — just tap the text box and use the **microphone on your phone's keyboard**; it works just as well.
