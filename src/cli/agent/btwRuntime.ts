import { getDefaultProvider, getProviderModel } from "../../llm/index.js";
import type { ChatMessage } from "../../llm/provider.js";
import { SYSTEM_PROMPT } from "../../prompts/system.js";
import type { Message } from "../hooks/agent/types.js";

const BTW_SYSTEM_REMINDER = `<system-reminder>
This is a side question from the user. The main agent is working on a separate task — do NOT interrupt it. Answer this question directly using only your existing knowledge of the conversation context.

CRITICAL CONSTRAINTS:
- You have NO tools available — you cannot read files, run commands, or take any actions
- Answer in a single, direct response — maximum 3-4 sentences
- If you don't know, say so briefly — do not offer to investigate
- NEVER say "Let me check..." or "I'll look into..."
- Format: concise answer, no preamble, no "Based on the conversation..."
</system-reminder>`;

export interface BtwQueryResult {
  response: string;
  usage?: { inputTokens: number; outputTokens: number };
}

/**
 * Run a side-channel query. Forks the current conversation context, adds the
 * btw question, and gets a direct LLM answer. Does NOT write back to the
 * main conversation.
 */
export async function runBtwQuery(
  question: string,
  mainMessages: Message[],
): Promise<BtwQueryResult> {
  const provider = await getDefaultProvider();
  const model = getProviderModel(provider.name);
  const systemPrompt = SYSTEM_PROMPT;

  const contextMessages = buildBtwContext(mainMessages);
  const queryMessage: ChatMessage = {
    role: "user",
    content: `${BTW_SYSTEM_REMINDER}\n\nUser side question: ${question}\n\nPlease answer concisely:`,
  };

  const messages = [...contextMessages, queryMessage];

  const result = await provider.generate({
    model,
    systemPrompt,
    messages,
  });

  return {
    response: result.text.trim(),
    usage: { inputTokens: 0, outputTokens: 0 },
  };
}

function buildBtwContext(mainMessages: Message[]): ChatMessage[] {
  return mainMessages.map((m) => m as ChatMessage);
}
