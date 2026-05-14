import {
  createHarnessRunRecord,
  type ApprovalPolicy,
  type ExecutionMode,
  prepareTaskExecution,
  recordTaskCompleted,
  recordTaskStarted,
  saveHarnessRun,
  verifyTaskCompletion,
} from "../../../harness/index.js";
import { allTools } from "../../../tools/index.js";
import { filesystemTools } from "../../../tools/filesystem.js";
import { createDelegateTool } from "../../../subagents/delegateTool.js";
import { executeWorkers, formatWorkerResults } from "../../../harness/workerEngine.js";
import { SYSTEM_PROMPT } from "../../../prompts/system.js";
import { countMessagesTokens } from "../../../context/tokenizer.js";
import { createProvider, getDefaultProvider, getProviderModel, type ChatMessage, type LLMProvider } from "../../../llm/index.js";
import { getModeModelConfig } from "../../../settings/storage.js";
import { sessionManager } from "../../../session/manager.js";
import { BtwQueue } from "../../../agent/btw.js";
import { JsonFileCheckpointer } from "../../../agent/checkpointer.js";
import { HitlGate } from "../../../agent/hitl.js";
import { runAgentLoop } from "../../../agent/loop.js";
import { createDefaultMiddleware } from "../../../agent/middleware.js";
import type { AgentTool, HitlDecision } from "../../../agent/types.js";
import { processAgentStream } from "../../agent/streamProcessor.js";
import type { HitlInterrupt } from "../../agent/streamProcessor.js";
import { rememberCompletedTask } from "../../../harness/projectMemory.js";
import { filterToolsForPolicy } from "./toolPolicy.js";
import type { Dispatch } from "react";
import type { FeedAction } from "../../state/feedReducer.js";
import type { ActiveAgentRun, Message } from "./types.js";

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

function createRuntimeTools({
  provider,
  modelName,
  dispatch,
  parentTurnId,
  mode = "build",
  approvalPolicy = "auto_edit",
}: Pick<AgentRunOptions, "provider" | "modelName" | "dispatch" | "parentTurnId" | "mode" | "approvalPolicy">): AgentTool[] {
  const delegateTool = createDelegateTool({ provider, modelName, dispatch, parentTurnId });
  const buildTools = [...filesystemTools, ...allTools, ...(approvalPolicy === "full_auto" ? [delegateTool] : [])];
  return filterToolsForPolicy(buildTools, mode, approvalPolicy) as AgentTool[];
}

export async function prepareHarness(
  text: string,
  messages: Message[],
  providerName?: string,
  modelName?: string,
  systemPromptOverride?: string,
  mode: ExecutionMode = "build"
): Promise<{
  prepared: ReturnType<typeof prepareTaskExecution>;
  harnessRun: ReturnType<typeof createHarnessRunRecord>;
  provider: LLMProvider;
  modelName: string;
}> {
  const prepared = prepareTaskExecution({
    text,
    expandedText: text,
    basePrompt: systemPromptOverride ?? SYSTEM_PROMPT,
    messages,
    mode,
  });

  // Check mode-specific provider/model config first
  const modeConfig = getModeModelConfig(mode);
  const effectiveProviderName = modeConfig?.provider ?? providerName;
  const effectiveModelName = modeConfig?.model ?? modelName;

  const provider = effectiveProviderName
    ? createProvider(effectiveProviderName)
    : await getDefaultProvider();
  const resolvedModel = effectiveModelName ?? getProviderModel(provider.name);

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

  return { prepared, harnessRun, provider, modelName: resolvedModel };
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

  const tools = createRuntimeTools(options);
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
    middleware: createDefaultMiddleware(threadId),
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
      id: `verify-${Date.now()}`,
      text: `Verifier flagged: ${completion.verification.findings.join(" ")}`,
    });
  }

  sessionManager.onMessageAdded(messages);

  const finalCount = countMessagesTokens(messages, SYSTEM_PROMPT);
  onTokensUpdate(finalCount);

  dispatch({ type: "FINALIZE_TURN", completedAt: Date.now() });

  return messages;
}

export async function executeWorkerPhase(
  prepared: ReturnType<typeof prepareTaskExecution>,
  taskText: string,
  provider: ReturnType<typeof createProvider>,
  model: string,
  dispatch: Dispatch<FeedAction>,
  parentTurnId: string
): Promise<string> {
  if (prepared.workerAssignments.length === 0) return "";

  const workerResults = await executeWorkers({
    assignments: prepared.workerAssignments,
    taskText,
    provider,
    model,
    dispatch,
    parentTurnId,
  });

  return formatWorkerResults(workerResults);
}
