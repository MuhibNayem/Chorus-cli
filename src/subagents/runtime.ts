import type { LLMProvider } from "../llm/provider.js";
import { BtwQueue } from "../agent/btw.js";
import { JsonFileCheckpointer } from "../agent/checkpointer.js";
import { HitlGate } from "../agent/hitl.js";
import { runAgentLoop } from "../agent/loop.js";
import { getAllSubagents } from "./index.js";

// ── Subagent event types (replaces Dispatch<FeedAction>) ──────────────────────

export type SubagentEvent =
  | {
      type: "subagent-add";
      subagentId: string;
      name: string;
      task: string;
      status: "running";
      sessionId: string;
    }
  | {
      type: "subagent-thinking";
      sessionId: string;
      id: string;
      text: string;
      expanded: boolean;
    }
  | {
      type: "subagent-think-token";
      sessionId: string;
      text: string;
    }
  | {
      type: "subagent-token";
      subagentId: string;
      text: string;
    }
  | {
      type: "subagent-tool-start";
      sessionId: string;
      id: string;
      name: string;
      args: Record<string, unknown>;
    }
  | {
      type: "subagent-tool-done";
      sessionId: string;
      id: string;
      name: string;
      result: string;
    }
  | {
      type: "subagent-tool-error";
      sessionId: string;
      id: string;
      name: string;
      error: string;
    }
  | {
      type: "subagent-done";
      subagentId: string;
      result: string;
    }
  | {
      type: "subagent-finalize";
      subagentId: string;
      completedAt: number;
    }
  | {
      type: "subagent-session-complete";
      sessionId: string;
      completedAt: number;
    }
  | {
      type: "subagent-error";
      sessionId: string;
      text: string;
      subagentId: string;
    };

export type SubagentEventCallback = (event: SubagentEvent) => void;

// ── Options ───────────────────────────────────────────────────────────────────

export interface SubagentExecutionOptions {
  subagentName: string;
  task: string;
  provider: LLMProvider;
  modelName: string;
  onEvent: SubagentEventCallback;
  parentTurnId: string;
}

// ── Debug helper ──────────────────────────────────────────────────────────────

function dbg(label: string, data?: unknown): void {
  if (process.env.DEBUG !== "1") return;
  const line = `[${new Date().toISOString()}] ${label}${
    data !== undefined ? " " + JSON.stringify(data, null, 0) : ""
  }\n`;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require("fs").appendFileSync("debug.log", line);
  } catch {
    /* never crash on debug */
  }
}

// ── Execution ─────────────────────────────────────────────────────────────────

export async function executeSubagent(
  options: SubagentExecutionOptions,
): Promise<string> {
  const { subagentName, task, provider, modelName, onEvent, parentTurnId } = options;

  const allAgents = getAllSubagents();
  const subagent = allAgents.find((s) => s.name === subagentName);
  if (!subagent) {
    throw new Error(
      `Unknown subagent: ${subagentName}. Available: ${allAgents.map((s) => s.name).join(", ")}`,
    );
  }

  const subagentId = `subagent-${subagentName}-${Date.now()}`;
  const sessionId = `session-${subagentId}`;
  const threadId = `${sessionId}-thread`;

  onEvent({
    type: "subagent-add",
    subagentId,
    name: subagentName,
    task: task.slice(0, 200),
    status: "running",
    sessionId,
  });

  onEvent({
    type: "subagent-thinking",
    sessionId,
    id: `${sessionId}-think-0`,
    text: `Delegating to ${subagentName} subagent…`,
    expanded: false,
  });

  dbg("SUBAGENT_START", { subagentName, task: task.slice(0, 100) });

  try {
    const hitlGate = new HitlGate();
    const btwQueue = new BtwQueue();
    const checkpointer = new JsonFileCheckpointer();

    let responseText = "";
    let toolCallsObserved = 0;

    const stream = runAgentLoop({
      provider,
      model: modelName,
      tools: subagent.tools,
      messages: [{ role: "user", content: task }],
      systemPrompt: subagent.systemPrompt,
      threadId,
      hitlGate,
      btwQueue,
      policy: subagent.permissionMode ?? "full_auto",
      checkpointer,
    });

    for await (const event of stream) {
      switch (event.type) {
        case "thinking":
          onEvent({ type: "subagent-think-token", sessionId, text: event.text });
          break;
        case "token":
          responseText += event.text;
          onEvent({ type: "subagent-token", subagentId: sessionId, text: event.text });
          break;
        case "tool-start":
          toolCallsObserved += 1;
          onEvent({
            type: "subagent-tool-start",
            sessionId,
            id: event.id,
            name: event.name,
            args: event.args,
          });
          dbg("SUBAGENT_TOOL_START", { sessionId, name: event.name });
          break;
        case "tool-done":
          onEvent({
            type: "subagent-tool-done",
            sessionId,
            id: event.id,
            name: event.name,
            result: event.result,
          });
          break;
        case "tool-error":
          onEvent({
            type: "subagent-tool-error",
            sessionId,
            id: event.id,
            name: event.name,
            error: event.error,
          });
          break;
        case "done":
          responseText = event.response;
          toolCallsObserved = event.toolCount;
          break;
        case "error":
          dbg("SUBAGENT_ERROR_EVENT", { message: event.message, fatal: event.fatal });
          break;
      }
    }

    onEvent({ type: "subagent-done", subagentId, result: responseText });
    onEvent({ type: "subagent-finalize", subagentId, completedAt: Date.now() });
    onEvent({ type: "subagent-session-complete", sessionId, completedAt: Date.now() });
    dbg("SUBAGENT_DONE", { subagentName, responseLength: responseText.length, toolCallsObserved });

    return responseText;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    onEvent({ type: "subagent-error", sessionId, text: `Error: ${message}`, subagentId });
    onEvent({ type: "subagent-finalize", subagentId, completedAt: Date.now() });
    onEvent({ type: "subagent-session-complete", sessionId, completedAt: Date.now() });
    onEvent({ type: "subagent-done", subagentId, result: message });

    dbg("SUBAGENT_ERROR", { subagentName, message });
    throw error;
  }
}
