import { createHash, randomBytes, createCipheriv, createDecipheriv } from "crypto";
import * as fs from "fs";
import * as http from "http";
import * as path from "path";
import { spawn } from "child_process";
import type { OAuthTokens } from "@modelcontextprotocol/sdk/shared/auth.js";
import type { OAuthClientProvider } from "@modelcontextprotocol/sdk/client/auth.js";
import { ClientCredentialsProvider } from "@modelcontextprotocol/sdk/client/auth-extensions.js";
import type { McpServerConfig } from "./config.js";

const ALGORITHM = "aes-256-gcm";
const KEY_LENGTH = 32;
const IV_LENGTH = 12;
const TAG_LENGTH = 16;
const AUTH_STORE_FILE = "mcp-auth.json";

function getChorusDir(): string {
  return path.join(process.env.CHORUS_HOME_DIR ?? process.env.HOME ?? process.cwd(), ".chorus");
}

function ensureChorusDir(): string {
  const dir = getChorusDir();
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function keyFilePath(): string {
  return path.join(ensureChorusDir(), ".mcp-key");
}

function authStorePathRaw(): string {
  return path.join(ensureChorusDir(), AUTH_STORE_FILE);
}

function getOrCreateEncryptionKey(): Buffer {
  const keyPath = keyFilePath();
  try {
    const existing = fs.readFileSync(keyPath);
    if (existing.length === KEY_LENGTH) return existing;
  } catch { /* key doesn't exist yet */ }

  const key = randomBytes(KEY_LENGTH);
  fs.writeFileSync(keyPath, key, { mode: 0o600 });
  return key;
}

function encrypt(data: string): { iv: string; tag: string; ciphertext: string } {
  const key = getOrCreateEncryptionKey();
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(data, "utf-8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    iv: iv.toString("base64"),
    tag: tag.toString("base64"),
    ciphertext: encrypted.toString("base64"),
  };
}

function decrypt(encrypted: { iv: string; tag: string; ciphertext: string }): string {
  const key = getOrCreateEncryptionKey();
  const decipher = createDecipheriv(ALGORITHM, key, Buffer.from(encrypted.iv, "base64"));
  decipher.setAuthTag(Buffer.from(encrypted.tag, "base64"));
  return Buffer.concat([
    decipher.update(Buffer.from(encrypted.ciphertext, "base64")),
    decipher.final(),
  ]).toString("utf-8");
}

type EncryptedBlob = { iv: string; tag: string; ciphertext: string };

type PersistedAuthStorePlain = {
  servers?: Record<string, { tokens?: OAuthTokens }>;
};

function loadAuthStore(): PersistedAuthStorePlain {
  try {
    const raw = fs.readFileSync(authStorePathRaw(), "utf-8");
    try {
      const encrypted = JSON.parse(raw) as EncryptedBlob;
      if (encrypted.iv && encrypted.tag && encrypted.ciphertext) {
        const decrypted = decrypt(encrypted);
        return JSON.parse(decrypted) as PersistedAuthStorePlain;
      }
    } catch {
      // Fallback: might be unencrypted from a previous version
    }
    try {
      const unencrypted = JSON.parse(raw) as PersistedAuthStorePlain;
      if (unencrypted.servers && Object.keys(unencrypted.servers).length > 0) {
        return unencrypted;
      }
    } catch {
      // ignore
    }
    return {};
  } catch {
    return {};
  }
}

function saveAuthStore(store: PersistedAuthStorePlain): void {
  const plaintext = JSON.stringify(store, null, 2);
  const encrypted = encrypt(plaintext);
  const filePath = authStorePathRaw();
  const tmp = `${filePath}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(encrypted, null, 2), { encoding: "utf-8", mode: 0o600 });
  fs.renameSync(tmp, filePath);
  try {
    fs.chmodSync(filePath, 0o600);
  } catch {
    // Best effort
  }
}

export function authStoreKey(config: McpServerConfig): string {
  return createHash("sha256").update(`${config.name}:${config.url ?? config.command ?? ""}`).digest("hex");
}

export function loadTokens(storeKey: string): OAuthTokens | undefined {
  const store = loadAuthStore();
  const entry = store.servers?.[storeKey];
  if (!entry) return undefined;
  if (entry.tokens) return entry.tokens;
  return undefined;
}

export function saveTokens(storeKey: string, tokens: OAuthTokens): void {
  const store = loadAuthStore();
  store.servers = {
    ...(store.servers ?? {}),
    [storeKey]: { tokens },
  };
  saveAuthStore(store);
}

export function clearTokens(storeKey: string): void {
  const store = loadAuthStore();
  if (store.servers) {
    delete store.servers[storeKey];
    saveAuthStore(store);
  }
}

export class PersistentClientCredentialsProvider extends ClientCredentialsProvider {
  private storeKey: string;

  constructor(
    options: ConstructorParameters<typeof ClientCredentialsProvider>[0],
    storeKey: string,
  ) {
    super(options);
    this.storeKey = storeKey;
    const tokens = loadTokens(storeKey);
    if (tokens) super.saveTokens(tokens);
  }

  override tokens(): OAuthTokens | undefined {
    return loadTokens(this.storeKey) ?? super.tokens();
  }

  override saveTokens(tokens: OAuthTokens): void {
    super.saveTokens(tokens);
    saveTokens(this.storeKey, tokens);
  }
}

function openBrowser(url: string): void {
  const platform = process.platform;
  const cmd = platform === "darwin" ? "open" : platform === "win32" ? "start" : "xdg-open";
  const args = platform === "win32" ? ["", url] : [url];
  const child = spawn(cmd, args, { stdio: "ignore", detached: true });
  child.unref();
}

function generateCodeVerifier(): string {
  return randomBytes(32).toString("base64url").slice(0, 128);
}

async function generateCodeChallenge(verifier: string): Promise<string> {
  const hash = createHash("sha256").update(verifier).digest();
  return hash.toString("base64url").replace(/=+$/, "");
}

type OAuthCallbackResult = {
  code: string;
  state: string;
};

function startCallbackServer(port: number, expectedState: string, timeoutMs: number): Promise<OAuthCallbackResult> {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const url = new URL(req.url ?? "/", `http://localhost:${port}`);
      if (url.pathname === "/callback") {
        const code = url.searchParams.get("code");
        const state = url.searchParams.get("state");
        const error = url.searchParams.get("error");

        if (error) {
          res.writeHead(400, { "Content-Type": "text/html" });
          res.end(`<html><body><h1>Authorization Failed</h1><p>${error}: ${url.searchParams.get("error_description") ?? ""}</p><p>You may close this window.</p></body></html>`);
          server.close();
          reject(new Error(`OAuth authorization error: ${error}`));
          return;
        }

        if (!code) {
          res.writeHead(400, { "Content-Type": "text/html" });
          res.end("<html><body><h1>Missing Code</h1><p>No authorization code received.</p></body></html>");
          server.close();
          reject(new Error("No authorization code received in callback"));
          return;
        }

        if (state !== expectedState) {
          res.writeHead(400, { "Content-Type": "text/html" });
          res.end("<html><body><h1>Invalid State</h1><p>State mismatch — possible CSRF attack.</p></body></html>");
          server.close();
          reject(new Error("OAuth state mismatch"));
          return;
        }

        res.writeHead(200, { "Content-Type": "text/html" });
        res.end("<html><body><h1>Authorization Successful</h1><p>You may close this window and return to Chorus.</p></body></html>");
        server.close();
        resolve({ code, state });
      } else {
        res.writeHead(404).end();
      }
    });

    server.on("error", (err) => {
      reject(new Error(`OAuth callback server error: ${err.message}`));
    });

    server.listen(port, "127.0.0.1", () => {
      // server is listening
    });

    const timer = setTimeout(() => {
      server.close();
      reject(new Error(`OAuth authorization timed out after ${timeoutMs / 1000}s`));
    }, timeoutMs);

    const origResolve = resolve;
    resolve = (value) => {
      clearTimeout(timer);
      origResolve(value);
    };
  });
}

function getFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = http.createServer();
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      server.close(() => resolve(port));
    });
    server.on("error", reject);
  });
}

async function exchangeCodeForTokens(
  tokenUrl: string,
  clientId: string,
  clientSecret: string | undefined,
  code: string,
  codeVerifier: string,
  redirectUri: string,
): Promise<OAuthTokens> {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: redirectUri,
    client_id: clientId,
    code_verifier: codeVerifier,
  });
  if (clientSecret) body.set("client_secret", clientSecret);

  const response = await fetch(tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Token exchange failed (${response.status}): ${text}`);
  }

  const data = (await response.json()) as {
    access_token: string;
    token_type: string;
    expires_in?: number;
    refresh_token?: string;
    scope?: string;
  };

  return {
    access_token: data.access_token,
    token_type: data.token_type ?? "Bearer",
    expires_in: data.expires_in,
    refresh_token: data.refresh_token,
    scope: data.scope,
  };
}

async function refreshTokens(
  tokenUrl: string,
  clientId: string,
  clientSecret: string | undefined,
  refreshToken: string,
): Promise<OAuthTokens> {
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
    client_id: clientId,
  });
  if (clientSecret) body.set("client_secret", clientSecret);

  const response = await fetch(tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Token refresh failed (${response.status}): ${text}`);
  }

  const data = (await response.json()) as {
    access_token: string;
    token_type: string;
    expires_in?: number;
    refresh_token?: string;
    scope?: string;
  };

  return {
    access_token: data.access_token,
    token_type: data.token_type ?? "Bearer",
    expires_in: data.expires_in,
    refresh_token: data.refresh_token ?? refreshToken,
    scope: data.scope,
  };
}

export async function runOAuthFlow(config: McpServerConfig): Promise<OAuthTokens> {
  const auth = config.auth;
  if (!auth || auth.type !== "authorization_code") {
    throw new Error(`Server "${config.name}" is not configured for authorization_code auth`);
  }

  const authUrl = auth.authorizationUrl ?? config.url;
  const tokenUrl = auth.tokenUrl ?? `${config.url}/token`;
  const clientId = auth.clientIdEnv ? process.env[auth.clientIdEnv] : undefined;
  const clientSecret = auth.clientSecretEnv ? process.env[auth.clientSecretEnv] : undefined;

  if (!authUrl) throw new Error(`MCP server "${config.name}" is missing authorizationUrl`);
  if (!clientId) throw new Error(`MCP server "${config.name}" is missing clientIdEnv or the env var is not set`);

  const port = await getFreePort();
  const redirectUri = `http://localhost:${port}/callback`;
  const codeVerifier = generateCodeVerifier();
  const codeChallenge = await generateCodeChallenge(codeVerifier);
  const state = randomBytes(16).toString("hex");

  const params = new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    redirect_uri: redirectUri,
    code_challenge: codeChallenge,
    code_challenge_method: "S256",
    state,
    scope: auth.scope ?? "",
  });

  const fullAuthUrl = `${authUrl}?${params.toString()}`;
  const timeoutMs = config.timeoutMs ?? 120_000;

  console.log(`\nOpening browser for MCP server "${config.name}" authorization...\n`);
  console.log(`If the browser doesn't open, visit:\n  ${fullAuthUrl}\n`);

  openBrowser(fullAuthUrl);

  const { code } = await startCallbackServer(port, state, timeoutMs);
  const tokens = await exchangeCodeForTokens(tokenUrl, clientId, clientSecret, code, codeVerifier, redirectUri);

  const storeKey = authStoreKey(config);
  saveTokens(storeKey, tokens);
  console.log(`Authorization complete. Tokens saved for "${config.name}".`);

  return tokens;
}

class AuthorizationCodeProvider implements OAuthClientProvider {
  readonly redirectUrl: string | undefined = undefined;
  private tokensValue: OAuthTokens | undefined;
  private readonly storeKey: string;
  private readonly config: McpServerConfig;

  constructor(config: McpServerConfig) {
    this.storeKey = authStoreKey(config);
    this.config = config;
    this.tokensValue = loadTokens(this.storeKey);
  }

  get clientMetadata() {
    return {
      redirect_uris: [] as string[],
      grant_types: ["authorization_code", "refresh_token"] as string[],
      response_types: ["code"] as string[],
      client_name: this.config.auth?.clientName ?? "chorus-cli",
    };
  }

  clientInformation(): undefined { return undefined; }
  saveCodeVerifier(): void { /* PKCE handled externally through the browser flow */ }
  codeVerifier(): string { return ""; }

  tokens(): OAuthTokens | undefined {
    if (!this.tokensValue) {
      this.tokensValue = loadTokens(this.storeKey);
    }
    return this.tokensValue;
  }

  saveTokens(tokens: OAuthTokens): void {
    this.tokensValue = tokens;
    saveTokens(this.storeKey, tokens);
  }

  redirectToAuthorization(): void { /* handled via runOAuthFlow */ }

  async refreshAccessToken(): Promise<OAuthTokens | null> {
    const existing = this.tokens();
    if (!existing?.refresh_token) return null;

    const auth = this.config.auth;
    const tokenUrl = auth?.tokenUrl ?? `${this.config.url}/token`;
    const clientId = auth?.clientIdEnv ? process.env[auth.clientIdEnv] : undefined;
    const clientSecret = auth?.clientSecretEnv ? process.env[auth.clientSecretEnv] : undefined;

    if (!clientId) throw new Error(`Cannot refresh tokens: missing clientId for "${this.config.name}"`);

    try {
      const tokens = await refreshTokens(tokenUrl, clientId, clientSecret, existing.refresh_token);
      this.saveTokens(tokens);
      return tokens;
    } catch {
      clearTokens(this.storeKey);
      this.tokensValue = undefined;
      return null;
    }
  }
}

class BearerAuthProvider implements OAuthClientProvider {
  readonly redirectUrl: string | undefined = undefined;
  private tokenValue: string;

  constructor(tokenEnv: string) {
    const token = process.env[tokenEnv];
    if (!token) throw new Error(`Bearer auth requires ${tokenEnv} environment variable`);
    this.tokenValue = token;
  }

  get clientMetadata() {
    return {
      redirect_uris: [],
      grant_types: [],
      response_types: [],
      client_name: "chorus-cli",
    };
  }

  clientInformation(): undefined { return undefined; }
  tokens(): OAuthTokens { return { access_token: this.tokenValue, token_type: "Bearer" }; }
  saveTokens(): void { /* no-op */ }
  redirectToAuthorization(): void { /* no-op */ }
  saveCodeVerifier(): void { /* no-op */ }
  codeVerifier(): string { return ""; }
}

export function buildAuthProvider(config: McpServerConfig): OAuthClientProvider | undefined {
  const auth = config.auth;
  if (!auth || auth.type === "none") return undefined;

  if (auth.type === "bearer") {
    const tokenEnv = auth.tokenEnv ?? config.bearerTokenEnv;
    if (!tokenEnv) throw new Error(`MCP server "${config.name}" is missing tokenEnv for bearer auth`);
    return new BearerAuthProvider(tokenEnv);
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

  if (auth.type === "authorization_code") {
    const clientId = auth.clientIdEnv ? process.env[auth.clientIdEnv] : undefined;
    if (!clientId) {
      throw new Error(`MCP server "${config.name}" needs OAuth authorization — run 'chorus mcp auth ${config.name}'`);
    }
    const provider = new AuthorizationCodeProvider(config);
    if (!provider.tokens()) {
      throw new Error(`MCP server "${config.name}" has no valid tokens — run 'chorus mcp auth ${config.name}'`);
    }
    return provider;
  }

  return undefined;
}

export function getAuthStatus(config: McpServerConfig): { type: string; hasToken: boolean; needsAuth: boolean } {
  const auth = config.auth;
  if (!auth || auth.type === "none") return { type: "none", hasToken: true, needsAuth: false };

  if (auth.type === "bearer") {
    const token = auth.tokenEnv ? process.env[auth.tokenEnv] : process.env[config.bearerTokenEnv ?? ""];
    return { type: "bearer", hasToken: !!token, needsAuth: !token };
  }

  if (auth.type === "client_credentials") {
    const clientId = auth.clientIdEnv ? process.env[auth.clientIdEnv] : undefined;
    const clientSecret = auth.clientSecretEnv ? process.env[auth.clientSecretEnv] : undefined;
    const hasStoredTokens = !!loadTokens(authStoreKey(config));
    return { type: "client_credentials", hasToken: !!(clientId && clientSecret) || hasStoredTokens, needsAuth: !clientId || !clientSecret };
  }

  if (auth.type === "authorization_code") {
    const clientId = auth.clientIdEnv ? process.env[auth.clientIdEnv] : undefined;
    const hasTokens = !!loadTokens(authStoreKey(config));
    return { type: "authorization_code", hasToken: hasTokens, needsAuth: !hasTokens || !clientId };
  }

  return { type: "unknown", hasToken: false, needsAuth: false };
}
