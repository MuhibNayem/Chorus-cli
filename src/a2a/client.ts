/**
 * A2A Client — calls external A2A-compatible agents from within a Chorus swarm.
 * Implements JSON-RPC 2.0 over HTTP with optional SSE streaming.
 */

import type {
  AgentCard,
  Task,
  TaskSendParams,
  TaskStreamEvent,
  JsonRpcRequest,
  JsonRpcResponse,
} from "./types.js";

export interface A2AClientConfig {
  /** Base URL of the remote A2A agent */
  baseUrl: string;
  /** Bearer token or API key for authentication */
  apiKey?: string;
  timeoutMs?: number;
}

export class A2AClient {
  private baseUrl: string;
  private headers: Record<string, string>;
  private timeoutMs: number;

  constructor(config: A2AClientConfig) {
    this.baseUrl = config.baseUrl.replace(/\/$/, "");
    this.timeoutMs = config.timeoutMs ?? 30_000;
    this.headers = {
      "Content-Type": "application/json",
      ...(config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {}),
    };
  }

  async getAgentCard(): Promise<AgentCard> {
    const res = await this.fetch(`${this.baseUrl}/.well-known/agent.json`);
    return (await res.json()) as AgentCard;
  }

  async sendTask(params: TaskSendParams): Promise<Task> {
    const body: JsonRpcRequest = {
      jsonrpc: "2.0",
      id: Date.now(),
      method: "tasks/send",
      params,
    };
    const res = await this.fetch(`${this.baseUrl}/tasks`, {
      method: "POST",
      body: JSON.stringify(body),
    });
    const json = (await res.json()) as JsonRpcResponse;
    if (json.error) throw new Error(`A2A error ${json.error.code}: ${json.error.message}`);
    return json.result as Task;
  }

  async getTask(taskId: string): Promise<Task> {
    const body: JsonRpcRequest = {
      jsonrpc: "2.0",
      id: Date.now(),
      method: "tasks/get",
      params: { id: taskId },
    };
    const res = await this.fetch(`${this.baseUrl}/tasks`, {
      method: "POST",
      body: JSON.stringify(body),
    });
    const json = (await res.json()) as JsonRpcResponse;
    if (json.error) throw new Error(`A2A error ${json.error.code}: ${json.error.message}`);
    return json.result as Task;
  }

  async cancelTask(taskId: string): Promise<void> {
    const body: JsonRpcRequest = {
      jsonrpc: "2.0",
      id: Date.now(),
      method: "tasks/cancel",
      params: { id: taskId },
    };
    await this.fetch(`${this.baseUrl}/tasks`, {
      method: "POST",
      body: JSON.stringify(body),
    });
  }

  async *streamTask(params: TaskSendParams): AsyncGenerator<TaskStreamEvent> {
    const body: JsonRpcRequest = {
      jsonrpc: "2.0",
      id: Date.now(),
      method: "tasks/sendSubscribe",
      params,
    };

    const res = await this.fetch(`${this.baseUrl}/tasks/stream`, {
      method: "POST",
      body: JSON.stringify(body),
      headers: { ...this.headers, Accept: "text/event-stream" },
    });

    if (!res.body) throw new Error("No response body for streaming task");

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          if (line.startsWith("data: ")) {
            const data = line.slice(6).trim();
            if (data === "[DONE]") return;
            try {
              yield JSON.parse(data) as TaskStreamEvent;
            } catch {
              // malformed SSE line — skip
            }
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
  }

  /** Poll a task until it reaches a terminal state */
  async waitForTask(taskId: string, pollIntervalMs = 500): Promise<Task> {
    const terminalStates = new Set(["completed", "failed", "canceled"]);
    while (true) {
      const task = await this.getTask(taskId);
      if (terminalStates.has(task.state)) return task;
      await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
    }
  }

  private async fetch(url: string, init?: RequestInit): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const res = await fetch(url, {
        ...init,
        headers: { ...this.headers, ...(init?.headers as Record<string, string> | undefined) },
        signal: controller.signal,
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);
      return res;
    } finally {
      clearTimeout(timer);
    }
  }
}

/**
 * Create an AgentTool that delegates to an external A2A agent.
 * Drop this into any agent's tools array to give it access to external A2A agents.
 */
export function createA2ATool(name: string, client: A2AClient, description?: string) {
  return {
    name,
    description: description ?? `Delegate a task to the external A2A agent at ${client["baseUrl"]}`,
    parameters: {
      type: "object",
      properties: {
        task: { type: "string", description: "The task to send to the external agent" },
        await_completion: {
          type: "boolean",
          description: "If true, wait for the task to complete and return the result",
          default: true,
        },
      },
      required: ["task"],
    },
    execute: async (args: { task: string; await_completion?: boolean }) => {
      const sent = await client.sendTask({
        message: { role: "user", content: [{ type: "text", text: args.task }] },
      });
      if (args.await_completion !== false) {
        const completed = await client.waitForTask(sent.id);
        const last = completed.messages.at(-1);
        const text = last?.content.find((c) => c.type === "text")?.text ?? "";
        return JSON.stringify({ taskId: completed.id, state: completed.state, result: text });
      }
      return JSON.stringify({ taskId: sent.id, state: sent.state });
    },
  };
}
