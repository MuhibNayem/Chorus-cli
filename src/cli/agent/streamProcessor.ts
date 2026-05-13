import type { Dispatch } from "react";
import type { FeedAction } from "../state/feedReducer.js";

type DebugFn = (label: string, data?: unknown) => void;

type ToolCallLike = {
  id?: string;
  name?: string;
  args?: unknown;
};

type MessageLike = {
  type?: string;
  role?: string;
  content?: unknown;
  tool_call_id?: string;
  tool_calls?: ToolCallLike[];
  additional_kwargs?: {
    reasoning_content?: string;
    thinking?: string;
  };
};

type StreamResult = {
  responseText: string;
  reasoningContent: string;
  toolCallsObserved: number;
  hadError: boolean;
  interrupt?: HitlInterrupt;
};

export interface HitlActionRequest {
  name: string;
  args: Record<string, unknown>;
  description?: string;
}

export interface HitlReviewConfig {
  actionName: string;
  allowedDecisions: string[];
  description?: string;
}

export interface HitlInterrupt {
  actionRequests: HitlActionRequest[];
  reviewConfigs: HitlReviewConfig[];
}

function asMessage(value: unknown): MessageLike | null {
  return value && typeof value === "object" ? value as MessageLike : null;
}

function messageType(message: MessageLike): string {
  return message.type ?? message.role ?? "";
}

function messageContent(message: MessageLike): string {
  return typeof message.content === "string" ? message.content : "";
}

function toolResultContent(value: unknown): string {
  return typeof value === "string" ? value : JSON.stringify(value);
}

function updateToolResult(message: MessageLike, dispatch: Dispatch<FeedAction>, dbg: DebugFn): void {
  const toolCallId = message.tool_call_id;
  if (!toolCallId || message.content === undefined) return;

  dispatch({
    type: "UPDATE_TOOL_CALL",
    id: toolCallId,
    result: toolResultContent(message.content),
    status: "done",
  });
  dbg("TOOL_RESULT", { toolCallId });
}

function nodeMessages(data: unknown): MessageLike[] {
  if (!data || typeof data !== "object") return [];

  const messages: MessageLike[] = [];
  for (const nodeOutput of Object.values(data as Record<string, unknown>)) {
    if (!nodeOutput || typeof nodeOutput !== "object") continue;
    const value = (nodeOutput as { messages?: unknown }).messages;
    if (!Array.isArray(value)) continue;
    for (const item of value) {
      const message = asMessage(item);
      if (message) messages.push(message);
    }
  }

  return messages;
}

function extractInterrupt(data: unknown): HitlInterrupt | null {
  if (!data || typeof data !== "object") return null;
  const raw = (data as { __interrupt__?: unknown }).__interrupt__;
  if (!Array.isArray(raw) || raw.length === 0) return null;
  const first = raw[0];
  const value = first && typeof first === "object" && "value" in first
    ? (first as { value?: unknown }).value
    : first;
  if (!value || typeof value !== "object") return null;
  const actionRequests = (value as { actionRequests?: unknown }).actionRequests;
  const reviewConfigs = (value as { reviewConfigs?: unknown }).reviewConfigs;
  if (!Array.isArray(actionRequests) || !Array.isArray(reviewConfigs)) return null;
  return {
    actionRequests: actionRequests.map((request) => {
      const item = request as Partial<HitlActionRequest>;
      return {
        name: String(item.name ?? "unknown"),
        args: item.args && typeof item.args === "object" ? item.args : {},
        description: item.description,
      };
    }),
    reviewConfigs: reviewConfigs.map((config) => {
      const item = config as Partial<HitlReviewConfig>;
      return {
        actionName: String(item.actionName ?? "unknown"),
        allowedDecisions: Array.isArray(item.allowedDecisions) ? item.allowedDecisions.map(String) : [],
        description: item.description,
      };
    }),
  };
}

function stripThinkTags(content: string): string {
  return content.replace(/<think>[\s\S]*?<\/think>/g, "").trim();
}

/**
 * Extracts <think>...</think> blocks from content and returns the cleaned text
 * plus any thinking content found. Handles streaming across chunk boundaries.
 */
class ThinkTagParser {
  private inThinkBlock = false;
  private thinkBuffer = "";
  private pendingPrefix = ""; // For handling tags split across chunks

  parse(content: string): { responseText: string; thinkingText: string } {
    let responseText = "";
    let thinkingText = "";
    let text = this.pendingPrefix + content;
    this.pendingPrefix = "";

    while (text) {
      if (!this.inThinkBlock) {
        const openIdx = text.indexOf("<think>");
        if (openIdx === -1) {
          // No opening tag. But check if we have a partial tag at the end.
          const partialStart = text.lastIndexOf("<");
          if (partialStart !== -1 && partialStart > text.length - 10) {
            // Potential partial tag - save it for next chunk
            this.pendingPrefix = text.slice(partialStart);
            text = text.slice(0, partialStart);
          }
          responseText += text;
          break;
        }
        // Text before <think> is regular content
        if (openIdx > 0) {
          responseText += text.slice(0, openIdx);
        }
        this.inThinkBlock = true;
        text = text.slice(openIdx + 7);
      } else {
        const closeIdx = text.indexOf("</think>");
        if (closeIdx === -1) {
          // No closing tag yet - check for partial close tag
          const partialClose = text.lastIndexOf("<");
          if (partialClose !== -1 && partialClose > text.length - 10) {
            this.pendingPrefix = text.slice(partialClose);
            this.thinkBuffer += text.slice(0, partialClose);
          } else {
            this.thinkBuffer += text;
          }
          break;
        }
        // Found closing tag
        this.thinkBuffer += text.slice(0, closeIdx);
        thinkingText += this.thinkBuffer;
        this.thinkBuffer = "";
        this.inThinkBlock = false;
        text = text.slice(closeIdx + 8);
      }
    }

    return { responseText, thinkingText };
  }
}

export async function processAgentStream(
  stream: AsyncIterable<unknown>,
  dispatch: Dispatch<FeedAction>,
  dbg: DebugFn
): Promise<StreamResult> {
  const dispatchedToolIds = new Set<string>();
  let lastAiMessage: MessageLike | null = null;
  let responseTextFromStream = "";
  let reasoningContentFromStream = "";
  let hasDispatchedThinking = false;
  let hadError = false;
  const thinkParser = new ThinkTagParser();

  try {
    for await (const rawChunk of stream) {
      const chunk = Array.isArray(rawChunk) ? rawChunk : [];
      const mode = typeof chunk[0] === "string" ? chunk[0] : "";
      const data = chunk[1];

      if (mode === "messages" && Array.isArray(data)) {
        const message = asMessage(data[0]);
        if (!message) continue;

        const type = messageType(message);
        const isAiChunk = type === "AIMessageChunk" || type === "AIMessage" || type === "ai" || type === "assistant";
        if (isAiChunk) {
          const rawContent = messageContent(message);

          // Debug: log when content contains <think> but parser may not catch it
          if (rawContent.includes("<think") && !rawContent.includes("<think>")) {
            dbg("THINK_ATTRS", { type, content: rawContent.slice(0, 200) });
          }

          // Parse <think> tags and reasoning_content
          const { responseText, thinkingText } = thinkParser.parse(rawContent);

          if (responseText) {
            responseTextFromStream += responseText;
            dispatch({ type: "APPEND_RESPONSE_TOKEN", text: responseText });
            dbg("TOKEN", { len: responseText.length });
          }

          if (thinkingText) {
            reasoningContentFromStream += thinkingText;
            hasDispatchedThinking = true;
            dispatch({ type: "APPEND_THINK_TOKEN", text: thinkingText });
            dbg("THINK_TOKEN", { len: thinkingText.length });
          }

          // Also check additional_kwargs for reasoning_content (DeepSeek style)
          const reasoningFromKwargs =
            message.additional_kwargs?.reasoning_content ??
            message.additional_kwargs?.thinking;
          if (reasoningFromKwargs) {
            reasoningContentFromStream += reasoningFromKwargs;
            hasDispatchedThinking = true;
            dispatch({ type: "APPEND_THINK_TOKEN", text: reasoningFromKwargs });
            dbg("THINK_KWARGS", { len: reasoningFromKwargs.length });
          }
        }

        if (type === "ToolMessage" || type === "tool") {
          updateToolResult(message, dispatch, dbg);
        }
      }

      if (mode === "updates") {
        const interrupt = extractInterrupt(data);
        if (interrupt) {
          dbg("HITL_INTERRUPT", { actions: interrupt.actionRequests.map((action) => action.name) });
          return {
            responseText: responseTextFromStream.trim(),
            reasoningContent: reasoningContentFromStream.trim(),
            toolCallsObserved: dispatchedToolIds.size,
            hadError,
            interrupt,
          };
        }

        for (const message of nodeMessages(data)) {
          const type = messageType(message);
          const isAi = type === "AIMessage" || type === "ai" || type === "assistant";
          if (!isAi) continue;

          lastAiMessage = message;
          for (const toolCall of message.tool_calls ?? []) {
            const toolCallId = toolCall.id ?? `tc-${Date.now()}`;
            if (dispatchedToolIds.has(toolCallId)) continue;
            dispatchedToolIds.add(toolCallId);
            dispatch({
              type: "ADD_TOOL_CALL",
              toolCall: {
                id: toolCallId,
                name: toolCall.name ?? "unknown",
                args: toolCall.args ?? {},
                status: "running",
              },
            });
            dbg("TOOL_CALL", { toolCallId, name: toolCall.name });
          }

          // Extract <think> tags from updates-mode content for history (don't dispatch UI events —
          // messages mode handles streaming tokens; dispatching from both modes creates duplicates)
          const rawContent = messageContent(message);
          if (rawContent.includes("<think>")) {
            const { thinkingText } = thinkParser.parse(rawContent);
            if (thinkingText) {
              reasoningContentFromStream += thinkingText;
              hasDispatchedThinking = true;
              dbg("THINK_UPDATE", { len: thinkingText.length });
            }
          }

          // Fallback: if no thinking was dispatched from chunks, check additional_kwargs
          if (!hasDispatchedThinking) {
            const reasoningFromKwargs =
              message.additional_kwargs?.reasoning_content ??
              message.additional_kwargs?.thinking;
            if (reasoningFromKwargs?.trim()) {
              reasoningContentFromStream += reasoningFromKwargs;
              hasDispatchedThinking = true;
              dispatch({ type: "APPEND_THINK_TOKEN", text: reasoningFromKwargs });
              dbg("THINK_FALLBACK", { len: reasoningFromKwargs.length });
            }
          }
        }
      }
    }
  } catch (error) {
    hadError = true;
    const message = error instanceof Error ? error.message : String(error);
    dispatch({
      type: "APPEND_SYSTEM",
      id: `stream-error-${Date.now()}`,
      text: `Stream interrupted: ${message}`,
    });
    dbg("STREAM_ERROR", { message });
  }

  const aiMessageContent = messageContent(lastAiMessage ?? {});
  const finalContent = (aiMessageContent ? stripThinkTags(aiMessageContent) : "") || responseTextFromStream;
  dbg("STREAM_DONE", { hadAIMsg: lastAiMessage !== null });

  return {
    responseText: finalContent.trim(),
    reasoningContent: reasoningContentFromStream.trim(),
    toolCallsObserved: dispatchedToolIds.size,
    hadError,
  };
}
