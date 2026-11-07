import { useMemo, useRef, useState } from "react";
import { applyResult, describe, interpret, type InterpretOptions } from "../lib/ai/interpret";
import type { AiResult } from "../lib/ai/schema";
import { prepareImage, type Attachment } from "../lib/images";
import { whisperPrompt } from "../lib/groq";
import { fmtElapsed, useDictation } from "../lib/speech";
import { getSettings, useData, useSettings } from "../state/store";
import { toast } from "../state/ui";

interface Pending {
  result: AiResult & { offline: boolean };
  raw: string;
  attachments: Attachment[];
  skip: Set<number>;
}

/**
 * Text box + mic. Sends what you said to the AI, shows what it understood,
 * and saves it (with Undo). Used for global capture and for per-task updates.
 */
export function Composer({
  placeholder,
  opts,
  compact = false,
  onApplied,
}: {
  placeholder: string;
  opts: () => InterpretOptions;
  compact?: boolean;
  onApplied?: (touchedTaskIds: string[]) => void;
}) {
  const settings = useSettings();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<Pending | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [dragging, setDragging] = useState(false);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const addFiles = async (files: Iterable<File>) => {
    const imgs = [...files].filter((f) => f.type.startsWith("image/") || /\.(heic|heif)$/i.test(f.name));
    if (!imgs.length) return;
    setExpanded(true);
    for (const f of imgs) {
      try {
        const a = await prepareImage(f, f.name && f.name !== "image.png" ? f.name : "screenshot");
        setAttachments((cur) => [...cur, a].slice(0, 6));
      } catch {
        toast(`Couldn't open ${f.name || "that image"}. Try a PNG or JPEG screenshot.`, { error: true });
      }
    }
  };
  const { lists, tasks } = useData();
  // Names Whisper should spell right: your lists, plus people you're waiting on.
  const hint = useMemo(
    () => whisperPrompt([...lists.map((l) => l.name), ...tasks.filter((t) => t.status !== "done").map((t) => t.waitingOn ?? "")]),
    [lists, tasks],
  );
  const dict = useDictation(settings.speechLang, setText, hint);

  const commit = async (p: Pending) => {
    const n0 = p.attachments.length;
    const raw = n0 ? `${p.raw}${p.raw ? " " : ""}[${n0} screenshot${n0 === 1 ? "" : "s"}]` : p.raw;
    const receipt = await applyResult(p.result, { raw, focusTaskId: opts().focusTaskId, skip: p.skip });
    setPending(null);
    const n = p.result.actions.length - p.skip.size;
    toast(p.result.reply || `Saved ${n} change${n === 1 ? "" : "s"}.`, {
      action: {
        label: "Undo",
        run: () => {
          void receipt.undo();
          toast("Undone.");
        },
      },
    });
    onApplied?.(receipt.touchedTaskIds);
  };

  const submit = async (value = text) => {
    if (busy || dict.transcribing) return;
    if (dict.listening) {
      const said = await dict.stop();
      if (said === null) return; // transcription failed; the recording is kept for Retry
      value = said;
    }
    return send(value);
  };

  /** Send text (already transcribed) to the AI. */
  const send = async (value: string) => {
    const raw = value.trim();
    if (!raw && !attachments.length) return;
    setBusy(true);
    const atts = attachments;
    try {
      const result = await interpret(raw, opts(), atts);
      setText("");
      setAttachments([]);
      setExpanded(false);
      if (!result.actions.length) {
        toast(result.reply || "Nothing to add there.");
        return;
      }
      const p: Pending = { result, raw, attachments: atts, skip: new Set() };
      if (getSettings().reviewBeforeSaving) setPending(p);
      else await commit(p);
    } catch (e) {
      toast((e as Error).message, { error: true, ms: 7000 });
    } finally {
      setBusy(false);
    }
  };

  const toggleMic = async () => {
    if (dict.listening) {
      // Stopping the mic sends what you said.
      const said = await dict.stop();
      if (said !== null) void send(said);
    } else {
      setExpanded(true);
      dict.start(text);
    }
  };

  const hasKey = !!settings.keys[settings.provider]?.trim();

  const lines = text.split("\n").length + Math.floor(text.length / 60);
  const rows = expanded || text || attachments.length ? Math.min(compact ? 6 : 9, Math.max(compact ? 2 : 3, lines)) : 1;

  return (
    <div
      className={`composer ${compact ? "compact" : ""} ${expanded || text ? "expanded" : ""} ${dragging ? "dragging" : ""}`}
      onDragOver={(e) => {
        if ([...e.dataTransfer.types].includes("Files")) {
          e.preventDefault();
          setDragging(true);
        }
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        setDragging(false);
        if (e.dataTransfer.files.length) {
          e.preventDefault();
          void addFiles(e.dataTransfer.files);
        }
      }}
    >
      {pending && (
        <div className="review">
          <div className="review-head">
            <strong>{pending.result.reply || "Here's what I got:"}</strong>
            {pending.result.offline && <span className="muted small"> (offline parser)</span>}
          </div>
          <ul>
            {pending.result.actions.map((a, i) => {
              const d = describe(a, settings.defaultSpace, opts().focusTaskId);
              const off = pending.skip.has(i) || !!d.invalid;
              return (
                <li key={i} className={off ? "off" : ""}>
                  <label>
                    <input
                      type="checkbox"
                      checked={!off}
                      disabled={!!d.invalid}
                      onChange={() => {
                        const skip = new Set(pending.skip);
                        if (skip.has(i)) skip.delete(i);
                        else skip.add(i);
                        setPending({ ...pending, skip });
                      }}
                    />
                    <span className="review-icon">{d.icon}</span>
                    <span>
                      <span className="review-title">{d.headline}</span>
                      {d.invalid && <span className="error-text"> — {d.invalid}</span>}
                      {d.details.map((x, j) => (
                        <span key={j} className="review-detail">
                          {x}
                        </span>
                      ))}
                    </span>
                  </label>
                </li>
              );
            })}
          </ul>
          <div className="review-actions">
            <button
              className="btn"
              onClick={() => {
                setText(pending.raw);
                setAttachments(pending.attachments);
                setPending(null);
                setExpanded(true);
                setTimeout(() => taRef.current?.focus(), 0);
              }}
            >
              Edit what I said
            </button>
            <button className="btn" onClick={() => setPending(null)}>
              Cancel
            </button>
            <button className="btn primary" onClick={() => void commit(pending)}>
              Save
            </button>
          </div>
        </div>
      )}
      {dict.error && (
        <div className="error-text small dict-error">
          {dict.error}
          {dict.canRetry && (
            <>
              {" "}
              <button
                className="btn"
                onClick={async () => {
                  const said = await dict.retry();
                  if (said !== null) void send(said);
                }}
              >
                Retry
              </button>
              <button className="btn" onClick={dict.discard}>
                Discard recording
              </button>
            </>
          )}
        </div>
      )}
      {attachments.length > 0 && (
        <div className="attachments">
          {attachments.map((a) => (
            <div key={a.id} className="thumb" title={a.name}>
              <img src={a.preview} alt={a.name} />
              {a.tiles.length > 1 && <span className="thumb-badge">{a.tiles.length} parts</span>}
              <button className="thumb-x" aria-label="Remove image" onClick={() => setAttachments(attachments.filter((x) => x.id !== a.id))} disabled={busy}>
                ✕
              </button>
            </div>
          ))}
          <span className="hint">Add a few words if you like (“this is from Kathy about the vendor deal”), then send.</span>
        </div>
      )}
      <div className="composer-row">
        <button
          className="attach"
          onClick={() => fileRef.current?.click()}
          disabled={busy}
          aria-label="Add a screenshot or photo"
          title="Add a screenshot or photo (or paste / drop one)"
        >
          📎
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          multiple
          hidden
          onChange={(e) => {
            if (e.target.files) void addFiles(e.target.files);
            e.target.value = "";
          }}
        />
        <textarea
          ref={taRef}
          value={text}
          rows={rows}
          placeholder={
            busy
              ? attachments.length
                ? "Reading…"
                : "Thinking…"
              : dict.transcribing
                ? "Transcribing…"
                : dict.listening && dict.engine === "whisper"
                ? `Recording ${fmtElapsed(dict.elapsed)}… tap ■ when you're done`
                : dict.listening
                ? "Listening… tap ■ when you're done"
                : attachments.length
                  ? "Anything to add? (optional)"
                  : placeholder
          }
          onPaste={(e) => {
            const files = [...e.clipboardData.files];
            if (files.some((f) => f.type.startsWith("image/"))) {
              e.preventDefault();
              void addFiles(files);
            }
          }}
          onFocus={() => setExpanded(true)}
          onBlur={() => !text && !attachments.length && setExpanded(false)}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !("ontouchstart" in window)) {
              e.preventDefault();
              void submit();
            }
          }}
          disabled={busy || dict.transcribing}
        />
        <button
          className={`mic ${dict.listening ? "on" : ""}`}
          onClick={() => void toggleMic()}
          disabled={busy || dict.transcribing}
          aria-label={dict.listening ? "Stop and send" : "Speak"}
          title={dict.supported ? (dict.listening ? "Stop and send" : "Tap and talk") : "Voice not supported here — use your keyboard's mic"}
        >
          {dict.transcribing ? <span className="spinner" /> : dict.listening ? "■" : "🎙"}
        </button>
        <button className="send" onClick={() => void submit()} disabled={busy || dict.transcribing || (!text.trim() && !attachments.length && !dict.listening)} aria-label="Send">
          {busy ? <span className="spinner" /> : "➤"}
        </button>
      </div>
      {hasKey && !compact && text.length > 400 && !pending && (
        <div className="hint">Pasted an email or chat? Send it and I'll pull out the to-dos and file them where they belong.</div>
      )}
      {!hasKey && !compact && (expanded || text) && (
        <div className="hint">No AI key yet — using the simple parser (“add X under Y priority 8 #tag”). Add a key in Settings for natural language.</div>
      )}
    </div>
  );
}
