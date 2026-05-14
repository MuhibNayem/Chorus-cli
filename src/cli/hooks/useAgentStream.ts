import { useCallback, useRef, useEffect, useState } from "react";
import type { Dispatch } from "react";
import { shouldCompact, compactMessages } from "../../context/compaction.js";
import { countMessagesTokens } from "../../context/tokenizer.js";
import {
  getContextWindow,
  getProviderModel,
  getPreferredProviderName,
  normalizeProviderName,
} from "../../llm/index.js";
import { SYSTEM_PROMPT } from "../../prompts/system.js";
import { loadAgents } from "../../agents/loader.js";
import type { FeedAction } from "../state/feedReducer.js";
import {
  decisionsForInterrupt,
  executeWorkerPhase,
  finalizeTurn,
  prepareHarness,
  resumeAgentStream,
  runAgentStream,
  type PendingAgentRun,
} from "./agent/agentRunner.js";
import type { Message } from "./agent/types.js";
import type { HitlInterrupt } from "../agent/streamProcessor.js";
import type { ApprovalPolicy, ExecutionMode } from "../../harness/types.js";

interface ModelOverride {
  providerName?: string;
  modelName?: string;
}

function parseAgentModelOverride(value?: string): ModelOverride {
  if (!value) return {};
  const separator = value.indexOf(":");
  if (separator <= 0) return { modelName: value };

  const providerName = value.slice(0, separator);
  const modelName = value.slice(separator + 1);
  return normalizeProviderName(providerName)
    ? { providerName, modelName }
    : { modelName: value };
}

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

interface UseAgentStreamOptions {
  dispatch: Dispatch<FeedAction>;
  onTokensUpdate: (tokens: number) => void;
  initialMessages?: Message[];
  providerName?: string;
  modelName?: string;
  executionMode?: ExecutionMode;
  approvalPolicy?: ApprovalPolicy;
}

export interface PendingApproval {
  interrupt: HitlInterrupt;
}

export function useAgentStream({
  dispatch,
  onTokensUpdate,
  initialMessages,
  providerName,
  modelName,
  executionMode = "build",
  approvalPolicy = "auto_edit",
}: UseAgentStreamOptions) {
  const messagesRef = useRef<Message[]>(initialMessages ?? []);
  const providerNameRef = useRef(providerName);
  const modelNameRef = useRef(modelName);
  const executionModeRef = useRef<ExecutionMode>(executionMode);
  const approvalPolicyRef = useRef<ApprovalPolicy>(approvalPolicy);
  const pendingRunRef = useRef<PendingAgentRun | null>(null);
  const sessionApprovedToolsRef = useRef<Set<string>>(new Set());
  const [pendingApproval, setPendingApproval] = useState<PendingApproval | null>(null);

  useEffect(() => {
    providerNameRef.current = providerName;
  }, [providerName]);
  useEffect(() => {
    modelNameRef.current = modelName;
  }, [modelName]);
  useEffect(() => {
    executionModeRef.current = executionMode;
  }, [executionMode]);
  useEffect(() => {
    approvalPolicyRef.current = approvalPolicy;
  }, [approvalPolicy]);

  const getContextLimit = useCallback(() => {
    const p = providerNameRef.current;
    const m = modelNameRef.current;
    if (m) return getContextWindow(m, p ?? undefined);
    if (p) {
      const provider = normalizeProviderName(p);
      if (provider) return getContextWindow(getProviderModel(provider), provider);
    }
    const preferred = getPreferredProviderName();
    return getContextWindow(getProviderModel(preferred), preferred);
  }, []);

  const submit = useCallback(
    async (text: string) => {
      dbg("SUBMIT", { text: text.slice(0, 80) });
      const turnStartedAt = Date.now();
      const turnId = `turn-${Date.now()}`;

      // Detect @agent-name prefix: "@name rest of message"
      let agentSystemPrompt: string | undefined;
      let agentModelOverride: string | undefined;
      let activeText = text;
      const agentPrefixMatch = text.match(/^@([\w-]+)\s*([\s\S]*)$/);
      if (agentPrefixMatch) {
        const agentName = agentPrefixMatch[1];
        const agents = loadAgents();
        const agentDef = agents.find((a) => a.name === agentName);
        if (agentDef) {
          agentSystemPrompt = agentDef.systemPrompt;
          agentModelOverride = agentDef.model;
          activeText = agentPrefixMatch[2].trim() || text; // fall back to full text if no body
          dispatch({
            type: "APPEND_SYSTEM",
            id: `agent-${Date.now()}`,
            text: `Using agent: ${agentDef.name}${agentDef.model ? `  [${agentDef.model}]` : ""}`,
          });
        }
      }

      dispatch({
        type: "APPEND_USER",
        id: `user-${Date.now()}`,
        text,
        startedAt: turnStartedAt,
      });
      messagesRef.current.push({ role: "user", content: activeText });

      const effectiveSystemPrompt = agentSystemPrompt ?? SYSTEM_PROMPT;
      const tokenCount = countMessagesTokens(messagesRef.current, effectiveSystemPrompt);
      onTokensUpdate(tokenCount);

      const contextLimit = getContextLimit();
      if (await shouldCompact(messagesRef.current, effectiveSystemPrompt, contextLimit)) {
        dispatch({
          type: "APPEND_SYSTEM",
          id: `compact-${Date.now()}`,
          text: "Compacting conversation context…",
        });
        const result = await compactMessages(
          messagesRef.current,
          effectiveSystemPrompt,
          contextLimit
        );
        messagesRef.current = [
          {
            role: "system",
            content: `[Previous conversation summary: ${result.summary}]`,
          },
          ...messagesRef.current.slice(-20),
        ];
        onTokensUpdate(result.compressedCount);
      }

      try {
        const parsedAgentModel = parseAgentModelOverride(agentModelOverride);
        const resolvedProviderName = parsedAgentModel.providerName ?? providerNameRef.current ?? undefined;
        const resolvedModelName = parsedAgentModel.modelName ?? modelNameRef.current ?? undefined;
        const activeMode = executionModeRef.current;
        const activeApprovalPolicy = approvalPolicyRef.current;
        const { prepared, harnessRun, model, provider } = await prepareHarness(
          activeText,
          messagesRef.current,
          resolvedProviderName,
          resolvedModelName,
          agentSystemPrompt,
          activeMode
        );

        // Execute worker phase (parallel pre-processing)
        const resolvedModel = resolvedModelName ?? getProviderModel(provider.name);
        const workerContext = activeMode === "plan"
          ? ""
          : await executeWorkerPhase(
              prepared,
              activeText,
              provider,
              resolvedModel,
              dispatch,
              turnId
            );

        // Inject worker results into runtime prompt
        const enrichedPrompt = workerContext
          ? `${prepared.runtimePrompt}\n\n${workerContext}`
          : prepared.runtimePrompt;

        const pendingRun: PendingAgentRun = {
          messages: messagesRef.current,
          prepared,
          harnessRun,
          model,
          runtimePrompt: enrichedPrompt,
          parentTurnId: turnId,
          mode: activeMode,
          approvalPolicy: activeApprovalPolicy,
          turnStartedAt,
        };
        const streamResult = await runAgentStream({
          messages: messagesRef.current,
          model,
          runtimePrompt: enrichedPrompt,
          dispatch,
          parentTurnId: turnId,
          mode: activeMode,
          approvalPolicy: activeApprovalPolicy,
          sessionApprovedTools: sessionApprovedToolsRef.current,
        });
        if (streamResult.interrupt) {
          pendingRunRef.current = pendingRun;
          setPendingApproval({ interrupt: streamResult.interrupt });
          return;
        }
        messagesRef.current = finalizeTurn(
          messagesRef.current,
          prepared,
          harnessRun,
          streamResult,
          turnStartedAt,
          dispatch,
          onTokensUpdate
        );
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        dbg("ERROR", {
          message: errMsg,
          stack: err instanceof Error ? err.stack : undefined,
        });
        dispatch({
          type: "SET_ERROR",
          id: `error-${Date.now()}`,
          message: errMsg,
        });
      }
    },
    [dispatch, onTokensUpdate, getContextLimit]
  );

  const respondToApproval = useCallback(
    async (decision: "approve" | "approve_session" | "deny") => {
      const pendingRun = pendingRunRef.current;
      const pending = pendingApproval;
      if (!pendingRun || !pending) return;

      if (decision === "approve_session") {
        for (const action of pending.interrupt.actionRequests) {
          sessionApprovedToolsRef.current.add(action.name);
        }
      }

      pendingRunRef.current = null;
      setPendingApproval(null);

      try {
        const streamResult = await resumeAgentStream({
          messages: pendingRun.messages,
          model: pendingRun.model,
          runtimePrompt: pendingRun.runtimePrompt,
          dispatch,
          parentTurnId: pendingRun.parentTurnId,
          mode: pendingRun.mode,
          approvalPolicy: pendingRun.approvalPolicy,
          sessionApprovedTools: sessionApprovedToolsRef.current,
          decisions: decisionsForInterrupt(
            pending.interrupt,
            decision === "deny" ? "deny" : "approve"
          ),
        });

        if (streamResult.interrupt) {
          pendingRunRef.current = pendingRun;
          setPendingApproval({ interrupt: streamResult.interrupt });
          return;
        }

        messagesRef.current = finalizeTurn(
          messagesRef.current,
          pendingRun.prepared,
          pendingRun.harnessRun,
          streamResult,
          pendingRun.turnStartedAt,
          dispatch,
          onTokensUpdate
        );
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        dbg("APPROVAL_RESUME_ERROR", {
          message: errMsg,
          stack: err instanceof Error ? err.stack : undefined,
        });
        dispatch({
          type: "SET_ERROR",
          id: `error-${Date.now()}`,
          message: errMsg,
        });
      }
    },
    [dispatch, onTokensUpdate, pendingApproval]
  );

  const clearHistory = useCallback(() => {
    messagesRef.current = [];
    pendingRunRef.current = null;
    sessionApprovedToolsRef.current.clear();
    setPendingApproval(null);
  }, []);

  const loadSession = useCallback((msgs: Message[]) => {
    messagesRef.current = msgs;
  }, []);

  return { submit, clearHistory, loadSession, pendingApproval, respondToApproval };
}
