/**
 * Token Budget Allocation for Skills
 *
 * Skills participate in the context budget alongside history and system prompt.
 * When context is tight, skills are dropped or compressed before conversation
 * history is sacrificed.
 */

import type { SkillDef, PatternDef, TokenBudget } from "./types.js";
import { countTokens } from "../context/tokenizer.js";

/** Estimate tokens for a skill schema (conservative over-estimation). */
export function estimateSkillTokens(skill: SkillDef | PatternDef): number {
  const schema = formatSkillSchema(skill);
  return countTokens(schema);
}

/** Format a skill/pattern as an injectable schema string. */
export function formatSkillSchema(skill: SkillDef | PatternDef): string {
  const lines: string[] = [];
  lines.push(`## Skill: ${skill.name}`);
  lines.push(`Description: ${skill.description}`);

  if ("parameters" in skill && skill.parameters.length) {
    lines.push("Parameters:");
    for (const param of skill.parameters) {
      const def = param.default !== undefined ? ` (default: ${JSON.stringify(param.default)})` : "";
      lines.push(`  - ${param.name}: ${param.type}${def} — ${param.description}`);
    }
  }

  if ("instructions" in skill && skill.instructions) {
    // Truncate instructions to first 500 chars to keep schemas compact
    const truncated =
      skill.instructions.length > 500
        ? skill.instructions.slice(0, 500) + "\n[...truncated]"
        : skill.instructions;
    lines.push("Instructions:");
    lines.push(truncated);
  }

  if ("workflow" in skill && skill.workflow?.length) {
    lines.push("Workflow:");
    for (const step of skill.workflow) {
      lines.push(`  1. ${step.tool}(${JSON.stringify(step.input)})`);
    }
  }

  return lines.join("\n");
}

/** Build a minimal router table (always injected, ~20 tokens). */
export function buildRouterTable(skills: SkillDef[]): string {
  if (skills.length === 0) return "";
  const lines = ["## Available Skills (router table)"];
  for (const skill of skills) {
    lines.push(`- ${skill.name}: ${skill.description.slice(0, 60)}`);
  }
  return lines.join("\n");
}

/** Build compressed schemas (strip examples, keep only params + name). */
export function compressSchema(skill: SkillDef | PatternDef): string {
  const lines: string[] = [];
  lines.push(`${skill.name}: ${skill.description}`);
  if ("parameters" in skill && skill.parameters.length) {
    lines.push(`  params: ${skill.parameters.map((p) => p.name).join(", ")}`);
  }
  return lines.join("\n");
}

/**
 * Select optimal skill subset given a token budget.
 *
 * Uses a greedy knapsack: sort by relevanceScore/schemaTokens ratio,
 * then pick highest-ratio items until budget is exhausted.
 */
export function selectOptimalSubset(
  matches: Array<{ skill: SkillDef | PatternDef; score: number }>,
  budget: number,
): Array<{ skill: SkillDef | PatternDef; score: number }> {
  if (budget <= 0) return [];

  // Compute value/cost ratio for each
  const scored = matches.map((m) => {
    const cost = estimateSkillTokens(m.skill);
    const ratio = cost > 0 ? m.score / cost : m.score;
    return { ...m, cost, ratio };
  });

  // Sort descending by ratio
  scored.sort((a, b) => b.ratio - a.ratio);

  const selected: Array<{ skill: SkillDef | PatternDef; score: number }> = [];
  let used = 0;

  for (const item of scored) {
    if (used + item.cost <= budget) {
      selected.push({ skill: item.skill, score: item.score });
      used += item.cost;
    }
  }

  // Re-sort selected by original relevance score (highest first)
  selected.sort((a, b) => b.score - a.score);

  return selected;
}

/** Create a token budget from context window and current usage. */
export function createTokenBudget(
  contextWindow: number,
  reservedTokens: number,
  skillReserveRatio = 0.15,
): TokenBudget {
  // Reserve 15% of context window for skills (configurable)
  const maxSkillTokens = Math.floor(contextWindow * skillReserveRatio);
  const available = Math.max(0, Math.min(maxSkillTokens, contextWindow - reservedTokens));

  return {
    total: contextWindow,
    reserved: reservedTokens,
    available,
  };
}
