import { createHash } from "crypto";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { spawn } from "child_process";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport, getDefaultEnvironment } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { ClientCredentialsProvider } from "@modelcontextprotocol/sdk/client/auth-extensions.js";
import type { OAuthTokens } from "@modelcontextprotocol/sdk/shared/auth.js";
import type { OAuthClientProvider } from "@modelcontextprotocol/sdk/client/auth.js";
import type { Transport, FetchLike } from "@modelcontextprotocol/sdk/shared/transport.js";
import type { AgentTool } from "../agent/types.js";
import { loadMcpServers, type McpServerConfig } from "./config.js";

type McpToolDef = Awaited<ReturnType<Client["listTools"]>>["tools"][number];
type McpResourceDef = Awaited<ReturnType<Client["listResources"]>>["resources"][number];
type ManagedConnection = {
  config: McpServerConfig;
  key: string;
  client: Client;
  transport: Transport;
  connectedAt: number;
  tools: McpToolDef[];
  resources: McpResourceDef[];
  error?: string;
};

export type McpTool = AgentTool & {
  mcpServerName: string;
  mcpToolName?: string;
  mcpReadOnly?: boolean;
};

export type McpServerStatus = {
  name: string;
  source: McpServerConfig["source"];
  command: string;
  connected: boolean;
  toolCount: number;
  resourceCount: number;
  error?: string;
};

const connections = new Map<string, ManagedConnection>();
const DEFAULT_MAX_OUTPUT_TOKENS = 25_000;

function connectionKey(config: McpServerConfig): string {
  return createHash("sha256")
    .update(JSON.stringify({
      name: config.name,
      command: config.command,
      args: config.args ?? [],
      env: config.env ?? {},
      cwd: config.cwd ?? "",
      type: config.type ?? "stdio",
      url: config.url ?? "",
      headers: config.headers ?? {},
      bearerTokenEnv: config.bearerTokenEnv ?? "",
      auth: config.auth ?? {},
      headersHelper: config.headersHelper ?? "",
    }))
    .digest("hex");
}

function sanitizeToolPart(value: string): string {
  return value.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 48);
}

function namespacedToolName(serverName: string, toolName: string): string {
  return `mcp__${sanitizeToolPart(serverName)}__${sanitizeToolPart(toolName)}`;
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs}ms`)), timeoutMs);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

async function connectServer(config: McpServerConfig): Promise<ManagedConnection> {
  const key = connectionKey(config);
  const existing = connections.get(config.name);
  if (existing?.key === key && !existing.error) return existing;

  if (existing) {
    await closeConnection(existing);
    connections.delete(config.name);
  }

  const transport = await createTransport(config);
  const client = new Client(
    { name: "chorus-cli", version: "0.1.4" },
    { capabilities: { roots: { listChanged: true } } },
  );
  const timeoutMs = config.timeoutMs ?? Number(process.env.MCP_TIMEOUT ?? 10_000);

  try {
    await withTimeout(client.connect(transport), timeoutMs, `MCP server "${config.name}" startup`);
    const [toolResult, resourceResult] = await Promise.allSettled([
      withTimeout(client.listTools(), timeoutMs, `MCP server "${config.name}" tools/list`),
      withTimeout(client.listResources(), timeoutMs, `MCP server "${config.name}" resources/list`),
    ]);
    const managed: ManagedConnection = {
      config,
      key,
      client,
      transport,
      connectedAt: Date.now(),
      tools: toolResult.status === "fulfilled" ? toolResult.value.tools : [],
      resources: resourceResult.status === "fulfilled" ? resourceResult.value.resources : [],
      error: toolResult.status === "rejected" ? String(toolResult.reason) : undefined,
    };
    connections.set(config.name, managed);
    return managed;
  } catch (error) {
    const managed: ManagedConnection = {
      config,
      key,
      client,
      transport,
      connectedAt: Date.now(),
      tools: [],
      resources: [],
      error: error instanceof Error ? error.message : String(error),
    };
    connections.set(config.name, managed);
    return managed;
  }
}

function getChorusDir(): string {
  const homeDir = process.env.CHORUS_HOME_DIR ?? os.homedir();
  const dir = path.join(homeDir, ".chorus");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

type PersistedMcpAuth = {
  servers?: Record<string, { tokens?: OAuthTokens }>;
};

function authStorePath(): string {
  return path.join(getChorusDir(), "mcp-auth.json");
}

function authStoreKey(config: McpServerConfig): string {
  return createHash("sha256").update(`${config.name}:${config.url ?? ""}`).digest("hex");
}

function loadAuthStore(): PersistedMcpAuth {
  try {
    return JSON.parse(fs.readFileSync(authStorePath(), "utf-8")) as PersistedMcpAuth;
  } catch {
    return {};
  }
}

function saveAuthStore(store: PersistedMcpAuth): void {
  const filePath = authStorePath();
  const tmp = `${filePath}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(store, null, 2), { encoding: "utf-8", mode: 0o600 });
  fs.renameSync(tmp, filePath);
  try {
    fs.chmodSync(filePath, 0o600);
  } catch {
    // Best effort for Windows and restricted filesystems.
  }
}

class PersistentClientCredentialsProvider extends ClientCredentialsProvider {
  constructor(
    options: ConstructorParameters<typeof ClientCredentialsProvider>[0],
    private readonly storeKey: string,
  ) {
    super(options);
    const tokens = loadAuthStore().servers?.[storeKey]?.tokens;
    if (tokens) super.saveTokens(tokens);
  }

  override tokens(): OAuthTokens | undefined {
    return loadAuthStore().servers?.[this.storeKey]?.tokens ?? super.tokens();
  }

  override saveTokens(tokens: OAuthTokens): void {
    super.saveTokens(tokens);
    const store = loadAuthStore();
    store.servers = {
      ...(store.servers ?? {}),
      [this.storeKey]: { tokens },
    };
    saveAuthStore(store);
  }
}

function buildAuthProvider(config: McpServerConfig): OAuthClientProvider | undefined {
  const auth = config.auth;
  if (!auth || auth.type === "none") return undefined;

  if (auth.type === "bearer") {
    const token = auth.tokenEnv ? process.env[auth.tokenEnv] : undefined;
    if (!token) throw new Error(`MCP server "${config.name}" is missing token env ${auth.tokenEnv}`);
    return {
      redirectUrl: undefined,
      clientMetadata: {
        redirect_uris: [],
        grant_types: [],
        response_types: [],
        client_name: "chorus-cli",
      },
      clientInformation: () => undefined,
      tokens: () => ({ access_token: token, token_type: "Bearer" }),
      saveTokens: () => undefined,
      redirectToAuthorization: () => undefined,
      saveCodeVerifier: () => undefined,
      codeVerifier: () => "",
    };
  }

  if (auth.type === "client_credentials") {
    const clientId = auth.clientIdEnv ? process.env[auth.clientIdEnv] : undefined;
    const clientSecret = auth.clientSecretEnv ? process.env[auth.clientSecretEnv] : undefined;
    if (!clientId || !clientSecret) {
      throw new Error(`MCP server "${config.name}" is missing OAuth client credential env vars`);
    }
    return new PersistentClientCredentialsProvider({
      clientId,
      clientSecret,
      clientName: auth.clientName ?? "chorus-cli",
      scope: auth.scope,
    }, authStoreKey(config));
  }

  return undefined;
}

function parseHelperHeaders(output: string, serverName: string): Record<string, string> {
  const parsed = JSON.parse(output) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`MCP headers helper for "${serverName}" must print a JSON object`);
  }

  const headers: Record<string, string> = {};
  for (const [key, value] of Object.entries(parsed)) {
    if (typeof value !== "string") {
      throw new Error(`MCP headers helper for "${serverName}" returned non-string header "${key}"`);
    }
    headers[key] = value;
  }
  return headers;
}

async function runHeadersHelper(config: McpServerConfig): Promise<Record<string, string>> {
  const helper = config.headersHelper;
  if (!helper) return {};
  const command = typeof helper === "string" ? helper : helper.command;
  const args = typeof helper === "string" ? [] : helper.args ?? [];
  const timeoutMs = typeof helper === "string" ? config.timeoutMs ?? 10_000 : helper.timeoutMs ?? config.timeoutMs ?? 10_000;

  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: typeof helper === "string" ? config.cwd : helper.cwd ?? config.cwd,
      env: {
        ...process.env,
        ...(typeof helper === "string" ? {} : helper.env ?? {}),
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error(`MCP headers helper for "${config.name}" timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    child.stdout.on("data", (chunk) => { stdout += String(chunk); });
    child.stderr.on("data", (chunk) => { stderr += String(chunk); });
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        reject(new Error(`MCP headers helper for "${config.name}" exited ${code}: ${stderr.trim()}`));
        return;
      }
      try {
        resolve(parseHelperHeaders(stdout, config.name));
      } catch (error) {
        reject(error);
      }
    });
  });
}

async function buildHeaders(config: McpServerConfig): Promise<Record<string, string>> {
  const headers: Record<string, string> = { ...(config.headers ?? {}) };
  if (config.bearerTokenEnv) {
    const token = process.env[config.bearerTokenEnv];
    if (token && !headers.Authorization && !headers.authorization) {
      headers.Authorization = `Bearer ${token}`;
    }
  }
  Object.assign(headers, await runHeadersHelper(config));
  return headers;
}

async function createTransport(config: McpServerConfig): Promise<Transport> {
  const type = config.type ?? "stdio";
  if (type === "stdio") {
    return new StdioClientTransport({
      command: config.command!,
      args: config.args ?? [],
      cwd: config.cwd,
      env: { ...getDefaultEnvironment(), ...(config.env ?? {}) },
      stderr: "pipe",
    });
  }

  const headers = await buildHeaders(config);
  const authProvider = buildAuthProvider(config);
  const requestInit: RequestInit = Object.keys(headers).length > 0 ? { headers } : {};

  if (type === "sse") {
    const fetchWithHeaders: FetchLike = (url, init) => fetch(url, {
      ...init,
      headers: { ...headers, ...(init?.headers as Record<string, string> | undefined ?? {}) },
    });
    return new SSEClientTransport(new URL(config.url!), {
      authProvider,
      requestInit,
      eventSourceInit: Object.keys(headers).length > 0 ? { fetch: fetchWithHeaders } : undefined,
      fetch: fetchWithHeaders,
    });
  }

  return new StreamableHTTPClientTransport(new URL(config.url!), { authProvider, requestInit });
}

async function closeConnection(connection: ManagedConnection): Promise<void> {
  try {
    await connection.client.close();
  } catch {
    try {
      await connection.transport.close();
    } catch {
      // ignore shutdown failures
    }
  }
}

function outputTokenLimit(config: McpServerConfig): number {
  const envLimit = process.env.CHORUS_MCP_MAX_OUTPUT_TOKENS ?? process.env.MAX_MCP_OUTPUT_TOKENS;
  const parsed = envLimit ? Number(envLimit) : undefined;
  return config.maxOutputTokens ?? (Number.isFinite(parsed) && parsed! > 0 ? parsed! : DEFAULT_MAX_OUTPUT_TOKENS);
}

function capMcpOutput(output: string, config: McpServerConfig): string {
  const maxTokens = outputTokenLimit(config);
  const maxChars = Math.max(1_000, maxTokens * 4);
  if (output.length <= maxChars) return output;
  return `${output.slice(0, maxChars)}\n\n[Chorus truncated MCP output at ${maxTokens.toLocaleString()} tokens. Set maxOutputTokens or CHORUS_MCP_MAX_OUTPUT_TOKENS to change this.]`;
}

function formatCallToolResult(result: Awaited<ReturnType<Client["callTool"]>>, config: McpServerConfig): string {
  if ("toolResult" in result) {
    const output = typeof result.toolResult === "string" ? result.toolResult : JSON.stringify(result.toolResult, null, 2);
    return capMcpOutput(output, config);
  }

  const sections: string[] = [];
  if (result.structuredContent) {
    sections.push(`Structured content:\n${JSON.stringify(result.structuredContent, null, 2)}`);
  }

  for (const item of result.content ?? []) {
    if (item.type === "text") {
      sections.push(item.text);
    } else if (item.type === "resource") {
      const resource = item.resource;
      sections.push("text" in resource
        ? `[Resource ${resource.uri}]\n${resource.text}`
        : `[Binary resource ${resource.uri} ${resource.mimeType ?? ""}]`);
    } else if (item.type === "resource_link") {
      sections.push(`[Resource link ${item.uri}] ${item.name}${item.description ? ` - ${item.description}` : ""}`);
    } else if (item.type === "image" || item.type === "audio") {
      sections.push(`[${item.type} content ${item.mimeType}, ${item.data.length} base64 chars]`);
    }
  }

  const output = sections.join("\n\n").trim() || "(empty MCP tool result)";
  return capMcpOutput(result.isError ? `MCP tool returned an error:\n${output}` : output, config);
}

function createToolWrapper(connection: ManagedConnection, tool: McpToolDef): McpTool {
  return {
    name: namespacedToolName(connection.config.name, tool.name),
    description: `[MCP:${connection.config.name}] ${tool.description ?? tool.title ?? tool.name}`,
    schema: tool.inputSchema,
    mcpServerName: connection.config.name,
    mcpToolName: tool.name,
    mcpReadOnly: tool.annotations?.readOnlyHint === true && tool.annotations?.destructiveHint !== true,
    async invoke(input: unknown) {
      const result = await connection.client.callTool({
        name: tool.name,
        arguments: input && typeof input === "object" ? input as Record<string, unknown> : {},
      });
      return formatCallToolResult(result, connection.config);
    },
  };
}

function createResourceTools(connection: ManagedConnection): McpTool[] {
  const server = connection.config.name;
  return [
    {
      name: namespacedToolName(server, "list_resources"),
      description: `[MCP:${server}] List resources exposed by this MCP server.`,
      schema: { type: "object", properties: {}, additionalProperties: false },
      mcpServerName: server,
      mcpReadOnly: true,
      async invoke() {
        const result = await connection.client.listResources();
        return capMcpOutput(result.resources
          .map((r) => `${r.uri}  ${r.name}${r.description ? ` - ${r.description}` : ""}`)
          .join("\n") || "(no MCP resources)", connection.config);
      },
    },
    {
      name: namespacedToolName(server, "read_resource"),
      description: `[MCP:${server}] Read a resource by URI from this MCP server.`,
      schema: {
        type: "object",
        properties: { uri: { type: "string", description: "Resource URI to read." } },
        required: ["uri"],
        additionalProperties: false,
      },
      mcpServerName: server,
      mcpReadOnly: true,
      async invoke(input: unknown) {
        const uri = (input as { uri?: string } | undefined)?.uri;
        if (!uri) throw new Error("Missing required MCP resource URI.");
        const result = await connection.client.readResource({ uri });
        return capMcpOutput(result.contents.map((content) => (
          "text" in content
            ? `[${content.uri}]\n${content.text}`
            : `[${content.uri}] binary ${content.mimeType ?? "application/octet-stream"} ${content.blob.length} base64 chars`
        )).join("\n\n"), connection.config);
      },
    },
  ];
}

export async function getMcpTools(): Promise<McpTool[]> {
  const configs = loadMcpServers();
  if (configs.length === 0) return [];

  const connections = await Promise.all(configs.map(connectServer));
  return connections.flatMap((connection) => {
    if (connection.error) return [];
    return [
      ...connection.tools.map((tool) => createToolWrapper(connection, tool)),
      ...createResourceTools(connection),
    ];
  });
}

export async function getMcpStatus(): Promise<McpServerStatus[]> {
  const configs = loadMcpServers();
  await Promise.all(configs.map(connectServer));
  return configs.map((config) => {
    const connection = connections.get(config.name);
    return {
      name: config.name,
      source: config.source,
      command: formatServerEndpoint(config),
      connected: !!connection && !connection.error,
      toolCount: connection?.tools.length ?? 0,
      resourceCount: connection?.resources.length ?? 0,
      error: connection?.error,
    };
  });
}

function formatServerEndpoint(config: McpServerConfig): string {
  if ((config.type ?? "stdio") === "stdio") {
    return [config.command, ...(config.args ?? [])].filter(Boolean).join(" ");
  }
  return `${config.type}: ${config.url}`;
}

export async function reloadMcpConnections(): Promise<McpServerStatus[]> {
  const current = [...connections.values()];
  connections.clear();
  await Promise.all(current.map(closeConnection));
  return getMcpStatus();
}

export async function closeMcpConnections(): Promise<void> {
  const current = [...connections.values()];
  connections.clear();
  await Promise.all(current.map(closeConnection));
}
