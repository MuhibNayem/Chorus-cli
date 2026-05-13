import { get_encoding, Tiktoken } from "tiktoken";

let encoder: Tiktoken | null = null;

function getEncoder(): Tiktoken {
  if (!encoder) {
    encoder = get_encoding("cl100k_base");
  }
  return encoder;
}

export async function countTokens(text: string): Promise<number> {
  const enc = getEncoder();
  return enc.encode(text).length;
}

export async function countMessagesTokens(
  messages: Array<{ role: string; content: string }>,
  systemPrompt: string
): Promise<number> {
  let total = await countTokens(systemPrompt);

  for (const msg of messages) {
    total += await countTokens(`${msg.role}: ${msg.content}`);
  }

  return total;
}

export function tokensToDisplay(tokens: number): string {
  if (tokens < 1000) return `${tokens}`;
  if (tokens < 1000000) return `${(tokens / 1000).toFixed(1)}K`;
  return `${(tokens / 1000000).toFixed(1)}M`;
}
