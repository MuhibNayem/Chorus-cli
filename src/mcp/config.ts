import * as fs from "fs";
import * as path from "path";
import { createHash } from "crypto";
import { loadSettings, type McpServerSettings } from "../settings/storage.js";

export type McpServerConfig = McpServerSettings & {
  name: string;
  source: "user" | "project";
};

type ProjectMcpConfig = {
  mcpServers?: Record<string, McpServerSettings>;
};

const SERVER_NAME_RE = /^[A-Za-z0-9_.-]{1,64}$/;
const ENV_RE = /\$\{([A-Za-z_][A-Za-z0-9_]*)(?::-([^}]*))?\}/g;
const TRUST_FILE = "trusted-mcp.json";

type TrustedMcpRecord = {
  path: string;
  hash: string;
  trustedAt: string;
};

type TrustedMcpStore = {
  projects?: Record<string, TrustedMcpRecord>;
};

export type ProjectMcpTrust = {
  filePath: string;
  exists: boolean;
  trusted: boolean;
  hash?: string;
};

function getChorusDir(): string {
  const homeDir = process.env.CHORUS_HOME_DIR ?? process.env.HOME ?? process.cwd();
  const dir = path.join(homeDir, ".chorus");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function getTrustPath(): string {
  return path.join(getChorusDir(), TRUST_FILE);
}

function projectConfigPath(cwd: string): string {
  return path.resolve(cwd, ".mcp.json");
}

function hashFile(filePath: string): string | undefined {
  try {
    return createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
  } catch {
    return undefined;
  }
}

function loadTrustStore(): TrustedMcpStore {
  try {
    return JSON.parse(fs.readFileSync(getTrustPath(), "utf-8")) as TrustedMcpStore;
  } catch {
    return {};
  }
}

function saveTrustStore(store: TrustedMcpStore): void {
  const filePath = getTrustPath();
  const tmp = `${filePath}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(store, null, 2), { encoding: "utf-8", mode: 0o600 });
  fs.renameSync(tmp, filePath);
  try {
    fs.chmodSync(filePath, 0o600);
  } catch {
    // Best effort on platforms that do not support chmod.
  }
}

function expandEnv(value: string): string {
  return value.replace(ENV_RE, (_match, name: string, fallback: string | undefined) => {
    const resolved = process.env[name] ?? fallback;
    if (resolved === undefined) {
      throw new Error(`Missing required environment variable: ${name}`);
    }
    return resolved;
  });
}

function expandRecord(record: Record<string, string> | undefined): Record<string, string> | undefined {
  if (!record) return undefined;
  return Object.fromEntries(Object.entries(record).map(([key, value]) => [key, expandEnv(value)]));
}

function expandHeadersHelper(server: McpServerSettings): McpServerSettings["headersHelper"] {
  const helper = server.headersHelper;
  if (!helper) return undefined;
  if (typeof helper === "string") return expandEnv(helper);
  return {
    ...helper,
    command: expandEnv(helper.command),
    args: helper.args?.map(expandEnv),
    env: expandRecord(helper.env),
    cwd: helper.cwd ? expandEnv(helper.cwd) : undefined,
  };
}

function normalizeServer(server: McpServerSettings): McpServerSettings {
  return {
    ...server,
    command: server.command ? expandEnv(server.command) : undefined,
    args: server.args?.map(expandEnv),
    env: expandRecord(server.env),
    cwd: server.cwd ? expandEnv(server.cwd) : undefined,
    url: server.url ? expandEnv(server.url) : undefined,
    headers: expandRecord(server.headers),
    headersHelper: expandHeadersHelper(server),
  };
}

function readProjectConfig(cwd = process.cwd(), requireTrust = true): Record<string, McpServerSettings> {
  if (requireTrust && !getProjectMcpTrust(cwd).trusted) return {};
  const filePath = projectConfigPath(cwd);
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, "utf-8")) as ProjectMcpConfig;
    return parsed.mcpServers ?? {};
  } catch {
    return {};
  }
}

function isValidServer(name: string, server: McpServerSettings): boolean {
  if (!SERVER_NAME_RE.test(name)) return false;
  if (server.enabled === false) return false;
  const type = server.type ?? "stdio";
  if (!["stdio", "http", "sse"].includes(type)) return false;
  if (type === "stdio" && (typeof server.command !== "string" || server.command.trim().length === 0)) return false;
  if ((type === "http" || type === "sse") && (typeof server.url !== "string" || server.url.trim().length === 0)) return false;
  if (server.args && !Array.isArray(server.args)) return false;
  if (server.env && (typeof server.env !== "object" || Array.isArray(server.env))) return false;
  if (server.headers && (typeof server.headers !== "object" || Array.isArray(server.headers))) return false;
  if (server.headersHelper && typeof server.headersHelper !== "string") {
    if (typeof server.headersHelper !== "object" || Array.isArray(server.headersHelper)) return false;
    if (typeof server.headersHelper.command !== "string" || server.headersHelper.command.trim().length === 0) return false;
    if (server.headersHelper.args && !Array.isArray(server.headersHelper.args)) return false;
  }
  if (server.auth) {
    if (typeof server.auth !== "object" || Array.isArray(server.auth)) return false;
    const authType = server.auth.type ?? "none";
    if (!["none", "bearer", "client_credentials"].includes(authType)) return false;
    if (authType === "bearer" && !server.auth.tokenEnv) return false;
    if (authType === "client_credentials" && (!server.auth.clientIdEnv || !server.auth.clientSecretEnv)) return false;
  }
  return true;
}

export function getProjectMcpTrust(cwd = process.cwd()): ProjectMcpTrust {
  const filePath = projectConfigPath(cwd);
  const hash = hashFile(filePath);
  if (!hash) return { filePath, exists: false, trusted: false };
  if (process.env.CHORUS_TRUST_PROJECT_MCP === "1") {
    return { filePath, exists: true, trusted: true, hash };
  }
  const record = loadTrustStore().projects?.[filePath];
  return { filePath, exists: true, trusted: record?.hash === hash, hash };
}

export function trustProjectMcpConfig(cwd = process.cwd()): ProjectMcpTrust {
  const state = getProjectMcpTrust(cwd);
  if (!state.exists || !state.hash) return state;
  const store = loadTrustStore();
  store.projects = {
    ...(store.projects ?? {}),
    [state.filePath]: {
      path: state.filePath,
      hash: state.hash,
      trustedAt: new Date().toISOString(),
    },
  };
  saveTrustStore(store);
  return getProjectMcpTrust(cwd);
}

export function untrustProjectMcpConfig(cwd = process.cwd()): void {
  const filePath = projectConfigPath(cwd);
  const store = loadTrustStore();
  if (store.projects?.[filePath]) {
    delete store.projects[filePath];
    saveTrustStore(store);
  }
}

/** Load Claude-style project .mcp.json plus user ~/.chorus/settings.json MCP servers. */
export function loadMcpServers(cwd = process.cwd()): McpServerConfig[] {
  const userServers = loadSettings().mcp?.servers ?? {};
  const projectServers = readProjectConfig(cwd);
  const merged = new Map<string, McpServerConfig>();

  for (const [name, server] of Object.entries(userServers)) {
    try {
      const normalized = normalizeServer(server);
      if (isValidServer(name, normalized)) {
        merged.set(name, { ...normalized, name, source: "user" });
      }
    } catch {
      // Invalid or unresolved user MCP entries are ignored; /mcp shows only loadable servers.
    }
  }

  for (const [name, server] of Object.entries(projectServers)) {
    try {
      const normalized = normalizeServer(server);
      if (isValidServer(name, normalized)) {
        merged.set(name, { ...normalized, name, source: "project" });
      }
    } catch {
      // Avoid leaking missing secret names into prompts/status output.
    }
  }

  return [...merged.values()];
}

export function formatMcpConfigExample(): string {
  return JSON.stringify({
    mcpServers: {
      filesystem: {
        type: "stdio",
        command: "npx",
        args: ["-y", "@modelcontextprotocol/server-filesystem", process.cwd()],
        env: {},
      },
      sentry: {
        type: "http",
        url: "https://mcp.sentry.dev/mcp",
        auth: {
          type: "bearer",
          tokenEnv: "SENTRY_MCP_TOKEN",
        },
        maxOutputTokens: 25000,
      },
    },
  }, null, 2);
}
