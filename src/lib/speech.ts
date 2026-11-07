import { useCallback, useEffect, useRef, useState } from "react";
import { getSettings } from "../state/store";
import { transcribe } from "./groq";

/* Minimal typings for the Web Speech API (not in lib.dom). */
interface SRAlternative { transcript: string }
interface SRResult { isFinal: boolean; 0: SRAlternative; length: number }
interface SREvent { resultIndex: number; results: { length: number; [i: number]: SRResult } }
interface SpeechRec {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((e: SREvent) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
}

function getCtor(): (new () => SpeechRec) | null {
  const w = window as unknown as Record<string, unknown>;
  return (w.SpeechRecognition || w.webkitSpeechRecognition || null) as (new () => SpeechRec) | null;
}

const recorderSupported = () =>
  typeof window !== "undefined" && typeof MediaRecorder !== "undefined" && !!navigator.mediaDevices?.getUserMedia;

export const speechSupported = () => typeof window !== "undefined" && (!!getCtor() || recorderSupported());

/** Use Groq Whisper when there's a key, the browser can record, and we're online. */
export function usingWhisper(): boolean {
  return !!getSettings().groqKey?.trim() && recorderSupported() && navigator.onLine !== false;
}

function pickMime(): string | undefined {
  for (const m of ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus"]) {
    if (MediaRecorder.isTypeSupported?.(m)) return m;
  }
  return undefined;
}

export type Dictation = ReturnType<typeof useDictation>;

/**
 * Tap-to-talk dictation. Keeps going through pauses (you can ramble) until you tap stop.
 *
 * Two engines:
 * - Groq Whisper (when a Groq key is set): records audio, then transcribes it all at once on stop.
 *   Much better with names and long rambles, but no live text while you talk.
 * - The browser's built-in speech recognition: live text as you speak.
 *
 * `stop()` resolves with the full text (existing text + what was said), or null if transcription failed
 * (the recording is kept and `retry()` sends it again).
 */
export function useDictation(lang: string, onText: (fullText: string) => void, hint?: string) {
  const [listening, setListening] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const [interim, setInterim] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [engine, setEngine] = useState<"browser" | "whisper" | null>(null);
  const [canRetry, setCanRetry] = useState(false);

  const onTextRef = useRef(onText);
  onTextRef.current = onText;
  const hintRef = useRef(hint);
  hintRef.current = hint;
  const mounted = useRef(true);

  // Browser engine state
  const recRef = useRef<SpeechRec | null>(null);
  const finalRef = useRef("");
  const latestRef = useRef("");
  const wantRef = useRef(false);

  // Whisper engine state
  const mediaRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const baseRef = useRef("");
  const failedRef = useRef<Blob | null>(null);
  const timerRef = useRef<number | null>(null);

  const clearTimer = () => {
    if (timerRef.current !== null) window.clearInterval(timerRef.current);
    timerRef.current = null;
  };
  const releaseMic = () => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  };

  const runTranscription = useCallback(
    async (blob: Blob): Promise<string | null> => {
      const s = getSettings();
      setTranscribing(true);
      setError(null);
      try {
        const said = await transcribe(blob, { apiKey: s.groqKey.trim(), model: s.groqModel, lang, prompt: hintRef.current });
        failedRef.current = null;
        setCanRetry(false);
        const full = (baseRef.current + said).trim();
        if (mounted.current) onTextRef.current(full);
        return full;
      } catch (e) {
        failedRef.current = blob;
        setCanRetry(true);
        setError((e as Error).message);
        return null;
      } finally {
        setTranscribing(false);
      }
    },
    [lang],
  );

  const startWhisper = useCallback(async (existing: string) => {
    baseRef.current = existing ? existing.trimEnd() + " " : "";
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
    } catch (e) {
      const name = (e as DOMException).name;
      setError(name === "NotAllowedError" ? "Microphone permission was denied." : `Couldn't start the microphone (${name || e}).`);
      return;
    }
    const mime = pickMime();
    let rec: MediaRecorder;
    try {
      rec = new MediaRecorder(stream, mime ? { mimeType: mime, audioBitsPerSecond: 32000 } : undefined);
    } catch {
      rec = new MediaRecorder(stream);
    }
    streamRef.current = stream;
    chunksRef.current = [];
    rec.ondataavailable = (ev) => ev.data.size && chunksRef.current.push(ev.data);
    mediaRef.current = rec;
    rec.start(1000);
    const t0 = Date.now();
    setElapsed(0);
    clearTimer();
    timerRef.current = window.setInterval(() => setElapsed(Math.floor((Date.now() - t0) / 1000)), 500);
    setEngine("whisper");
    setListening(true);
  }, []);

  const startBrowser = useCallback(
    (existing: string) => {
      const Ctor = getCtor();
      if (!Ctor) {
        setError("Voice input isn't supported in this browser. Add a Groq key in Settings, or use your keyboard's mic button.");
        return;
      }
      finalRef.current = existing ? existing.trimEnd() + " " : "";
      latestRef.current = finalRef.current.trim();
      wantRef.current = true;

      const begin = () => {
        const rec = new Ctor();
        rec.lang = lang;
        rec.continuous = true;
        rec.interimResults = true;
        rec.onresult = (e) => {
          let interimText = "";
          for (let i = e.resultIndex; i < e.results.length; i++) {
            const r = e.results[i];
            if (r.isFinal) finalRef.current += r[0].transcript.trim() + " ";
            else interimText += r[0].transcript;
          }
          setInterim(interimText);
          latestRef.current = (finalRef.current + interimText).trim();
          onTextRef.current(latestRef.current);
        };
        rec.onerror = (e) => {
          if (e.error === "no-speech" || e.error === "aborted") return;
          if (e.error === "not-allowed") setError("Microphone permission was denied.");
          else setError(`Voice error: ${e.error}`);
          wantRef.current = false;
        };
        // Mobile browsers end sessions after silence; restart while the user still wants to talk.
        rec.onend = () => {
          if (wantRef.current) {
            try {
              begin();
            } catch {
              setListening(false);
            }
          } else {
            setListening(false);
            setInterim("");
          }
        };
        recRef.current = rec;
        rec.start();
      };
      try {
        begin();
        setEngine("browser");
        setListening(true);
      } catch (e) {
        setError(String(e));
      }
    },
    [lang],
  );

  const start = useCallback(
    (existing = "") => {
      setError(null);
      setCanRetry(false);
      failedRef.current = null;
      if (usingWhisper()) void startWhisper(existing);
      else startBrowser(existing);
    },
    [startWhisper, startBrowser],
  );

  const stop = useCallback((): Promise<string | null> => {
    const media = mediaRef.current;
    if (media) {
      mediaRef.current = null;
      clearTimer();
      setListening(false);
      return new Promise((resolve) => {
        media.onstop = () => {
          releaseMic();
          const blob = new Blob(chunksRef.current, { type: media.mimeType || "audio/webm" });
          chunksRef.current = [];
          // Nothing said (a mis-tap): keep what was already typed.
          if (blob.size < 2000) return resolve(baseRef.current.trim());
          void runTranscription(blob).then(resolve);
        };
        try {
          media.stop();
        } catch {
          releaseMic();
          resolve(null);
        }
      });
    }
    wantRef.current = false;
    recRef.current?.stop();
    setListening(false);
    setInterim("");
    // Give the recognizer a moment to deliver its last final result.
    return new Promise((resolve) => setTimeout(() => resolve(latestRef.current), 250));
  }, [runTranscription]);

  const retry = useCallback(async (): Promise<string | null> => {
    const blob = failedRef.current;
    return blob ? runTranscription(blob) : null;
  }, [runTranscription]);

  const discard = useCallback(() => {
    failedRef.current = null;
    setCanRetry(false);
    setError(null);
  }, []);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      wantRef.current = false;
      recRef.current?.abort();
      clearTimer();
      if (mediaRef.current) {
        mediaRef.current.onstop = null;
        try {
          mediaRef.current.stop();
        } catch {
          /* ignore */
        }
      }
      releaseMic();
    };
  }, []);

  return { listening, transcribing, interim, error, elapsed, engine, canRetry, start, stop, retry, discard, supported: speechSupported() };
}

export const fmtElapsed = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
