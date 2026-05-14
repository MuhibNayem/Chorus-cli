import { createDeepAgent } from "deepagents";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import type { Dispatch } from "react";
import type { FeedAction } from "../cli/state/feedReducer.js";
import { allSubagents } from "./index.js";
import type { AgentLike } from "../cli/hooks/agent/types.js";

export interface SubagentExecutionOptions {
  subagentName: string;
  task: string;
  model: BaseChatModel;
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
  const { subagentName, task, model, dispatch, parentTurnId } = options;

  const subagent = allSubagents.find((s) => s.name === subagentName);
  if (!subagent) {
    throw new Error(`Unknown subagent: ${subagentName}. Available: ${allSubagents.map((s) => s.name).join(", ")}`);
  }

  const subagentId = `subagent-${subagentName}-${Date.now()}`;
  const sessionId = `session-${subagentId}`;

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
    const agent = createDeepAgent({
      model,
      tools: subagent.tools,
      systemPrompt: subagent.systemPrompt,
    }) as AgentLike;

    const stream = await agent.stream(
      { messages: [{ role: "user", content: task }] } as Parameters<typeof agent.stream>[0],
      { streamMode: ["messages", "updates"] } as Parameters<typeof agent.stream>[1]
    );

    const result = await processSubagentStream(stream, sessionId, dispatch, dbg);

    dispatch({
      type: "FINALIZE_SUBAGENT",
      id: subagentId,
      completedAt: Date.now(),
    });

    dispatch({
      type: "FINALIZE_SESSION",
      sessionId,
      completedAt: Date.now(),
    });

    dbg("SUBAGENT_DONE", { subagentName, responseLength: result.responseText.length });

    return result.responseText;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    dispatch({
      type: "ADD_SESSION_EVENT",
      sessionId,
      event: {
        kind: "response",
        text: `Error: ${message}`,
      },
    });

    dispatch({
      type: "FINALIZE_SUBAGENT",
      id: subagentId,
      completedAt: Date.now(),
    });

    dispatch({
      type: "FINALIZE_SESSION",
      sessionId,
      completedAt: Date.now(),
    });

    dispatch({
      type: "UPDATE_SUBAGENT",
      id: subagentId,
      status: "error",
      result: message,
    });

    dbg("SUBAGENT_ERROR", { subagentName, message });
    throw error;
  }
}

interface SubagentStreamResult {
  responseText: string;
  toolCallsObserved: number;
  hadError: boolean;
}

async function processSubagentStream(
  stream: AsyncIterable<unknown>,
  sessionId: string,
  dispatch: Dispatch<FeedAction>,
  dbg: (label: string, data?: unknown) => void
): Promise<SubagentStreamResult> {
  let responseText = "";
  let toolCallsObserved = 0;
  let hadError = false;

  try {
    for await (const rawChunk of stream) {
      const chunk = Array.isArray(rawChunk) ? rawChunk : [];
      const mode = typeof chunk[0] === "string" ? chunk[0] : "";
      const data = chunk[1];

      if (mode === "messages" && Array.isArray(data)) {
        const message = data[0] as Record<string, unknown> | undefined;
        if (!message) continue;

        const type = (message.type as string) ?? (message.role as string) ?? "";
        const isAiChunk = type === "AIMessageChunk" || type === "ai" || type === "assistant";

        if (isAiChunk && typeof message.content === "string") {
          const text = message.content;
          responseText += text;
          dispatch({
            type: "APPEND_SUBAGENT_TOKEN",
            id: sessionId,
            text,
          });
          dbg("SUBAGENT_TOKEN", { sessionId, len: text.length });
        }

        if (type === "ToolMessage" || type === "tool") {
          const toolCallId = message.tool_call_id as string;
          const content = message.content;
          if (toolCallId && content !== undefined) {
            dispatch({
              type: "ADD_SESSION_EVENT",
              sessionId,
              event: {
                kind: "tool",
                card: {
                  id: toolCallId,
                  name: "subagent-tool",
                  args: {},
                  result: typeof content === "string" ? content : JSON.stringify(content),
                  status: "done",
                  expanded: false,
                },
              },
            });
          }
        }
      }

      if (mode === "updates" && data && typeof data === "object") {
        for (const nodeOutput of Object.values(data as Record<string, unknown>)) {
          if (!nodeOutput || typeof nodeOutput !== "object") continue;
          const msgs = (nodeOutput as { messages?: unknown[] }).messages;
          if (!Array.isArray(msgs)) continue;
          for (const item of msgs) {
            const msg = item as Record<string, unknown> | undefined;
            if (!msg) continue;
            const type = (msg.type as string) ?? (msg.role as string) ?? "";
            if (type === "AIMessage" || type === "ai" || type === "assistant") {
              const toolCalls = (msg.tool_calls as Array<Record<string, unknown>>) ?? [];
              toolCallsObserved += toolCalls.length;

              // Dispatch tool calls to session
              for (const tc of toolCalls) {
                const tcId = tc.id as string;
                const tcName = tc.name as string;
                if (tcId) {
                  dispatch({
                    type: "ADD_SESSION_EVENT",
                    sessionId,
                    event: {
                      kind: "tool",
                      card: {
                        id: tcId,
                        name: tcName ?? "unknown",
                        args: tc.args ?? {},
                        status: "running",
                        expanded: false,
                      },
                    },
                  });
                }
              }
            }
          }
        }
      }
    }
  } catch (error) {
    hadError = true;
    const message = error instanceof Error ? error.message : String(error);
    dbg("SUBAGENT_STREAM_ERROR", { sessionId, message });
  }

  return {
    responseText: responseText.trim(),
    toolCallsObserved,
    hadError,
  };
}
