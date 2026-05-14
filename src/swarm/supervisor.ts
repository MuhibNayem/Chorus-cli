import type { AgentTool } from "../agent/types.js";
import type { LLMProvider } from "../llm/provider.js";
import type { Checkpointer } from "../agent/types.js";
import type { ApprovalPolicy } from "../harness/types.js";
import type { ContextMode, SwarmAgent, SwarmConfig } from "./types.js";

export interface SpecialistDef {
  name: string;
  description: string;
  systemPrompt: string;
  tools?: AgentTool[];
  model?: string;
  contextMode?: ContextMode;
  maxRounds?: number;
  outputValidator?: (output: string) => { ok: boolean; reason?: string };
  /** Per-agent permission mode. Overrides the swarm-level policy for this specialist. */
  permissionMode?: ApprovalPolicy;
  /** Isolation mode. "worktree" gives this specialist an isolated git worktree. */
  isolation?: "none" | "worktree";
}

export interface SupervisorConfig {
  /** System prompt for the central coordinator. */
  coordinatorPrompt: string;
  /** Name shown in events and traces. */
  coordinatorName?: string;
  /** Specialist agents the coordinator can route to. */
  specialists: SpecialistDef[];
  task: string;
  /** Invariant intent injected into every agent. */
  spec?: string;
  provider: LLMProvider;
  modelName: string;
  coordinatorModel?: string;
  maxHandoffs?: number;
  maxRoundsPerAgent?: number;
  checkpointer?: Checkpointer;
}

/**
 * Builds a SwarmConfig that implements the Supervisor pattern:
 *
 *   Coordinator ──routes──► Specialist A
 *                ◄──reports──
 *   Coordinator ──routes──► Specialist B
 *                ◄──reports──
 *   Coordinator ──(no handoff = done)
 *
 * The coordinator uses "shared" context so it sees everything. Specialists
 * use "filtered" context so they receive only their task description and any
 * artifacts produced by previous agents — keeping their context lean.
 */
export function buildSupervisorSwarm(config: SupervisorConfig): SwarmConfig {
  const {
    coordinatorPrompt,
    coordinatorName = "coordinator",
    specialists,
    task,
    spec,
    provider,
    modelName,
    coordinatorModel,
    maxHandoffs,
    maxRoundsPerAgent = 30,
    checkpointer,
  } = config;

  const specialistNames = specialists.map((s) => s.name);

  const coordinatorAgent: SwarmAgent = {
    name: coordinatorName,
    description: "Central coordinator — routes tasks to specialists and synthesizes final output.",
    systemPrompt: coordinatorPrompt,
    tools: [] as AgentTool[],
    handoffDestinations: specialistNames,
    contextMode: "shared",
    maxRounds: maxRoundsPerAgent,
    model: coordinatorModel,
  };

  const specialistAgents: SwarmAgent[] = specialists.map((s) => ({
    name: s.name,
    description: s.description,
    systemPrompt: buildSpecialistPrompt(s.systemPrompt, coordinatorName),
    tools: s.tools ?? ([] as AgentTool[]),
    handoffDestinations: [coordinatorName],
    contextMode: s.contextMode ?? "filtered",
    maxRounds: s.maxRounds ?? maxRoundsPerAgent,
    model: s.model,
    outputValidator: s.outputValidator,
    permissionMode: s.permissionMode,
    isolation: s.isolation,
  }));

  return {
    agents: [coordinatorAgent, ...specialistAgents],
    initialAgent: coordinatorName,
    task,
    spec,
    provider,
    modelName,
    maxHandoffs: maxHandoffs ?? (specialists.length + 1) * 3,
    checkpointer,
    policy: "full_auto",
  };
}

function buildSpecialistPrompt(basePrompt: string, coordinatorName: string): string {
  return `${basePrompt}

When your work is complete, hand off back to the ${coordinatorName} by calling the handoff_to_${coordinatorName} tool. Include a concise summary of what you produced and store any significant outputs as artifacts using set_artifact before handing off.`;
}
