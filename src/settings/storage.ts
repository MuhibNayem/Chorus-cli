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

export type ChorusSettings = {
  llm?: {
    provider?: string;
    providers?: Record<string, ChorusProviderSettings>;
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

export function clearSettingsCache(): void {
  cachedSettings = null;
}
