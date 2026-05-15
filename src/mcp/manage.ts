import { loadSettings, saveSettings, type McpServerSettings } from "../settings/storage.js";
import { getMcpStatus } from "./client.js";
import { formatMcpConfigExample, getProjectMcpTrust, trustProjectMcpConfig, untrustProjectMcpConfig, loadMcpServers } from "./config.js";
import { runOAuthFlow, getAuthStatus, clearTokens, authStoreKey } from "./auth.js";

type ParsedMcpAdd = {
  name: string;
  server: McpServerSettings;
};

function requireValue(args: string[], index: number, flag: string): string {
  const value = args[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`Missing value for ${flag}`);
  return value;
}

function parseKeyValue(value: string, flag: string): [string, string] {
  const index = value.indexOf("=");
  if (index <= 0) throw new Error(`${flag} must be KEY=VALUE`);
  return [value.slice(0, index), value.slice(index + 1)];
}

function parseAdd(args: string[]): ParsedMcpAdd {
  const name = args[0];
  if (!name) throw new Error("Usage: chorus mcp add <name> --type stdio --command <cmd> [--arg value]");

  const server: McpServerSettings = { type: "stdio" };
  for (let i = 1; i < args.length; i += 1) {
    const flag = args[i];
    if (flag === "--type" || flag === "--transport") {
      const type = requireValue(args, i, flag);
      if (!["stdio", "http", "sse"].includes(type)) throw new Error("--type must be stdio, http, or sse");
      server.type = type as McpServerSettings["type"];
      i += 1;
    } else if (flag === "--command") {
      server.command = requireValue(args, i, flag);
      i += 1;
    } else if (flag === "--arg") {
      server.args = [...(server.args ?? []), requireValue(args, i, flag)];
      i += 1;
    } else if (flag === "--url") {
      server.url = requireValue(args, i, flag);
      i += 1;
    } else if (flag === "--env") {
      const [key, value] = parseKeyValue(requireValue(args, i, flag), flag);
      server.env = { ...(server.env ?? {}), [key]: value };
      i += 1;
    } else if (flag === "--header") {
      const [key, value] = parseKeyValue(requireValue(args, i, flag), flag);
      server.headers = { ...(server.headers ?? {}), [key]: value };
      i += 1;
    } else if (flag === "--cwd") {
      server.cwd = requireValue(args, i, flag);
      i += 1;
    } else if (flag === "--bearer-token-env") {
      server.bearerTokenEnv = requireValue(args, i, flag);
      i += 1;
    } else if (flag === "--client-id-env") {
      server.auth = { ...(server.auth ?? {}), type: "client_credentials", clientIdEnv: requireValue(args, i, flag) };
      i += 1;
    } else if (flag === "--client-secret-env") {
      server.auth = { ...(server.auth ?? {}), type: "client_credentials", clientSecretEnv: requireValue(args, i, flag) };
      i += 1;
    } else if (flag === "--scope") {
      server.auth = { ...(server.auth ?? {}), scope: requireValue(args, i, flag) };
      i += 1;
    } else {
      throw new Error(`Unknown MCP add option: ${flag}`);
    }
  }

  if ((server.type ?? "stdio") === "stdio" && !server.command) throw new Error("stdio MCP servers require --command");
  if ((server.type === "http" || server.type === "sse") && !server.url) throw new Error(`${server.type} MCP servers require --url`);
  return { name, server };
}

export async function runMcpCliCommand(args: string[]): Promise<number> {
  const subcommand = args[0] ?? "list";

  if (subcommand === "list") {
    const trust = getProjectMcpTrust();
    if (trust.exists && !trust.trusted) {
      console.log(`Project .mcp.json is not trusted: ${trust.filePath}`);
      console.log("Run `chorus mcp trust` after reviewing it.");
    }
    const statuses = await getMcpStatus();
    if (statuses.length === 0) {
      console.log(`No MCP servers configured.\n\nExample .mcp.json:\n${formatMcpConfigExample()}`);
      return 0;
    }
    for (const s of statuses) {
      const stateIcon = s.connected ? "✓" : s.state === "connecting" ? "⟳" : s.needsAuth ? "🔒" : "✗";
      const detail = s.connected
        ? `${s.toolCount} tools, ${s.resourceCount} resources`
        : s.needsAuth
          ? `needs auth (${s.authType}) — run 'chorus mcp auth ${s.name}'`
          : s.error ?? "failed";
      const authTag = s.authType !== "none" ? ` [${s.authType}]` : "";
      console.log(`${stateIcon} ${s.name}${authTag}\t${s.state}\t${s.source}\t${detail}\t${s.command}`);
    }
    return 0;
  }

  if (subcommand === "trust") {
    const trust = trustProjectMcpConfig();
    if (!trust.exists) {
      console.error("No .mcp.json found in this workspace.");
      return 1;
    }
    console.log(`Trusted project MCP config: ${trust.filePath}`);
    return 0;
  }

  if (subcommand === "untrust") {
    untrustProjectMcpConfig();
    console.log("Removed trust for this workspace .mcp.json.");
    return 0;
  }

  if (subcommand === "remove") {
    const name = args[1];
    if (!name) throw new Error("Usage: chorus mcp remove <name>");
    const settings = loadSettings();
    const servers = { ...(settings.mcp?.servers ?? {}) };
    delete servers[name];
    saveSettings({ ...settings, mcp: { ...(settings.mcp ?? {}), servers } });
    console.log(`Removed user MCP server: ${name}`);
    return 0;
  }

  if (subcommand === "add-json") {
    const name = args[1];
    const json = args[2];
    if (!name || !json) throw new Error("Usage: chorus mcp add-json <name> '<json>'");
    const server = JSON.parse(json) as McpServerSettings;
    const settings = loadSettings();
    saveSettings({
      ...settings,
      mcp: {
        ...(settings.mcp ?? {}),
        servers: { ...(settings.mcp?.servers ?? {}), [name]: server },
      },
    });
    console.log(`Added user MCP server: ${name}`);
    return 0;
  }

  if (subcommand === "add") {
    const { name, server } = parseAdd(args.slice(1));
    const settings = loadSettings();
    saveSettings({
      ...settings,
      mcp: {
        ...(settings.mcp ?? {}),
        servers: { ...(settings.mcp?.servers ?? {}), [name]: server },
      },
    });
    console.log(`Added user MCP server: ${name}`);
    return 0;
  }

  if (subcommand === "auth") {
    const name = args[1];
    if (!name) throw new Error("Usage: chorus mcp auth <server-name>");

    const configs = loadMcpServers();
    const config = configs.find((c) => c.name === name);
    if (!config) throw new Error(`MCP server "${name}" not found in configuration.`);

    const auth = getAuthStatus(config);
    if (auth.type === "none") {
      console.log(`Server "${name}" does not require authentication.`);
      return 0;
    }

    if (auth.type !== "authorization_code") {
      console.log(`Server "${name}" uses ${auth.type} auth — no browser flow needed.`);
      if (auth.needsAuth) {
        console.log(`Set the required environment variables and re-run.`);
      }
      return auth.needsAuth ? 1 : 0;
    }

    try {
      await runOAuthFlow(config);
    } catch (error) {
      console.error(`OAuth flow failed: ${error instanceof Error ? error.message : String(error)}`);
      return 1;
    }
    return 0;
  }

  if (subcommand === "unauth") {
    const name = args[1];
    if (!name) throw new Error("Usage: chorus mcp unauth <server-name>");

    const configs = loadMcpServers();
    const config = configs.find((c) => c.name === name);
    if (!config) throw new Error(`MCP server "${name}" not found in configuration.`);

    clearTokens(authStoreKey(config));
    console.log(`Cleared stored tokens for "${name}".`);
    return 0;
  }

  console.error("Usage: chorus mcp list | trust | untrust | add | add-json | remove | auth | unauth");
  return 1;
}
