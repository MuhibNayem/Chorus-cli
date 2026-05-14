import { createDeepAgent } from "deepagents";
import { Command, MemorySaver } from "@langchain/langgraph";
import { AIMessage, HumanMessage, SystemMessage } from "@langchain/core/messages";
import type { BaseMessage } from "@langchain/core/messages";
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
import { createDelegateTool } from "../../../subagents/delegateTool.js";
import { executeWorkers, formatWorkerResults } from "../../../harness/workerEngine.js";
import { SYSTEM_PROMPT } from "../../../prompts/system.js";
import { countMessagesTokens } from "../../../context/tokenizer.js";
import { createProvider, getDefaultProvider, getProviderModel } from "../../../llm/index.js";
import { getModeModelConfig } from "../../../settings/storage.js";
import { sessionManager } from "../../../session/manager.js";
import { processAgentStream } from "../../agent/streamProcessor.js";
import type { HitlInterrupt } from "../../agent/streamProcessor.js";
import { rememberCompletedTask } from "../../../harness/projectMemory.js";
import { filterToolsForPolicy } from "./toolPolicy.js";
import type { Dispatch } from "react";
import type { FeedAction } from "../../state/feedReducer.js";
import type { Message, AgentLike } from "./types.js";

type HitlDecision =
  | { type: "approve" }
  | { type: "reject"; message?: string };
type DeepAgentOptions = NonNullable<Parameters<typeof createDeepAgent>[0]>;

const hitlCheckpointer = new MemorySaver();
const HITL_TOOL_DESCRIPTIONS: Record<string, string> = {
  file_write: "Review this file write before it changes the workspace.",
  file_edit: "Review this targeted file edit before it changes the workspace.",
  run_command: "Review this shell command before it runs.",
  git_commit: "Review this git commit before it records changes.",
  delegate_to_subagent: "Review this delegation before another agent starts work.",
};

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

/**
 * Convert internal Messages to LangChain BaseMessage instances.
 * Preserves reasoning_content in additional_kwargs so that LangGraph
 * checkpoints maintain it across tool-call rounds (required by DeepSeek).
 */
function toAgentMessages(msgs: Message[]): BaseMessage[] {
  return msgs.map((m) => {
    if (m.role === "assistant") {
      const msg = new AIMessage({ content: m.content });
      if (m.reasoning_content) {
        msg.additional_kwargs.reasoning_content = m.reasoning_content;
      }
      return msg;
    }
    if (m.role === "user") return new HumanMessage(m.content);
    if (m.role === "system") return new SystemMessage(m.content);
    return new HumanMessage(m.content);
  });
}

export interface HarnessResult {
  prepared: ReturnType<typeof prepareTaskExecution>;
  harnessRun: ReturnType<typeof createHarnessRunRecord>;
}

export interface AgentRunOptions {
  messages: Message[];
  model: Awaited<ReturnType<ReturnType<typeof createProvider>["createChatModel"]>>;
  runtimePrompt: string;
  dispatch: Dispatch<FeedAction>;
  parentTurnId: string;
  mode?: ExecutionMode;
  approvalPolicy?: ApprovalPolicy;
  sessionApprovedTools?: Set<string>;
}

export interface ResumeAgentRunOptions extends AgentRunOptions {
  decisions: HitlDecision[];
}

export interface PendingAgentRun {
  messages: Message[];
  prepared: ReturnType<typeof prepareTaskExecution>;
  harnessRun: ReturnType<typeof createHarnessRunRecord>;
  model: Awaited<ReturnType<ReturnType<typeof createProvider>["createChatModel"]>>;
  runtimePrompt: string;
  parentTurnId: string;
  mode: ExecutionMode;
  approvalPolicy: ApprovalPolicy;
  turnStartedAt: number;
}

function buildInterruptOn(
  tools: Array<{ name?: string }>,
  mode: ExecutionMode,
  approvalPolicy: ApprovalPolicy,
  sessionApprovedTools: Set<string> = new Set()
): DeepAgentOptions["interruptOn"] {
  if (mode !== "build") return undefined;
  if (approvalPolicy === "suggest") return undefined;

  const interruptOn: NonNullable<DeepAgentOptions["interruptOn"]> = {};
  for (const tool of tools) {
    const name = tool.name;
    if (!name || sessionApprovedTools.has(name)) continue;
    if (!(name in HITL_TOOL_DESCRIPTIONS)) continue;
    interruptOn[name] = {
      allowedDecisions: ["approve", "reject"],
      description: HITL_TOOL_DESCRIPTIONS[name],
    };
  }

  return Object.keys(interruptOn).length > 0 ? interruptOn : undefined;
}

function createConfiguredAgent({
  model,
  runtimePrompt,
  dispatch,
  parentTurnId,
  mode = "build",
  approvalPolicy = "auto_edit",
  sessionApprovedTools,
}: Omit<AgentRunOptions, "messages">): AgentLike {
  const delegateTool = createDelegateTool({ model, dispatch, parentTurnId });
  const buildTools = approvalPolicy === "full_auto" ? [...allTools, delegateTool] : allTools;
  const tools = filterToolsForPolicy(buildTools, mode, approvalPolicy);
  const interruptOn = buildInterruptOn(tools, mode, approvalPolicy, sessionApprovedTools);

  const agentOptions: DeepAgentOptions = {
    model,
    tools,
    systemPrompt: runtimePrompt,
  };
  if (interruptOn) {
    agentOptions.interruptOn = interruptOn;
    agentOptions.checkpointer = hitlCheckpointer;
  }
  if (process.env.DISABLE_TODO_MIDDLEWARE === "1") {
    agentOptions.middleware = [];
  }

  return createDeepAgent(agentOptions) as AgentLike;
}

function agentStreamConfig() {
  const limit = parseInt(process.env.LANGGRAPH_RECURSION_LIMIT ?? "", 10);
  return {
    streamMode: ["messages", "updates"] as const,
    configurable: { thread_id: sessionManager.getCurrent()?.id },
    recursionLimit: Number.isFinite(limit) && limit > 0 ? limit : 2000,
  };
}

export async function prepareHarness(
  text: string,
  messages: Message[],
  providerName?: string,
  modelName?: string,
  systemPromptOverride?: string,
  mode: ExecutionMode = "build"
): Promise<{ prepared: ReturnType<typeof prepareTaskExecution>; harnessRun: ReturnType<typeof createHarnessRunRecord>; model: Awaited<ReturnType<ReturnType<typeof createProvider>["createChatModel"]>>; provider: ReturnType<typeof createProvider> }> {
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

  const model = await provider.createChatModel(resolvedModel);
  return { prepared, harnessRun, model, provider };
}

export async function runAgentStream(
  messagesOrOptions: Message[] | AgentRunOptions,
  model?: Awaited<ReturnType<ReturnType<typeof createProvider>["createChatModel"]>>,
  runtimePrompt?: string,
  dispatch?: Dispatch<FeedAction>,
  parentTurnId?: string,
  mode: ExecutionMode = "build",
  approvalPolicy: ApprovalPolicy = "auto_edit"
) {
  const options: AgentRunOptions = Array.isArray(messagesOrOptions)
    ? {
        messages: messagesOrOptions,
        model: model!,
        runtimePrompt: runtimePrompt!,
        dispatch: dispatch!,
        parentTurnId: parentTurnId!,
        mode,
        approvalPolicy,
      }
    : messagesOrOptions;

  const agent = createConfiguredAgent(options);

  const agentInput = { messages: toAgentMessages(options.messages) };
  const agentConfig = agentStreamConfig();

  const stream = await agent.stream(agentInput, agentConfig);
  dbg("STREAM_OPENED", { msgCount: options.messages.length });

  return processAgentStream(stream, options.dispatch, dbg);
}

export async function resumeAgentStream(options: ResumeAgentRunOptions) {
  const agent = createConfiguredAgent(options);
  const resumeCommand = new Command({ resume: { decisions: options.decisions } });
  const stream = await agent.stream(resumeCommand, agentStreamConfig());
  dbg("STREAM_RESUMED", { decisions: options.decisions.map((decision) => decision.type) });

  return processAgentStream(stream, options.dispatch, dbg);
}

export function decisionsForInterrupt(
  interrupt: HitlInterrupt,
  decision: "approve" | "deny"
): HitlDecision[] {
  return interrupt.actionRequests.map(() =>
    decision === "approve"
      ? { type: "approve" }
      : { type: "reject", message: "Denied by user." }
  );
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
  const responseText = streamResult.responseText;
  if (responseText) {
    const msg: Message = { role: "assistant", content: responseText };
    if (streamResult.reasoningContent) {
      msg.reasoning_content = streamResult.reasoningContent;
    }
    messages.push(msg);
  }

  const completion = verifyTaskCompletion({
    task: prepared.task,
    responseText,
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
      summary: responseText || "(no response text)",
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
