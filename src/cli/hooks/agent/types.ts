export interface Message {
  role: string;
  content: string;
  reasoning_content?: string;
}

/** Minimal agent interface — shields useAgentStream from deepagents type complexity */
export interface AgentLike {
  stream(state: unknown, config: unknown): Promise<AsyncIterable<unknown>>;
}
