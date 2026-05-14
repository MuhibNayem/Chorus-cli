import type { ApprovalPolicy } from "../harness/types.js";
import type { ChatMessage, LLMProvider, ModelResponse, ToolCall, ToolDef } from "../llm/provider.js";
import type { AgentMiddleware } from "./middleware.js";

export type AgentTool = {
  name?: string;
  description?: string;
  schema?: unknown;
  invoke(input: unknown): Promise<unknown>;
};

export type HitlDecision =
  | { type: "approve" }
  | { type: "approve_session"; toolNames?: string[] }
  | { type: "reject"; message?: string };

export type HitlRequest = {
  id: string;
  name: string;
  args: Record<string, unknown>;
  description?: string;
};

export type AgentEvent =
  | { type: "token"; text: string }
  | { type: "thinking"; text: string }
  | { type: "tool-start"; id: string; name: string; args: Record<string, unknown> }
  | { type: "tool-done"; id: string; name: string; result: string; durationMs: number }
  | { type: "tool-error"; id: string; name: string; error: string; willRetry: boolean }
  | { type: "hitl"; requests: HitlRequest[]; resumeKey: string }
  | { type: "btw"; text: string }
  | { type: "checkpoint"; round: number; threadId: string }
  | { type: "compacted"; removedMessages: number; savedTokens: number }
  | { type: "done"; response: string; reasoning: string; toolCount: number; history: ChatMessage[] }
  | { type: "error"; message: string; fatal: boolean };

export type CheckpointState = {
  messages: ChatMessage[];
  round: number;
  waitingForHitl?: {
    resumeKey: string;
    requests: HitlRequest[];
    toolCalls: ToolCall[];
    assistant: ModelResponse;
  };
};

export interface Checkpoint {
  threadId: string;
  round: number;
  messages: ChatMessage[];
  createdAt: number;
  waitingForHitl?: CheckpointState["waitingForHitl"];
}

export interface Checkpointer {
  save(threadId: string, state: CheckpointState): Promise<void>;
  load(threadId: string): Promise<Checkpoint | null>;
  loadAt(threadId: string, round: number): Promise<Checkpoint | null>;
  list(threadId: string): Promise<Checkpoint[]>;
  fork(threadId: string, round: number, newThreadId: string): Promise<void>;
  delete(threadId: string): Promise<void>;
}

export interface LoopOptions {
  provider: LLMProvider;
  model: string;
  tools: AgentTool[];
  messages: ChatMessage[];
  systemPrompt: string;
  threadId: string;
  hitlGate: {
    shouldPause(toolCalls: ToolCall[], policy: ApprovalPolicy): boolean;
    wait(resumeKey: string): Promise<HitlDecision>;
  };
  btwQueue: {
    drain(): string[];
  };
  policy: ApprovalPolicy;
  checkpointer: Checkpointer;
  maxRounds?: number;
  resumedDecision?: HitlDecision;
  middleware?: AgentMiddleware[];
}
