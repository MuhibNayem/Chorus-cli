import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { getProviderById } from "./providers.js";

export type ChorusProviderSettings = {
  apiKey?: string;
  baseUrl?: string;
  model?: string;
  summaryModel?: string;
};

export type ModeModelConfig = {
  provider: string;
  model: string;
};

export type ChorusAdvisorSettings = {
  enabled: boolean;
  provider?: string;
  model?: string;
  autoOnComplexTasks?: boolean;
};

export type ChorusApiKeys = {
  serper?: string;
  googleCseKey?: string;
  googleCseId?: string;
  weather?: string;
};

export type McpServerSettings = {
  type?: "stdio" | "http" | "sse";
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  cwd?: string;
  url?: string;
  headers?: Record<string, string>;
  headersHelper?: string | {
    command: string;
    args?: string[];
    env?: Record<string, string>;
    cwd?: string;
    timeoutMs?: number;
  };
  bearerTokenEnv?: string;
  auth?: {
    type?: "none" | "bearer" | "client_credentials";
    tokenEnv?: string;
    clientIdEnv?: string;
    clientSecretEnv?: string;
    scope?: string;
    clientName?: string;
  };
  enabled?: boolean;
  timeoutMs?: number;
  maxOutputTokens?: number;
};

export type ChorusSettings = {
  llm?: {
    provider?: string;
    providers?: Record<string, ChorusProviderSettings>;
    modes?: {
      build?: ModeModelConfig;
      plan?: ModeModelConfig;
    };
    advisor?: ChorusAdvisorSettings;
  };
  apiKeys?: ChorusApiKeys;
  mcp?: {
    servers?: Record<string, McpServerSettings>;
  };
};

let cachedSettings: ChorusSettings | null = null;

function getChorusDir(): string {
  const homeDir = process.env.CHORUS_HOME_DIR ?? os.homedir();
  const dir = path.join(homeDir, ".chorus");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function getSettingsPath(): string {
  return path.join(getChorusDir(), "settings.json");
}

export function loadSettings(): ChorusSettings {
  if (cachedSettings) {
    return cachedSettings;
  }

  try {
    cachedSettings = JSON.parse(fs.readFileSync(getSettingsPath(), "utf-8")) as ChorusSettings;
  } catch {
    cachedSettings = {};
  }

  return cachedSettings;
}

export function getProviderSettings(name: string): ChorusProviderSettings {
  return loadSettings().llm?.providers?.[name] ?? {};
}

export function getGlobalProviderPreference(): string | undefined {
  return loadSettings().llm?.provider;
}

function atomicWrite(filePath: string, data: unknown): void {
  const tmp = `${filePath}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), "utf-8");
  fs.renameSync(tmp, filePath);
}

export function saveSettings(settings: ChorusSettings): void {
  atomicWrite(getSettingsPath(), settings);
  cachedSettings = settings;
  try {
    fs.appendFileSync(
      path.join(getChorusDir(), "save-debug.log"),
      `[${new Date().toISOString()}] saved provider=${settings.llm?.provider ?? "?"}\n`
    );
  } catch { /* never crash on debug log */ }
}

export type LlmSettingsField = string;

export function getMissingLlmSettings(settings: ChorusSettings = loadSettings()): LlmSettingsField[] {
  const providerId = settings.llm?.provider;
  if (!providerId) {
    return ["provider"];
  }

  const provider = getProviderById(providerId);
  const pSettings = settings.llm?.providers?.[providerId] ?? {};
  const missing: LlmSettingsField[] = [];

  if (provider?.allowCustomBaseUrl && !pSettings.baseUrl) {
    missing.push(`${providerId}.baseUrl`);
  }

  if (provider?.requiresApiKey && !pSettings.apiKey) {
    missing.push(`${providerId}.apiKey`);
  }

  if (!pSettings.model) {
    missing.push(`${providerId}.model`);
  }

  return missing;
}

export function hasRequiredLlmSettings(settings: ChorusSettings = loadSettings()): boolean {
  return getMissingLlmSettings(settings).length === 0;
}

export function getModeModelConfig(mode: "build" | "plan"): ModeModelConfig | undefined {
  const settings = loadSettings();
  return settings.llm?.modes?.[mode];
}

export function getAdvisorSettings(): ChorusAdvisorSettings | undefined {
  return loadSettings().llm?.advisor;
}

export function isAdvisorEnabled(): boolean {
  return loadSettings().llm?.advisor?.enabled ?? false;
}

export function clearSettingsCache(): void {
  cachedSettings = null;
}

// ── API key resolution (env wins, settings fallback) ──────────────────────────

function envOrApiKey(envVar: string, settingsKey: keyof ChorusApiKeys): string | undefined {
  return process.env[envVar] ?? loadSettings().apiKeys?.[settingsKey];
}

export function getSerperApiKey(): string | undefined {
  return envOrApiKey("SERPER_API_KEY", "serper");
}

export function getGoogleCseApiKey(): string | undefined {
  return envOrApiKey("GOOGLE_CSE_API_KEY", "googleCseKey");
}

export function getGoogleCseId(): string | undefined {
  return envOrApiKey("GOOGLE_CSE_ID", "googleCseId");
}

export function getWeatherApiKey(): string | undefined {
  return envOrApiKey("WEATHER_API_KEY", "weather");
}

export function getApiKeyStatus(): Array<{ label: string; key: keyof ChorusApiKeys; envVar: string; value: string | undefined; fromEnv: boolean }> {
  return [
    { label: "Serper API key",      key: "serper",       envVar: "SERPER_API_KEY",     value: getSerperApiKey(),     fromEnv: !!process.env.SERPER_API_KEY },
    { label: "Google CSE API key",  key: "googleCseKey", envVar: "GOOGLE_CSE_API_KEY", value: getGoogleCseApiKey(),  fromEnv: !!process.env.GOOGLE_CSE_API_KEY },
    { label: "Google CSE ID",       key: "googleCseId",  envVar: "GOOGLE_CSE_ID",      value: getGoogleCseId(),      fromEnv: !!process.env.GOOGLE_CSE_ID },
    { label: "Weather API key",     key: "weather",      envVar: "WEATHER_API_KEY",     value: getWeatherApiKey(),    fromEnv: !!process.env.WEATHER_API_KEY },
  ];
}

export function saveApiKeys(keys: ChorusApiKeys): void {
  const existing = loadSettings();
  saveSettings({ ...existing, apiKeys: { ...existing.apiKeys, ...keys } });
}
