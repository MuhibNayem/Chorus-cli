import type { AgentEvent } from "../agent/types.js";
import type { AgentTool } from "../agent/types.js";
import type { ChatMessage } from "../llm/provider.js";
import type { Checkpointer } from "../agent/types.js";
import type { LLMProvider } from "../llm/provider.js";
import type { ApprovalPolicy } from "../harness/types.js";

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
  /** Per-agent permission mode. Overrides SwarmConfig.policy for this agent. */
  permissionMode?: ApprovalPolicy;
  /** Graph execution: agents this agent depends on. All deps must complete before this agent runs. */
  dependsOn?: string[];
  /** Outcome contract: artifact keys this agent must produce. Missing keys trip the circuit breaker. */
  requiredArtifacts?: string[];
  /**
   * Isolation mode:
   * - "none": agent runs in the shared workspace (default)
   * - "worktree": agent runs in an isolated git worktree; filesystem tools are scoped to it
   */
  isolation?: "none" | "worktree";
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
  | { type: "swarm-done"; swarmId: string; handoffCount: number; totalAgentRounds: number; totalInputTokens: number; totalOutputTokens: number; totalCostUsd: number; durationMs: number }
  | { type: "agent-start"; agent: string; traceId: string; contextMode: ContextMode }
  | { type: "agent-done"; agent: string; responseText: string; metrics: AgentMetrics }
  | { type: "handoff"; from: string; to: string; taskDescription: string; reasoning?: string }
  | { type: "artifact-set"; key: string; agentSource: string }
  | { type: "validation-fail"; agent: string; reason: string }
  | { type: "circuit-break"; reason: string; agent: string }
  | { type: "wave-start"; wave: number; agents: string[] }
  | { type: "wave-done"; wave: number; agents: string[]; artifacts: string[] }
  | { type: "artifact-missing"; agent: string; key: string }
  | { type: "worktree-created"; agent: string; path: string; branch: string }
  | { type: "worktree-removed"; agent: string; path: string }
  | { type: "worktree-error"; agent: string; reason: string }
  | { type: "swarm-resumed"; swarmId: string; fromWave: number; artifacts: string[] }
  | { type: "wave-checkpoint"; wave: number; artifacts: string[] }
  | { type: "budget-exceeded"; agent: string; scope: "total" | "per-agent"; limitUsd: number; spentUsd: number }
  | TaggedAgentEvent;

export interface CostBudget {
  /** Hard cap on total swarm spend in USD. Exceeded → circuit-break the swarm. */
  totalUsd?: number;
  /** Per-agent hard caps in USD. Exceeded → circuit-break that agent only. */
  perAgentUsd?: Record<string, number>;
}

export interface CostRoutingPolicy {
  /**
   * When estimated remaining budget drops below this fraction of total,
   * swap to the cheap model automatically.
   */
  budgetPressureThreshold?: number;
  /**
   * Model to use for low-complexity tasks (e.g. "openai/gpt-4o-mini").
   * Applied when budget pressure threshold is exceeded or task is flagged cheap.
   */
  cheapModel?: string;
  /**
   * Max output tokens a task must stay under to be considered "simple".
   * Agents whose maxRounds ≤ 1 or whose first response is short are eligible.
   */
  simpleTaskMaxTokens?: number;
}

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
  policy?: ApprovalPolicy;
  /**
   * Execution model:
   * - "handoff": sequential handoff-based execution (default, original behavior)
   * - "graph": DAG-based parallel wave execution using agent.dependsOn declarations
   */
  executionModel?: "handoff" | "graph";
  /**
   * If set, attempt to resume a graph swarm from an existing checkpoint.
   * The value must be the swarmId returned in a prior `swarm-start` event.
   * Completed waves and their artifacts are restored; only remaining waves run.
   */
  resumeSwarmId?: string;
  /** Hard cost caps. Exceeding a cap trips the circuit breaker. */
  costBudget?: CostBudget;
  /** Declarative cost routing — auto-downgrade model tier under budget pressure. */
  costRouting?: CostRoutingPolicy;
}

export interface AgentMetrics {
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  durationMs: number;
  rounds: number;
  toolCalls: number;
}

export interface CircuitBreakerResult {
  tripped: boolean;
  reason?: string;
}
