/**
 * A2A Server — exposes a Chorus swarm (or any agent) as an A2A-compatible endpoint.
 *
 * Implements the Google A2A JSON-RPC 2.0 protocol over HTTP.
 * Endpoints:
 *   GET  /.well-known/agent.json  → AgentCard (public)
 *   GET  /tasks                   → list all persisted tasks (auth required)
 *   POST /tasks                   → tasks/send, tasks/get, tasks/cancel
 *   POST /tasks/stream            → tasks/sendSubscribe (SSE)
 *   POST /tasks/schedule          → schedule a one-shot or recurring task
 *   POST /tasks/goal              → start a goal-driven autonomous task
 *   POST /webhooks/:route         → external webhook (HMAC signed, queues a task)
 *
 * Security:
 *   - Optional Bearer token auth on POST routes (set bearerToken in config)
 *   - Request body size limit (default 64 KB)
 *   - Per-IP rate limiting (60 req/min by default)
 *   - Error messages sanitized — no internal paths or keys in responses
 */

import * as http from "http";
import { randomUUID } from "crypto";
import { RateLimiter } from "../gateway/rate-limiter.js";
import { sanitizeError, validateInput } from "../gateway/sanitize.js";
import { getWebhookRoute, validateSignature, renderTemplate } from "../gateway/webhooks.js";
import { taskStore } from "../persistence/taskStore.js";
import { validateCron } from "../scheduler/cron.js";
import type {
  AgentCard,
  Task,
  TaskSendParams,
  JsonRpcRequest,
  JsonRpcResponse,
  TaskStreamEvent,
} from "./types.js";
import type { Scheduler } from "../scheduler/index.js";

const BODY_LIMIT_BYTES = 64 * 1024; // 64 KB

export interface A2AServerConfig {
  port?: number;
  host?: string;
  card: Omit<AgentCard, "endpoints">;
  /** Handler that processes a task input and returns the result text */
  handleTask: (input: string, taskId: string) => AsyncGenerator<string> | Promise<string>;
  /**
   * If set, all POST /tasks* requests must include
   * `Authorization: Bearer <token>` matching this value.
   * The agent card endpoint is always public.
   */
  bearerToken?: string;
  /** Max requests per IP per minute (default: 60). */
  rateLimit?: number;
  /** Scheduler instance — required for /tasks/schedule and /tasks/goal endpoints. */
  scheduler?: Scheduler;
}

export class A2AServer {
  private server: http.Server;
  private config: A2AServerConfig;
  private port: number;
  private host: string;
  private limiter: RateLimiter;

  constructor(config: A2AServerConfig) {
    this.config = config;
    this.port = config.port ?? 3210;
    this.host = config.host ?? "127.0.0.1";
    this.limiter = new RateLimiter(config.rateLimit ?? 60, 60_000);
    this.server = http.createServer((req, res) => {
      void this.handleRequest(req, res);
    });
  }

  start(): Promise<void> {
    return new Promise((resolve) => {
      this.server.listen(this.port, this.host, () => resolve());
    });
  }

  stop(): Promise<void> {
    this.limiter.dispose();
    return new Promise((resolve, reject) => {
      this.server.close((err) => (err ? reject(err) : resolve()));
    });
  }

  get baseUrl(): string {
    return `http://${this.host}:${this.port}`;
  }

  private agentCard(): AgentCard {
    return {
      ...this.config.card,
      endpoints: {
        tasks: `${this.baseUrl}/tasks`,
        wellKnown: `${this.baseUrl}/.well-known/agent.json`,
      },
    };
  }

  private clientIp(req: http.IncomingMessage): string {
    const forwarded = req.headers["x-forwarded-for"];
    if (typeof forwarded === "string") return forwarded.split(",")[0]!.trim();
    return req.socket.remoteAddress ?? "unknown";
  }

  private isAuthorized(req: http.IncomingMessage): boolean {
    if (!this.config.bearerToken) return true;
    const auth = req.headers.authorization ?? "";
    return auth === `Bearer ${this.config.bearerToken}`;
  }

  private async handleRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const url = new URL(req.url ?? "/", `http://${req.headers.host}`);
    const cors = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
    };

    if (req.method === "OPTIONS") {
      res.writeHead(204, cors);
      res.end();
      return;
    }

    // Agent card is always public — no auth or rate limiting.
    if (req.method === "GET" && url.pathname === "/.well-known/agent.json") {
      res.writeHead(200, { "Content-Type": "application/json", ...cors });
      res.end(JSON.stringify(this.agentCard()));
      return;
    }

    if (req.method === "GET" && url.pathname === "/health") {
      res.writeHead(200, { "Content-Type": "application/json", ...cors });
      res.end(JSON.stringify({ status: "ok", ts: Date.now() }));
      return;
    }

    // Authenticated GET: list all persisted tasks.
    if (req.method === "GET" && url.pathname === "/tasks") {
      const ip = this.clientIp(req);
      const rl = this.limiter.check(ip);
      if (!rl.allowed) {
        res.writeHead(429, { "Content-Type": "application/json", "Retry-After": String(Math.ceil(rl.retryAfterMs / 1000)), ...cors });
        res.end(JSON.stringify({ error: "Too many requests" }));
        return;
      }
      if (!this.isAuthorized(req)) {
        res.writeHead(401, { "Content-Type": "application/json", "WWW-Authenticate": "Bearer", ...cors });
        res.end(JSON.stringify({ error: "Unauthorized" }));
        return;
      }
      const stateFilter = url.searchParams.get("state");
      const tasks = stateFilter
        ? taskStore.list().filter((t) => t.state === stateFilter)
        : taskStore.list();
      res.writeHead(200, { "Content-Type": "application/json", ...cors });
      res.end(JSON.stringify({ tasks }));
      return;
    }

    // All POST routes: check rate limit then auth.
    if (req.method === "POST") {
      const ip = this.clientIp(req);
      const rl = this.limiter.check(ip);
      if (!rl.allowed) {
        res.writeHead(429, {
          "Content-Type": "application/json",
          "Retry-After": String(Math.ceil(rl.retryAfterMs / 1000)),
          ...cors,
        });
        res.end(JSON.stringify({ error: "Too many requests" }));
        return;
      }

      if (!this.isAuthorized(req)) {
        res.writeHead(401, { "Content-Type": "application/json", "WWW-Authenticate": "Bearer", ...cors });
        res.end(JSON.stringify({ error: "Unauthorized" }));
        return;
      }

      if (url.pathname === "/tasks") {
        let body: string;
        try { body = await readBody(req, BODY_LIMIT_BYTES); }
        catch { res.writeHead(413, cors); res.end(JSON.stringify({ error: "Payload too large" })); return; }

        let rpc: JsonRpcRequest;
        try { rpc = JSON.parse(body) as JsonRpcRequest; }
        catch { res.writeHead(400, cors); res.end(JSON.stringify({ error: "Invalid JSON" })); return; }

        const response = await this.handleRpc(rpc);
        res.writeHead(200, { "Content-Type": "application/json", ...cors });
        res.end(JSON.stringify(response));
        return;
      }

      if (url.pathname === "/tasks/stream") {
        let body: string;
        try { body = await readBody(req, BODY_LIMIT_BYTES); }
        catch { res.writeHead(413, cors); res.end(JSON.stringify({ error: "Payload too large" })); return; }

        let rpc: JsonRpcRequest;
        try { rpc = JSON.parse(body) as JsonRpcRequest; }
        catch { res.writeHead(400, cors); res.end(JSON.stringify({ error: "Invalid JSON" })); return; }

        res.writeHead(200, {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          Connection: "keep-alive",
          ...cors,
        });
        await this.handleStreamRpc(rpc, res);
        return;
      }

      // Schedule a one-shot or recurring task via the autonomous scheduler.
      if (url.pathname === "/tasks/schedule") {
        if (!this.config.scheduler) {
          res.writeHead(503, { "Content-Type": "application/json", ...cors });
          res.end(JSON.stringify({ error: "Scheduler not enabled" }));
          return;
        }
        let body: string;
        try { body = await readBody(req, BODY_LIMIT_BYTES); }
        catch { res.writeHead(413, cors); res.end(JSON.stringify({ error: "Payload too large" })); return; }

        let parsed: { input: string; scheduledFor?: string; cronExpr?: string; metadata?: Record<string, unknown> };
        try { parsed = JSON.parse(body) as typeof parsed; }
        catch { res.writeHead(400, cors); res.end(JSON.stringify({ error: "Invalid JSON" })); return; }

        const validation = validateInput(parsed.input ?? "");
        if (!validation.ok) {
          res.writeHead(422, { "Content-Type": "application/json", ...cors });
          res.end(JSON.stringify({ error: validation.reason }));
          return;
        }

        let taskId: string;
        if (parsed.cronExpr) {
          const cronErr = validateCron(parsed.cronExpr);
          if (cronErr) {
            res.writeHead(422, { "Content-Type": "application/json", ...cors });
            res.end(JSON.stringify({ error: `Invalid cron expression: ${cronErr}` }));
            return;
          }
          taskId = this.config.scheduler.scheduleCron(validation.text, parsed.cronExpr, parsed.metadata);
        } else {
          const at = parsed.scheduledFor ? new Date(parsed.scheduledFor) : undefined;
          taskId = this.config.scheduler.scheduleOnce(validation.text, at, parsed.metadata);
        }

        res.writeHead(201, { "Content-Type": "application/json", ...cors });
        res.end(JSON.stringify({ taskId, status: "queued" }));
        return;
      }

      // Start a goal-driven autonomous task.
      if (url.pathname === "/tasks/goal") {
        if (!this.config.scheduler) {
          res.writeHead(503, { "Content-Type": "application/json", ...cors });
          res.end(JSON.stringify({ error: "Scheduler not enabled" }));
          return;
        }
        let body: string;
        try { body = await readBody(req, BODY_LIMIT_BYTES); }
        catch { res.writeHead(413, cors); res.end(JSON.stringify({ error: "Payload too large" })); return; }

        let parsed: { input: string; goalCondition: string; metadata?: Record<string, unknown> };
        try { parsed = JSON.parse(body) as typeof parsed; }
        catch { res.writeHead(400, cors); res.end(JSON.stringify({ error: "Invalid JSON" })); return; }

        const validation = validateInput(parsed.input ?? "");
        if (!validation.ok) {
          res.writeHead(422, { "Content-Type": "application/json", ...cors });
          res.end(JSON.stringify({ error: validation.reason }));
          return;
        }
        if (!parsed.goalCondition?.trim()) {
          res.writeHead(422, { "Content-Type": "application/json", ...cors });
          res.end(JSON.stringify({ error: "goalCondition is required" }));
          return;
        }

        const taskId = this.config.scheduler.scheduleGoal(validation.text, parsed.goalCondition.trim(), parsed.metadata);
        res.writeHead(201, { "Content-Type": "application/json", ...cors });
        res.end(JSON.stringify({ taskId, status: "queued", goalCondition: parsed.goalCondition.trim() }));
        return;
      }

      // Webhook routes — external events queued as agent tasks.
      if (req.method === "POST" && typeof url.pathname === "string" && url.pathname.startsWith("/webhooks/")) {
        if (!this.config.scheduler) {
          res.writeHead(503, { "Content-Type": "application/json", ...cors });
          res.end(JSON.stringify({ error: "Scheduler not enabled" }));
          return;
        }
        const routeName = url.pathname.slice("/webhooks/".length);
        const route = getWebhookRoute(routeName);
        if (!route) {
          res.writeHead(404, { "Content-Type": "application/json", ...cors });
          res.end(JSON.stringify({ error: `Webhook route not found: ${routeName}` }));
          return;
        }

        let rawBody: Buffer;
        try { rawBody = await readRawBody(req, BODY_LIMIT_BYTES); }
        catch { res.writeHead(413, cors); res.end(JSON.stringify({ error: "Payload too large" })); return; }

        const signature = (req.headers["x-hub-signature-256"] as string) ?? "";
        if (!validateSignature(rawBody, signature, route.hmacSecret)) {
          res.writeHead(401, { "Content-Type": "application/json", ...cors });
          res.end(JSON.stringify({ error: "Invalid signature" }));
          return;
        }

        let payload: unknown;
        try { payload = JSON.parse(rawBody.toString("utf-8")); }
        catch { res.writeHead(400, cors); res.end(JSON.stringify({ error: "Invalid JSON payload" })); return; }

        const prompt = renderTemplate(route.template, payload);
        const validation = validateInput(prompt);
        if (!validation.ok) {
          res.writeHead(422, { "Content-Type": "application/json", ...cors });
          res.end(JSON.stringify({ error: validation.reason }));
          return;
        }

        const taskId = this.config.scheduler.scheduleOnce(validation.text, undefined, { source: "webhook", route: routeName });
        res.writeHead(201, { "Content-Type": "application/json", ...cors });
        res.end(JSON.stringify({ taskId, status: "queued" }));
        return;
      }
    }

    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Not found" }));
  }

  private async handleRpc(rpc: JsonRpcRequest): Promise<JsonRpcResponse> {
    const params = rpc.params as Record<string, unknown> | undefined;

    switch (rpc.method) {
      case "tasks/send": {
        const p = params as unknown as TaskSendParams;
        const rawInput = p.message.content.find((c) => c.type === "text")?.text ?? "";
        const validation = validateInput(rawInput);
        if (!validation.ok) {
          return { jsonrpc: "2.0", id: rpc.id, error: { code: -32602, message: validation.reason } };
        }

        const taskId = p.id ?? randomUUID();
        const now = Date.now();
        const task: Task = {
          id: taskId,
          agentId: this.config.card.id,
          state: "submitted",
          messages: [p.message],
          createdAt: now,
          updatedAt: now,
        };
        taskStore.create(task);
        void this.executeTask(task, validation.text);
        return { jsonrpc: "2.0", id: rpc.id, result: task };
      }

      case "tasks/get": {
        const { id } = params as { id: string };
        const task = taskStore.get(id);
        if (!task) {
          return { jsonrpc: "2.0", id: rpc.id, error: { code: -32001, message: `Task ${id} not found` } };
        }
        return { jsonrpc: "2.0", id: rpc.id, result: task };
      }

      case "tasks/cancel": {
        const { id } = params as { id: string };
        taskStore.update(id, { state: "canceled" });
        return { jsonrpc: "2.0", id: rpc.id, result: { id } };
      }

      default:
        return { jsonrpc: "2.0", id: rpc.id, error: { code: -32601, message: `Method not found: ${rpc.method}` } };
    }
  }

  private async handleStreamRpc(rpc: JsonRpcRequest, res: http.ServerResponse): Promise<void> {
    if (rpc.method !== "tasks/sendSubscribe") {
      const evt: TaskStreamEvent = {
        type: "task-status-update",
        taskId: "unknown",
        status: { state: "failed", message: `Method not found: ${rpc.method}` },
        final: true,
      };
      res.write(`data: ${JSON.stringify(evt)}\n\n`);
      res.end();
      return;
    }

    const p = rpc.params as TaskSendParams;
    const rawInput = p.message.content.find((c) => c.type === "text")?.text ?? "";
    const validation = validateInput(rawInput);

    if (!validation.ok) {
      const evt: TaskStreamEvent = {
        type: "task-status-update",
        taskId: p.id ?? "unknown",
        status: { state: "failed", message: validation.reason },
        final: true,
      };
      res.write(`data: ${JSON.stringify(evt)}\n\n`);
      res.end();
      return;
    }

    const taskId = p.id ?? randomUUID();
    const now = Date.now();
    const task: Task = {
      id: taskId,
      agentId: this.config.card.id,
      state: "working",
      messages: [p.message],
      createdAt: now,
      updatedAt: now,
    };
    taskStore.create(task);

    const sendEvent = (evt: TaskStreamEvent) => {
      try { res.write(`data: ${JSON.stringify(evt)}\n\n`); } catch { /* client disconnected */ }
    };

    sendEvent({ type: "task-status-update", taskId, status: { state: "working" }, final: false });

    try {
      const handler = this.config.handleTask(validation.text, taskId);
      let fullText = "";

      if (typeof handler === "object" && Symbol.asyncIterator in handler) {
        for await (const chunk of handler) {
          fullText += chunk;
          sendEvent({ type: "task-artifact-update", taskId, artifact: { parts: [{ type: "text", text: chunk }] }, final: false });
        }
      } else {
        fullText = await handler;
      }

      taskStore.update(taskId, {
        state: "completed",
        messages: [...task.messages, { role: "agent", content: [{ type: "text", text: fullText }] }],
      });
      sendEvent({ type: "task-artifact-update", taskId, artifact: { parts: [{ type: "text", text: fullText }] }, final: true });
      sendEvent({ type: "task-status-update", taskId, status: { state: "completed" }, final: true });
    } catch (err) {
      taskStore.update(taskId, { state: "failed" });
      sendEvent({ type: "task-status-update", taskId, status: { state: "failed", message: sanitizeError(err) }, final: true });
    }

    res.end();
  }

  private async executeTask(task: Task, input: string): Promise<void> {
    taskStore.update(task.id, { state: "working" });
    try {
      const handler = this.config.handleTask(input, task.id);
      let fullText = "";
      if (typeof handler === "object" && Symbol.asyncIterator in handler) {
        for await (const chunk of handler) fullText += chunk;
      } else {
        fullText = await handler;
      }
      taskStore.update(task.id, {
        state: "completed",
        messages: [...task.messages, { role: "agent", content: [{ type: "text", text: fullText }] }],
      });
    } catch (err) {
      taskStore.update(task.id, {
        state: "failed",
        messages: [...task.messages, { role: "agent", content: [{ type: "text", text: sanitizeError(err) }] }],
      });
    }
  }
}

function readBody(req: http.IncomingMessage, limitBytes: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let total = 0;
    req.on("data", (chunk: Buffer) => {
      total += chunk.length;
      if (total > limitBytes) {
        req.destroy();
        reject(new Error("Body too large"));
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")));
    req.on("error", reject);
  });
}

function readRawBody(req: http.IncomingMessage, limitBytes: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let total = 0;
    req.on("data", (chunk: Buffer) => {
      total += chunk.length;
      if (total > limitBytes) {
        req.destroy();
        reject(new Error("Body too large"));
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}
