import { useEffect, useRef, useState } from "react";
import { organizeContext } from "../lib/ai/interpret";
import { useDictation } from "../lib/speech";
import { listPath } from "../lib/tree";
import { getContext, setContext, useData, useSettings } from "../state/store";
import { toast } from "../state/ui";
import { SPACES, type List, type Place } from "../types";

export function placeName(p: Place, lists: List[]): { name: string; path: string } {
  if (p.kind === "all") return { name: "About me", path: "Everything" };
  if (p.kind === "space") {
    const sp = SPACES.find((s) => s.id === p.space)!;
    return { name: sp.name, path: sp.name };
  }
  const l = lists.find((x) => x.id === p.id);
  return { name: l?.name ?? "List", path: l ? listPath(lists, l.id, l.space).join(" › ") : "" };
}

const EXPLAIN: Record<Place["kind"], string> = {
  all: "Tell the AI about you: your job and team, your boss, family, and people you mention a lot. It reads this every time you add something.",
  space: "What this part of your life covers: company or team, main projects, the people in it.",
  list: "What this topic is, who's involved and what they do, nicknames and jargon, and what kinds of to-dos belong here. The AI reads it to decide where things go.",
};

const EXAMPLE: Record<Place["kind"], string> = {
  all: "e.g. I'm an operations manager at Acme. My boss is Priya. My wife is Sam, kids are Leo and Maya. “The office” means the Denver site.",
  space: "e.g. I run operations at Acme. Big projects right now are the ERP transformation and the office move. My team is Jordan, Lisa and Tom.",
  list: "e.g. This is the ERP transformation program, go-live in March. Kathy Nguyen is the exec sponsor and wants a status email every Friday. Jordan runs the data migration. Michael is our contact at the vendor. People call it “TP” or “the program”.",
};

/** Slide-over editor for a topic's background doc. Talk or type, then Organize. */
export function ContextPanel({ place, onClose }: { place: Place; onClose: () => void }) {
  const { lists } = useData();
  const settings = useSettings();
  const saved = getContext(place);
  const [doc, setDoc] = useState(saved);
  const [before, setBefore] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const dict = useDictation(settings.speechLang, setDoc);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const { name, path } = placeName(place, lists);
  const hasKey = !!settings.keys[settings.provider]?.trim();

  const docRef = useRef(doc);
  docRef.current = doc;
  const close = () => {
    dict.stop();
    const v = docRef.current.trim();
    if (v !== getContext(place).trim()) {
      void setContext(place, v);
      toast(`Saved background for ${name}.`);
    }
    onClose();
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const organize = async () => {
    if (dict.listening) dict.stop();
    setBusy(true);
    setNote(null);
    try {
      // Anything typed/said after the saved doc is the "new material".
      const base = saved.trim();
      const cur = doc.trim();
      const [existing, added] = base && cur.startsWith(base) ? [base, cur.slice(base.length)] : ["", cur];
      const r = await organizeContext(path, existing, added);
      setBefore(doc);
      setDoc(r.context);
      setNote(r.reply || "Organized. Check it over, then close to save.");
    } catch (e) {
      toast((e as Error).message, { error: true, ms: 7000 });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="detail-wrap" onClick={close}>
      <aside className="detail" onClick={(e) => e.stopPropagation()}>
        <header className="detail-head">
          <div style={{ flex: 1 }}>
            <div className="muted small">📄 Background</div>
            <div className="detail-title" style={{ padding: 0 }}>
              {name}
            </div>
            {place.kind === "list" && <div className="path">{path}</div>}
          </div>
          <button className="icon-btn" onClick={close} aria-label="Close">
            ✕
          </button>
        </header>
        <div className="detail-body">
          <p className="about-explain">{EXPLAIN[place.kind]} Just ramble. Tap ✨ Organize and the AI turns it into a tidy brief.</p>
          <div className="about-tools">
            <button
              className={`btn ${dict.listening ? "danger" : ""}`}
              onClick={() => {
                if (dict.listening) dict.stop();
                else {
                  dict.start(doc);
                  setTimeout(() => {
                    const ta = taRef.current;
                    if (ta) ta.scrollTop = ta.scrollHeight;
                  }, 0);
                }
              }}
              disabled={busy}
            >
              {dict.listening ? "■ Stop" : "🎙 Talk"}
            </button>
            <button className="btn primary" onClick={() => void organize()} disabled={busy || !doc.trim() || !hasKey} title={hasKey ? "" : "Needs an AI key (Settings)"}>
              {busy ? "Organizing…" : "✨ Organize"}
            </button>
            {before !== null && (
              <button
                className="btn"
                onClick={() => {
                  setDoc(before);
                  setBefore(null);
                  setNote(null);
                }}
              >
                Undo organize
              </button>
            )}
            <span className="grow" />
            <button className="btn" onClick={close}>
              Done
            </button>
          </div>
          {dict.listening && <div className="hint">Listening… keep talking, tap ■ Stop when you're done.</div>}
          {dict.error && <div className="error-text small">{dict.error}</div>}
          {note && <div className="about-note">{note}</div>}
          <textarea
            ref={taRef}
            className="about-doc"
            value={doc}
            onChange={(e) => setDoc(e.target.value)}
            placeholder={EXAMPLE[place.kind]}
            disabled={busy}
          />
          <p className="muted small" style={{ margin: 0 }}>
            You can also add to this from the main bar: “for Transformation, Lisa is taking over the vendor side.” Saves when you close.
          </p>
        </div>
      </aside>
    </div>
  );
}

/** Compact strip at the top of a view: preview of the background doc, tap to edit. */
export function AboutCard({ place, onOpen }: { place: Place; onOpen: (p: Place) => void }) {
  const { lists, meta } = useData();
  void meta; // re-render when space/about-me docs change
  const text = getContext(place).trim();
  const { name } = placeName(place, lists);
  return (
    <button className={`about-card ${text ? "has" : ""}`} onClick={() => onOpen(place)}>
      <span className="about-icon">📄</span>
      <span className="about-text">
        {text ||
          (place.kind === "all"
            ? "Tell the AI about you (your job, team, family) so it files things in the right place."
            : `Add background for ${name}: who's involved, what it's for, nicknames. The AI uses it to file things here.`)}
      </span>
      <span className="about-go">{text ? "Edit" : "Add"} ›</span>
    </button>
  );
}
