/**
 * Trajectory-Based Skill Synthesizer
 *
 * Observes tool call sequences from agent history and automatically synthesizes
 * reusable patterns (Layer 2 skills) when similar successful trajectories repeat.
 *
 * Algorithm:
 *   1. Collect tool trajectories from each round
 *   2. Find similar trajectories using LCS alignment
 *   3. Abstract concrete values into parameters
 *   4. Generate a PatternDef
 *   5. Register with the SkillRegistry
 */

import type { ToolTrajectory, PatternDef, PatternParameter, SkillWorkflowStep } from "./types.js";
import type { SkillRegistry } from "./registry.js";
import type { ChatMessage } from "../llm/provider.js";

/** Minimum similarity ratio for trajectories to be considered alike. */
const DEFAULT_SIMILARITY_THRESHOLD = 0.6;
/** Minimum number of similar trajectories before synthesis. */
const DEFAULT_MIN_TRAJECTORIES = 3;
/** Maximum patterns to keep. */
const DEFAULT_MAX_PATTERNS = 100;

export interface SynthesizerOptions {
  similarityThreshold?: number;
  minTrajectories?: number;
  maxPatterns?: number;
}

export class TrajectorySynthesizer {
  private registry: SkillRegistry;
  private trajectories: ToolTrajectory[] = [];
  private similarityThreshold: number;
  private minTrajectories: number;
  private maxPatterns: number;

  constructor(registry: SkillRegistry, opts: SynthesizerOptions = {}) {
    this.registry = registry;
    this.similarityThreshold = opts.similarityThreshold ?? DEFAULT_SIMILARITY_THRESHOLD;
    this.minTrajectories = opts.minTrajectories ?? DEFAULT_MIN_TRAJECTORIES;
    this.maxPatterns = opts.maxPatterns ?? DEFAULT_MAX_PATTERNS;
  }

  /** Observe a trajectory after a round completes. */
  observe(trajectory: ToolTrajectory): void {
    this.trajectories.push(trajectory);

    // Only consider successful trajectories for synthesis
    if (!trajectory.success) return;

    // Find similar trajectories
    const similar = this.findSimilar(trajectory);
    if (similar.length >= this.minTrajectories - 1) {
      const all = [trajectory, ...similar];
      const pattern = this.synthesize(all);
      if (pattern) {
        this.registry.registerPattern(pattern);
        this.registry.savePattern(pattern);
      }
    }
  }

  /** Find trajectories similar to the given one. */
  private findSimilar(trajectory: ToolTrajectory): ToolTrajectory[] {
    const targetNames = trajectory.tools.map((t) => t.name);
    const similar: ToolTrajectory[] = [];

    for (const other of this.trajectories) {
      if (other.id === trajectory.id) continue;
      if (!other.success) continue;

      const otherNames = other.tools.map((t) => t.name);
      const lcs = longestCommonSubsequence(targetNames, otherNames);
      const similarity = lcs.length / Math.max(targetNames.length, otherNames.length);

      if (similarity >= this.similarityThreshold) {
        similar.push(other);
      }
    }

    return similar;
  }

  /** Synthesize a pattern from a group of similar trajectories. */
  private synthesize(trajectories: ToolTrajectory[]): PatternDef | null {
    if (trajectories.length < this.minTrajectories) return null;

    // 1. Align tool sequences using LCS
    const aligned = this.alignSequences(trajectories.map((t) => t.tools.map((x) => x.name)));
    if (aligned.length === 0) return null;

    // 2. Extract parameters from varying fields
    const parameters = this.extractParameters(trajectories, aligned);

    // 3. Build workflow from aligned sequence
    const workflow = this.buildWorkflow(trajectories, aligned, parameters);

    // 4. Estimate token cost
    const estimatedTokens = Math.round(
      trajectories.reduce((sum, t) => sum + t.tokens, 0) / trajectories.length,
    );

    // 5. Generate name and description
    const name = this.generateName(aligned);
    const description = this.generateDescription(aligned, trajectories[0].task);

    return {
      name,
      description,
      parameters,
      workflow,
      estimatedTokens,
      evidenceCount: trajectories.length,
      sourceTrajectories: trajectories.map((t) => t.id),
      synthesizedAt: Date.now(),
    };
  }

  /** Align multiple tool sequences using iterative LCS. */
  private alignSequences(sequences: string[][]): string[] {
    if (sequences.length === 0) return [];
    if (sequences.length === 1) return sequences[0];

    let aligned = sequences[0];
    for (let i = 1; i < sequences.length; i++) {
      aligned = longestCommonSubsequence(aligned, sequences[i]);
    }
    return aligned;
  }

  /** Extract parameters by finding fields that vary across trajectories. */
  private extractParameters(
    trajectories: ToolTrajectory[],
    aligned: string[],
  ): PatternParameter[] {
    const parameters: PatternParameter[] = [];

    // For each step in the aligned sequence, examine inputs
    for (let stepIdx = 0; stepIdx < aligned.length; stepIdx++) {
      const toolName = aligned[stepIdx];

      // Collect all inputs for this step across trajectories
      const stepInputs: Record<string, unknown[]> = {};
      for (const traj of trajectories) {
        const tool = traj.tools.find((t) => t.name === toolName);
        if (!tool) continue;

        for (const [key, value] of Object.entries(tool.input)) {
          if (!stepInputs[key]) stepInputs[key] = [];
          stepInputs[key].push(value);
        }
      }

      // Find fields that vary
      for (const [key, values] of Object.entries(stepInputs)) {
        const unique = new Set(values.map((v) => JSON.stringify(v)));
        if (unique.size > 1) {
          // This field varies → make it a parameter
          const paramName = `${toolName}_${key}`;
          if (!parameters.find((p) => p.name === paramName)) {
            const types = new Set(values.map((v) => typeof v));
            const paramType = types.has("number")
              ? "number"
              : types.has("boolean")
                ? "boolean"
                : "string";

            parameters.push({
              name: paramName,
              type: paramType as PatternParameter["type"],
              description: `Parameter for ${toolName}.${key}`,
            });
          }
        }
      }
    }

    return parameters;
  }

  /** Build workflow steps with parameter placeholders. */
  private buildWorkflow(
    trajectories: ToolTrajectory[],
    aligned: string[],
    parameters: PatternParameter[],
  ): SkillWorkflowStep[] {
    return aligned.map((toolName) => {
      // Find a representative input for this tool
      const representative = trajectories
        .map((t) => t.tools.find((x) => x.name === toolName))
        .find((t) => t !== undefined);

      const input: Record<string, unknown> = {};
      if (representative) {
        for (const [key, value] of Object.entries(representative.input)) {
          const paramName = `${toolName}_${key}`;
          if (parameters.find((p) => p.name === paramName)) {
            // This field varies → use placeholder
            input[key] = `{{${paramName}}}`;
          } else {
            // Constant value → keep it
            input[key] = value;
          }
        }
      }

      return { tool: toolName, input };
    });
  }

  /** Generate a kebab-case name from the aligned sequence. */
  private generateName(aligned: string[]): string {
    const verbs = aligned.map((name) => {
      // Strip common suffixes and take first meaningful part
      return name.replace(/_tool$|_cmd$/, "").split("_")[0];
    });

    const unique = [...new Set(verbs)];
    return `${unique.join("-")}-pattern`;
  }

  /** Generate a human-readable description. */
  private generateDescription(aligned: string[], task: string): string {
    const steps = aligned.join(" → ");
    return `Pattern: ${steps} (learned from "${task.slice(0, 50)}")`;
  }

  /** Extract a trajectory from conversation history. */
  static extractTrajectory(
    history: readonly ChatMessage[],
    opts: { success?: boolean; tokens?: number; duration?: number; task?: string } = {},
  ): ToolTrajectory {
    const tools: ToolTrajectory["tools"] = [];
    let task = opts.task ?? "";

    // Find the last user message for the task
    for (let i = history.length - 1; i >= 0; i--) {
      if (history[i].role === "user") {
        task = history[i].content.slice(0, 200);
        break;
      }
    }

    // Extract tool calls and results from history
    let currentTool: { name: string; input: Record<string, unknown>; output: string } | null = null;

    for (const msg of history) {
      if (msg.role === "assistant" && msg.tool_calls) {
        for (const tc of msg.tool_calls) {
          try {
            const input = JSON.parse(tc.function.arguments) as Record<string, unknown>;
            currentTool = { name: tc.function.name, input, output: "" };
          } catch {
            currentTool = { name: tc.function.name, input: {}, output: "" };
          }
        }
      }

      if (msg.role === "tool" && currentTool && msg.tool_call_id) {
        currentTool.output = msg.content;
        tools.push({ ...currentTool });
        currentTool = null;
      }
    }

    return {
      id: `traj-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      task,
      tools,
      success: opts.success ?? true,
      tokens: opts.tokens ?? 0,
      duration: opts.duration ?? 0,
      timestamp: Date.now(),
    };
  }
}

// ─── LCS Algorithm ────────────────────────────────────────────────────────────

/** Compute the Longest Common Subsequence of two arrays. */
export function longestCommonSubsequence<T>(a: T[], b: T[]): T[] {
  const m = a.length;
  const n = b.length;

  // DP table
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (a[i - 1] === b[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
      }
    }
  }

  // Backtrack to reconstruct LCS
  const result: T[] = [];
  let i = m;
  let j = n;

  while (i > 0 && j > 0) {
    if (a[i - 1] === b[j - 1]) {
      result.unshift(a[i - 1]);
      i--;
      j--;
    } else if (dp[i - 1][j] > dp[i][j - 1]) {
      i--;
    } else {
      j--;
    }
  }

  return result;
}
