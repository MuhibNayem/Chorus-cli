import { countTokens, countMessagesTokens } from "./tokenizer";
import { streamOllama } from "../ollama/client";
import { buildSubagentPrompt } from "../prompts/system";
import { withRetry } from "../llm/retry";

const COMPACTION_THRESHOLD = 100_000;
const KEEP_RECENT_TOKENS = 28_000;
const SUMMARIZE_MODEL = process.env.OLLAMA_MODEL ?? "batiai/gemma4-e2b:q4";
const OLLAMA_BASE_URL = process.env.OLLAMA_BASE_URL ?? "http://localhost:11434";

export interface CompactionResult {
  summary: string;
  originalCount: number;
  compressedCount: number;
}

export async function shouldCompact(
  messages: Array<{ role: string; content: string }>,
  systemPrompt: string
): Promise<boolean> {
  const tokens = await countMessagesTokens(messages, systemPrompt);
  return tokens >= COMPACTION_THRESHOLD;
}

export async function compactMessages(
  messages: Array<{ role: string; content: string }>,
  systemPrompt: string
): Promise<CompactionResult> {
  const originalCount = await countMessagesTokens(messages, systemPrompt);

  const recentMessages = messages.slice(-20);
  const olderMessages = messages.slice(0, -20);

  const summaryPrompt = `Summarize the following conversation, preserving key facts, decisions, architecture choices, and important context. Keep the summary concise but comprehensive enough that future interactions can understand the history.

Conversation to summarize:
${olderMessages.map((m) => `${m.role}: ${m.content}`).join("\n\n")}

Provide a single summary paragraph.`;

  let summary = "";

  await withRetry(
    () =>
      new Promise<void>((resolve, reject) => {
        streamOllama({
          baseUrl: OLLAMA_BASE_URL,
          model: SUMMARIZE_MODEL,
          systemPrompt: buildSubagentPrompt("planner"),
          messages: [{ role: "user", content: summaryPrompt }],
          onThink: () => {},
          onResponse: (text) => { summary += text; },
          onComplete: () => resolve(),
          onError: reject,
        });
      }),
    { maxAttempts: 3, baseDelayMs: 1_000 }
  );

  const compressedMessages: Array<{ role: string; content: string }> = [
    { role: "system", content: `[Previous conversation summary: ${summary}]` },
    ...recentMessages,
  ];

  const compressedCount = await countMessagesTokens(compressedMessages, systemPrompt);

  return {
    summary,
    originalCount,
    compressedCount,
  };
}

export { COMPACTION_THRESHOLD, KEEP_RECENT_TOKENS };

// Trims messages until token count is below `maxTokens`, dropping oldest non-system messages first.
export async function trimToWindow(
  messages: Array<{ role: string; content: string }>,
  systemPrompt: string,
  maxTokens: number
): Promise<Array<{ role: string; content: string }>> {
  let current = [...messages];
  let count = await countMessagesTokens(current, systemPrompt);
  while (count >= maxTokens && current.length > 1) {
    const firstNonSystem = current.findIndex((m) => m.role !== "system");
    if (firstNonSystem === -1) break;
    current.splice(firstNonSystem, 1);
    count = await countMessagesTokens(current, systemPrompt);
  }
  return current;
}
