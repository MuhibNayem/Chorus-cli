import { useCallback, useRef } from "react";
import type { Dispatch } from "react";
import { appendFileSync } from "fs";
import { initChatModel } from "langchain";
import { createDeepAgent } from "deepagents";
import { allTools } from "../../tools/index.js";
import { allSubagents } from "../../subagents/index.js";
import { SYSTEM_PROMPT } from "../../prompts/system.js";
import { countMessagesTokens } from "../../context/tokenizer.js";
import { shouldCompact, compactMessages, trimToWindow, COMPACTION_THRESHOLD } from "../../context/compaction.js";
import { sessionManager } from "../../session/manager.js";
import type { FeedAction } from "../state/feedReducer.js";

const OLLAMA_BASE_URL = process.env.OLLAMA_BASE_URL ?? "http://localhost:11434";
const MODEL_NAME      = process.env.OLLAMA_MODEL      ?? "batiai/gemma4-e2b:q4";

function dbg(label: string, data?: unknown): void {
  if (process.env.DEBUG !== "1") return;
  const line = `[${new Date().toISOString()}] ${label}${
    data !== undefined ? " " + JSON.stringify(data, null, 0) : ""
  }\n`;
  try { appendFileSync("debug.log", line); } catch { /* never crash on debug */ }
}

interface Message {
  role: string;
  content: string;
}

interface UseAgentStreamOptions {
  dispatch: Dispatch<FeedAction>;
  onTokensUpdate: (tokens: number) => void;
  initialMessages?: Message[];
}

export function useAgentStream({ dispatch, onTokensUpdate, initialMessages }: UseAgentStreamOptions) {
  const messagesRef = useRef<Message[]>(initialMessages ?? []);
  const abortControllerRef = useRef<AbortController | null>(null);

  const cancel = useCallback(() => {
    abortControllerRef.current?.abort();
  }, []);

  const submit = useCallback(
    async (text: string) => {
      dbg("SUBMIT", { text: text.slice(0, 80) });

      const abortController = new AbortController();
      abortControllerRef.current = abortController;

      const userId = `user-${Date.now()}`;
      dispatch({ type: "APPEND_USER", id: userId, text });
      messagesRef.current.push({ role: "user", content: text });

      const tokenCount = await countMessagesTokens(messagesRef.current, SYSTEM_PROMPT);
      onTokensUpdate(tokenCount);

      if (await shouldCompact(messagesRef.current, SYSTEM_PROMPT)) {
        const result = await compactMessages(messagesRef.current, SYSTEM_PROMPT);
        let compacted: Array<{ role: string; content: string }> = [
          { role: "system", content: `[Previous conversation summary: ${result.summary}]` },
          ...messagesRef.current.slice(-20),
        ];
        // If still over 75% of threshold after compaction, progressively drop oldest messages
        const budget = Math.floor(COMPACTION_THRESHOLD * 0.75);
        compacted = await trimToWindow(compacted, SYSTEM_PROMPT, budget);
        messagesRef.current = compacted;
        onTokensUpdate(result.compressedCount);
      }

      try {
        const model = await initChatModel(`ollama:${MODEL_NAME}`, {
          baseUrl: OLLAMA_BASE_URL,
        });

        const runtimePrompt = `${SYSTEM_PROMPT}
## Workspace

Working directory: ${process.cwd()}
Platform: ${process.platform}
Node version: ${process.version}
`;

        const agentOptions: Parameters<typeof createDeepAgent>[0] = {
          model,
          tools:        allTools     as any,
          subagents:    allSubagents as any,
          systemPrompt: runtimePrompt,
        };
        if (process.env.DISABLE_TODO_MIDDLEWARE === "1") {
          agentOptions.middleware = [];
        }

        const agent = createDeepAgent(agentOptions);

        const stream = await agent.stream(
          { messages: messagesRef.current as any },
          {
            streamMode: ["messages", "updates"] as const,
            configurable: { thread_id: sessionManager.getCurrent()?.id },
            signal: abortController.signal,
          } as any,
        );
        dbg("STREAM_OPENED", { msgCount: messagesRef.current.length });

        const dispatchedToolIds = new Set<string>();
        let lastAIMsg: any        = null;
        let responseTextFromStream = "";
        let thinkingDispatched    = false;

        for await (const rawChunk of stream) {
          if (abortController.signal.aborted) break;
          const [mode, data] = rawChunk as unknown as [string, unknown];

          // ── per-token streaming ─────────────────────────────────────────
          if (mode === "messages") {
            const [msg, _meta] = data as [any, any];
            const msgType: string = msg?.type ?? msg?.role ?? "";

            const isAIChunk =
              msgType === "AIMessageChunk" ||
              msgType === "ai"             ||
              msgType === "assistant";

            if (isAIChunk) {
              const content = typeof msg.content === "string" ? msg.content : "";
              if (content) {
                responseTextFromStream += content;
                dispatch({ type: "APPEND_RESPONSE_TOKEN", text: content });
                dbg("TOKEN", { len: content.length });
              }

              const thinking: string | undefined =
                msg.additional_kwargs?.reasoning_content ??
                msg.additional_kwargs?.thinking;
              if (thinking) {
                thinkingDispatched = true;
                dispatch({ type: "APPEND_THINK_TOKEN", text: thinking });
                dbg("THINK_TOKEN", { len: thinking.length });
              }
            }

            const isToolMsg = msgType === "ToolMessage" || msgType === "tool";
            if (isToolMsg) {
              const toolCallId: string | undefined = msg.tool_call_id;
              const result = msg.content;
              if (toolCallId && result !== undefined) {
                dispatch({
                  type:   "UPDATE_TOOL_CALL",
                  id:     toolCallId,
                  result: typeof result === "string" ? result : JSON.stringify(result),
                  status: "done",
                });
                dbg("TOOL_RESULT", { toolCallId });
              }
            }
          }

          // ── node state diffs ────────────────────────────────────────────
          if (mode === "updates") {
            const stateUpdate = data as Record<string, unknown>;

            for (const nodeOutput of Object.values(stateUpdate)) {
              if (!nodeOutput || typeof nodeOutput !== "object") continue;
              const msgs = (nodeOutput as any).messages;
              if (!Array.isArray(msgs)) continue;

              for (const msg of msgs) {
                const msgType: string = msg?.type ?? msg?.role ?? "";
                const isAI =
                  msgType === "AIMessage" ||
                  msgType === "ai"        ||
                  msgType === "assistant";

                if (isAI) {
                  lastAIMsg = msg;

                  // Bug 1.2 fix: also scan additional_kwargs.tool_calls for Ollama
                  const toolCalls: any[] = [
                    ...(msg.tool_calls ?? []),
                    ...(msg.additional_kwargs?.tool_calls ?? []),
                  ];
                  for (const tc of toolCalls) {
                    const tcId: string = tc.id ?? `tc-${Date.now()}`;
                    if (dispatchedToolIds.has(tcId)) continue;
                    dispatchedToolIds.add(tcId);
                    dispatch({
                      type: "ADD_TOOL_CALL",
                      toolCall: {
                        id:     tcId,
                        name:   tc.name ?? "unknown",
                        args:   tc.args ?? {},
                        status: "running",
                      },
                    });
                    dbg("TOOL_CALL", { tcId, name: tc.name });
                  }

                  if (!thinkingDispatched) {
                    const thinking: string | undefined =
                      msg.additional_kwargs?.reasoning_content ??
                      msg.additional_kwargs?.thinking;
                    if (thinking?.trim()) {
                      thinkingDispatched = true;
                      dispatch({ type: "APPEND_THINK_TOKEN", text: thinking });
                      dbg("THINK_FALLBACK", { len: thinking.length });
                    }
                  }
                }
              }
            }
          }
        }

        if (abortController.signal.aborted) {
          dispatch({
            type:    "SET_ERROR",
            id:      `cancelled-${Date.now()}`,
            message: "Cancelled by user.",
          });
          return;
        }

        dbg("STREAM_DONE", { hadAIMsg: !!lastAIMsg });

        // Bug 1.1 fix: prefer streamed tokens; fall back to updates-mode content
        const aiMessageContent = typeof lastAIMsg?.content === "string"
          ? lastAIMsg.content.replace(/<think>[\s\S]*?<\/think>/g, "").trim()
          : "";
        const responseText = (responseTextFromStream || aiMessageContent).trim();

        if (responseText) {
          messagesRef.current.push({ role: "assistant", content: responseText });
        }

        // Auto-save session after every completed turn
        sessionManager.onMessageAdded(messagesRef.current);

        const finalCount = await countMessagesTokens(messagesRef.current, SYSTEM_PROMPT);
        onTokensUpdate(finalCount);

        dispatch({ type: "FINALIZE_TURN" });

      } catch (err) {
        if (err instanceof Error && err.name === "AbortError") {
          dispatch({
            type:    "SET_ERROR",
            id:      `cancelled-${Date.now()}`,
            message: "Cancelled by user.",
          });
          return;
        }
        const errMsg = err instanceof Error ? err.message : String(err);
        dbg("ERROR", { message: errMsg, stack: err instanceof Error ? err.stack : undefined });
        dispatch({
          type:    "SET_ERROR",
          id:      `error-${Date.now()}`,
          message: errMsg,
        });
      }
    },
    [dispatch, onTokensUpdate]
  );

  const clearHistory = useCallback(() => {
    messagesRef.current = [];
    abortControllerRef.current = null;
  }, []);

  const loadSession = useCallback((msgs: Message[]) => {
    messagesRef.current = msgs;
  }, []);

  return { submit, clearHistory, loadSession, cancel };
}
