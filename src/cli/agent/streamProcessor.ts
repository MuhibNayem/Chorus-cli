import type { Dispatch } from "react";
import type { AgentEvent, HitlRequest } from "../../agent/types.js";
import type { ChatMessage } from "../../llm/provider.js";
import type { FeedAction } from "../state/feedReducer.js";

type DebugFn = (label: string, data?: unknown) => void;

type StreamResult = {
  responseText: string;
  reasoningContent: string;
  toolCallsObserved: number;
  hadError: boolean;
  history: ChatMessage[];
  interrupt?: HitlInterrupt;
};

export interface HitlActionRequest {
  id: string;
  name: string;
  args: Record<string, unknown>;
  description?: string;
}

export interface HitlInterrupt {
  resumeKey: string;
  actionRequests: HitlActionRequest[];
}

function toActionRequest(request: HitlRequest): HitlActionRequest {
  return {
    id: request.id,
    name: request.name,
    args: request.args,
    description: request.description,
  };
}

export async function processAgentStream(
  iterator: AsyncIterator<AgentEvent>,
  dispatch: Dispatch<FeedAction>,
  dbg: DebugFn,
): Promise<StreamResult> {
  const openTools = new Set<string>();
  let responseText = "";
  let reasoningContent = "";
  let toolCallsObserved = 0;
  let hadError = false;
  let history: ChatMessage[] = [];

  try {
    while (true) {
      const { value: event, done } = await iterator.next();
      if (done || !event) break;

      switch (event.type) {
        case "token":
          responseText += event.text;
          dispatch({ type: "APPEND_RESPONSE_TOKEN", text: event.text });
          break;
        case "thinking":
          reasoningContent += event.text;
          dispatch({ type: "APPEND_THINK_TOKEN", text: event.text });
          break;
        case "tool-start":
          toolCallsObserved += 1;
          openTools.add(event.id);
          dispatch({
            type: "ADD_TOOL_CALL",
            toolCall: {
              id: event.id,
              name: event.name,
              args: event.args,
              status: "running",
            },
          });
          dbg("TOOL_CALL", { id: event.id, name: event.name });
          break;
        case "tool-done":
          openTools.delete(event.id);
          dispatch({
            type: "UPDATE_TOOL_CALL",
            id: event.id,
            result: event.result,
            status: "done",
          });
          dbg("TOOL_DONE", { id: event.id, name: event.name, durationMs: event.durationMs });
          break;
        case "tool-error":
          dispatch({
            type: "UPDATE_TOOL_CALL",
            id: event.id,
            result: event.error,
            status: "error",
          });
          openTools.delete(event.id);
          dbg("TOOL_ERROR", { id: event.id, name: event.name, willRetry: event.willRetry });
          break;
        case "btw":
          dispatch({
            type: "APPEND_SYSTEM",
            id: `btw-${Date.now()}`,
            text: `╭─ /btw ──────────────────────────────\n│ ${event.text}\n╰──────────────────────────────────────`,
          });
          break;
        case "aborted":
          dispatch({
            type: "APPEND_SYSTEM",
            id: `aborted-${Date.now()}`,
            text: event.message ?? "Task interrupted by user.",
          });
          hadError = false;
          return {
            responseText: responseText.trim(),
            reasoningContent: reasoningContent.trim(),
            toolCallsObserved,
            hadError: false,
            history,
          };
        case "compacted":
          dispatch({
            type: "APPEND_SYSTEM",
            id: `compact-${Date.now()}`,
            text: `Context compacted: ${event.removedMessages} message(s) summarized, ~${Math.round(event.savedTokens / 1000)}K tokens freed.`,
          });
          dbg("COMPACTED", { removedMessages: event.removedMessages, savedTokens: event.savedTokens });
          break;
        case "checkpoint":
          dbg("CHECKPOINT", { round: event.round, threadId: event.threadId });
          break;
        case "hitl":
          return {
            responseText: responseText.trim(),
            reasoningContent: reasoningContent.trim(),
            toolCallsObserved,
            hadError,
            history,
            interrupt: {
              resumeKey: event.resumeKey,
              actionRequests: event.requests.map(toActionRequest),
            },
          };
        case "done":
          history = event.history;
          responseText = event.response;
          reasoningContent = event.reasoning;
          for (const toolId of openTools) {
            dispatch({
              type: "UPDATE_TOOL_CALL",
              id: toolId,
              result: "Tool call ended without a result from the agent loop.",
              status: hadError ? "error" : "done",
            });
          }
          return {
            responseText: responseText.trim(),
            reasoningContent: reasoningContent.trim(),
            toolCallsObserved,
            hadError,
            history,
          };
        case "error":
          hadError = true;
          dispatch({
            type: "APPEND_SYSTEM",
            id: `stream-error-${Date.now()}`,
            text: `Stream interrupted: ${event.message}`,
          });
          if (event.fatal) {
            for (const toolId of openTools) {
              dispatch({
                type: "UPDATE_TOOL_CALL",
                id: toolId,
                result: event.message,
                status: "error",
              });
            }
            return {
              responseText: responseText.trim(),
              reasoningContent: reasoningContent.trim(),
              toolCallsObserved,
              hadError,
              history,
            };
          }
          break;
      }
    }
  } catch (error) {
    hadError = true;
    const message = error instanceof Error ? error.message : String(error);
    const stack = error instanceof Error ? error.stack : undefined;
    dispatch({
      type: "APPEND_SYSTEM",
      id: `stream-error-${Date.now()}`,
      text: `Stream interrupted: ${message}${stack ? `\n\n${stack}` : ""}`,
    });
    dbg("STREAM_ERROR", { message, stack });
  }

  for (const toolId of openTools) {
    dispatch({
      type: "UPDATE_TOOL_CALL",
      id: toolId,
      result: "Tool call ended without a result from the agent loop.",
      status: hadError ? "error" : "done",
    });
  }

  return {
    responseText: responseText.trim(),
    reasoningContent: reasoningContent.trim(),
    toolCallsObserved,
    hadError,
    history,
  };
}
