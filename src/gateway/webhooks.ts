import { createHmac, timingSafeEqual } from "crypto";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

export interface WebhookRouteConfig {
  hmacSecret: string;
  template: string;
  description?: string;
}

let routeConfig: Record<string, WebhookRouteConfig> = {};

function getConfigPath(): string {
  const dir = path.join(process.env.CHORUS_HOME_DIR ?? os.homedir(), ".chorus");
  return path.join(dir, "webhooks.json");
}

export function loadWebhookConfig(): void {
  const cfgPath = getConfigPath();
  try {
    const raw = fs.readFileSync(cfgPath, "utf-8");
    const parsed = JSON.parse(raw) as { routes: Record<string, WebhookRouteConfig> };
    routeConfig = parsed.routes ?? {};
    const count = Object.keys(routeConfig).length;
    if (count > 0) {
      console.log(`Chorus webhooks: ${count} route(s) loaded from ${cfgPath}`);
    }
  } catch {
    routeConfig = {};
  }
}

export function getWebhookRoute(name: string): WebhookRouteConfig | undefined {
  return routeConfig[name];
}

export function validateSignature(
  body: Buffer,
  signature: string,
  secret: string,
): boolean {
  if (!signature || !secret) return false;
  const expected = createHmac("sha256", secret).update(body).digest("hex");
  const provided = signature.startsWith("sha256=") ? signature.slice(7) : signature;
  if (expected.length !== provided.length) return false;
  return timingSafeEqual(Buffer.from(expected), Buffer.from(provided));
}

export function renderTemplate(template: string, payload: unknown): string {
  return template.replace(/\{\{([^}]+)\}\}/g, (_match, pathStr) => {
    const val = deepGet(payload, (pathStr as string).trim());
    if (val === undefined || val === null) return "";
    if (typeof val === "object") return JSON.stringify(val);
    return String(val);
  });
}

function deepGet(obj: unknown, path: string): unknown {
  const keys = path.split(".");
  let current: unknown = obj;
  for (const key of keys) {
    if (current === null || current === undefined) return undefined;
    if (typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[key];
  }
  return current;
}
