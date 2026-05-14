/**
 * Skill Executor — Executes skill workflows and swarm-orchestrated skills.
 *
 * Two execution modes:
 *   1. Single-mode: Run workflow steps sequentially, substituting parameters.
 *   2. Swarm-mode: Spawn a swarm with skill-declared agents, merge results.
 */

import type { SkillDef, PatternDef, SkillExecutionResult, SkillWorkflowStep } from "./types.js";
import type { AgentTool } from "../agent/types.js";

/** Substitute {{parameter}} placeholders in workflow inputs. */
function substituteParams(
  input: Record<string, unknown>,
  params: Record<string, unknown>,
): Record<string, unknown> {
  const result: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(input)) {
    if (typeof value === "string" && value.startsWith("{{") && value.endsWith("}}")) {
      const paramName = value.slice(2, -2);
      result[key] = params[paramName] ?? value;
    } else {
      result[key] = value;
    }
  }

  return result;
}

/** Execute a single workflow step against the tool registry. */
async function executeStep(
  step: SkillWorkflowStep,
  toolsByName: Map<string, AgentTool>,
  stepResults: Record<string, unknown>,
): Promise<unknown> {
  const tool = toolsByName.get(step.tool);
  if (!tool) {
    throw new Error(`Unknown tool in workflow: ${step.tool}`);
  }

  // Substitute step results from previous steps
  const input = substituteStepResults(step.input, stepResults);

  return tool.invoke(input);
}

/** Substitute {{step.field}} references to previous step outputs. */
function substituteStepResults(
  input: Record<string, unknown>,
  stepResults: Record<string, unknown>,
): Record<string, unknown> {
  const result: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(input)) {
    if (typeof value === "string" && value.startsWith("{{") && value.endsWith("}}")) {
      const path = value.slice(2, -2);
      result[key] = resolvePath(stepResults, path);
    } else {
      result[key] = value;
    }
  }

  return result;
}

/** Resolve a dotted path like "result.matches.0.path" from an object. */
function resolvePath(obj: Record<string, unknown>, path: string): unknown {
  const parts = path.split(".");
  let current: unknown = obj;

  for (const part of parts) {
    if (current === null || current === undefined) return undefined;

    if (Array.isArray(current)) {
      const idx = parseInt(part, 10);
      current = current[idx];
    } else if (typeof current === "object") {
      current = (current as Record<string, unknown>)[part];
    } else {
      return undefined;
    }
  }

  return current;
}

/** Execute a pattern workflow sequentially. */
export async function executePatternWorkflow(
  pattern: PatternDef,
  params: Record<string, unknown>,
  toolsByName: Map<string, AgentTool>,
): Promise<SkillExecutionResult> {
  const start = Date.now();
  const stepResults: Record<string, unknown> = {};
  const outputs: string[] = [];
  let tokensUsed = 0;

  try {
    for (const step of pattern.workflow) {
      // Substitute user-provided params
      const stepInput = substituteParams(step.input, params);

      // Execute
      const result = await executeStep({ ...step, input: stepInput }, toolsByName, stepResults);
      const resultStr = typeof result === "string" ? result : JSON.stringify(result);

      // Store result for downstream steps
      stepResults[step.tool] = result;
      outputs.push(`[${step.tool}]: ${resultStr.slice(0, 500)}`);

      // Rough token estimation
      tokensUsed += resultStr.length / 4;
    }

    return {
      success: true,
      output: outputs.join("\n\n"),
      tokensUsed: Math.round(tokensUsed),
      durationMs: Date.now() - start,
    };
  } catch (error) {
    return {
      success: false,
      output: `Workflow failed at step: ${error instanceof Error ? error.message : String(error)}`,
      tokensUsed: Math.round(tokensUsed),
      durationMs: Date.now() - start,
    };
  }
}

/** Execute a skill with swarm orchestration. */
export async function executeSkillWithSwarm(
  skill: SkillDef,
  params: Record<string, unknown>,
  // TODO: In Phase D, integrate with src/swarm/orchestrator.ts
  // For now, returns a placeholder indicating swarm execution is needed
): Promise<SkillExecutionResult> {
  const start = Date.now();

  if (!skill.swarm?.enabled) {
    return {
      success: false,
      output: "Skill does not have swarm enabled",
      tokensUsed: 0,
      durationMs: Date.now() - start,
    };
  }

  // Placeholder: Actual swarm integration requires importing the swarm orchestrator,
  // which would create a circular dependency. The integration point is designed but
  // deferred to avoid coupling issues. When integrated, this function will:
  //   1. Build a SwarmConfig from skill.swarm declaration
  //   2. Call runSwarm() with the config
  //   3. Merge swarm results into a single output

  return {
    success: true,
    output: `Swarm execution for "${skill.name}" would spawn ${skill.swarm.agents?.length ?? 0} agents.`,
    tokensUsed: 0,
    durationMs: Date.now() - start,
    swarmResults: skill.swarm.agents?.map((a) => ({
      agent: a.role,
      output: `[Placeholder] Agent ${a.role} result`,
    })),
  };
}

/** Main skill execution dispatcher. */
export async function executeSkill(
  skill: SkillDef | PatternDef,
  params: Record<string, unknown>,
  toolsByName: Map<string, AgentTool>,
): Promise<SkillExecutionResult> {
  // Check if it's a skill with swarm mode
  if ("swarm" in skill && skill.swarm?.enabled) {
    return executeSkillWithSwarm(skill as SkillDef, params);
  }

  // Check if it's a pattern with a workflow
  if ("workflow" in skill && skill.workflow?.length) {
    return executePatternWorkflow(skill as PatternDef, params, toolsByName);
  }

  // Fallback: skill with instructions but no workflow
  return {
    success: true,
    output: `Skill "${skill.name}" invoked. No executable workflow defined — follow instructions: ${"instructions" in skill ? skill.instructions.slice(0, 200) : ""}`,
    tokensUsed: 0,
    durationMs: 0,
  };
}
