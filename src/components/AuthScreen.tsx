import { useState } from "react";
import { fb } from "../lib/storage/config";

export function AuthScreen({ deniedEmail }: { deniedEmail?: string }) {
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
        {deniedEmail ? (
          <>
            <p className="muted">{deniedEmail} doesn't have access to this app.</p>
            <button className="btn primary wide" disabled={busy} onClick={() => run(async () => (await fb()).logOut())}>
              Sign out
            </button>
          </>
        ) : (
          <>
            <p className="muted">Say it, and it's on your list. Sign in to sync your phone and computer.</p>
            <button className="btn primary wide" disabled={busy} onClick={() => run(async () => (await fb()).signInGoogle())}>
              Continue with Google
            </button>
          </>
        )}
        {err && <p className="error-text">{err}</p>}
      </div>
    </div>
  );
}
