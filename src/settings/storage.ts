import * as fs from "fs";
import * as path from "path";
import * as os from "os";

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

export interface PersistedApproval {
  name: string;
  expiresAt: number;
}

export interface ChorusSettings {
  version: number;
  approvals?: {
    persistedTools: PersistedApproval[];
  };
}

function getSettingsPath(): string {
  const dir = path.join(os.homedir(), ".chorus");
  fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, "settings.json");
}

function atomicWrite(filePath: string, data: unknown): void {
  const tmp = `${filePath}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), "utf-8");
  fs.renameSync(tmp, filePath);
}

export function loadSettings(): ChorusSettings {
  try {
    return JSON.parse(fs.readFileSync(getSettingsPath(), "utf-8")) as ChorusSettings;
  } catch {
    return { version: 1 };
  }
}

export function saveSettings(settings: ChorusSettings): void {
  const p = getSettingsPath();
  atomicWrite(p, { ...settings, version: 1 });
  try { fs.chmodSync(p, 0o600); } catch { /* non-POSIX systems */ }
}

export function loadPersistedApprovals(): PersistedApproval[] {
  const settings = loadSettings();
  const now = Date.now();
  return (settings.approvals?.persistedTools ?? []).filter((a) => a.expiresAt > now);
}

export function persistApproval(toolName: string): void {
  const settings = loadSettings();
  const now = Date.now();
  const tools = (settings.approvals?.persistedTools ?? [])
    .filter((a) => a.expiresAt > now && a.name !== toolName);
  tools.push({ name: toolName, expiresAt: now + SEVEN_DAYS_MS });
  saveSettings({ ...settings, approvals: { persistedTools: tools } });
}

export function clearPersistedApprovals(): void {
  const settings = loadSettings();
  saveSettings({ ...settings, approvals: { persistedTools: [] } });
}
