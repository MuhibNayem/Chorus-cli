import type { Dispatch } from "react";
import type { LLMProvider } from "../llm/provider.js";
import { BtwQueue } from "../agent/btw.js";
import { JsonFileCheckpointer } from "../agent/checkpointer.js";
import { HitlGate } from "../agent/hitl.js";
import { runAgentLoop } from "../agent/loop.js";
import type { FeedAction } from "../cli/state/feedReducer.js";
import { getAllSubagents } from "./index.js";

export interface SubagentExecutionOptions {
  subagentName: string;
  task: string;
  provider: LLMProvider;
  modelName: string;
  dispatch: Dispatch<FeedAction>;
  parentTurnId: string;
}

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

export async function executeSubagent(
  options: SubagentExecutionOptions
): Promise<string> {
  const { subagentName, task, provider, modelName, dispatch, parentTurnId } = options;

  const allAgents = getAllSubagents();
  const subagent = allAgents.find((s) => s.name === subagentName);
  if (!subagent) {
    throw new Error(`Unknown subagent: ${subagentName}. Available: ${allAgents.map((s) => s.name).join(", ")}`);
  }

  const subagentId = `subagent-${subagentName}-${Date.now()}`;
  const sessionId = `session-${subagentId}`;
  const threadId = `${sessionId}-thread`;

  dispatch({
    type: "ADD_SUBAGENT",
    subagent: {
      id: subagentId,
      name: subagentName,
      task: task.slice(0, 200),
      status: "running",
      text: "",
      sessionId,
    },
  });

  dispatch({
    type: "ADD_SESSION_EVENT",
    sessionId,
    event: {
      kind: "thinking",
      id: `${sessionId}-think-0`,
      text: `Delegating to ${subagentName} subagent…`,
      expanded: false,
    },
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
        case "token":
          responseText += event.text;
          dispatch({ type: "APPEND_SUBAGENT_TOKEN", id: sessionId, text: event.text });
          break;
        case "tool-start":
          toolCallsObserved += 1;
          dispatch({
            type: "ADD_SESSION_EVENT",
            sessionId,
            event: {
              kind: "tool",
              card: {
                id: event.id,
                name: event.name,
                args: event.args,
                status: "running",
                expanded: false,
              },
            },
          });
          dbg("SUBAGENT_TOOL_START", { sessionId, name: event.name });
          break;
        case "tool-done":
          dispatch({
            type: "ADD_SESSION_EVENT",
            sessionId,
            event: {
              kind: "tool",
              card: {
                id: event.id,
                name: event.name,
                args: {},
                result: event.result,
                status: "done",
                expanded: false,
              },
            },
          });
          break;
        case "tool-error":
          dispatch({
            type: "ADD_SESSION_EVENT",
            sessionId,
            event: {
              kind: "tool",
              card: {
                id: event.id,
                name: event.name,
                args: {},
                result: event.error,
                status: "error",
                expanded: false,
              },
            },
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

    dispatch({ type: "FINALIZE_SUBAGENT", id: subagentId, completedAt: Date.now() });
    dispatch({ type: "FINALIZE_SESSION", sessionId, completedAt: Date.now() });
    dbg("SUBAGENT_DONE", { subagentName, responseLength: responseText.length, toolCallsObserved });

    return responseText;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    dispatch({
      type: "ADD_SESSION_EVENT",
      sessionId,
      event: { kind: "response", text: `Error: ${message}` },
    });
    dispatch({ type: "FINALIZE_SUBAGENT", id: subagentId, completedAt: Date.now() });
    dispatch({ type: "FINALIZE_SESSION", sessionId, completedAt: Date.now() });
    dispatch({ type: "UPDATE_SUBAGENT", id: subagentId, status: "error", result: message });

    dbg("SUBAGENT_ERROR", { subagentName, message });
    throw error;
  }
}
