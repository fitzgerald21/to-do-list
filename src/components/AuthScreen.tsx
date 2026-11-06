import { useState } from "react";
import { fb } from "../lib/storage/config";

export function AuthScreen() {
  const [email, setEmail] = useState("");
  const [pw, setPw] = useState("");
  const [create, setCreate] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const run = async (fn: () => Promise<unknown>) => {
    setErr(null);
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      setErr((e as Error).message.replace("Firebase: ", ""));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="auth">
      <div className="auth-card">
        <img src={`${import.meta.env.BASE_URL}icon.svg`} alt="" width={64} height={64} />
        <h1>Brain Dump</h1>
        <p className="muted">Say it, and it's on your list. Sign in to sync your phone and computer.</p>
        <button className="btn primary wide" disabled={busy} onClick={() => run(async () => (await fb()).signInGoogle())}>
          Continue with Google
        </button>
        <div className="or">or</div>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void run(async () => (await fb()).signInEmail(email, pw, create));
          }}
        >
          <input type="email" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" required />
          <input
            type="password"
            placeholder="Password"
            value={pw}
            onChange={(e) => setPw(e.target.value)}
            autoComplete={create ? "new-password" : "current-password"}
            required
            minLength={6}
          />
          <button className="btn wide" disabled={busy} type="submit">
            {create ? "Create account" : "Sign in with email"}
          </button>
        </form>
        <button className="link" onClick={() => setCreate(!create)}>
          {create ? "I already have an account" : "New here? Create an account"}
        </button>
        {err && <p className="error-text">{err}</p>}
      </div>
    </div>
  );
}
