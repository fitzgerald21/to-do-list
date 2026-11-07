/** Speech-to-text through Groq's hosted Whisper (OpenAI-compatible audio API). */

const BASE = "https://api.groq.com/openai/v1";

export const GROQ_MODELS = [
  { id: "whisper-large-v3-turbo", name: "Whisper Large v3 Turbo: fast, cheapest" },
  { id: "whisper-large-v3", name: "Whisper Large v3: a bit more accurate" },
] as const;

/** Whisper's prompt is capped at 224 tokens; keep well under it. */
const MAX_PROMPT = 600;

export function whisperPrompt(names: string[]): string {
  const uniq = [...new Set(names.map((n) => n.trim()).filter(Boolean))];
  let out = "To-do list dictation.";
  if (uniq.length) {
    out += " Topics and names: ";
    for (const n of uniq) {
      if (out.length + n.length + 2 > MAX_PROMPT) break;
      out += (out.endsWith(": ") ? "" : ", ") + n;
    }
    out += ".";
  }
  return out;
}

function fileName(mime: string): string {
  if (mime.includes("mp4") || mime.includes("aac")) return "speech.m4a";
  if (mime.includes("ogg")) return "speech.ogg";
  if (mime.includes("wav")) return "speech.wav";
  return "speech.webm";
}

async function groqError(res: Response): Promise<Error> {
  let msg = "";
  try {
    const j = await res.json();
    msg = j?.error?.message ?? "";
  } catch {
    /* ignore */
  }
  if (res.status === 401) return new Error("Groq rejected the API key. Check it in Settings.");
  if (res.status === 413) return new Error("That recording is too long for Groq. Try shorter chunks.");
  if (res.status === 429) return new Error("Groq rate limit hit. Wait a moment and tap Retry.");
  return new Error(`Groq transcription failed (HTTP ${res.status})${msg ? `: ${msg}` : ""}`);
}

export async function transcribe(
  audio: Blob,
  opts: { apiKey: string; model: string; lang?: string; prompt?: string; signal?: AbortSignal },
): Promise<string> {
  const form = new FormData();
  form.append("file", audio, fileName(audio.type));
  form.append("model", opts.model || GROQ_MODELS[0].id);
  form.append("response_format", "json");
  form.append("temperature", "0");
  // "en-US" -> "en". Whisper takes ISO-639-1 codes.
  const lang = opts.lang?.split("-")[0]?.toLowerCase();
  if (lang) form.append("language", lang);
  if (opts.prompt) form.append("prompt", opts.prompt);
  let res: Response;
  try {
    res = await fetch(`${BASE}/audio/transcriptions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${opts.apiKey}` },
      body: form,
      signal: opts.signal,
    });
  } catch {
    throw new Error("Couldn't reach Groq. Check your connection and tap Retry.");
  }
  if (!res.ok) throw await groqError(res);
  const j = await res.json();
  return String(j?.text ?? "").trim();
}

/** Cheap key check: list models. */
export async function testGroqKey(apiKey: string): Promise<void> {
  let res: Response;
  try {
    res = await fetch(`${BASE}/models`, { headers: { Authorization: `Bearer ${apiKey}` } });
  } catch {
    throw new Error("Couldn't reach Groq.");
  }
  if (!res.ok) throw await groqError(res);
}
