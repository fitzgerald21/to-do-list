import type { ProviderId, Settings } from "../../types";
import { extractJson, RESULT_SCHEMA } from "./schema";

export const PROVIDERS: { id: ProviderId; name: string; keyUrl: string; keyHint: string }[] = [
  { id: "anthropic", name: "Claude (Anthropic)", keyUrl: "https://platform.claude.com/settings/keys", keyHint: "sk-ant-…" },
  { id: "openrouter", name: "OpenRouter", keyUrl: "https://openrouter.ai/settings/keys", keyHint: "sk-or-…" },
  { id: "deepinfra", name: "DeepInfra", keyUrl: "https://deepinfra.com/dash/api_keys", keyHint: "DeepInfra API token" },
];

export class AiError extends Error {}

/** Send the system + user prompt to whichever provider is selected; return parsed JSON. */
export async function callModel(settings: Settings, system: string, user: string): Promise<unknown> {
  const key = settings.keys[settings.provider]?.trim();
  if (!key) throw new AiError(`Add your ${PROVIDERS.find((p) => p.id === settings.provider)!.name} API key in Settings.`);
  const model = settings.models[settings.provider]?.trim();
  if (!model) throw new AiError("Pick a model in Settings.");
  if (settings.provider === "anthropic") return callClaude(key, model, settings.effort, system, user);
  return callOpenAICompatible(settings.provider, key, model, system, user);
}

// ----------------------------------------------------------------- Claude

async function callClaude(
  apiKey: string,
  model: string,
  effort: Settings["effort"],
  system: string,
  user: string,
): Promise<unknown> {
  // The key lives only in your browser (and, if you opt in, your own Firestore doc),
  // so calling the API directly from the page is fine for a personal app.
  const { default: Anthropic } = await import("@anthropic-ai/sdk");
  const client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true });

  let useEffort = true;
  let useFormat = true;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await client.messages.create({
        model,
        max_tokens: 16000,
        system: [{ type: "text", text: system, cache_control: { type: "ephemeral" } }],
        messages: [{ role: "user", content: user }],
        ...(useEffort || useFormat
          ? {
              output_config: {
                ...(useEffort ? { effort } : {}),
                ...(useFormat ? { format: { type: "json_schema" as const, schema: RESULT_SCHEMA as unknown as Record<string, unknown> } } : {}),
              },
            }
          : {}),
      });
      if (res.stop_reason === "refusal") throw new AiError("Claude declined that request. Try rephrasing it.");
      if (res.stop_reason === "max_tokens") throw new AiError("The answer was cut off. Try saying less at once.");
      const text = res.content
        .map((b) => (b.type === "text" ? b.text : ""))
        .join("");
      return useFormat ? JSON.parse(text) : extractJson(text);
    } catch (e) {
      if (e instanceof Anthropic.BadRequestError) {
        // Older models don't support effort and/or structured outputs - retry without.
        const msg = e.message.toLowerCase();
        if (useEffort && msg.includes("effort")) {
          useEffort = false;
          continue;
        }
        if (useFormat && (msg.includes("output_config") || msg.includes("format") || msg.includes("schema"))) {
          useFormat = false;
          continue;
        }
        throw new AiError(`Claude rejected the request: ${e.message}`);
      }
      if (e instanceof Anthropic.AuthenticationError) throw new AiError("Your Anthropic API key was rejected. Check it in Settings.");
      if (e instanceof Anthropic.PermissionDeniedError) throw new AiError("Your Anthropic key doesn't have access to that model.");
      if (e instanceof Anthropic.NotFoundError) throw new AiError(`Model "${model}" wasn't found. Pick another in Settings.`);
      if (e instanceof Anthropic.RateLimitError) throw new AiError("Rate limited by Anthropic. Wait a moment and try again.");
      if (e instanceof Anthropic.APIConnectionError) throw new AiError("Couldn't reach Anthropic. Are you online?");
      if (e instanceof Anthropic.APIError) throw new AiError(`Anthropic error: ${e.message}`);
      throw e;
    }
  }
  throw new AiError("Claude request failed.");
}

// ------------------------------------------------- OpenRouter / DeepInfra

const ENDPOINTS: Record<Exclude<ProviderId, "anthropic">, string> = {
  openrouter: "https://openrouter.ai/api/v1/chat/completions",
  deepinfra: "https://api.deepinfra.com/v1/openai/chat/completions",
};

type Fmt = "json_schema" | "json_object" | "none";

async function callOpenAICompatible(
  provider: Exclude<ProviderId, "anthropic">,
  key: string,
  model: string,
  system: string,
  user: string,
): Promise<unknown> {
  // Not every model supports strict JSON schemas, so step down until one works.
  const formats: Fmt[] = provider === "openrouter" ? ["json_schema", "json_object", "none"] : ["json_object", "none"];
  const sys = `${system}\n\nRespond with ONLY the JSON object, no prose. JSON schema:\n${JSON.stringify(RESULT_SCHEMA)}`;
  let lastErr = "";
  for (const fmt of formats) {
    const body: Record<string, unknown> = {
      model,
      max_tokens: 8000,
      messages: [
        { role: "system", content: sys },
        { role: "user", content: user },
      ],
    };
    if (fmt === "json_schema")
      body.response_format = { type: "json_schema", json_schema: { name: "todo_actions", strict: true, schema: RESULT_SCHEMA } };
    if (fmt === "json_object") body.response_format = { type: "json_object" };

    let res: Response;
    try {
      res = await fetch(ENDPOINTS[provider], {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${key}`,
          ...(provider === "openrouter" ? { "HTTP-Referer": location.origin, "X-Title": "Brain Dump To-Do" } : {}),
        },
        body: JSON.stringify(body),
      });
    } catch {
      throw new AiError(`Couldn't reach ${provider}. Are you online?`);
    }
    if (res.status === 401 || res.status === 403) throw new AiError(`Your ${provider} API key was rejected. Check it in Settings.`);
    if (res.status === 429) throw new AiError(`Rate limited by ${provider}. Wait a moment and try again.`);
    if (res.status === 402) throw new AiError(`${provider} says your account is out of credits.`);
    if (!res.ok) {
      lastErr = (await res.text().catch(() => "")).slice(0, 300);
      if (res.status === 400 || res.status === 422) continue; // try a looser format
      throw new AiError(`${provider} error ${res.status}: ${lastErr}`);
    }
    const data = await res.json();
    const text: string = data?.choices?.[0]?.message?.content ?? "";
    try {
      return extractJson(text);
    } catch {
      lastErr = `Model reply wasn't valid JSON: ${text.slice(0, 200)}`;
      continue;
    }
  }
  throw new AiError(`${provider} request failed. ${lastErr}`);
}
