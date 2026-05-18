import { getGlobalProviderPreference, getProviderSettings } from "../settings/storage.js";

export type ProviderName =
  | "ollama"
  | "vllm"
  | "openai"
  | "deepseek"
  | "minimax"
  | "kimi"
  | "groq"
  | "openrouter"
  | "anthropic"
  | "gemini"
  | "opencode";

const ALL_PROVIDER_NAMES: ProviderName[] = [
  "ollama",
  "vllm",
  "openai",
  "deepseek",
  "minimax",
  "kimi",
  "groq",
  "openrouter",
  "anthropic",
  "gemini",
  "opencode",
];

export function normalizeProviderName(value?: string): ProviderName | null {
  const lower = (value ?? "").toLowerCase();
  return ALL_PROVIDER_NAMES.includes(lower as ProviderName) ? (lower as ProviderName) : null;
}

export function getPreferredProviderName(): ProviderName {
  const fromEnv = normalizeProviderName(process.env.LLM_PROVIDER);
  if (fromEnv) return fromEnv;
  const fromSettings = normalizeProviderName(getGlobalProviderPreference());
  if (fromSettings) return fromSettings;
  return "deepseek";
}

export function getProviderPreference(): ProviderName {
  return getPreferredProviderName();
}

function envOrSettings(
  provider: ProviderName,
  field: "model" | "summaryModel" | "baseUrl" | "apiKey"
): string | undefined {
  const prefix = provider.toUpperCase().replace(/-/g, "_");
  const envValue = process.env[`${prefix}_${field.toUpperCase()}`];
  if (envValue) return envValue;
  const settings = getProviderSettings(provider);
  return settings[field];
}

function defaultModel(provider: ProviderName): string {
  switch (provider) {
    case "ollama":
      return "batiai/gemma4-e2b:q4";
    case "vllm":
      return "google/gemma-4-E2B-it";
    case "openai":
      return "gpt-4o";
    case "deepseek":
      return "deepseek-chat";
    case "minimax":
      return "MiniMax-M2.7";
    case "kimi":
      return "kimi-k2.6";
    case "groq":
      return "llama-3.3-70b-versatile";
    case "openrouter":
      return "anthropic/claude-3.5-sonnet";
    case "anthropic":
      return "claude-3-5-sonnet-20241022";
    case "gemini":
      return "gemini-1.5-pro-latest";
    case "opencode":
      return "anthropic/claude-sonnet-4-5";
    default:
      return "";
  }
}

export function getProviderModel(provider: ProviderName): string {
  return envOrSettings(provider, "model") ?? defaultModel(provider);
}

export function getPrimaryModelName(): string {
  return getProviderModel(getPreferredProviderName());
}

export function getSummaryModelForProvider(provider: ProviderName): string {
  return envOrSettings(provider, "summaryModel") ?? getProviderModel(provider);
}

export function getSummaryModelName(): string {
  return getSummaryModelForProvider(getPreferredProviderName());
}

export function getProviderLabel(): string {
  return `${getPreferredProviderName()}:${getPrimaryModelName()}`;
}
