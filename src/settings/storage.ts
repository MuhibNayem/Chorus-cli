import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { getProviderById } from "./providers.js";
import {
  loadEncryptedApiKeys,
  saveEncryptedApiKeys,
  clearSecretsCache,
  migrateFromPlaintext,
} from "./secrets.js";

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
  telegramBotToken?: string;
  telegramAllowedUserIds?: string;
  /** Optional bearer token to authenticate A2A HTTP endpoint requests. */
  a2aBearerToken?: string;
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
    type?: "none" | "bearer" | "client_credentials" | "authorization_code" | "aws_sigv4";
    tokenEnv?: string;
    clientIdEnv?: string;
    clientSecretEnv?: string;
    authorizationUrl?: string;
    tokenUrl?: string;
    scope?: string;
    clientName?: string;
    awsRegion?: string;
    awsService?: string;
    awsProfile?: string;
    awsAccessKeyIdEnv?: string;
    awsSecretAccessKeyEnv?: string;
    awsSessionTokenEnv?: string;
  };
  enabled?: boolean;
  timeoutMs?: number;
  maxOutputTokens?: number;
  envFile?: string;
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
  clearSecretsCache();
}

// ── API key resolution ─────────────────────────────────────────────────────────
// Priority: env var → encrypted store (~/.chorus/api-keys.enc) → plaintext migration

function getStoredApiKeys(): ChorusApiKeys {
  const enc = loadEncryptedApiKeys();
  if (Object.keys(enc).length > 0) return enc;
  // First-run migration: move plaintext keys into encrypted store.
  const plaintext = loadSettings().apiKeys ?? {};
  migrateFromPlaintext(plaintext);
  return plaintext;
}

function envOrKey(envVar: string, settingsKey: keyof ChorusApiKeys): string | undefined {
  return process.env[envVar] ?? getStoredApiKeys()[settingsKey];
}

export function getSerperApiKey(): string | undefined {
  return envOrKey("SERPER_API_KEY", "serper");
}

export function getGoogleCseApiKey(): string | undefined {
  return envOrKey("GOOGLE_CSE_API_KEY", "googleCseKey");
}

export function getGoogleCseId(): string | undefined {
  return envOrKey("GOOGLE_CSE_ID", "googleCseId");
}

export function getWeatherApiKey(): string | undefined {
  return envOrKey("WEATHER_API_KEY", "weather");
}

export function getTelegramBotToken(): string | undefined {
  return envOrKey("TELEGRAM_BOT_TOKEN", "telegramBotToken");
}

export function getTelegramAllowedUserIds(): string | undefined {
  return envOrKey("TELEGRAM_ALLOWED_USER_IDS", "telegramAllowedUserIds");
}

export function getA2ABearerToken(): string | undefined {
  return envOrKey("A2A_BEARER_TOKEN", "a2aBearerToken");
}

export function getApiKeyStatus(): Array<{ label: string; key: keyof ChorusApiKeys; envVar: string; value: string | undefined; fromEnv: boolean }> {
  return [
    { label: "Serper API key",          key: "serper",                envVar: "SERPER_API_KEY",            value: getSerperApiKey(),            fromEnv: !!process.env.SERPER_API_KEY },
    { label: "Google CSE API key",      key: "googleCseKey",          envVar: "GOOGLE_CSE_API_KEY",        value: getGoogleCseApiKey(),         fromEnv: !!process.env.GOOGLE_CSE_API_KEY },
    { label: "Google CSE ID",           key: "googleCseId",           envVar: "GOOGLE_CSE_ID",             value: getGoogleCseId(),             fromEnv: !!process.env.GOOGLE_CSE_ID },
    { label: "Weather API key",         key: "weather",               envVar: "WEATHER_API_KEY",           value: getWeatherApiKey(),           fromEnv: !!process.env.WEATHER_API_KEY },
    { label: "Telegram bot token",      key: "telegramBotToken",      envVar: "TELEGRAM_BOT_TOKEN",        value: getTelegramBotToken(),        fromEnv: !!process.env.TELEGRAM_BOT_TOKEN },
    { label: "Telegram allowed IDs",    key: "telegramAllowedUserIds",envVar: "TELEGRAM_ALLOWED_USER_IDS", value: getTelegramAllowedUserIds(),  fromEnv: !!process.env.TELEGRAM_ALLOWED_USER_IDS },
    { label: "A2A bearer token",        key: "a2aBearerToken",        envVar: "A2A_BEARER_TOKEN",          value: getA2ABearerToken(),          fromEnv: !!process.env.A2A_BEARER_TOKEN },
  ];
}

export function saveApiKeys(keys: ChorusApiKeys): void {
  const existing = getStoredApiKeys();
  saveEncryptedApiKeys({ ...existing, ...keys });
  // Keep settings.json apiKeys blank — everything lives in the encrypted store.
  const settings = loadSettings();
  if (settings.apiKeys && Object.keys(settings.apiKeys).length > 0) {
    settings.apiKeys = {};
    atomicWrite(getSettingsPath(), settings);
    cachedSettings = settings;
  }
}
