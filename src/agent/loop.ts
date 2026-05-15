import { z } from "zod";
import type { ChatMessage, ModelResponse, ToolCall, ToolDef, ToolStreamEvent } from "../llm/provider.js";
import { DEFAULT_RETRY_POLICY, withRetry } from "./retry.js";
import type { AgentMiddleware, RoundContext } from "./middleware.js";
import type { AgentEvent, AgentTool, HitlDecision, HitlRequest, LoopOptions } from "./types.js";
import { estimateCost } from "../llm/pricing.js";

type ToolByName = Map<string, AgentTool>;

function normalizeToolCallArgs(toolCall: ToolCall): Record<string, unknown> {
  const raw = toolCall.function.arguments.trim();
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    throw new Error("Tool arguments must be a JSON object.");
  } catch (error) {
    throw new Error(
      `Invalid JSON arguments for ${toolCall.function.name}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

function toHitlRequests(toolCalls: ToolCall[]): HitlRequest[] {
  return toolCalls.map((toolCall) => ({
    id: toolCall.id,
    name: toolCall.function.name,
    args: safeArgs(toolCall),
  }));
}

function safeArgs(toolCall: ToolCall): Record<string, unknown> {
  try {
    return normalizeToolCallArgs(toolCall);
  } catch {
    return { _raw: toolCall.function.arguments };
  }
}

function toolDefsFromTools(tools: AgentTool[]): ToolDef[] {
  return tools
    .filter((tool): tool is AgentTool & { name: string } => typeof tool.name === "string" && tool.name.length > 0)
    .map((tool) => ({
      type: "function",
      function: {
        name: tool.name!,
        description: tool.description,
        parameters: zodToJsonSchema(tool.schema),
      },
    }));
}

function zodToJsonSchema(schema: unknown): Record<string, unknown> {
  if (schema instanceof z.ZodType) {
    return normalizeZodSchema(schema);
  }
  if (schema && typeof schema === "object" && !Array.isArray(schema)) {
    const maybeSchema = schema as Record<string, unknown>;
    if (
      typeof maybeSchema.type === "string" ||
      (maybeSchema.properties !== null && typeof maybeSchema.properties === "object" && !Array.isArray(maybeSchema.properties)) ||
      Array.isArray(maybeSchema.required)
    ) {
      return maybeSchema;
    }
  }
  return { type: "object", properties: {}, additionalProperties: true };
}

function normalizeZodSchema(schema: z.ZodTypeAny): Record<string, unknown> {
  if (schema instanceof z.ZodOptional || schema instanceof z.ZodDefault) {
    return normalizeZodSchema(schema._def.innerType);
  }
  if (schema instanceof z.ZodString) {
    return { type: "string" };
  }
  if (schema instanceof z.ZodNumber) {
    return { type: "number" };
  }
  if (schema instanceof z.ZodBoolean) {
    return { type: "boolean" };
  }
  if (schema instanceof z.ZodEnum) {
    return { type: "string", enum: [...schema.options] };
  }
  if (schema instanceof z.ZodArray) {
    return { type: "array", items: normalizeZodSchema(schema.element) };
  }
  if (schema instanceof z.ZodObject) {
    const shape = schema.shape;
    const properties: Record<string, unknown> = {};
    const required: string[] = [];
    for (const [key, value] of Object.entries(shape)) {
      const field = value as z.ZodTypeAny;
      properties[key] = normalizeZodSchema(field);
      if (!(field instanceof z.ZodOptional) && !(field instanceof z.ZodDefault)) {
        required.push(key);
      }
    }
    return {
      type: "object",
      properties,
      ...(required.length > 0 ? { required } : {}),
      additionalProperties: false,
    };
  }
  return { type: "object", properties: {}, additionalProperties: true };
}

function mergeAssistantMessage(
  history: ChatMessage[],
  response: ModelResponse,
): void {
  history.push({
    role: "assistant",
    content: response.content,
    ...(response.reasoning_content ? { reasoning_content: response.reasoning_content } : {}),
    ...(response.tool_calls ? { tool_calls: response.tool_calls } : {}),
  });
}

async function executeToolCall(
  toolCall: ToolCall,
  toolsByName: ToolByName,
): Promise<{ result: string; attempts: number }> {
  const tool = toolsByName.get(toolCall.function.name);
  if (!tool) {
    throw new Error(`Unknown tool: ${toolCall.function.name}`);
  }

  const args = normalizeToolCallArgs(toolCall);
  const { value, attempts } = await withRetry(
    async () => tool.invoke(args),
    DEFAULT_RETRY_POLICY,
  );

  return {
    result: typeof value === "string" ? value : JSON.stringify(value, null, 2),
    attempts,
  };
}

function applyHitlDecision(
  decision: HitlDecision,
  history: ChatMessage[],
): "continue" | "stop" {
  if (decision.type === "reject") {
    history.push({
      role: "user",
      content: decision.message?.trim() || "Tool execution denied by user.",
    });
    return "stop";
  }
  return "continue";
}

async function runMiddleware<K extends keyof AgentMiddleware>(
  middleware: AgentMiddleware[],
  hook: K,
  ...args: Parameters<NonNullable<AgentMiddleware[K]>>
): Promise<void> {
  for (const mw of middleware) {
    const fn = mw[hook] as ((...a: Parameters<NonNullable<AgentMiddleware[K]>>) => Promise<unknown>) | undefined;
    if (fn) await fn.apply(mw, args);
  }
}

export async function* runAgentLoop(options: LoopOptions): AsyncGenerator<AgentEvent> {
  const {
    provider,
    model,
    tools,
    messages,
    systemPrompt,
    threadId,
    hitlGate,
    btwQueue,
    policy,
    checkpointer,
    maxRounds = 500,
    resumedDecision,
    middleware = [],
    abortSignal,
  } = options;

  const saved = await checkpointer.load(threadId);
  // Only restore when a HITL-paused run exists for this thread. A completed turn
  // also writes a checkpoint, but the caller's messages array already contains the
  // new user turn and must not be overridden.
  const restoreFromCheckpoint = saved?.waitingForHitl != null;
  const history = restoreFromCheckpoint ? saved!.messages : messages;

  let round = restoreFromCheckpoint ? saved!.round : 0;
  let totalTools = 0;
  let pendingDecision = resumedDecision;
  const loopStartMs = Date.now();
  let totalInputTokens = 0;
  let totalOutputTokens = 0;

  while (round < maxRounds) {
    if (abortSignal?.aborted) {
      yield { type: "aborted", message: "Interrupted by user." };
      return;
    }
    for (const text of btwQueue.drain()) {
      history.push({ role: "user", content: `[/btw] ${text}` });
      yield { type: "btw", text };
    }

    // Middleware: beforeRound
    const roundCtx: RoundContext = { round, threadId, model, history, toolCallsThisRound: 0 };
    await runMiddleware(middleware, "beforeRound", roundCtx);

    // Rebuild tools + system prompt each round (enables per-turn skill routing)
    const allTools = [...tools, ...middleware.flatMap((mw) => mw.extraTools?.() ?? [])];
    const toolsByName: ToolByName = new Map(
      allTools
        .filter((tool): tool is AgentTool & { name: string } => typeof tool.name === "string" && tool.name.length > 0)
        .map((tool) => [tool.name!, tool]),
    );

    // Pass tool registry to middlewares that need it for pattern execution
    for (const mw of middleware) {
      mw.setTools?.(toolsByName);
    }

    const toolDefs = toolDefsFromTools(allTools);

    const extraPrompts = middleware.flatMap((mw) => {
      const extra = mw.extraSystemPrompt?.();
      return extra ? [extra] : [];
    });
    const effectiveSystemPrompt = extraPrompts.length > 0
      ? `${systemPrompt}\n\n${extraPrompts.join("\n\n")}`
      : systemPrompt;

    // Middleware: maybeCompact — first matching middleware wins
    for (const mw of middleware) {
      if (!mw.maybeCompact) continue;
      const compactResult = await mw.maybeCompact(history, { model, systemPrompt: effectiveSystemPrompt });
      if (compactResult) {
        history.splice(0, history.length, ...compactResult.replacement);
        yield { type: "compacted", removedMessages: compactResult.removedMessages, savedTokens: compactResult.savedTokens };
        break;
      }
    }

    const stream = provider.streamWithTools({
      model,
      messages: history,
      systemPrompt: effectiveSystemPrompt,
      tools: toolDefs,
    });
    let response: ModelResponse | null = null;

    for await (const event of stream) {
      if (event.type === "token") {
        yield { type: "token", text: event.text };
        continue;
      }
      if (event.type === "thinking") {
        yield { type: "thinking", text: event.text };
        continue;
      }
      if (event.type === "done") {
        response = event.response;
        if (response.usage) {
          totalInputTokens += response.usage.inputTokens;
          totalOutputTokens += response.usage.outputTokens;
        }
        break;
      }
    }

    if (!response) {
      response = { content: "" };
    }

    mergeAssistantMessage(history, response);

    if (!response.tool_calls || response.tool_calls.length === 0) {
      await checkpointer.save(threadId, { messages: history, round });
      yield { type: "checkpoint", round, threadId };
      yield {
        type: "done",
        response: response.content,
        reasoning: response.reasoning_content ?? "",
        toolCount: totalTools,
        history,
        inputTokens: totalInputTokens,
        outputTokens: totalOutputTokens,
        costUsd: estimateCost(model, totalInputTokens, totalOutputTokens),
        durationMs: Date.now() - loopStartMs,
      };
      return;
    }

    totalTools += response.tool_calls.length;
    const requests = toHitlRequests(response.tool_calls);
    let decision = pendingDecision;
    pendingDecision = undefined;

    if (!decision && hitlGate.shouldPause(response.tool_calls, policy)) {
      const resumeKey = `hitl-${threadId}-${round}`;
      await checkpointer.save(threadId, {
        messages: history,
        round,
        waitingForHitl: {
          resumeKey,
          requests,
          toolCalls: response.tool_calls,
          assistant: response,
        },
      });
      yield { type: "checkpoint", round, threadId };
      yield { type: "hitl", requests, resumeKey };
      decision = await hitlGate.wait(resumeKey);
    }

    if (decision && applyHitlDecision(decision, history) === "stop") {
      await checkpointer.save(threadId, { messages: history, round });
      yield { type: "checkpoint", round, threadId };
      yield {
        type: "done",
        response: response.content,
        reasoning: response.reasoning_content ?? "",
        toolCount: totalTools,
        history,
        inputTokens: totalInputTokens,
        outputTokens: totalOutputTokens,
        costUsd: estimateCost(model, totalInputTokens, totalOutputTokens),
        durationMs: Date.now() - loopStartMs,
      };
      return;
    }

    let toolCallsThisRound = 0;
    for (const toolCall of response.tool_calls) {
      const name = toolCall.function.name;
      let args: Record<string, unknown>;
      try {
        args = normalizeToolCallArgs(toolCall);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        yield { type: "tool-error", id: toolCall.id, name, error: message, willRetry: false };
        history.push({
          role: "tool",
          tool_call_id: toolCall.id,
          content: `Error: ${message}`,
        });
        continue;
      }

      toolCallsThisRound += 1;
      yield { type: "tool-start", id: toolCall.id, name, args };
      const startedAt = Date.now();

      try {
        const { result: rawResult, attempts } = await executeToolCall(toolCall, toolsByName);
        const durationMs = Date.now() - startedAt;

        // Middleware: afterTool — each mw may transform the result string
        let result = rawResult;
        for (const mw of middleware) {
          if (!mw.afterTool) continue;
          const transformed = await mw.afterTool({ id: toolCall.id, name, result, durationMs });
          if (transformed !== undefined) result = transformed;
        }

        history.push({
          role: "tool",
          tool_call_id: toolCall.id,
          content: result,
        });
        yield {
          type: "tool-done",
          id: toolCall.id,
          name,
          result: attempts > 1 ? `${result}\n\n[retried ${attempts - 1} time(s)]` : result,
          durationMs,
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        history.push({
          role: "tool",
          tool_call_id: toolCall.id,
          content: `Error: ${message}`,
        });
        yield {
          type: "tool-error",
          id: toolCall.id,
          name,
          error: message,
          willRetry: false,
        };
      }
    }

    round += 1;
    // Middleware: afterRound
    const afterCtx: RoundContext = { round, threadId, model, history, toolCallsThisRound };
    await runMiddleware(middleware, "afterRound", afterCtx);

    await checkpointer.save(threadId, { messages: history, round });
    yield { type: "checkpoint", round, threadId };
  }

  yield {
    type: "error",
    message: `Agent loop exceeded max rounds (${maxRounds}).`,
    fatal: true,
  };
}
