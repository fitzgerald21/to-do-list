import { afterEach, describe, expect, it, vi } from "vitest";
import { transcribe, whisperPrompt } from "./groq";

describe("groq whisper", () => {
  afterEach(() => vi.restoreAllMocks());

  it("builds a short spelling prompt from names", () => {
    expect(whisperPrompt(["Transformation", "Kathy", "", "Kathy"])).toBe("To-do list dictation. Topics and names: Transformation, Kathy.");
    expect(whisperPrompt([])).toBe("To-do list dictation.");
    expect(whisperPrompt(Array.from({ length: 200 }, (_, i) => `Name${i}`)).length).toBeLessThanOrEqual(601);
  });

  it("posts audio with model, language and prompt", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ text: " Call Kathy. " }), { status: 200 }));
    const text = await transcribe(new Blob(["x"], { type: "audio/mp4" }), { apiKey: "gsk_1", model: "whisper-large-v3-turbo", lang: "en-US", prompt: "p" });
    expect(text).toBe("Call Kathy.");
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.groq.com/openai/v1/audio/transcriptions");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer gsk_1");
    const form = init.body as FormData;
    expect(form.get("model")).toBe("whisper-large-v3-turbo");
    expect(form.get("language")).toBe("en");
    expect(form.get("prompt")).toBe("p");
    expect((form.get("file") as File).name).toBe("speech.m4a");
  });

  it("explains a bad key", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}", { status: 401 }));
    await expect(transcribe(new Blob(["x"]), { apiKey: "bad", model: "m" })).rejects.toThrow(/rejected the API key/);
  });
});
