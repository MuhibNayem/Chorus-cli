/**
 * Headless agent runner — bridges A2AServer.handleTask to runAgentLoop.
 *
 * No React, no TUI, no HITL blocking. Uses full_auto approval policy so the
 * agent loop never pauses waiting for human confirmation — appropriate for a
 * daemon process that has no interactive terminal.
 *
 * All agent events are forwarded to globalBroadcaster so the ChannelServer
 * SSE stream (/events) reflects daemon task activity in real time.
 */

import { randomUUID } from "crypto";
import {
  getDefaultProvider,
  createProvider,
  getProviderModel,
  getContextWindow,
} from "../llm/index.js";
import { getModeModelConfig } from "../settings/storage.js";
import { filesystemTools } from "../tools/filesystem.js";
import { allTools } from "../tools/index.js";
import { getMcpTools } from "../mcp/client.js";
import { buildSystemPrompt } from "../prompts/system.js";
import { runAgentLoop } from "../agent/loop.js";
import { HitlGate } from "../agent/hitl.js";
import { JsonFileCheckpointer } from "../agent/checkpointer.js";
import { BtwQueue } from "../agent/btw.js";
import { createDefaultMiddleware } from "../agent/middleware.js";
import { globalBroadcaster } from "../channels/broadcaster.js";
import { fireHook } from "../gateway/hooks.js";
import type { ChatMessage } from "../llm/provider.js";

export interface HeadlessRunOptions {
  input: string;
  /** Stable thread ID; defaults to a fresh UUID per request. */
  threadId?: string;
  /** Override the configured provider by name. */
  provider?: string;
  /** Override the configured model name. */
  model?: string;
  /**
   * Existing conversation history to continue. The runner appends the new
   * user message and runs the loop, then returns the updated history via
   * `onHistoryUpdate`. Enables multi-turn conversations (e.g. Telegram).
   */
  history?: ChatMessage[];
  /** Called once with the complete updated message history after the turn. */
  onHistoryUpdate?: (history: ChatMessage[]) => void;
  /** AbortSignal to cancel the in-flight agent loop (e.g. /stop command). */
  abortSignal?: AbortSignal;
}

// One HitlGate per process — full_auto means shouldPause() always returns false.
const daemonHitlGate = new HitlGate();
const daemonCheckpointer = new JsonFileCheckpointer();

/**
 * Run one agent turn headlessly, yielding token chunks as they arrive.
 *
 * Suitable as the `handleTask` callback for A2AServer — the caller receives
 * an AsyncGenerator<string> and can stream chunks directly to the HTTP client.
 */
export async function* runHeadlessAgent(
  options: HeadlessRunOptions,
): AsyncGenerator<string> {
  const { input } = options;
  const threadId = options.threadId ?? randomUUID();

  // Provider resolution: explicit arg → mode config → global default
  const modeConfig =
    !options.provider && !options.model ? getModeModelConfig("build") : null;
  const providerName = options.provider ?? modeConfig?.provider;
  const modelName = options.model ?? modeConfig?.model;

  const provider = providerName
    ? createProvider(providerName)
    : await getDefaultProvider();
  const resolvedModel = modelName ?? getProviderModel(provider.name);

  const mcpTools = await getMcpTools();
  // Delegate tool is omitted — it requires a React dispatch for TUI event routing.
  const tools = [...filesystemTools, ...allTools, ...mcpTools];

  // Build message list: prior history (if any) + the new user turn.
  const messages: ChatMessage[] = [
    ...(options.history ?? []),
    { role: "user", content: input },
  ];
  const systemPrompt = buildSystemPrompt(provider.name, resolvedModel);
  const btwQueue = new BtwQueue();

  globalBroadcaster.broadcastSessionStart(threadId);
  fireHook("agent:start", { threadId, input });

  let agentResult: { output: string; reasoning: string; toolCount: number; inputTokens: number; outputTokens: number; costUsd: number; durationMs: number } | null = null;

  try {
    for await (const event of runAgentLoop({
      provider,
      model: resolvedModel,
      tools,
      messages,
      systemPrompt,
      threadId,
      hitlGate: daemonHitlGate,
      btwQueue,
      policy: "full_auto",
      checkpointer: daemonCheckpointer,
      middleware: createDefaultMiddleware(threadId, {
        contextWindow: getContextWindow(resolvedModel),
      }),
      abortSignal: options.abortSignal,
    })) {
      // Mirror every event to the SSE channel so connected clients get live updates.
      globalBroadcaster.broadcastAgentEvent(threadId, event);

      if (event.type === "token") {
        yield event.text;
      } else if (event.type === "done") {
        agentResult = { output: event.response, reasoning: event.reasoning, toolCount: event.toolCount, inputTokens: event.inputTokens, outputTokens: event.outputTokens, costUsd: event.costUsd, durationMs: event.durationMs };
        options.onHistoryUpdate?.(event.history as ChatMessage[]);
        return;
      } else if (event.type === "error" && event.fatal) {
        throw new Error(event.message);
      }
    }
  } finally {
    fireHook("agent:end", { threadId, input, ...agentResult });
    globalBroadcaster.broadcastSessionEnd(threadId);
  }
}
