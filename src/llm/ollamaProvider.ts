import { getProviderSettings } from "../settings/storage.js";
import type { ProviderName } from "./config.js";
import { ReasoningStreamParser } from "./reasoningParser.js";
import type {
  ChatMessage,
  GenerationRequest,
  GenerationResult,
  LLMProvider,
  ModelResponse,
  ProviderHealth,
  StreamEvent,
  ToolCall,
  ToolDef,
  ToolStreamEvent,
} from "./provider.js";

type OllamaProviderOptions = {
  baseUrl?: string;
};

type OllamaChatChunk = {
  message?: {
    role?: string;
    content?: string;
    thinking?: string;
    reasoning_content?: string;
    tool_calls?: OllamaToolCall[];
  };
  done?: boolean;
  error?: string;
  prompt_eval_count?: number;
  eval_count?: number;
};

type OllamaToolCall = {
  id?: string;
  type?: string;
  function?: {
    name?: string;
    arguments?: string | Record<string, unknown>;
  };
};

type OllamaToolAccumulator = {
  id: string;
  type: "function";
  name: string;
  arguments: string;
};

type OllamaOutboundToolCall = {
  id?: string;
  type: "function";
  function: {
    name: string;
    arguments: Record<string, unknown>;
  };
};

type OllamaOutboundMessage = Omit<ChatMessage, "tool_calls" | "reasoning_content"> & {
  thinking?: string;
  tool_calls?: OllamaOutboundToolCall[];
};

function extractOllamaUsage(chunk: OllamaChatChunk): { inputTokens: number; outputTokens: number } | undefined {
  if (chunk.prompt_eval_count !== undefined || chunk.eval_count !== undefined) {
    return {
      inputTokens: chunk.prompt_eval_count ?? 0,
      outputTokens: chunk.eval_count ?? 0,
    };
  }
  return undefined;
}

export class OllamaProvider implements LLMProvider {
  readonly name: ProviderName = "ollama";
  private readonly baseUrl: string;

  constructor(options: OllamaProviderOptions = {}) {
    const settings = getProviderSettings("ollama");
    this.baseUrl = options.baseUrl ?? process.env.OLLAMA_BASE_URL ?? settings.baseUrl ?? "http://localhost:11434";
  }

  async generate(input: GenerationRequest): Promise<GenerationResult> {
    const response = await fetch(`${this.baseUrl}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: input.model,
        messages: this.toMessages(input),
        stream: false,
      }),
    });

    if (!response.ok) {
      const detail = await this.readErrorDetail(response);
      throw new Error(`ollama generate failed: ${response.status}${detail}`);
    }

    const data = (await response.json()) as OllamaChatChunk;
    if (data.error) {
      throw new Error(data.error);
    }

    return {
      text: data.message?.content ?? "",
      model: input.model,
    };
  }

  async *stream(input: GenerationRequest): AsyncIterable<StreamEvent> {
    try {
      const response = await fetch(`${this.baseUrl}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: input.model,
          messages: this.toMessages(input),
          stream: true,
        }),
      });

      if (!response.ok || !response.body) {
        const detail = await this.readErrorDetail(response);
        throw new Error(`ollama stream failed: ${response.status}${detail}`);
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";

          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed) continue;

            const chunk = JSON.parse(trimmed) as OllamaChatChunk;
            if (chunk.error) {
              throw new Error(chunk.error);
            }

            const text = chunk.message?.content ?? "";
            if (text) {
              yield { type: "response.delta", text };
            }
          }
        }

        const tail = buffer.trim();
        if (tail) {
          const chunk = JSON.parse(tail) as OllamaChatChunk;
          if (chunk.error) {
            throw new Error(chunk.error);
          }
          const text = chunk.message?.content ?? "";
          if (text) {
            yield { type: "response.delta", text };
          }
        }
      } finally {
        reader.releaseLock();
      }

      yield { type: "response.completed" };
    } catch (error) {
      yield {
        type: "response.error",
        error: error instanceof Error ? error : new Error(String(error)),
      };
    }
  }

  async *streamWithTools(input: GenerationRequest & { tools: ToolDef[] }): AsyncIterable<ToolStreamEvent> {
    const response = await fetch(`${this.baseUrl}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: input.model,
        messages: this.toMessages(input),
        tools: input.tools,
        stream: true,
      }),
    });

    if (!response.ok || !response.body) {
      const detail = await this.readErrorDetail(response);
      throw new Error(`ollama tool stream failed: ${response.status}${detail}`);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    const toolCalls = new Map<number, OllamaToolAccumulator>();
    const thinkParser = new ReasoningStreamParser();
    let buffer = "";
    let content = "";
    let reasoning = "";
    let hasNativeReasoning = false;
    let completed = false;

    function* emitFragments(frags: ReturnType<ReasoningStreamParser["write"]>) {
      for (const frag of frags) {
        if (frag.type === "thinking") {
          reasoning += frag.text;
          yield { type: "thinking" as const, text: frag.text };
        } else {
          content += frag.text;
          yield { type: "token" as const, text: frag.text };
        }
      }
    }

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;

          const chunk = JSON.parse(trimmed) as OllamaChatChunk;
          if (chunk.error) {
            throw new Error(chunk.error);
          }

          const nativeThinking = chunk.message?.thinking ?? chunk.message?.reasoning_content ?? "";
          if (nativeThinking) {
            hasNativeReasoning = true;
            reasoning += nativeThinking;
            yield { type: "thinking", text: nativeThinking };
          }

          const text = chunk.message?.content ?? "";
          if (text) {
            if (hasNativeReasoning) {
              content += text;
              yield { type: "token", text };
            } else {
              for (const frag of emitFragments(thinkParser.write(text))) {
                yield frag;
              }
            }
          }

          this.accumulateOllamaToolCalls(toolCalls, chunk.message?.tool_calls);

          if (chunk.done) {
            completed = true;
            if (!hasNativeReasoning) {
              for (const frag of thinkParser.flush()) {
                if (frag.type === "thinking") reasoning += frag.text;
                else content += frag.text;
                yield frag;
              }
            }
            const usage = extractOllamaUsage(chunk);
            yield { type: "done", response: this.buildModelResponse(content, reasoning, toolCalls, usage) };
            return;
          }
        }
      }

      const tail = buffer.trim();
      if (tail) {
        const chunk = JSON.parse(tail) as OllamaChatChunk;
        if (chunk.error) {
          throw new Error(chunk.error);
        }

        const nativeThinking = chunk.message?.thinking ?? chunk.message?.reasoning_content ?? "";
        if (nativeThinking) {
          hasNativeReasoning = true;
          reasoning += nativeThinking;
          yield { type: "thinking", text: nativeThinking };
        }

        const text = chunk.message?.content ?? "";
        if (text) {
          if (hasNativeReasoning) {
            content += text;
            yield { type: "token", text };
          } else {
            for (const frag of emitFragments(thinkParser.write(text))) {
              yield frag;
            }
          }
        }

        this.accumulateOllamaToolCalls(toolCalls, chunk.message?.tool_calls);
        if (chunk.done) {
          completed = true;
          if (!hasNativeReasoning) {
            for (const frag of thinkParser.flush()) {
              if (frag.type === "thinking") reasoning += frag.text;
              else content += frag.text;
              yield frag;
            }
          }
          const usage = extractOllamaUsage(chunk);
          yield { type: "done", response: this.buildModelResponse(content, reasoning, toolCalls, usage) };
          return;
        }
      }
    } finally {
      reader.releaseLock();
    }

    if (!completed) {
      if (!hasNativeReasoning) {
        for (const frag of thinkParser.flush()) {
          if (frag.type === "thinking") reasoning += frag.text;
          else content += frag.text;
          yield frag;
        }
      }
      yield { type: "done", response: this.buildModelResponse(content, reasoning, toolCalls) };
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

  private toMessages(input: GenerationRequest): OllamaOutboundMessage[] {
    const base = input.messages.map((m) => {
      const msg: OllamaOutboundMessage = { role: m.role, content: m.content };
      if (m.reasoning_content && m.role === "assistant") {
        msg.thinking = m.reasoning_content;
      }
      if (m.tool_call_id) {
        msg.tool_call_id = m.tool_call_id;
      }
      if (m.tool_calls) {
        msg.tool_calls = m.tool_calls.map((toolCall) => ({
          id: toolCall.id,
          type: toolCall.type,
          function: {
            name: toolCall.function.name,
            arguments: this.parseOllamaToolArguments(toolCall.function.arguments),
          },
        }));
      }
      return msg;
    });
    if (!input.systemPrompt) {
      return base;
    }
    return [{ role: "system", content: input.systemPrompt }, ...base];
  }

  private accumulateOllamaToolCalls(
    calls: Map<number, OllamaToolAccumulator>,
    deltas: OllamaToolCall[] | undefined,
  ): void {
    for (const [index, delta] of (deltas ?? []).entries()) {
      const current =
        calls.get(index) ??
        {
          id: delta.id ?? `ollama-tool-${index}`,
          type: "function" as const,
          name: "",
          arguments: "",
        };

      if (delta.id) current.id = delta.id;
      if (delta.function?.name) current.name = delta.function.name;
      if (delta.function?.arguments !== undefined) {
        if (typeof delta.function.arguments === "string") {
          current.arguments += delta.function.arguments;
        } else {
          current.arguments = JSON.stringify(delta.function.arguments);
        }
      }
      calls.set(index, current);
    }
  }

  private parseOllamaToolArguments(raw: string): Record<string, unknown> {
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      // Fall through to a raw wrapper. The local executor will surface malformed
      // JSON earlier; this keeps a bad historical call from breaking Ollama's parser.
    }
    return { _raw: raw };
  }

  private buildModelResponse(
    content: string,
    reasoning: string,
    calls: Map<number, OllamaToolAccumulator>,
    usage?: { inputTokens: number; outputTokens: number },
  ): ModelResponse {
    const tool_calls: ToolCall[] = [...calls.entries()]
      .sort(([a], [b]) => a - b)
      .filter(([, call]) => call.name)
      .map(([, call]) => ({
        id: call.id,
        type: call.type,
        function: {
          name: call.name,
          arguments: call.arguments,
        },
      }));

    return {
      content,
      ...(reasoning ? { reasoning_content: reasoning } : {}),
      ...(tool_calls.length > 0 ? { tool_calls } : {}),
      ...(usage ? { usage } : {}),
    };
  }

  private async readErrorDetail(response: Response): Promise<string> {
    try {
      const text = await response.text();
      return text ? `: ${text}` : "";
    } catch {
      return "";
    }
  }
}
