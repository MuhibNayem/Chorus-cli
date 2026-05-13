import { countTokens, countMessagesTokens } from "./tokenizer.js";
import { getDefaultProvider, getSummaryModelForProvider } from "../llm/index.js";

const COMPACTION_RATIO = 0.75;
const KEEP_RECENT_RATIO = 0.22;

function getThresholds(contextWindow: number): { threshold: number; keepRecent: number } {
  return {
    threshold: Math.floor(contextWindow * COMPACTION_RATIO),
    keepRecent: Math.floor(contextWindow * KEEP_RECENT_RATIO),
  };
}
export interface CompactionResult {
  summary: string;
  originalCount: number;
  compressedCount: number;
}

export function shouldCompact(
  messages: Array<{ role: string; content: string; reasoning_content?: string }>,
  systemPrompt: string,
  contextWindow: number = 128_000
): boolean {
  const tokens = countMessagesTokens(messages, systemPrompt);
  return tokens >= getThresholds(contextWindow).threshold;
}

function selectRecentMessages(
  messages: Array<{ role: string; content: string; reasoning_content?: string }>,
  keepTokens: number
): {
  recentMessages: Array<{ role: string; content: string; reasoning_content?: string }>;
  olderMessages: Array<{ role: string; content: string; reasoning_content?: string }>;
} {
  const tokenCosts = messages.map((message) => {
    let text = `${message.role}: ${message.content}`;
    if (message.reasoning_content) {
      text += `\n[reasoning]: ${message.reasoning_content}`;
    }
    return {
      message,
      tokens: countTokens(text),
    };
  });

  let recentTokenTotal = 0;
  let splitIndex = messages.length;

  for (let i = tokenCosts.length - 1; i >= 0; i--) {
    const cost = tokenCosts[i].tokens;
    if (recentTokenTotal + cost > keepTokens && splitIndex !== messages.length) {
      break;
    }
    recentTokenTotal += cost;
    splitIndex = i;
    if (recentTokenTotal >= keepTokens) {
      break;
    }
  }

  return {
    olderMessages: messages.slice(0, splitIndex),
    recentMessages: messages.slice(splitIndex),
  };
}

export async function compactMessages(
  messages: Array<{ role: string; content: string; reasoning_content?: string }>,
  systemPrompt: string,
  contextWindow: number = 128_000
): Promise<CompactionResult> {
  const { keepRecent } = getThresholds(contextWindow);
  const originalCount = countMessagesTokens(messages, systemPrompt);

  const { recentMessages, olderMessages } = selectRecentMessages(messages, keepRecent);

  const summaryPrompt = `Summarize the following conversation, preserving key facts, decisions, architecture choices, and important context. Keep the summary concise but comprehensive enough that future interactions can understand the history.

Conversation to summarize:
${olderMessages.map((m) => {
    let text = `${m.role}: ${m.content}`;
    if (m.reasoning_content) {
      text += `\n[reasoning]: ${m.reasoning_content}`;
    }
    return text;
  }).join("\n\n")}

Provide a single summary paragraph.`;

  const provider = await getDefaultProvider();
  const summaryModel = getSummaryModelForProvider(provider.name);
  const result = await provider.generate({
    model: summaryModel,
    systemPrompt: "You summarize coding conversations for later continuation.",
    messages: [{ role: "user", content: summaryPrompt }],
  });
  const summary = result.text;

  const compressedMessages: Array<{ role: string; content: string; reasoning_content?: string }> = [
    { role: "system", content: `[Previous conversation summary: ${summary}]` },
    ...recentMessages,
  ];

  const compressedCount = countMessagesTokens(compressedMessages, systemPrompt);

  return {
    summary,
    originalCount,
    compressedCount,
  };
}


