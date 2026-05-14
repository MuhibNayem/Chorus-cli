import type { ChatMessage, ToolCall } from "../../../llm/provider.js";

export interface Message extends Omit<ChatMessage, "role"> {
  role: string;
  tool_calls?: ToolCall[];
}

export interface ActiveAgentRun {
  iterator: AsyncIterator<unknown>;
  resumeKey?: string;
}

/** Minimal agent interface used by the still-DeepAgents subagent path. */
export interface AgentLike {
  stream(state: unknown, config: unknown): Promise<AsyncIterable<unknown>>;
}
