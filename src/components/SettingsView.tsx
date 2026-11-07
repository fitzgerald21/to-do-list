import { useEffect, useMemo, useState } from "react";
import type { User } from "firebase/auth";
import { fetchModels, formatPrice, type ModelOption } from "../lib/ai/models";
import { PROVIDERS } from "../lib/ai/providers";
import { GROQ_MODELS, testGroqKey } from "../lib/groq";
import { fb, firebaseEnabled } from "../lib/storage/config";
import { getData, saveList, saveMeta, saveTask, updateSettings, useSettings } from "../state/store";
import { toast } from "../state/ui";
import { SPACES, type List, type Meta, type ProviderId, type Settings, type Task } from "../types";

function ModelPicker({ provider, apiKey, value, onChange }: { provider: ProviderId; apiKey: string; value: string; onChange: (id: string) => void }) {
  const [models, setModels] = useState<ModelOption[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [sort, setSort] = useState<"price" | "name">("price");
  const [open, setOpen] = useState(false);

  const load = (force = false) => {
    setErr(null);
    setModels(null);
    fetchModels(provider, apiKey, force)
      .then(setModels)
      .catch((e) => setErr(String(e.message ?? e)));
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => load(), [provider, apiKey ? 1 : 0]);

  const filtered = useMemo(() => {
    if (!models) return [];
    const words = q.toLowerCase().split(/\s+/).filter(Boolean);
    const out = models.filter((m) => words.every((w) => (m.id + " " + m.name).toLowerCase().includes(w)));
    return out.sort((a, b) =>
      sort === "name" ? a.name.localeCompare(b.name) : (a.inPrice ?? 1e9) + (a.outPrice ?? 1e9) - ((b.inPrice ?? 1e9) + (b.outPrice ?? 1e9)),
    );
  }, [models, q, sort]);

  const current = models?.find((m) => m.id === value);

  return (
    <div className="model-picker">
      <button className="model-current" onClick={() => setOpen(!open)}>
        <span>
          <b>{current?.name ?? (value || "Choose a model")}</b>
          <span className="muted small"> {current ? formatPrice(current) : value ? "" : ""}</span>
        </span>
        <span>{open ? "▴" : "▾"}</span>
      </button>
      {open && (
        <div className="model-list">
          <div className="model-tools">
            <input autoFocus placeholder={`Search ${models?.length ?? ""} models…`} value={q} onChange={(e) => setQ(e.target.value)} />
            <select value={sort} onChange={(e) => setSort(e.target.value as "price" | "name")}>
              <option value="price">Cheapest first</option>
              <option value="name">A → Z</option>
            </select>
            <button className="icon-btn" title="Refresh list" onClick={() => load(true)}>
              ⟳
            </button>
          </div>
          {err && <div className="error-text small">{err}</div>}
          {!models && !err && <div className="muted small pad">Loading models…</div>}
          <div className="model-scroll">
            {filtered.slice(0, 300).map((m) => (
              <button
                key={m.id}
                className={`model-opt ${m.id === value ? "active" : ""}`}
                onClick={() => {
                  onChange(m.id);
                  setOpen(false);
                }}
              >
                <span className="model-name">
                  {m.name}
                  {m.vision && <span title="Can read screenshots"> 👁</span>}
                  <span className="muted small"> {m.id !== m.name ? m.id : ""}</span>
                </span>
                <span className="model-price">{formatPrice(m)}</span>
              </button>
            ))}
          </div>
          <input
            className="custom-model"
            placeholder="…or type an exact model id and press Enter"
            onKeyDown={(e) => {
              if (e.key === "Enter" && e.currentTarget.value.trim()) {
                onChange(e.currentTarget.value.trim());
                setOpen(false);
              }
            }}
          />
        </div>
      )}
    </div>
  );
}

export function SettingsView({ user }: { user: User | null }) {
  const s = useSettings();
  const set = (patch: Partial<Settings>) => updateSettings(patch);
  const provider = PROVIDERS.find((p) => p.id === s.provider)!;
  const [showKey, setShowKey] = useState(false);

  const exportData = () => {
    const { lists, tasks, meta } = getData();
    const blob = new Blob([JSON.stringify({ version: 1, exportedAt: new Date().toISOString(), lists, tasks, meta }, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `brain-dump-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const importData = async (file: File) => {
    try {
      const d = JSON.parse(await file.text()) as { lists?: List[]; tasks?: Task[]; meta?: Meta };
      const lists = d.lists ?? [];
      const tasks = d.tasks ?? [];
      if (!window.confirm(`Import ${lists.length} lists and ${tasks.length} tasks? Items with the same id are overwritten.`)) return;
      for (const l of lists) await saveList(l);
      for (const t of tasks) await saveTask(t);
      if (d.meta?.context) await saveMeta({ ...getData().meta, context: { ...getData().meta.context, ...d.meta.context }, updatedAt: Date.now() });
      toast(`Imported ${lists.length} lists and ${tasks.length} tasks.`);
    } catch (e) {
      toast(`Import failed: ${(e as Error).message}`, { error: true });
    }
  };

  return (
    <div className="view settings">
      <section className="card-section">
        <h2>🤖 AI</h2>
        <p className="muted small">
          The AI turns what you say into tasks and updates. Your API key is stored on this device
          {firebaseEnabled ? " (and in your private Firestore doc if you turn on sync below)" : ""} and sent only to the provider you pick.
        </p>
        <div className="seg">
          {PROVIDERS.map((p) => (
            <button key={p.id} className={s.provider === p.id ? "active" : ""} onClick={() => set({ provider: p.id })}>
              {p.name}
            </button>
          ))}
        </div>

        <label className="field">
          {provider.name} API key{" "}
          <a href={provider.keyUrl} target="_blank" rel="noreferrer" className="small">
            get one ↗
          </a>
          <div className="key-row">
            <input
              type={showKey ? "text" : "password"}
              placeholder={provider.keyHint}
              value={s.keys[s.provider]}
              onChange={(e) => set({ keys: { ...s.keys, [s.provider]: e.target.value.trim() } })}
              autoComplete="off"
            />
            <button className="btn" onClick={() => setShowKey(!showKey)}>
              {showKey ? "Hide" : "Show"}
            </button>
          </div>
        </label>

        <div className="field">
          Model
          <ModelPicker
            provider={s.provider}
            apiKey={s.keys[s.provider]}
            value={s.models[s.provider]}
            onChange={(id) => set({ models: { ...s.models, [s.provider]: id } })}
          />
        </div>

        {s.provider === "anthropic" && (
          <label className="field">
            Effort (how hard Claude thinks)
            <select value={s.effort} onChange={(e) => set({ effort: e.target.value as Settings["effort"] })}>
              <option value="low">Low — fastest</option>
              <option value="medium">Medium</option>
              <option value="high">High — default</option>
              <option value="xhigh">Extra high</option>
              <option value="max">Max — slowest</option>
            </select>
          </label>
        )}

        <label className="toggle">
          <input type="checkbox" checked={s.reviewBeforeSaving} onChange={(e) => set({ reviewBeforeSaving: e.target.checked })} />
          Show me what the AI understood before saving
        </label>
        {!s.reviewBeforeSaving && <p className="muted small">Changes save instantly — tap Undo on the pop-up if it got something wrong.</p>}
      </section>

      <section className="card-section">
        <h2>🎙 Capture</h2>
        <label className="field">
          When I don't say Work or Personal, assume
          <select value={s.defaultSpace} onChange={(e) => set({ defaultSpace: e.target.value as Settings["defaultSpace"] })}>
            {SPACES.map((sp) => (
              <option key={sp.id} value={sp.id}>
                {sp.name}
              </option>
            ))}
          </select>
        </label>
        <GroqVoice />
        <label className="field">
          Voice language
          <select value={s.speechLang} onChange={(e) => set({ speechLang: e.target.value })}>
            {["en-US", "en-GB", "en-AU", "en-CA", "en-IN", "es-ES", "es-MX", "fr-FR", "de-DE", "pt-BR", "it-IT"].map((l) => (
              <option key={l}>{l}</option>
            ))}
          </select>
        </label>
      </section>

      <section className="card-section">
        <h2>☁️ Sync & account</h2>
        {firebaseEnabled ? (
          <>
            <p>
              Signed in as <b>{user?.email ?? user?.displayName ?? "you"}</b>. Your lists sync across every device you sign in on, and work
              offline.
            </p>
            <label className="toggle">
              <input type="checkbox" checked={s.syncKeys} onChange={(e) => set({ syncKeys: e.target.checked })} />
              Sync my AI settings &amp; API keys to my other devices
            </label>
            <p className="muted small">Stored in your own Firestore document, readable only by your account.</p>
            <button className="btn" onClick={() => void fb().then((m) => m.logOut())}>
              Sign out
            </button>
          </>
        ) : (
          <div className="notice">
            <b>Local mode:</b> everything is saved in this browser only. To sync your phone and computer, connect Firebase — see{" "}
            <code>SETUP.md</code> in the project (about 10 minutes, free).
          </div>
        )}
      </section>

      <section className="card-section">
        <h2>💾 Backup</h2>
        <div className="row-gap">
          <button className="btn" onClick={exportData}>
            Export JSON
          </button>
          <label className="btn">
            Import JSON
            <input type="file" accept="application/json" hidden onChange={(e) => e.target.files?.[0] && void importData(e.target.files[0])} />
          </label>
        </div>
      </section>

      <section className="card-section">
        <h2>ℹ️ How the score works</h2>
        <p className="small">
          <b>Score = priority × urgency × (11 − effort) ÷ 10</b>, from 0 to 100. Important, urgent, <i>easy</i> things rise to the top;
          a huge low-priority project sinks. Sort by it in any view, or use Focus → 🔥 Top / ⚡ Quick wins.
        </p>
      </section>
    </div>
  );
}

/** Groq Whisper key + model for dictation. */
function GroqVoice() {
  const s = useSettings();
  const [show, setShow] = useState(false);
  const [testing, setTesting] = useState(false);
  const has = !!s.groqKey.trim();
  return (
    <>
      <label className="field">
        Groq API key for dictation (optional){" "}
        <a href="https://console.groq.com/keys" target="_blank" rel="noreferrer" className="small">
          get one ↗
        </a>
        <div className="key-row">
          <input
            type={show ? "text" : "password"}
            placeholder="gsk_…"
            value={s.groqKey}
            onChange={(e) => updateSettings({ groqKey: e.target.value.trim() })}
            autoComplete="off"
          />
          <button className="btn" onClick={() => setShow(!show)}>
            {show ? "Hide" : "Show"}
          </button>
          <button
            className="btn"
            disabled={!has || testing}
            onClick={async () => {
              setTesting(true);
              try {
                await testGroqKey(s.groqKey.trim());
                toast("Groq key works. 🎙 now uses Whisper.");
              } catch (e) {
                toast((e as Error).message, { error: true, ms: 7000 });
              } finally {
                setTesting(false);
              }
            }}
          >
            {testing ? "Testing…" : "Test"}
          </button>
        </div>
      </label>
      {has ? (
        <label className="field">
          Whisper model
          <select value={s.groqModel} onChange={(e) => updateSettings({ groqModel: e.target.value })}>
            {GROQ_MODELS.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
        </label>
      ) : null}
      <p className="muted small" style={{ marginTop: 0 }}>
        {has
          ? "🎙 records what you say and Groq's Whisper writes it out when you tap ■. It's better with names and long rambles, but the text appears when you stop, not while you talk. Without internet it falls back to your browser's voice typing."
          : "Without a Groq key, 🎙 uses your browser's built-in voice typing. Add a key to use Whisper, which is more accurate, especially with names."}
      </p>
    </>
  );
}
