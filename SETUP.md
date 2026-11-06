# Setup guide

You can try the app right away with no setup (it saves to your browser only). To get it on your phone **and** computer with your data synced, do the Firebase steps once (about 10 minutes, free tier is plenty).

## The quick way: GitHub Pages

The app is published at **<https://fitzgerald21.github.io/to-do-list/>**. Every push to `main` (or `claude/voice-todo-app`) rebuilds it via `.github/workflows/pages.yml`, which publishes to the `gh-pages` branch.

Out of the box it saves to each browser only. To sync your phone and computer, do steps 1 and 2 below, then in GitHub go to **Settings → Secrets and variables → Actions → Variables** and add the six `VITE_FIREBASE_…` values as repository variables (same names as in `.env.example`). Re-run the workflow (Actions → Deploy to GitHub Pages → Run workflow). Then in Firebase, **Authentication → Settings → Authorized domains → Add** `fitzgerald21.github.io`.

> On the iPhone home-screen app, use **email/password** sign-in. Google sign-in on github.io needs a redirect that Safari blocks from home-screen apps.

## 0. Run it locally

You need [Node.js](https://nodejs.org) 20 or newer.

```bash
npm install
npm run dev
```

Open the URL it prints (e.g. `http://localhost:5173`). With no Firebase config it runs in **local mode**.

## 1. Create a Firebase project

1. Go to <https://console.firebase.google.com> → **Add project**. Name it anything (e.g. `brain-dump`). Google Analytics is optional.
2. **Build → Authentication → Get started.** Enable:
   - **Google** (easiest), and/or
   - **Email/Password** (works best inside the iPhone home-screen app).
3. **Build → Firestore Database → Create database.** Pick a location near you, start in **production mode**.
4. **Project settings (⚙️) → General → Your apps → Web (`</>`)**. Register an app (tick *Also set up Firebase Hosting*). Copy the `firebaseConfig` values.

## 2. Plug in the config

```bash
cp .env.example .env.local
```

Fill in `.env.local` with the values from step 1.4:

```
VITE_FIREBASE_API_KEY=AIza...
VITE_FIREBASE_AUTH_DOMAIN=your-project.firebaseapp.com
VITE_FIREBASE_PROJECT_ID=your-project
VITE_FIREBASE_STORAGE_BUCKET=your-project.firebasestorage.app
VITE_FIREBASE_MESSAGING_SENDER_ID=1234567890
VITE_FIREBASE_APP_ID=1:1234567890:web:abc123
```

(These are not secrets — Firebase web config is meant to be public. Your data is protected by the security rules in `firestore.rules`, which only let you read and write your own data.)

Put your project id in `.firebaserc` too (replace `YOUR-FIREBASE-PROJECT-ID`).

Restart `npm run dev` — you'll now see a sign-in screen.

## 3. Deploy so your phone can reach it (Firebase Hosting, optional if you use GitHub Pages)

```bash
npm install -g firebase-tools
firebase login
npm run deploy        # builds, then uploads the app + security rules
```

It prints a URL like `https://your-project.web.app`. That's your app.

> **Tip for Google sign-in on iPhone:** after the first deploy, change `VITE_FIREBASE_AUTH_DOMAIN` to `your-project.web.app` and deploy again. Then add `your-project.web.app` under **Authentication → Settings → Authorized domains** if it isn't there already. This keeps sign-in on the same domain as the app, which Safari requires.

## 4. Put it on your phone

- **iPhone (Safari):** open your URL → Share → **Add to Home Screen**.
- **Android (Chrome):** open your URL → ⋮ → **Install app** / **Add to Home screen**.

It opens full-screen like a normal app and works offline (changes sync when you're back online).

## 5. Add your AI key

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
