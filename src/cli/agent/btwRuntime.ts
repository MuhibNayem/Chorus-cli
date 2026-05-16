import { getDefaultProvider, getProviderModel } from "../../llm/index.js";
import type { ChatMessage } from "../../llm/provider.js";
import type { Message } from "../hooks/agent/types.js";

const BTW_SYSTEM_PROMPT = `You are a fast assistant answering a side question while the main agent works. 

RULES:
- Answer in 1-3 sentences, maximum.
- No tools, no analysis, no investigation.
- Do NOT say "Let me check..." or "I'll look into...".
- If you don't know from the conversation context, say "I don't have enough context to answer that."
- No preamble, no sign-off.`;

const BTW_USER_PREFIX = `<system-reminder>This is a side question. Answer concisely.</system-reminder>`;

export interface BtwQueryResult {
  response: string;
}

/**
 * Fast side-channel query. Uses only the last 2 user/assistant messages for context,
 * NOT the full history or the main system prompt. Lightweight and quick.
 */
export async function runBtwQuery(
  question: string,
  mainMessages: Message[],
): Promise<BtwQueryResult> {
  const provider = await getDefaultProvider();
  const model = getProviderModel(provider.name);
  const contextMessages = buildBtwContext(mainMessages);
  const queryMessage: ChatMessage = {
    role: "user",
    content: `${BTW_USER_PREFIX}\n\nQuestion: ${question}`,
  };

  const messages = [...contextMessages, queryMessage];
  const result = await provider.generate({
    model,
    systemPrompt: BTW_SYSTEM_PROMPT,
    messages,
  });

  return { response: result.text.trim() };
}

/** Take only the last 2 relevant messages for lightweight context. */
function buildBtwContext(mainMessages: Message[]): ChatMessage[] {
  const recent: ChatMessage[] = [];
  for (let i = mainMessages.length - 1; i >= 0 && recent.length < 2; i--) {
    const m = mainMessages[i];
    if (m.role === "user" || m.role === "assistant") {
      recent.unshift({ role: m.role as "user" | "assistant", content: m.content.slice(0, 300) });
    }
  }
  return recent;
}
