/**
 * Per-Turn Semantic Skill Router
 *
 * The key differentiator of ASR: re-evaluates skill relevance BEFORE every
 * agent turn, not just at session start. Only injects skills that match the
 * current conversation context and fit within the token budget.
 */

import * as fs from "fs";
import * as path from "path";
import type { SkillDef, PatternDef, SkillSelection, TokenBudget } from "./types.js";
import type { ChatMessage } from "../llm/provider.js";
import { SkillRegistry } from "./registry.js";
import { estimateSkillTokens, formatSkillSchema, buildRouterTable, selectOptimalSubset, compressSchema } from "./budget.js";

/**
 * Extract the user's intent from conversation history.
 * Uses the last user message + last assistant reasoning (if any).
 */
export function extractIntent(history: readonly ChatMessage[]): string {
  const parts: string[] = [];

  // Find last user message
  for (let i = history.length - 1; i >= 0; i--) {
    if (history[i].role === "user") {
      parts.push(history[i].content.slice(0, 500));
      break;
    }
  }

  // Find last assistant reasoning
  for (let i = history.length - 1; i >= 0; i--) {
    if (history[i].role === "assistant" && history[i].reasoning_content) {
      parts.push(`[reasoning: ${history[i].reasoning_content!.slice(0, 300)}]`);
      break;
    }
  }

  return parts.join("\n");
}

/**
 * Evaluate a `when:` condition against the current workspace.
 *
 * Supports simple conditions:
 *   - "*.ts exists" → checks if any .ts files exist in cwd
 *   - "package.json exists" → checks specific file
 *   - "src/ exists" → checks directory
 *   - "language:typescript" → checks if TS is in repo intelligence (future)
 */
export function evaluateWhenCondition(condition: string | undefined, cwd: string): boolean {
  if (!condition) return true;

  const cond = condition.trim().toLowerCase();

  // "*.ext exists"
  if (cond.endsWith(" exists")) {
    const pattern = condition.slice(0, -7).trim();
    return checkPatternExists(pattern, cwd);
  }

  // "file.ext" (implicit exists)
  if (!cond.includes(" ") && !cond.includes(":")) {
    return fs.existsSync(path.join(cwd, condition));
  }

  // Default: allow
  return true;
}

function checkPatternExists(pattern: string, cwd: string): boolean {
  // Simple glob: *.ts → check if any .ts files exist
  if (pattern.startsWith("*.")) {
    const ext = pattern.slice(1);
    try {
      const entries = fs.readdirSync(cwd, { withFileTypes: true });
      return entries.some((e) => e.isFile() && e.name.endsWith(ext));
    } catch {
      return false;
    }
  }

  // Directory check: src/ → check if src directory exists
  if (pattern.endsWith("/")) {
    return fs.existsSync(path.join(cwd, pattern.slice(0, -1)));
  }

  // Specific file
  return fs.existsSync(path.join(cwd, pattern));
}

/** Options for routing. */
export interface SkillRouterOptions {
  /** Max skills to select per turn. */
  maxSkills?: number;
  /** Max patterns to select per turn. */
  maxPatterns?: number;
  /** Minimum similarity score for inclusion. */
  minScore?: number;
  /** Current working directory for when: evaluation. */
  cwd?: string;
}

/** Route skills for the current turn based on conversation context. */
export async function routeSkillsForTurn(
  registry: SkillRegistry,
  history: readonly ChatMessage[],
  budget: TokenBudget,
  options: SkillRouterOptions = {},
): Promise<SkillSelection> {
  const { maxSkills = 6, maxPatterns = 3, minScore = 0.0, cwd = process.cwd() } = options;

  // 1. Extract intent from conversation
  const query = extractIntent(history);

  // 2. Semantic search against ALL skills + patterns
  const allMatches = await registry.findRelevant(query, Math.max(maxSkills, maxPatterns) * 3, minScore);

  // 3. Evaluate when: conditions (cheap, deterministic)
  const contextuallyValid = allMatches.filter((m) => {
    // Patterns don't have when: conditions; skills do
    if (m.kind === "pattern") return true;
    return evaluateWhenCondition((m.skill as SkillDef).when, cwd);
  });

  // 4. Separate skills vs patterns
  const skillMatches = contextuallyValid.filter((m) => m.kind === "skill").slice(0, maxSkills * 2);
  const patternMatches = contextuallyValid.filter((m) => m.kind === "pattern").slice(0, maxPatterns * 2);

  // 5. Budget-aware selection (greedy knapsack)
  const skillItems = skillMatches.map((m) => ({ skill: m.skill as SkillDef, score: m.score }));
  const patternItems = patternMatches.map((m) => ({ skill: m.skill as PatternDef, score: m.score }));

  const selectedSkillResults = selectOptimalSubset(skillItems, budget.available).slice(0, maxSkills);
  const selectedSkills: SkillDef[] = selectedSkillResults.map((s) => s.skill as SkillDef);
  const skillTokens = selectedSkills.reduce((sum, s) => sum + estimateSkillTokens(s), 0);

  const remainingBudget = { ...budget, available: budget.available - skillTokens };
  const selectedPatternResults = selectOptimalSubset(patternItems, remainingBudget.available).slice(0, maxPatterns);
  const selectedPatterns: PatternDef[] = selectedPatternResults.map((p) => p.skill as PatternDef);

  // 6. Build schema strings
  const schemas: string[] = [];

  // Always include router table (all skill names, minimal tokens)
  const allSkillNames = registry.getAllSkills().map((s) => s.name);
  if (allSkillNames.length > 0) {
    schemas.push(buildRouterTable(registry.getAllSkills()));
  }

  // Inject selected skill schemas
  for (const skill of selectedSkills) {
    schemas.push(formatSkillSchema(skill));
  }

  // Inject selected pattern schemas
  for (const pattern of selectedPatterns) {
    schemas.push(formatSkillSchema(pattern));
  }

  const tokensUsed = selectedSkills.reduce((sum, s) => sum + estimateSkillTokens(s), 0)
    + selectedPatterns.reduce((sum, p) => sum + estimateSkillTokens(p), 0);

  return {
    skills: selectedSkills,
    patterns: selectedPatterns,
    schemas,
    tokensUsed,
  };
}
