export interface ProviderDef {
  id: string;
  label: string;
  category: "local" | "cloud";
  requiresApiKey: boolean;
  allowCustomBaseUrl: boolean;
  defaultBaseUrl: string;
  apiKeyLabel: string;
  listModels: (baseUrl: string, apiKey: string) => Promise<string[]>;
}

// ── OpenAI-compatible model list helper ─────────────────────────────────────

async function fetchOpenAiModels(baseUrl: string, apiKey: string): Promise<string[]> {
  const url = `${baseUrl.replace(/\/$/, "")}/models`;
  const headers: Record<string, string> = {};
  if (apiKey && apiKey !== "EMPTY") {
    headers["Authorization"] = `Bearer ${apiKey}`;
  }
  const res = await fetch(url, { headers });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`HTTP ${res.status}${text ? `: ${text.slice(0, 200)}` : ""}`);
  }
  const data = (await res.json()) as { data?: Array<{ id?: string }> };
  const models = (data.data ?? [])
    .map((m) => m.id)
    .filter((id): id is string => typeof id === "string" && id.length > 0);
  return [...new Set(models)].sort();
}

// ── Ollama model list ───────────────────────────────────────────────────────

async function fetchOllamaModels(baseUrl: string): Promise<string[]> {
  const res = await fetch(`${baseUrl.replace(/\/$/, "")}/api/tags`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = (await res.json()) as { models?: Array<{ name?: string }> };
  return (data.models ?? [])
    .map((m) => m.name)
    .filter((name): name is string => typeof name === "string")
    .sort();
}

// ── Google Gemini model list ────────────────────────────────────────────────

async function fetchGeminiModels(baseUrl: string, apiKey: string): Promise<string[]> {
  const url = new URL(`${baseUrl.replace(/\/$/, "")}/models`, "https://generativelanguage.googleapis.com");
  url.searchParams.set("key", apiKey);
  const res = await fetch(url.toString());
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = (await res.json()) as { models?: Array<{ name?: string }> };
  return (data.models ?? [])
    .map((m) => m.name?.replace(/^models\//, ""))
    .filter((name): name is string => typeof name === "string")
    .sort();
}

// ── Provider registry ───────────────────────────────────────────────────────

export const ALL_PROVIDERS: ProviderDef[] = [
  {
    id: "ollama",
    label: "Ollama (local)",
    category: "local",
    requiresApiKey: false,
    allowCustomBaseUrl: true,
    defaultBaseUrl: "http://localhost:11434",
    apiKeyLabel: "",
    listModels: (baseUrl) => fetchOllamaModels(baseUrl),
  },
  {
    id: "vllm",
    label: "vLLM / OpenAI-compatible (local)",
    category: "local",
    requiresApiKey: false,
    allowCustomBaseUrl: true,
    defaultBaseUrl: "http://localhost:8000/v1",
    apiKeyLabel: "API key (optional)",
    listModels: (baseUrl, apiKey) => fetchOpenAiModels(baseUrl, apiKey),
  },
  {
    id: "openai",
    label: "OpenAI",
    category: "cloud",
    requiresApiKey: true,
    allowCustomBaseUrl: false,
    defaultBaseUrl: "https://api.openai.com/v1",
    apiKeyLabel: "OpenAI API key",
    listModels: (baseUrl, apiKey) => fetchOpenAiModels(baseUrl, apiKey),
  },
  {
    id: "deepseek",
    label: "DeepSeek",
    category: "cloud",
    requiresApiKey: true,
    allowCustomBaseUrl: false,
    defaultBaseUrl: "https://api.deepseek.com",
    apiKeyLabel: "DeepSeek API key",
    listModels: (baseUrl, apiKey) => fetchOpenAiModels(baseUrl, apiKey),
  },
  {
    id: "minimax",
    label: "MiniMax",
    category: "cloud",
    requiresApiKey: true,
    allowCustomBaseUrl: true,
    defaultBaseUrl: "https://api.minimax.io/v1",
    apiKeyLabel: "MiniMax API key",
    listModels: async () => [
      "MiniMax-M2.7",
      "MiniMax-M2.7-highspeed",
      "MiniMax-M2.5",
      "MiniMax-M2.5-highspeed",
      "MiniMax-M2.1",
      "MiniMax-M2.1-highspeed",
      "MiniMax-M2",
    ],
  },
  {
    id: "kimi",
    label: "Kimi (Moonshot)",
    category: "cloud",
    requiresApiKey: true,
    allowCustomBaseUrl: true,
    defaultBaseUrl: "https://api.moonshot.cn/v1",
    apiKeyLabel: "Kimi API key",
    listModels: (baseUrl, apiKey) => fetchOpenAiModels(baseUrl, apiKey),
  },
  {
    id: "groq",
    label: "Groq",
    category: "cloud",
    requiresApiKey: true,
    allowCustomBaseUrl: false,
    defaultBaseUrl: "https://api.groq.com/openai/v1",
    apiKeyLabel: "Groq API key",
    listModels: (baseUrl, apiKey) => fetchOpenAiModels(baseUrl, apiKey),
  },
  {
    id: "openrouter",
    label: "OpenRouter",
    category: "cloud",
    requiresApiKey: true,
    allowCustomBaseUrl: false,
    defaultBaseUrl: "https://openrouter.ai/api/v1",
    apiKeyLabel: "OpenRouter API key",
    listModels: (baseUrl, apiKey) => fetchOpenAiModels(baseUrl, apiKey),
  },
  {
    id: "anthropic",
    label: "Anthropic",
    category: "cloud",
    requiresApiKey: true,
    allowCustomBaseUrl: false,
    defaultBaseUrl: "https://api.anthropic.com/v1",
    apiKeyLabel: "Anthropic API key",
    listModels: async (baseUrl, apiKey) => {
      // Anthropic launched an OpenAI-compatible /v1/models endpoint in March 2026.
      // Try it first; fall back to hardcoded models if unavailable.
      try {
        return await fetchOpenAiModels(baseUrl, apiKey);
      } catch {
        return [
          "claude-3-5-sonnet-20241022",
          "claude-3-opus-20240229",
          "claude-3-sonnet-20240229",
          "claude-3-haiku-20240307",
          "claude-3-7-sonnet-20250219",
        ];
      }
    },
  },
  {
    id: "gemini",
    label: "Google Gemini",
    category: "cloud",
    requiresApiKey: true,
    allowCustomBaseUrl: false,
    defaultBaseUrl: "https://generativelanguage.googleapis.com/v1beta",
    apiKeyLabel: "Gemini API key",
    listModels: (baseUrl, apiKey) => fetchGeminiModels(baseUrl, apiKey),
  },
];

export function getProviderById(id: string): ProviderDef | undefined {
  return ALL_PROVIDERS.find((p) => p.id === id);
}
