import { useCallback, useEffect, useRef, useState } from "react";

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

export const speechSupported = () => typeof window !== "undefined" && !!getCtor();

/**
 * Hold-to-talk / tap-to-talk dictation. Keeps listening through pauses
 * (you can ramble) until you tap stop. Text accumulates into `transcript`.
 */
export function useDictation(lang: string, onText: (fullText: string) => void) {
  const [listening, setListening] = useState(false);
  const [interim, setInterim] = useState("");
  const [error, setError] = useState<string | null>(null);
  const recRef = useRef<SpeechRec | null>(null);
  const finalRef = useRef("");
  const wantRef = useRef(false);
  const onTextRef = useRef(onText);
  onTextRef.current = onText;

  const stop = useCallback(() => {
    wantRef.current = false;
    recRef.current?.stop();
    setListening(false);
    setInterim("");
  }, []);

  const start = useCallback(
    (existing = "") => {
      const Ctor = getCtor();
      if (!Ctor) {
        setError("Voice input isn't supported in this browser. Use your keyboard's mic button instead.");
        return;
      }
      setError(null);
      finalRef.current = existing ? existing.trimEnd() + " " : "";
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
          onTextRef.current((finalRef.current + interimText).trim());
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
        setListening(true);
      } catch (e) {
        setError(String(e));
      }
    },
    [lang],
  );

  useEffect(() => () => {
    wantRef.current = false;
    recRef.current?.abort();
  }, []);

  return { listening, interim, error, start, stop, supported: speechSupported() };
}
