import { initChatModel } from "langchain";
import { getProviderSettings } from "../settings/storage.js";
import type { ProviderName } from "./config.js";
import type {
  GenerationRequest,
  GenerationResult,
  LLMProvider,
  ProviderHealth,
  StreamEvent,
} from "./provider.js";

type VllmProviderOptions = {
  name?: ProviderName;
  apiKey?: string;
  baseUrl?: string;
};

type OpenAIChatCompletionResponse = {
  choices?: Array<{
    message?: { content?: string | null; reasoning_content?: string };
    delta?: { content?: string | null; reasoning_content?: string };
    finish_reason?: string | null;
  }>;
  error?: { message?: string };
};

/**
 * Cache for DeepSeek reasoning_content across API calls.
 * DeepSeek requires reasoning_content to be passed back in subsequent requests
 * when the model is in "thinking mode". LangChain's ChatOpenAI strips this field
 * during message serialization, so we intercept at the HTTP level.
 */
const reasoningCache = new Map<string, string>();

async function parseSSEForReasoning(stream: ReadableStream<Uint8Array>): Promise<void> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let accumulatedReasoning = "";
  const toolCallIds: string[] = [];

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith("data:")) continue;
        const data = trimmed.slice(5).trim();
        if (data === "[DONE]") continue;

        try {
          const parsed = JSON.parse(data) as OpenAIChatCompletionResponse;
          for (const choice of parsed.choices ?? []) {
            const delta = choice.delta;
            if (!delta) continue;
            if (delta.reasoning_content) {
              accumulatedReasoning += delta.reasoning_content;
            }
            const deltaToolCalls = (delta as Record<string, unknown>).tool_calls as Array<{ index?: number; id?: string }> | undefined;
            if (deltaToolCalls) {
              for (const tc of deltaToolCalls) {
                if (tc.id && !toolCallIds.includes(tc.id)) {
                  toolCallIds.push(tc.id);
                }
              }
            }
          }
        } catch {
          // Ignore parse errors on individual chunks
        }
      }
    }
  } catch {
    // Ignore stream errors
  } finally {
    reader.releaseLock();
  }

  if (accumulatedReasoning && toolCallIds.length > 0) {
    for (const id of toolCallIds) {
      reasoningCache.set(id, accumulatedReasoning);
    }
  }
}

function createDeepSeekCompatibleFetch(originalFetch: typeof fetch): typeof fetch {
  return async (input, init) => {
    let modifiedInit = init;

    // Intercept outgoing requests: inject cached reasoning_content
    if (init?.body && typeof init.body === "string") {
      try {
        const body = JSON.parse(init.body);
        if (Array.isArray(body.messages)) {
          let modified = false;
          for (const msg of body.messages) {
            if (
              msg.role === "assistant" &&
              Array.isArray(msg.tool_calls) &&
              msg.tool_calls.length > 0 &&
              msg.reasoning_content === undefined
            ) {
              for (const tc of msg.tool_calls) {
                const cached = reasoningCache.get(tc.id);
                if (cached !== undefined) {
                  msg.reasoning_content = cached;
                  modified = true;
                  break;
                }
              }
            }
          }
          if (modified) {
            modifiedInit = { ...init, body: JSON.stringify(body) };
          }
        }
      } catch {
        // Not JSON, ignore
      }
    }

    const response = await originalFetch(input, modifiedInit);

    // Intercept incoming responses: cache reasoning_content by tool call ID
    if (response.ok && response.body) {
      const contentType = response.headers.get("content-type") || "";

      if (contentType.includes("application/json")) {
        const clone = response.clone();
        try {
          const data = (await clone.json()) as OpenAIChatCompletionResponse;
          for (const choice of data.choices || []) {
            const msg = choice.message || choice.delta;
            if (msg?.reasoning_content) {
              const toolCalls = (msg as Record<string, unknown>).tool_calls as Array<{ id?: string }> | undefined;
              if (toolCalls && toolCalls.length > 0) {
                for (const tc of toolCalls) {
                  if (tc.id) {
                    reasoningCache.set(tc.id, msg.reasoning_content);
                  }
                }
              }
            }
          }
        } catch {
          // Ignore parse errors
        }
      } else if (contentType.includes("text/event-stream")) {
        // Tee the stream: parse one copy for reasoning_content, return the other unchanged
        const [ourStream, theirStream] = response.body.tee();
        void parseSSEForReasoning(ourStream);
        return new Response(theirStream, {
          status: response.status,
          statusText: response.statusText,
          headers: response.headers,
        });
      }
    }

    return response;
  };
}

export class VllmProvider implements LLMProvider {
  readonly name: ProviderName;
  private readonly apiKey: string;
  private readonly baseUrl: string;

  constructor(options: VllmProviderOptions = {}) {
    const name = options.name ?? "vllm";
    const settings = getProviderSettings(name);
    const prefix = name.toUpperCase().replace(/-/g, "_");
    this.name = name;
    this.apiKey =
      options.apiKey ??
      process.env[`${prefix}_API_KEY`] ??
      settings.apiKey ??
      "EMPTY";
    this.baseUrl =
      options.baseUrl ??
      process.env[`${prefix}_BASE_URL`] ??
      settings.baseUrl ??
      (name === "vllm" ? "http://127.0.0.1:8000/v1" : "");
  }

  async createChatModel(model: string) {
    const isDeepSeek = this.name === "deepseek" || model.toLowerCase().includes("deepseek");

    const config: Record<string, unknown> = {
      baseURL: this.baseUrl,
    };

    if (isDeepSeek) {
      config.fetch = createDeepSeekCompatibleFetch(globalThis.fetch);
    }

    return initChatModel(model, {
      modelProvider: "openai",
      apiKey: this.apiKey,
      configuration: config,
    });
  }

  async generate(input: GenerationRequest): Promise<GenerationResult> {
    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: "POST",
      headers: this.buildHeaders(),
      body: JSON.stringify({
        model: input.model,
        messages: this.toMessages(input),
        stream: false,
      }),
    });

    if (!response.ok) {
      throw new Error(`${this.name} request failed: ${response.status}`);
    }

    const payload = (await response.json()) as OpenAIChatCompletionResponse;
    const text = payload.choices?.[0]?.message?.content ?? "";

    return {
      text,
      model: input.model,
    };
  }

  async *stream(input: GenerationRequest): AsyncIterable<StreamEvent> {
    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: "POST",
      headers: this.buildHeaders(),
      body: JSON.stringify({
        model: input.model,
        messages: this.toMessages(input),
        stream: true,
      }),
    });

    if (!response.ok || !response.body) {
      throw new Error(`${this.name} stream failed: ${response.status}`);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith("data:")) continue;
        const data = trimmed.slice(5).trim();
        if (data === "[DONE]") {
          yield { type: "response.completed" };
          return;
        }

        try {
          const parsed = JSON.parse(data) as OpenAIChatCompletionResponse;
          const text = parsed.choices?.[0]?.delta?.content ?? "";
          if (text) {
            yield { type: "response.delta", text };
          }
        } catch (error) {
          yield {
            type: "response.error",
            error: error instanceof Error ? error : new Error(String(error)),
          };
          return;
        }
      }
    }

    yield { type: "response.completed" };
  }

  async health(): Promise<ProviderHealth> {
    try {
      const response = await fetch(`${this.baseUrl}/models`, {
        headers: this.buildHeaders(),
      });
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

  private buildHeaders(): Record<string, string> {
    return {
      "Content-Type": "application/json",
      Authorization: `Bearer ${this.apiKey}`,
    };
  }

  private toMessages(input: GenerationRequest) {
    const messages = input.messages.map((m) => {
      const msg: Record<string, unknown> = { role: m.role, content: m.content };
      if (m.reasoning_content) {
        msg.reasoning_content = m.reasoning_content;
      }
      return msg;
    });
    if (input.systemPrompt) {
      return [{ role: "system", content: input.systemPrompt }, ...messages];
    }
    return messages;
  }
}
