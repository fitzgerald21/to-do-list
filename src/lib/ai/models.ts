import type { ProviderId } from "../../types";

export interface ModelOption {
  id: string;
  name: string;
  /** USD per 1M input tokens. null = unknown. */
  inPrice: number | null;
  /** USD per 1M output tokens. */
  outPrice: number | null;
  context?: number | null;
  /** Can read images (screenshots). undefined = unknown. */
  vision?: boolean;
}

/** Anthropic's /v1/models doesn't return prices, so these are filled in by hand. */
const CLAUDE_PRICES: Record<string, [number, number]> = {
  "claude-haiku-5-5": [0.1, 0.5],
  "claude-sonnet-5-5": [2, 10],
  "claude-opus-5-5": [4, 20],
  "claude-fable-5-1": [10, 50],
  "claude-fable-5": [10, 50],
  "claude-opus-5": [5, 25],
  "claude-sonnet-5": [2, 10],
  "claude-opus-4-8": [5, 25],
  "claude-opus-4-7": [5, 25],
  "claude-opus-4-6": [5, 25],
  "claude-sonnet-4-6": [3, 15],
  "claude-haiku-4-5": [1, 5],
};

const CLAUDE_FALLBACK: ModelOption[] = [
  ["claude-haiku-5-5", "Claude Haiku 5.5"],
  ["claude-sonnet-5-5", "Claude Sonnet 5.5"],
  ["claude-opus-5-5", "Claude Opus 5.5"],
  ["claude-fable-5-1", "Claude Fable 5.1"],
].map(([id, name]) => ({ id, name, inPrice: CLAUDE_PRICES[id][0], outPrice: CLAUDE_PRICES[id][1], vision: true }));

const CACHE_MS = 12 * 60 * 60 * 1000;

function cached(key: string): ModelOption[] | null {
  try {
    const raw = localStorage.getItem(`braindump:models:v2:${key}`);
    if (!raw) return null;
    const { at, models } = JSON.parse(raw);
    return Date.now() - at < CACHE_MS ? models : null;
  } catch {
    return null;
  }
}

function store(key: string, models: ModelOption[]) {
  try {
    localStorage.setItem(`braindump:models:v2:${key}`, JSON.stringify({ at: Date.now(), models }));
  } catch {
    /* ignore */
  }
}

export async function fetchModels(provider: ProviderId, apiKey: string, force = false): Promise<ModelOption[]> {
  const cacheKey = provider === "anthropic" ? `anthropic:${apiKey ? "k" : "nokey"}` : provider;
  if (!force) {
    const c = cached(cacheKey);
    if (c) return c;
  }
  let models: ModelOption[];
  if (provider === "anthropic") models = await fetchClaude(apiKey);
  else if (provider === "openrouter") models = await fetchOpenRouter();
  else models = await fetchDeepInfra();
  store(cacheKey, models);
  return models;
}

async function fetchClaude(apiKey: string): Promise<ModelOption[]> {
  if (!apiKey) return CLAUDE_FALLBACK;
  try {
    const { default: Anthropic } = await import("@anthropic-ai/sdk");
    const client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true });
    const out: ModelOption[] = [];
    for await (const m of client.models.list({ limit: 100 })) {
      if (m.lifecycle === "retired") continue;
      const p = CLAUDE_PRICES[m.id];
      out.push({ id: m.id, name: m.display_name, inPrice: p?.[0] ?? null, outPrice: p?.[1] ?? null, context: m.max_input_tokens, vision: true });
    }
    return out.length ? out : CLAUDE_FALLBACK;
  } catch {
    return CLAUDE_FALLBACK;
  }
}

async function fetchOpenRouter(): Promise<ModelOption[]> {
  const res = await fetch("https://openrouter.ai/api/v1/models");
  if (!res.ok) throw new Error(`OpenRouter models: HTTP ${res.status}`);
  const { data } = await res.json();
  return (data as Array<Record<string, any>>)
    .filter((m) => {
      const outMods: string[] = m.architecture?.output_modalities ?? ["text"];
      return outMods.includes("text") && (!m.endpoints || m.endpoints.includes("/api/v1/chat/completions"));
    })
    .map((m) => ({
      id: m.id,
      name: m.name ?? m.id,
      inPrice: perMillion(m.pricing?.prompt),
      outPrice: perMillion(m.pricing?.completion),
      context: m.context_length ?? null,
      vision: ((m.architecture?.input_modalities as string[] | undefined) ?? []).includes("image"),
    }));
}

async function fetchDeepInfra(): Promise<ModelOption[]> {
  const res = await fetch("https://api.deepinfra.com/models/list");
  if (!res.ok) throw new Error(`DeepInfra models: HTTP ${res.status}`);
  const data = (await res.json()) as Array<Record<string, any>>;
  return data
    .filter((m) => m.type === "text-generation" && !m.private && !m.deprecated && m.pricing?.type === "tokens")
    .map((m) => ({
      id: m.model_name,
      name: m.model_name,
      // DeepInfra prices are in cents per token.
      inPrice: centsPerTokenToPerMillion(m.pricing?.cents_per_input_token),
      outPrice: centsPerTokenToPerMillion(m.pricing?.cents_per_output_token),
      context: m.max_tokens ?? null,
    }));
}

function perMillion(v: unknown): number | null {
  const n = typeof v === "string" ? parseFloat(v) : typeof v === "number" ? v : NaN;
  if (!Number.isFinite(n) || n < 0) return null;
  return round(n * 1_000_000);
}

function centsPerTokenToPerMillion(v: unknown): number | null {
  const n = typeof v === "number" ? v : NaN;
  if (!Number.isFinite(n) || n < 0) return null;
  return round((n * 1_000_000) / 100);
}

const round = (n: number) => Math.round(n * 1000) / 1000;

export function formatPrice(m: ModelOption): string {
  if (m.inPrice === null || m.outPrice === null) return "price unknown";
  if (m.inPrice === 0 && m.outPrice === 0) return "free";
  const f = (n: number) => (n < 0.01 ? n.toFixed(3) : n < 1 ? n.toFixed(2) : n.toFixed(2).replace(/\.00$/, ""));
  return `$${f(m.inPrice)} in · $${f(m.outPrice)} out /1M`;
}
