import { useCallback, useRef, useEffect, useState } from "react";
import type { Dispatch } from "react";
import { countMessagesTokens } from "../../context/tokenizer.js";
import {
  getProviderModel,
  getPreferredProviderName,
  normalizeProviderName,
} from "../../llm/index.js";
import { SYSTEM_PROMPT } from "../../prompts/system.js";
import { loadAgents } from "../../agents/loader.js";
import type { FeedAction } from "../state/feedReducer.js";
import {
  enqueueBtw,
  finalizeTurn,
  prepareHarness,
  resolveHitlDecision,
  resetAgentRuntime,
  resumeAgentStream,
  runAgentStream,
  type PendingAgentRun,
} from "./agent/agentRunner.js";
import type { ActiveAgentRun, Message } from "./agent/types.js";
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
  const activeRunRef = useRef<ActiveAgentRun | null>(null);
  const submittingRef = useRef(false);
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


  const submit = useCallback(
    async (text: string, abortSignal?: AbortSignal) => {
      if (submittingRef.current) return;
      submittingRef.current = true;
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

      try {
        const parsedAgentModel = parseAgentModelOverride(agentModelOverride);
        const resolvedProviderName = parsedAgentModel.providerName ?? providerNameRef.current ?? undefined;
        const resolvedModelName = parsedAgentModel.modelName ?? modelNameRef.current ?? undefined;
        const activeMode = executionModeRef.current;
        const activeApprovalPolicy = approvalPolicyRef.current;
        const { prepared, harnessRun, provider, modelName: resolvedModel } = await prepareHarness(
          activeText,
          messagesRef.current,
          resolvedProviderName,
          resolvedModelName,
          agentSystemPrompt,
          activeMode
        );

        const pendingRun: PendingAgentRun = {
          messages: messagesRef.current,
          prepared,
          harnessRun,
          provider,
          modelName: resolvedModel,
          runtimePrompt: prepared.runtimePrompt,
          parentTurnId: turnId,
          mode: activeMode,
          approvalPolicy: activeApprovalPolicy,
          turnStartedAt,
        };
        const streamResult = await runAgentStream({
          messages: messagesRef.current,
          provider,
          modelName: resolvedModel,
          runtimePrompt: prepared.runtimePrompt,
          dispatch,
          parentTurnId: turnId,
          mode: activeMode,
          approvalPolicy: activeApprovalPolicy,
          abortSignal,
        });
        if (streamResult.interrupt) {
          activeRunRef.current = streamResult.activeRun ?? null;
          pendingRunRef.current = pendingRun;
          setPendingApproval({ interrupt: streamResult.interrupt });
          return;
        }
        activeRunRef.current = null;
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
        const stack = err instanceof Error ? err.stack : undefined;
        dbg("ERROR", {
          message: errMsg,
          stack: err instanceof Error ? err.stack : undefined,
        });
        dispatch({
          type: "SET_ERROR",
          id: `error-${Date.now()}`,
          message: `${errMsg}${stack ? `\n\n${stack}` : ""}`,
        });
      } finally {
        submittingRef.current = false;
      }
    },
    [dispatch, onTokensUpdate]
  );

  const respondToApproval = useCallback(
    async (decision: "approve" | "approve_session" | "deny") => {
      const pendingRun = pendingRunRef.current;
      const pending = pendingApproval;
      const activeRun = activeRunRef.current;
      if (!pendingRun || !pending || !activeRun || !pending.interrupt.resumeKey) return;

      pendingRunRef.current = null;
      activeRunRef.current = null;
      setPendingApproval(null);

      try {
        const toolNames = pending.interrupt.actionRequests.map((action) => action.name);
        resolveHitlDecision(
          pending.interrupt.resumeKey,
          decision === "deny"
            ? { type: "reject", message: "Denied by user." }
            : decision === "approve_session"
            ? { type: "approve_session", toolNames }
            : { type: "approve" },
        );
        const streamResult = await resumeAgentStream({
          messages: pendingRun.messages,
          provider: pendingRun.provider,
          modelName: pendingRun.modelName,
          runtimePrompt: pendingRun.runtimePrompt,
          dispatch,
          parentTurnId: pendingRun.parentTurnId,
          mode: pendingRun.mode,
          approvalPolicy: pendingRun.approvalPolicy,
          activeRun,
        });

        if (streamResult.interrupt) {
          activeRunRef.current = streamResult.activeRun ?? null;
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
        const stack = err instanceof Error ? err.stack : undefined;
        dbg("APPROVAL_RESUME_ERROR", {
          message: errMsg,
          stack: err instanceof Error ? err.stack : undefined,
        });
        dispatch({
          type: "SET_ERROR",
          id: `error-${Date.now()}`,
          message: `${errMsg}${stack ? `\n\n${stack}` : ""}`,
        });
      }
    },
    [dispatch, onTokensUpdate, pendingApproval]
  );

  const submitBtw = useCallback((text: string) => {
    if (!pendingRunRef.current && !activeRunRef.current) {
      return false;
    }
    enqueueBtw(text);
    return true;
  }, []);

  const clearHistory = useCallback(() => {
    messagesRef.current = [];
    pendingRunRef.current = null;
    activeRunRef.current = null;
    resetAgentRuntime();
    setPendingApproval(null);
  }, []);

  const loadSession = useCallback((msgs: Message[]) => {
    messagesRef.current = msgs;
  }, []);

  const getMessages = useCallback((): Message[] => {
    return messagesRef.current;
  }, []);

  return { submit, submitBtw, clearHistory, loadSession, getMessages, pendingApproval, respondToApproval };
}
