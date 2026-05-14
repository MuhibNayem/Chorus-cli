/**
 * Adaptive Skill Runtime (ASR) — Type Definitions
 *
 * Four-layer skill stack:
 *   L0: Primitives (Tools)     — already exists in src/tools/
 *   L1: Skills (Human-Authored) — SKILL.md + scripts
 *   L2: Patterns (Synthesized)  — learned from tool trajectories
 *   L3: Metaskills              — skills that manage other skills
 */

import type { AgentTool } from "../agent/types.js";
import type { ChatMessage } from "../llm/provider.js";

// ═══════════════════════════════════════════════════════════════════════════════
// LAYER 1: Skill (Human-Authored)
// ═══════════════════════════════════════════════════════════════════════════════

/** A single tool step inside a skill workflow. */
export interface SkillWorkflowStep {
  /** Name of the tool to invoke. */
  tool: string;
  /** Input parameters (can use {{parameter}} templating). */
  input: Record<string, unknown>;
  /** Optional condition for executing this step. */
  when?: string;
}

/** Swarm declaration within a skill. */
export interface SkillSwarmConfig {
  enabled: boolean;
  preset?: string;
  agents?: Array<{
    role: string;
    description: string;
    model?: string;
  }>;
  handoff?: {
    strategy: "sequential" | "parallel";
    merge: "concatenate_results" | "vote" | "first_success";
  };
}

/** Anthropic Agent Skills compatible SKILL.md definition. */
export interface SkillDef {
  /** Unique skill name (kebab-case). */
  name: string;
  /** Short description for semantic search. */
  description: string;
  /** Longer markdown instructions (the body of SKILL.md). */
  instructions: string;
  /** Version tag. */
  version?: string;
  /** Author or source. */
  author?: string;
  /** Tags for categorization. */
  tags?: string[];
  /** Context-gating condition (cheap, deterministic). */
  when?: string;
  /** Optional workflow definition (declarative skill). */
  workflow?: SkillWorkflowStep[];
  /** Optional swarm configuration. */
  swarm?: SkillSwarmConfig;
  /** Max tokens this skill may consume per invocation. */
  costBudget?: number;
  /** File path where this skill was loaded from. */
  sourcePath?: string;
  /** Whether this skill was auto-synthesized. */
  synthesized?: boolean;
  /** IDs of source trajectories (for synthesized skills). */
  sourceTrajectories?: string[];
  /** Timestamp when the skill was created/last modified. */
  updatedAt?: number;
}

// ═══════════════════════════════════════════════════════════════════════════════
// LAYER 2: Pattern (Auto-Synthesized)
// ═══════════════════════════════════════════════════════════════════════════════

/** A parameter definition for a synthesized pattern. */
export interface PatternParameter {
  name: string;
  type: "string" | "number" | "boolean" | "array";
  description: string;
  default?: unknown;
}

/** A synthesized pattern learned from repeated tool trajectories. */
export interface PatternDef {
  name: string;
  description: string;
  parameters: PatternParameter[];
  /** The aligned tool sequence (abstracted). */
  workflow: SkillWorkflowStep[];
  /** Estimated token cost per invocation. */
  estimatedTokens: number;
  /** How many trajectories contributed to this pattern. */
  evidenceCount: number;
  /** Trajectory IDs that produced this pattern. */
  sourceTrajectories: string[];
  /** When this pattern was synthesized. */
  synthesizedAt: number;
}

// ═══════════════════════════════════════════════════════════════════════════════
// LAYER 3: Metaskills & Runtime Types
// ═══════════════════════════════════════════════════════════════════════════════

/** Result of semantic skill search. */
export interface SkillMatch {
  skill: SkillDef | PatternDef;
  /** Cosine similarity score (0–1). */
  score: number;
  /** Whether this is a pattern or static skill. */
  kind: "skill" | "pattern";
}

/** Selection result from the per-turn router. */
export interface SkillSelection {
  /** Skills selected for this turn. */
  skills: SkillDef[];
  /** Patterns selected for this turn. */
  patterns: PatternDef[];
  /** Formatted schema strings to inject into system prompt. */
  schemas: string[];
  /** Total tokens consumed by injected schemas. */
  tokensUsed: number;
}

/** Token budget for skill loading. */
export interface TokenBudget {
  /** Total context window size. */
  total: number;
  /** Tokens already consumed by history + system prompt. */
  reserved: number;
  /** Tokens available for skills. */
  available: number;
}

/** Performance metrics for a skill or pattern. */
export interface SkillMetrics {
  name: string;
  invocations: number;
  successes: number;
  failures: number;
  /** Average tokens consumed per invocation. */
  avgTokens: number;
  /** Average latency in ms. */
  avgLatency: number;
  /** Number of times user overrode/rejected output. */
  userOverrides: number;
  lastUsed: number;
  status: "active" | "trusted" | "watch" | "deprecated" | "annealing";
  /** Error patterns observed (for annealing trigger). */
  errorPatterns: Array<{ pattern: string; count: number }>;
}

/** A recorded tool trajectory for pattern learning. */
export interface ToolTrajectory {
  id: string;
  /** The user query that triggered this trajectory. */
  task: string;
  /** Sequence of tool calls with inputs and outputs. */
  tools: Array<{
    name: string;
    input: Record<string, unknown>;
    output: string;
  }>;
  /** Did the agent complete the task successfully? */
  success: boolean;
  /** Total tokens consumed. */
  tokens: number;
  /** Wall-clock duration in ms. */
  duration: number;
  /** Which skill/pattern was used (if any). */
  skillUsed?: string;
  /** Timestamp. */
  timestamp: number;
}

/** Options for the skill harness. */
export interface SkillHarnessOptions {
  /** Directories to scan for SKILL.md files. */
  skillDirs: string[];
  /** Minimum similarity threshold for semantic routing (0–1). */
  similarityThreshold?: number;
  /** Maximum skills to inject per turn. */
  maxSkillsPerTurn?: number;
  /** Maximum patterns to inject per turn. */
  maxPatternsPerTurn?: number;
  /** Minimum trajectories before synthesizing a pattern. */
  minTrajectoriesForSynthesis?: number;
  /** Enable/disable auto-synthesis. */
  enableSynthesis?: boolean;
  /** Enable/disable evaluation curation. */
  enableCuration?: boolean;
  /** Max synthesized patterns to keep. */
  maxPatterns?: number;
}

/** Pluggable embedder interface. */
export interface SkillEmbedder {
  /** Stable model/cache identifier for persisted vector indexes. */
  readonly modelId?: string;
  /** Embedding vector width when known. */
  readonly dimensions?: number;
  /** Embed a text string into a dense vector. */
  embed(text: string): Promise<number[]>;
}

/** Cached embedding entry. */
export interface EmbeddingCacheEntry {
  text: string;
  vector: number[];
  timestamp: number;
}

/** Serializable skill index entry for persistence. */
export interface SkillIndexEntry {
  name: string;
  description: string;
  vector: number[];
  kind: "skill" | "pattern";
  tags: string[];
}

/** Serialized form of the skill index. */
export interface SerializedSkillIndex {
  version: number;
  modelId?: string;
  dimensions?: number;
  entries: SkillIndexEntry[];
  generatedAt: number;
}

/** Serialized skill metrics store. */
export interface SerializedSkillMetrics {
  version: number;
  metrics: Record<string, SkillMetrics>;
  updatedAt: number;
}

/** Result of skill execution. */
export interface SkillExecutionResult {
  success: boolean;
  output: string;
  tokensUsed: number;
  durationMs: number;
  /** If swarm was used, includes sub-agent results. */
  swarmResults?: Array<{ agent: string; output: string }>;
}

/** Health report for all skills. */
export interface SkillHealthReport {
  generatedAt: number;
  totalSkills: number;
  totalPatterns: number;
  active: SkillMetrics[];
  trusted: SkillMetrics[];
  watch: SkillMetrics[];
  deprecated: SkillMetrics[];
  annealing: SkillMetrics[];
}
