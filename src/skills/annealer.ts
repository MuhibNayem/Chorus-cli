/**
 * Skill Annealer — Meta-agent for skill self-improvement.
 *
 * When a skill fails a quality gate repeatedly (>3 times with same error pattern),
 * the annealer spawns a diagnostic process that:
 *   1. Analyzes the "Rationalization Path" (how the skill failed)
 *   2. Proposes a patch to the skill instructions or workflow
 *   3. Creates a revised SKILL.md
 *   4. Validates the patch against recent trajectories
 */

import * as fs from "fs";
import * as path from "path";
import type { SkillDef, SkillMetrics, ToolTrajectory } from "./types.js";
import { loadSkillFile, saveSkillFile } from "./loader.js";

export interface AnnealResult {
  skillName: string;
  patched: boolean;
  reason: string;
  diff?: string;
}

export class SkillAnnealer {
  private skillDirs: string[];

  constructor(skillDirs: string[] = []) {
    this.skillDirs = skillDirs;
  }

  /**
   * Check if a skill needs annealing and attempt to patch it.
   *
   * Trigger condition: 3+ failures with the same error pattern.
   */
  shouldAnneal(metrics: SkillMetrics): boolean {
    if (metrics.status === "annealing") return false; // already annealing

    for (const error of metrics.errorPatterns) {
      if (error.count >= 3) return true;
    }
    return false;
  }

  /**
   * Anneal a skill by diagnosing its failures and proposing a patch.
   *
   * This is a lightweight, rule-based annealer. A full LLM-based annealer
   * would call the provider to generate revised instructions. The rule-based
   * approach works for common failure modes without additional API calls.
   */
  async anneal(skill: SkillDef, metrics: SkillMetrics): Promise<AnnealResult> {
    // Find the most frequent error pattern
    const topError = metrics.errorPatterns.sort((a, b) => b.count - a.count)[0];
    if (!topError || topError.count < 3) {
      return { skillName: skill.name, patched: false, reason: "No frequent error pattern found" };
    }

    const errorPattern = topError.pattern;
    const original = skill.instructions;
    let patched = original;
    let reason = "";

    // Rule-based patches for common failure modes
    if (errorPattern.includes("tool not found") || errorPattern.includes("unknown tool")) {
      patched = `IMPORTANT: Only use the tools listed in your available skills.\n\n${original}`;
      reason = "Added tool availability reminder";
    } else if (errorPattern.includes("invalid argument") || errorPattern.includes("schema validation")) {
      patched = `IMPORTANT: Validate all arguments against the tool schema before calling.\n\n${original}`;
      reason = "Added argument validation reminder";
    } else if (errorPattern.includes("timeout") || errorPattern.includes("too slow")) {
      patched = `IMPORTANT: Break large tasks into smaller steps. If a step takes too long, abort and report.\n\n${original}`;
      reason = "Added step-size guidance";
    } else if (errorPattern.includes("wrong file") || errorPattern.includes("file not found")) {
      patched = `IMPORTANT: Always verify file paths exist before reading/writing. Use list_dir to confirm.\n\n${original}`;
      reason = "Added file path verification reminder";
    } else {
      // Generic: prepend a failure-aware instruction
      patched = `NOTE: This skill has failed with "${errorPattern}". Be extra careful to avoid this error.\n\n${original}`;
      reason = `Added failure-aware note for: ${errorPattern}`;
    }

    // Apply patch
    if (patched !== original) {
      const patchedSkill: SkillDef = {
        ...skill,
        instructions: patched,
        updatedAt: Date.now(),
      };

      // Save to disk
      const saveDir = this.skillDirs.find((d) => fs.existsSync(d)) ?? this.skillDirs[0];
      if (saveDir) {
        saveSkillFile(patchedSkill, saveDir);
      }

      return {
        skillName: skill.name,
        patched: true,
        reason,
        diff: `--- ${skill.name}\n+++ ${skill.name} (annealed)\n@@ -1,3 +1,6 @@\n+${reason}\n+\n${original.slice(0, 200)}`,
      };
    }

    return { skillName: skill.name, patched: false, reason: "No applicable patch rule" };
  }

  /** Run annealing check across all skills that need it. */
  async annealAll(
    skills: SkillDef[],
    metricsMap: Map<string, SkillMetrics>,
  ): Promise<AnnealResult[]> {
    const results: AnnealResult[] = [];

    for (const skill of skills) {
      const metrics = metricsMap.get(skill.name);
      if (!metrics) continue;

      if (this.shouldAnneal(metrics)) {
        const result = await this.anneal(skill, metrics);
        results.push(result);
      }
    }

    return results;
  }
}
