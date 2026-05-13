/**
 * Model context window mappings — researched from official provider docs
 * as of May 2026. Values are in tokens.
 *
 * Sources:
 * - OpenAI: GPT-4o = 128K (openai.com)
 * - DeepSeek: deepseek-chat/reasoner = 128K (platform.deepseek.com, costgoat.com)
 * - MiniMax: M2.x series = 204,800 (platform.minimax.io/docs)
 * - Kimi/Moonshot: K2.6 = 262,144 (api.moonshot.cn, kingy.ai)
 * - Groq: llama-3.3-70b = 131,072 (console.groq.com/docs)
 * - Anthropic: Claude 3.5 Sonnet = 200K (anthropic.com)
 * - OpenRouter: passes through to upstream (uses Anthropic/OpenAI/Gemini limits)
 * - Google Gemini: 1.5 Pro = 1M (2M in some tiers) (ai.google.dev)
 * - Ollama/vLLM: local deployment — use common defaults (128K)
 */

export const DEFAULT_CONTEXT_WINDOW = 128_000;

/** Exact model name → context window (tokens) */
const MODEL_CONTEXT_WINDOWS: Record<string, number> = {
  // OpenAI
  "gpt-4o": 128_000,
  "gpt-4o-mini": 128_000,
  "gpt-4.1": 1_000_000,
  "gpt-4.1-mini": 1_000_000,
  "gpt-4.1-nano": 1_000_000,
  "o3": 200_000,
  "o3-mini": 200_000,
  "o1": 200_000,
  "o1-mini": 128_000,

  // DeepSeek
  "deepseek-chat": 128_000,
  "deepseek-reasoner": 128_000,
  "deepseek-v4-flash": 1_000_000,
  "deepseek-v4-pro": 1_000_000,

  // MiniMax
  "minimax-m2": 204_800,
  "minimax-m2.1": 204_800,
  "minimax-m2.1-highspeed": 204_800,
  "minimax-m2.5": 204_800,
  "minimax-m2.5-highspeed": 204_800,
  "minimax-m2.7": 204_800,
  "minimax-m2.7-highspeed": 204_800,
  "minimax-m2-her": 204_800,
  "m2-her": 204_800,

  // Kimi / Moonshot
  "kimi-k2": 262_144,
  "kimi-k2.5": 262_144,
  "kimi-k2.6": 262_144,
  "kimi-k2-thinking": 262_144,
  "kimi-k2-thinking-turbo": 262_144,
  "kimi-k2-turbo-preview": 262_144,
  "kimi-k2-0905-preview": 262_144,

  // Groq (Llama via Groq)
  "llama-3.3-70b-versatile": 131_072,
  "llama-3.3-70b": 131_072,
  "llama-3.1-8b-instant": 131_072,
  "llama-4-scout-17b-16e-instruct": 1_000_000,
  "llama-4-scout": 1_000_000,
  "llama-4-maverick": 1_000_000,
  "meta-llama/llama-4-scout-17b-16e-instruct": 1_000_000,

  // Anthropic
  "claude-3-5-sonnet-20241022": 200_000,
  "claude-3-5-sonnet": 200_000,
  "claude-3-opus-20240229": 200_000,
  "claude-3-sonnet-20240229": 200_000,
  "claude-3-haiku-20240307": 200_000,
  "claude-3-7-sonnet-20250219": 200_000,
  "claude-sonnet-4-5": 200_000,
  "claude-sonnet-4-6": 200_000,
  "claude-opus-4": 200_000,
  "claude-opus-4-7": 200_000,

  // Google Gemini
  "gemini-1.5-pro-latest": 1_000_000,
  "gemini-1.5-pro": 1_000_000,
  "gemini-1.5-flash": 1_000_000,
  "gemini-2.5-pro": 1_000_000,
  "gemini-2.5-flash": 1_000_000,
  "gemini-3.1-pro": 1_000_000,
  "gemini-3.1-pro-preview": 1_000_000,
  "gemini-3-flash": 200_000,

  // Ollama / vLLM local defaults (common local models)
  "batiai/gemma4-e2b:q4": 128_000,
  "google/gemma-4-e2b-it": 128_000,
  "qwen2.5-coder:latest": 128_000,
  "qwen2.5-coder:32b": 128_000,
  "llama3.1:latest": 128_000,
  "llama3.2:latest": 128_000,
  "mistral:latest": 128_000,
  "mixtral:latest": 128_000,
  "codellama:latest": 128_000,
  "deepseek-coder:latest": 128_000,
  "deepseek-coder-v2:latest": 128_000,
  "phi4:latest": 128_000,
  "command-r:latest": 128_000,
  "command-r-plus:latest": 128_000,
};

/** Provider-level defaults when model is not in the exact map */
const PROVIDER_DEFAULT_WINDOWS: Record<string, number> = {
  openai: 128_000,
  deepseek: 128_000,
  minimax: 204_800,
  kimi: 262_144,
  groq: 131_072,
  anthropic: 200_000,
  openrouter: 200_000, // Most common upstream on OpenRouter
  gemini: 1_000_000,
  ollama: 128_000,
  vllm: 128_000,
};

function normalizeModelName(model: string): string {
  return model.toLowerCase().trim().replace(/\s+/g, "-");
}

/**
 * Look up the context window for a given model.
 * Falls back to provider default, then global default.
 */
export function getContextWindow(model: string, provider?: string): number {
  const normalized = normalizeModelName(model);

  // 1. Exact match
  if (MODEL_CONTEXT_WINDOWS[normalized]) {
    return MODEL_CONTEXT_WINDOWS[normalized];
  }

  // 2. Prefix match (e.g. "gpt-4o-2024-08-06" → "gpt-4o")
  for (const [key, value] of Object.entries(MODEL_CONTEXT_WINDOWS)) {
    if (normalized.startsWith(key) || key.startsWith(normalized)) {
      return value;
    }
  }

  // 3. Provider default
  if (provider) {
    const providerDefault = PROVIDER_DEFAULT_WINDOWS[provider.toLowerCase()];
    if (providerDefault) return providerDefault;
  }

  // 4. Global fallback
  return DEFAULT_CONTEXT_WINDOW;
}

/**
 * Returns a human-readable context window string for the status bar.
 */
export function formatContextWindow(tokens: number): string {
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}M`;
  if (tokens >= 1_000) return `${(tokens / 1_000).toFixed(0)}K`;
  return `${tokens}`;
}
