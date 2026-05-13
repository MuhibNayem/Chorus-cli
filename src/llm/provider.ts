import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import type { ProviderName } from "./config.js";

export type ChatMessage = {
  role: "system" | "user" | "assistant";
  content: string;
  reasoning_content?: string;
};

export type GenerationRequest = {
  model: string;
  systemPrompt?: string;
  messages: ChatMessage[];
};

export type GenerationResult = {
  text: string;
  model: string;
};

export type StreamEvent =
  | { type: "response.delta"; text: string }
  | { type: "response.completed" }
  | { type: "response.error"; error: Error };

export type ProviderHealth = {
  ok: boolean;
  provider: ProviderName;
  detail?: string;
};

export interface LLMProvider {
  readonly name: ProviderName;
  createChatModel(model: string): Promise<BaseChatModel>;
  generate(input: GenerationRequest): Promise<GenerationResult>;
  stream(input: GenerationRequest): AsyncIterable<StreamEvent>;
  health(): Promise<ProviderHealth>;
}
