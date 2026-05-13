import { initChatModel } from "langchain";
import { getProviderSettings } from "../settings/storage.js";
import type { ProviderName } from "./config.js";
import type {
  ChatMessage,
  GenerationRequest,
  GenerationResult,
  LLMProvider,
  ProviderHealth,
  StreamEvent,
} from "./provider.js";

type OllamaProviderOptions = {
  baseUrl?: string;
};

export class OllamaProvider implements LLMProvider {
  readonly name: ProviderName = "ollama";
  private readonly baseUrl: string;

  constructor(options: OllamaProviderOptions = {}) {
    const settings = getProviderSettings("ollama");
    this.baseUrl = options.baseUrl ?? process.env.OLLAMA_BASE_URL ?? settings.baseUrl ?? "http://localhost:11434";
  }

  async createChatModel(model: string) {
    return initChatModel(`ollama:${model}`, {
      baseUrl: this.baseUrl,
    });
  }

  async generate(input: GenerationRequest): Promise<GenerationResult> {
    const model = await this.createChatModel(input.model);
    const response = await model.invoke(this.toMessages(input));

    return {
      text: this.contentToString(response.content),
      model: input.model,
    };
  }

  async *stream(input: GenerationRequest): AsyncIterable<StreamEvent> {
    try {
      const model = await this.createChatModel(input.model);
      for await (const chunk of await model.stream(this.toMessages(input))) {
        const text = this.contentToString(chunk.content);
        if (text) {
          yield { type: "response.delta", text };
        }
      }
      yield { type: "response.completed" };
    } catch (error) {
      yield {
        type: "response.error",
        error: error instanceof Error ? error : new Error(String(error)),
      };
    }
  }

  async health(): Promise<ProviderHealth> {
    try {
      const response = await fetch(`${this.baseUrl}/api/tags`);
      return {
        ok: response.ok,
        provider: this.name,
        detail: response.ok ? "reachable" : `HTTP ${response.status}`,
      };
    } catch (error) {
      return {
        ok: false,
        provider: this.name,
        detail: error instanceof Error ? error.message : String(error),
      };
    }
  }

  private toMessages(input: GenerationRequest): ChatMessage[] {
    const base = input.messages.map((m) => {
      const msg: ChatMessage = { role: m.role, content: m.content };
      if (m.reasoning_content) {
        msg.reasoning_content = m.reasoning_content;
      }
      return msg;
    });
    if (!input.systemPrompt) {
      return base;
    }
    return [{ role: "system", content: input.systemPrompt }, ...base];
  }

  private contentToString(content: unknown): string {
    if (typeof content === "string") {
      return content;
    }
    if (Array.isArray(content)) {
      return content
        .map((part) => {
          if (typeof part === "string") return part;
          if (part && typeof part === "object" && "text" in part) {
            const text = (part as { text?: unknown }).text;
            return typeof text === "string" ? text : "";
          }
          return "";
        })
        .join("");
    }
    return "";
  }
}
