import { useRef, useState } from "react";
import { applyResult, describe, interpret, type InterpretOptions } from "../lib/ai/interpret";
import type { AiResult } from "../lib/ai/schema";
import { useDictation } from "../lib/speech";
import { getSettings, useSettings } from "../state/store";
import { toast } from "../state/ui";

interface Pending {
  result: AiResult & { offline: boolean };
  raw: string;
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
  const taRef = useRef<HTMLTextAreaElement>(null);
  const dict = useDictation(settings.speechLang, setText);

  const commit = async (p: Pending) => {
    const receipt = await applyResult(p.result, { raw: p.raw, focusTaskId: opts().focusTaskId, skip: p.skip });
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
    const raw = value.trim();
    if (!raw || busy) return;
    if (dict.listening) dict.stop();
    setBusy(true);
    try {
      const result = await interpret(raw, opts());
      setText("");
      setExpanded(false);
      if (!result.actions.length) {
        toast(result.reply || "Nothing to add there.");
        return;
      }
      const p: Pending = { result, raw, skip: new Set() };
      if (getSettings().reviewBeforeSaving) setPending(p);
      else await commit(p);
    } catch (e) {
      toast((e as Error).message, { error: true, ms: 7000 });
    } finally {
      setBusy(false);
    }
  };

  const toggleMic = () => {
    if (dict.listening) {
      dict.stop();
      // Stopping the mic sends what you said.
      setTimeout(() => void submit(taRef.current?.value ?? text), 250);
    } else {
      setExpanded(true);
      dict.start(text);
    }
  };

  const hasKey = !!settings.keys[settings.provider]?.trim();

  return (
    <div className={`composer ${compact ? "compact" : ""} ${expanded || text ? "expanded" : ""}`}>
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
      {dict.error && <div className="error-text small">{dict.error}</div>}
      <div className="composer-row">
        <textarea
          ref={taRef}
          value={text}
          rows={expanded || text ? 3 : 1}
          placeholder={busy ? "Thinking…" : dict.listening ? "Listening… tap ■ when you're done" : placeholder}
          onFocus={() => setExpanded(true)}
          onBlur={() => !text && setExpanded(false)}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !("ontouchstart" in window)) {
              e.preventDefault();
              void submit();
            }
          }}
          disabled={busy}
        />
        <button
          className={`mic ${dict.listening ? "on" : ""}`}
          onClick={toggleMic}
          disabled={busy}
          aria-label={dict.listening ? "Stop and send" : "Speak"}
          title={dict.supported ? (dict.listening ? "Stop and send" : "Tap and talk") : "Voice not supported here — use your keyboard's mic"}
        >
          {dict.listening ? "■" : "🎙"}
        </button>
        <button className="send" onClick={() => void submit()} disabled={busy || !text.trim()} aria-label="Send">
          {busy ? <span className="spinner" /> : "➤"}
        </button>
      </div>
      {!hasKey && !compact && (expanded || text) && (
        <div className="hint">No AI key yet — using the simple parser (“add X under Y priority 8 #tag”). Add a key in Settings for natural language.</div>
      )}
    </div>
  );
}
