import {
  createHarnessRunRecord,
  type ApprovalPolicy,
  type ExecutionMode,
  prepareTaskExecution,
  recordTaskCompleted,
  recordTaskStarted,
  saveHarnessRun,
  verifyTaskCompletion,
  executeWorkers,
  formatWorkerResults,
  appendWorkerResultsToPrompt,
} from "../../../harness/index.js";
import { allTools } from "../../../tools/index.js";
import { filesystemTools } from "../../../tools/filesystem.js";
import { createDelegateTool } from "../../../subagents/delegateTool.js";
import { buildSystemPrompt } from "../../../prompts/system.js";
import { countMessagesTokens } from "../../../context/tokenizer.js";
import { createProvider, getDefaultProvider, getProviderModel, getContextWindow, type ChatMessage, type LLMProvider } from "../../../llm/index.js";
import { getModeModelConfig, getAdvisorSettings } from "../../../settings/storage.js";
import { sessionManager } from "../../../session/manager.js";
import { BtwQueue } from "../../../agent/btw.js";
import { JsonFileCheckpointer } from "../../../agent/checkpointer.js";
import { HitlGate } from "../../../agent/hitl.js";
import { runAgentLoop } from "../../../agent/loop.js";
import { createDefaultMiddleware } from "../../../agent/middleware.js";
import { getMcpTools, closeMcpConnections } from "../../../mcp/client.js";
import type { AgentTool, HitlDecision } from "../../../agent/types.js";
import { processAgentStream } from "../../agent/streamProcessor.js";
import type { HitlInterrupt } from "../../agent/streamProcessor.js";
import { rememberCompletedTask } from "../../../harness/projectMemory.js";
import { filterToolsForPolicy } from "./toolPolicy.js";
import type { Dispatch } from "react";
import type { FeedAction } from "../../state/feedReducer.js";
import type { ActiveAgentRun, Message } from "./types.js";
import type { WorkerEventCallback } from "../../../harness/workerEngine.js";
import type { SubagentEventCallback } from "../../../subagents/runtime.js";

const hitlGate = new HitlGate();
const checkpointer = new JsonFileCheckpointer();
const btwQueue = new BtwQueue();

function dbg(label: string, data?: unknown): void {
  if (process.env.DEBUG !== "1") return;
  const line = `[${new Date().toISOString()}] ${label}${
    data !== undefined ? " " + JSON.stringify(data, null, 0) : ""
  }\n`;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require("fs").appendFileSync("debug.log", line);
  } catch {
    /* never crash on debug */
  }
}

function buildWorkerEventAdapter(dispatch: Dispatch<FeedAction>): WorkerEventCallback {
  return (event) => {
    switch (event.type) {
      case "worker-add":
        dispatch({
          type: "ADD_WORKER",
          worker: { id: event.workerId, role: event.role, emoji: event.emoji, color: event.color, status: "running", summary: event.summary, sessionId: event.sessionId },
        });
        break;
      case "worker-thinking":
        dispatch({ type: "ADD_SESSION_EVENT", sessionId: event.sessionId, event: { kind: "thinking", id: event.id, text: event.text, expanded: event.expanded } });
        break;
      case "worker-response":
        dispatch({ type: "ADD_SESSION_EVENT", sessionId: event.sessionId, event: { kind: "response", text: event.text } });
        break;
      case "worker-main-turn-thinking":
        dispatch({ type: "ADD_THINKING_EVENT_TO_MAIN_TURN", sessionId: event.sessionId, event: { kind: "thinking", id: event.id, text: event.text, expanded: event.expanded } });
        break;
      case "worker-session-complete":
        dispatch({ type: "FINALIZE_SESSION", sessionId: event.sessionId, completedAt: event.completedAt });
        break;
      case "worker-update":
        dispatch({ type: "UPDATE_WORKER", id: event.workerId, status: event.status, result: event.result });
        break;
    }
  };
}

function buildSubagentEventAdapter(dispatch: Dispatch<FeedAction>): SubagentEventCallback {
  return (event) => {
    switch (event.type) {
      case "subagent-add":
        dispatch({ type: "ADD_SUBAGENT", subagent: { id: event.subagentId, name: event.name, task: event.task, status: "running", text: "", sessionId: event.sessionId } });
        break;
      case "subagent-thinking":
        dispatch({ type: "ADD_SESSION_EVENT", sessionId: event.sessionId, event: { kind: "thinking", id: event.id, text: event.text, expanded: event.expanded } });
        break;
      case "subagent-think-token":
        dispatch({ type: "APPEND_SESSION_THINK_TOKEN", sessionId: event.sessionId, text: event.text });
        break;
      case "subagent-token":
        dispatch({ type: "APPEND_SUBAGENT_TOKEN", id: event.subagentId, text: event.text });
        break;
      case "subagent-tool-start":
        dispatch({ type: "ADD_SESSION_EVENT", sessionId: event.sessionId, event: { kind: "tool", card: { id: event.id, name: event.name, args: event.args, status: "running", expanded: false } } });
        break;
      case "subagent-tool-done":
        dispatch({ type: "ADD_SESSION_EVENT", sessionId: event.sessionId, event: { kind: "tool", card: { id: event.id, name: event.name, args: {}, result: event.result, status: "done", expanded: false } } });
        break;
      case "subagent-tool-error":
        dispatch({ type: "ADD_SESSION_EVENT", sessionId: event.sessionId, event: { kind: "tool", card: { id: event.id, name: event.name, args: {}, result: event.error, status: "error", expanded: false } } });
        break;
      case "subagent-done":
        dispatch({ type: "UPDATE_SUBAGENT", id: event.subagentId, status: "done", result: event.result });
        break;
      case "subagent-finalize":
        dispatch({ type: "FINALIZE_SUBAGENT", id: event.subagentId, completedAt: event.completedAt });
        break;
      case "subagent-session-complete":
        dispatch({ type: "FINALIZE_SESSION", sessionId: event.sessionId, completedAt: event.completedAt });
        break;
      case "subagent-error":
        dispatch({ type: "ADD_SESSION_EVENT", sessionId: event.sessionId, event: { kind: "response", text: event.text } });
        dispatch({ type: "UPDATE_SUBAGENT", id: event.subagentId, status: "error", result: event.text });
        break;
    }
  };
}

export interface HarnessResult {
  prepared: ReturnType<typeof prepareTaskExecution>;
  harnessRun: ReturnType<typeof createHarnessRunRecord>;
}

export interface AgentRunOptions {
  messages: Message[];
  provider: LLMProvider;
  modelName: string;
  runtimePrompt: string;
  dispatch: Dispatch<FeedAction>;
  parentTurnId: string;
  mode?: ExecutionMode;
  approvalPolicy?: ApprovalPolicy;
  abortSignal?: AbortSignal;
}

export interface ResumeAgentRunOptions extends AgentRunOptions {
  activeRun: ActiveAgentRun;
}

export interface PendingAgentRun {
  messages: Message[];
  prepared: ReturnType<typeof prepareTaskExecution>;
  harnessRun: ReturnType<typeof createHarnessRunRecord>;
  provider: LLMProvider;
  modelName: string;
  runtimePrompt: string;
  parentTurnId: string;
  mode: ExecutionMode;
  approvalPolicy: ApprovalPolicy;
  turnStartedAt: number;
}

export interface AgentStreamResult {
  responseText: string;
  reasoningContent: string;
  toolCallsObserved: number;
  hadError: boolean;
  history: ChatMessage[];
  interrupt?: HitlInterrupt;
  activeRun?: ActiveAgentRun;
}

async function createRuntimeTools({
  provider,
  modelName,
  dispatch,
  parentTurnId,
  mode = "build",
  approvalPolicy = "auto_edit",
}: Pick<AgentRunOptions, "provider" | "modelName" | "dispatch" | "parentTurnId" | "mode" | "approvalPolicy">): Promise<AgentTool[]> {
  const delegateTool = createDelegateTool({ provider, modelName, onEvent: buildSubagentEventAdapter(dispatch), parentTurnId });
  const mcpTools = await getMcpTools();
  const buildTools = [...filesystemTools, ...allTools, ...mcpTools, delegateTool];
  return filterToolsForPolicy(buildTools, mode, approvalPolicy) as AgentTool[];
}

export async function prepareHarness(
  text: string,
  messages: Message[],
  providerName?: string,
  modelName?: string,
  systemPromptOverride?: string,
  mode: ExecutionMode = "build",
  dispatch?: Dispatch<FeedAction>,
): Promise<{
  prepared: ReturnType<typeof prepareTaskExecution>;
  harnessRun: ReturnType<typeof createHarnessRunRecord>;
  provider: LLMProvider;
  modelName: string;
}> {
  // Session overrides (from /provider or @agent) take priority over mode config.
  // Only fall back to mode config when the caller supplies no explicit provider/model.
  const modeConfig = (!providerName && !modelName) ? getModeModelConfig(mode) : null;
  const effectiveProviderName = providerName ?? modeConfig?.provider;
  const effectiveModelName = modelName ?? modeConfig?.model;

  const provider = effectiveProviderName
    ? createProvider(effectiveProviderName)
    : await getDefaultProvider();
  const resolvedModel = effectiveModelName ?? getProviderModel(provider.name);

  const prepared = prepareTaskExecution({
    text,
    expandedText: text,
    basePrompt: systemPromptOverride ?? buildSystemPrompt(provider.name, resolvedModel),
    messages,
    mode,
    isAgentInvocation: !!systemPromptOverride,
  });

  recordTaskStarted(prepared);
  const harnessRun = createHarnessRunRecord({
    task: prepared.task,
    route: prepared.route,
    protocol: prepared.protocol,
    repoIntelligence: prepared.repoIntelligence,
    projectMemory: prepared.projectMemory,
    contextBundle: prepared.contextBundle,
    workerAssignments: prepared.workerAssignments,
  });
  saveHarnessRun(harnessRun);
  dbg("TASK_PREPARED", {
    taskId: prepared.task.taskId,
    lane: prepared.task.lane,
    path: prepared.task.path,
    contextBundle: prepared.contextBundle.id,
    provider: provider.name,
    model: resolvedModel,
  });

  // Execute worker analysis (advisor, planner, etc.) as parallel pre-flight LLM calls
  let finalRuntimePrompt = prepared.runtimePrompt;
  if (prepared.workerAssignments.length > 0 && dispatch) {
    try {
      const advisorSettings = getAdvisorSettings();
      let advisorProvider = provider;
      let advisorModel = resolvedModel;
      if (advisorSettings?.provider) {
        advisorProvider = createProvider(advisorSettings.provider);
      }
      if (advisorSettings?.model) {
        advisorModel = advisorSettings.model;
      }

      const workerResults = await executeWorkers({
        assignments: prepared.workerAssignments,
        taskText: text,
        provider: advisorProvider,
        model: advisorModel,
        onEvent: buildWorkerEventAdapter(dispatch),
        parentTurnId: `turn-${Date.now()}`,
      });

      if (workerResults.length > 0) {
        finalRuntimePrompt = appendWorkerResultsToPrompt(
          prepared.runtimePrompt,
          workerResults.map((r) => ({
            workerId: r.workerId,
            status: "completed" as const,
            summary: r.summary,
            findings: r.findings,
            risks: [],
            nextActions: [],
            changedFiles: [],
            verification: { checksRun: [], checksPending: [] },
          })),
        );
        dbg("WORKERS_DONE", { count: workerResults.length });
      }
    } catch (error) {
      dbg("WORKERS_ERROR", { message: error instanceof Error ? error.message : String(error) });
    }
  }

  return {
    prepared: finalRuntimePrompt !== prepared.runtimePrompt
      ? { ...prepared, runtimePrompt: finalRuntimePrompt }
      : prepared,
    harnessRun,
    provider,
    modelName: resolvedModel,
  };
}

export async function runAgentStream(
  messagesOrOptions: Message[] | AgentRunOptions,
  provider?: LLMProvider,
  modelName?: string,
  runtimePrompt?: string,
  dispatch?: Dispatch<FeedAction>,
  parentTurnId?: string,
  mode: ExecutionMode = "build",
  approvalPolicy: ApprovalPolicy = "auto_edit"
): Promise<AgentStreamResult> {
  const options: AgentRunOptions = Array.isArray(messagesOrOptions)
    ? {
        messages: messagesOrOptions,
        provider: provider!,
        modelName: modelName!,
        runtimePrompt: runtimePrompt!,
        dispatch: dispatch!,
        parentTurnId: parentTurnId!,
        mode,
        approvalPolicy,
      }
    : messagesOrOptions;

  const tools = await createRuntimeTools(options);
  const threadId = sessionManager.getCurrent()?.id ?? crypto.randomUUID();
  const stream = runAgentLoop({
    provider: options.provider,
    model: options.modelName,
    tools,
    messages: options.messages as ChatMessage[],
    systemPrompt: options.runtimePrompt,
    threadId,
    hitlGate,
    btwQueue,
    policy: options.approvalPolicy ?? "auto_edit",
    checkpointer,
    middleware: createDefaultMiddleware(threadId, { contextWindow: getContextWindow(options.modelName) }),
    abortSignal: options.abortSignal,
  });
  const iterator = stream[Symbol.asyncIterator]();
  dbg("STREAM_OPENED", { msgCount: options.messages.length, toolCount: tools.length });

  const streamResult = await processAgentStream(iterator, options.dispatch, dbg);
  return {
    ...streamResult,
    activeRun: streamResult.interrupt ? { iterator, resumeKey: streamResult.interrupt.resumeKey } : undefined,
  };
}

export async function resumeAgentStream(options: ResumeAgentRunOptions) {
  dbg("STREAM_RESUMED", { resumeKey: options.activeRun.resumeKey });
  const streamResult = await processAgentStream(
    options.activeRun.iterator as AsyncIterator<import("../../../agent/types.js").AgentEvent>,
    options.dispatch,
    dbg,
  );
  return { ...streamResult, activeRun: undefined };
}

export function decisionsForInterrupt(
  interrupt: HitlInterrupt,
  decision: "approve" | "deny"
): HitlDecision {
  return decision === "approve"
    ? { type: "approve" }
    : { type: "reject", message: "Denied by user." };
}

export function resolveHitlDecision(
  resumeKey: string,
  decision: HitlDecision,
): void {
  hitlGate.resolve(resumeKey, decision);
}

export function enqueueBtw(text: string): boolean {
  btwQueue.enqueue(text);
  return true;
}

export function resetAgentRuntime(): void {
  btwQueue.clear();
  hitlGate.resetSessionApprovals();
  void closeMcpConnections();
}

export function finalizeTurn(
  messages: Message[],
  prepared: ReturnType<typeof prepareTaskExecution>,
  harnessRun: ReturnType<typeof createHarnessRunRecord>,
  streamResult: Awaited<ReturnType<typeof processAgentStream>>,
  turnStartedAt: number,
  dispatch: Dispatch<FeedAction>,
  onTokensUpdate: (tokens: number) => void
): Message[] {
  if (streamResult.history.length > 0) {
    messages.splice(0, messages.length, ...(streamResult.history as Message[]));
  } else if (streamResult.responseText && messages[messages.length - 1]?.content !== streamResult.responseText) {
    messages.push({
      role: "assistant",
      content: streamResult.responseText,
      ...(streamResult.reasoningContent ? { reasoning_content: streamResult.reasoningContent } : {}),
    });
  }

  const completion = verifyTaskCompletion({
    task: prepared.task,
    responseText: streamResult.responseText,
    toolCallsObserved: streamResult.toolCallsObserved,
    hadError: streamResult.hadError,
    durationMs: Date.now() - turnStartedAt,
    modelCalls: 1,
  });
  harnessRun.completed = completion;
  harnessRun.task = completion.task;
  saveHarnessRun(harnessRun);
  recordTaskCompleted(completion);
  if (completion.verification.ok) {
    harnessRun.projectMemory = rememberCompletedTask({
      taskId: completion.task.taskId,
      kind: prepared.route.kind,
      summary: streamResult.responseText || "(no response text)",
    });
    saveHarnessRun(harnessRun);
  }
  dbg("TASK_VERIFIED", {
    taskId: completion.task.taskId,
    ok: completion.verification.ok,
    findings: completion.verification.findings,
    durationMs: completion.durationMs,
  });
  if (!completion.verification.ok) {
    dispatch({
      type: "APPEND_SYSTEM",
      id: `verify-${prepared.task.taskId}`,
      text: `Verifier flagged: ${completion.verification.findings.join("\n")}`,
    });
  }

  sessionManager.onMessageAdded(messages);

  const finalCount = countMessagesTokens(messages, buildSystemPrompt());
  onTokensUpdate(finalCount);

  dispatch({ type: "FINALIZE_TURN", completedAt: Date.now() });

  return messages;
}

