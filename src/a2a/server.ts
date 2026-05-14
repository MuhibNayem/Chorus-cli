/**
 * A2A Server — exposes a Chorus swarm (or any agent) as an A2A-compatible endpoint.
 *
 * Implements the Google A2A JSON-RPC 2.0 protocol over HTTP.
 * Endpoints:
 *   GET  /.well-known/agent.json  → AgentCard
 *   POST /tasks                   → tasks/send, tasks/get, tasks/cancel
 *   POST /tasks/stream            → tasks/sendSubscribe (SSE)
 */

import * as http from "http";
import { randomUUID } from "crypto";
import type {
  AgentCard,
  Task,
  TaskState,
  TaskSendParams,
  JsonRpcRequest,
  JsonRpcResponse,
  TaskStreamEvent,
} from "./types.js";

export interface A2AServerConfig {
  port?: number;
  host?: string;
  card: Omit<AgentCard, "endpoints">;
  /** Handler that processes a task input and returns the result text */
  handleTask: (input: string, taskId: string) => AsyncGenerator<string> | Promise<string>;
}

export class A2AServer {
  private server: http.Server;
  private tasks = new Map<string, Task>();
  private config: A2AServerConfig;
  private port: number;
  private host: string;

  constructor(config: A2AServerConfig) {
    this.config = config;
    this.port = config.port ?? 3210;
    this.host = config.host ?? "127.0.0.1";
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

    if (req.method === "GET" && url.pathname === "/.well-known/agent.json") {
      res.writeHead(200, { "Content-Type": "application/json", ...cors });
      res.end(JSON.stringify(this.agentCard()));
      return;
    }

    if (req.method === "POST" && url.pathname === "/tasks") {
      const body = await readBody(req);
      const rpc = JSON.parse(body) as JsonRpcRequest;
      const response = await this.handleRpc(rpc, false);
      res.writeHead(200, { "Content-Type": "application/json", ...cors });
      res.end(JSON.stringify(response));
      return;
    }

    if (req.method === "POST" && url.pathname === "/tasks/stream") {
      const body = await readBody(req);
      const rpc = JSON.parse(body) as JsonRpcRequest;
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
        ...cors,
      });
      await this.handleStreamRpc(rpc, res);
      return;
    }

    res.writeHead(404, { "Content-Type": "application/json", ...cors });
    res.end(JSON.stringify({ error: "Not found" }));
  }

  private async handleRpc(rpc: JsonRpcRequest, _stream: false): Promise<JsonRpcResponse> {
    const params = rpc.params as Record<string, unknown> | undefined;

    switch (rpc.method) {
      case "tasks/send": {
        const p = params as unknown as TaskSendParams;
        const taskId = p.id ?? randomUUID();
        const input = p.message.content.find((c) => c.type === "text")?.text ?? "";

        const task: Task = {
          id: taskId,
          agentId: this.config.card.id,
          state: "submitted",
          messages: [p.message],
          createdAt: Date.now(),
          updatedAt: Date.now(),
        };
        this.tasks.set(taskId, task);

        // Run asynchronously
        void this.executeTask(task, input);

        return { jsonrpc: "2.0", id: rpc.id, result: task };
      }

      case "tasks/get": {
        const { id } = params as { id: string };
        const task = this.tasks.get(id);
        if (!task) {
          return {
            jsonrpc: "2.0",
            id: rpc.id,
            error: { code: -32001, message: `Task ${id} not found` },
          };
        }
        return { jsonrpc: "2.0", id: rpc.id, result: task };
      }

      case "tasks/cancel": {
        const { id } = params as { id: string };
        const task = this.tasks.get(id);
        if (task) {
          task.state = "canceled";
          task.updatedAt = Date.now();
        }
        return { jsonrpc: "2.0", id: rpc.id, result: { id } };
      }

      default:
        return {
          jsonrpc: "2.0",
          id: rpc.id,
          error: { code: -32601, message: `Method not found: ${rpc.method}` },
        };
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
    const taskId = p.id ?? randomUUID();
    const input = p.message.content.find((c) => c.type === "text")?.text ?? "";

    const task: Task = {
      id: taskId,
      agentId: this.config.card.id,
      state: "working",
      messages: [p.message],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    this.tasks.set(taskId, task);

    const sendEvent = (evt: TaskStreamEvent) => {
      res.write(`data: ${JSON.stringify(evt)}\n\n`);
    };

    sendEvent({ type: "task-status-update", taskId, status: { state: "working" }, final: false });

    try {
      const handler = this.config.handleTask(input, taskId);
      let fullText = "";

      if (typeof handler === "object" && Symbol.asyncIterator in handler) {
        for await (const chunk of handler) {
          fullText += chunk;
          sendEvent({
            type: "task-artifact-update",
            taskId,
            artifact: { parts: [{ type: "text", text: chunk }] },
            final: false,
          });
        }
      } else {
        fullText = await handler;
      }

      task.state = "completed";
      task.messages.push({ role: "agent", content: [{ type: "text", text: fullText }] });
      task.updatedAt = Date.now();

      sendEvent({ type: "task-artifact-update", taskId, artifact: { parts: [{ type: "text", text: fullText }] }, final: true });
      sendEvent({ type: "task-status-update", taskId, status: { state: "completed" }, final: true });
    } catch (err) {
      task.state = "failed";
      task.updatedAt = Date.now();
      sendEvent({
        type: "task-status-update",
        taskId,
        status: { state: "failed", message: String(err) },
        final: true,
      });
    }

    res.end();
  }

  private async executeTask(task: Task, input: string): Promise<void> {
    task.state = "working";
    task.updatedAt = Date.now();

    try {
      const handler = this.config.handleTask(input, task.id);
      let fullText = "";

      if (typeof handler === "object" && Symbol.asyncIterator in handler) {
        for await (const chunk of handler) {
          fullText += chunk;
        }
      } else {
        fullText = await handler;
      }

      task.state = "completed";
      task.messages.push({ role: "agent", content: [{ type: "text", text: fullText }] });
    } catch (err) {
      task.state = "failed";
      task.messages.push({ role: "agent", content: [{ type: "text", text: String(err) }] });
    }

    task.updatedAt = Date.now();
  }
}

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")));
    req.on("error", reject);
  });
}
