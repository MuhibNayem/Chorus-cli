import type { AgentEvent } from "../agent/types.js";
import type { AgentTool } from "../agent/types.js";
import type { ChatMessage } from "../llm/provider.js";
import type { Checkpointer } from "../agent/types.js";
import type { LLMProvider } from "../llm/provider.js";

export type ContextMode = "shared" | "isolated" | "filtered";
export type SwarmRole = "coordinator" | "specialist" | "verifier";

export interface SwarmAgent {
  name: string;
  description: string;
  systemPrompt: string;
  tools: AgentTool[];
  handoffDestinations: string[];
  contextMode: ContextMode;
  maxRounds: number;
  model?: string;
  outputValidator?: (output: string) => { ok: boolean; reason?: string };
}

export interface TokenBudget {
  perAgent: Record<string, number>;
  total: number;
}

export interface SwarmSession {
  sessionId: string;
  swarmId: string;
  /** Full cross-agent message history — used for "shared" context mode. */
  sharedMessages: ChatMessage[];
  /** Per-agent message history — used for "isolated" context mode. */
  agentMessages: Record<string, ChatMessage[]>;
  /** Last task description handed to each agent. */
  lastHandoffDescription: Record<string, string>;
  activeAgent: string | null;
  artifacts: Record<string, string>;
  agentHistory: string[];
  spec: string;
  handoffCount: number;
  maxHandoffs: number;
  tokenBudget: TokenBudget;
  traceId: string;
}

export interface HandoffRequest {
  targetAgent: string;
  taskDescription: string;
  artifacts: string[];
  reasoning?: string;
}

export type TaggedAgentEvent = AgentEvent & { agent: string };

export type SwarmEvent =
  | { type: "swarm-start"; swarmId: string; agents: string[] }
  | { type: "swarm-done"; swarmId: string; handoffCount: number; totalAgentRounds: number }
  | { type: "agent-start"; agent: string; traceId: string; contextMode: ContextMode }
  | { type: "agent-done"; agent: string; responseText: string }
  | { type: "handoff"; from: string; to: string; taskDescription: string; reasoning?: string }
  | { type: "artifact-set"; key: string; agentSource: string }
  | { type: "validation-fail"; agent: string; reason: string }
  | { type: "circuit-break"; reason: string; agent: string }
  | TaggedAgentEvent;

export interface SwarmConfig {
  agents: SwarmAgent[];
  initialAgent: string;
  task: string;
  /** Invariant intent anchor — injected into every agent's context. */
  spec?: string;
  provider: LLMProvider;
  modelName: string;
  maxHandoffs?: number;
  checkpointer?: Checkpointer;
  policy?: "full_auto" | "auto_edit";
}

export interface CircuitBreakerResult {
  tripped: boolean;
  reason?: string;
}
