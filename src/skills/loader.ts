/**
 * SKILL.md Loader
 *
 * Parses Anthropic Agent Skills compatible SKILL.md files:
 *   ---
 *   name: my-skill
 *   description: Short description
 *   tags: [code, refactor]
 *   when: "*.ts exists"
 *   ---
 *   # Instructions
 *
 *   Markdown body...
 *
 * No external YAML parser dependency — uses a lightweight frontmatter extractor.
 */

import * as fs from "fs";
import * as path from "path";
import type { SkillDef, SkillSwarmConfig } from "./types.js";

/** Parse simple YAML frontmatter (key: value pairs only, no nested objects). */
function parseFrontmatter(raw: string): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  const lines = raw.split("\n").map((l) => l.trimEnd());

  for (const line of lines) {
    if (!line || line.startsWith("#")) continue;
    const colonIdx = line.indexOf(":");
    if (colonIdx === -1) continue;

    const key = line.slice(0, colonIdx).trim();
    let value: unknown = line.slice(colonIdx + 1).trim();

    // Parse arrays: [a, b, c]
    if (typeof value === "string" && value.startsWith("[") && value.endsWith("]")) {
      value = value
        .slice(1, -1)
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
    }
    // Parse booleans
    else if (value === "true") value = true;
    else if (value === "false") value = false;
    // Parse numbers
    else if (typeof value === "string" && /^-?\d+$/.test(value)) {
      value = parseInt(value, 10);
    }
    else if (typeof value === "string" && /^-?\d+\.\d+$/.test(value)) {
      value = parseFloat(value);
    }
    // Unquote strings
    else if (typeof value === "string" && ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'")))) {
      value = value.slice(1, -1);
    }

    result[key] = value;
  }

  return result;
}

/** Extract YAML frontmatter and markdown body from raw SKILL.md content. */
export function extractSkillContent(raw: string): { frontmatter: Record<string, unknown>; body: string } {
  const trimmed = raw.trimStart();
  if (!trimmed.startsWith("---")) {
    return { frontmatter: {}, body: trimmed };
  }

  const endIdx = trimmed.indexOf("\n---", 3);
  if (endIdx === -1) {
    return { frontmatter: {}, body: trimmed };
  }

  const fmRaw = trimmed.slice(3, endIdx).trim();
  const body = trimmed.slice(endIdx + 4).trimStart();
  return { frontmatter: parseFrontmatter(fmRaw), body };
}

/** Build a SkillDef from parsed frontmatter + body. */
function buildSkillDef(
  frontmatter: Record<string, unknown>,
  body: string,
  sourcePath: string,
): SkillDef {
  const name = String(frontmatter.name ?? path.basename(path.dirname(sourcePath)));
  const description = String(frontmatter.description ?? "");
  const tags = Array.isArray(frontmatter.tags) ? frontmatter.tags.map(String) : undefined;
  const when = frontmatter.when ? String(frontmatter.when) : undefined;
  const version = frontmatter.version ? String(frontmatter.version) : undefined;
  const author = frontmatter.author ? String(frontmatter.author) : undefined;
  const costBudget = typeof frontmatter.cost_budget === "number" ? frontmatter.cost_budget : undefined;

  // Parse swarm config if present
  let swarm: SkillSwarmConfig | undefined;
  if (frontmatter.swarm === true) {
    swarm = { enabled: true };
  } else if (typeof frontmatter.swarm === "object" && frontmatter.swarm !== null) {
    const s = frontmatter.swarm as Record<string, unknown>;
    swarm = {
      enabled: true,
      preset: s.preset ? String(s.preset) : undefined,
      agents: Array.isArray(s.agents)
        ? s.agents.map((a: unknown) => ({
            role: String((a as Record<string, unknown>).role ?? ""),
            description: String((a as Record<string, unknown>).description ?? ""),
            model: (a as Record<string, unknown>).model ? String((a as Record<string, unknown>).model) : undefined,
          }))
        : undefined,
      handoff: s.handoff
        ? {
            strategy: (s.handoff as Record<string, unknown>).strategy === "parallel" ? "parallel" : "sequential",
            merge: String((s.handoff as Record<string, unknown>).merge ?? "concatenate_results") as "concatenate_results" | "vote" | "first_success",
          }
        : undefined,
    };
  }

  // Parse workflow if present
  let workflow: SkillDef["workflow"] = undefined;
  if (Array.isArray(frontmatter.workflow)) {
    workflow = frontmatter.workflow.map((step: unknown) => {
      const s = step as Record<string, unknown>;
      return {
        tool: String(s.tool ?? ""),
        input: (s.input as Record<string, unknown>) ?? {},
        when: s.when ? String(s.when) : undefined,
      };
    });
  }

  return {
    name,
    description,
    instructions: body,
    version,
    author,
    tags,
    when,
    workflow,
    swarm,
    costBudget,
    sourcePath,
    updatedAt: Date.now(),
  };
}

/** Load a single SKILL.md file. Returns null if invalid or unreadable. */
export function loadSkillFile(filePath: string): SkillDef | null {
  try {
    const raw = fs.readFileSync(filePath, "utf-8");
    const { frontmatter, body } = extractSkillContent(raw);
    if (!frontmatter.name && !body) return null;
    return buildSkillDef(frontmatter, body, filePath);
  } catch {
    return null;
  }
}

/** Recursively scan directories for SKILL.md files. */
export function scanSkillDirs(dirs: string[]): string[] {
  const results: string[] = [];

  for (const dir of dirs) {
    if (!fs.existsSync(dir)) continue;

    function walk(current: string) {
      let entries: fs.Dirent[];
      try {
        entries = fs.readdirSync(current, { withFileTypes: true });
      } catch {
        return;
      }

      for (const entry of entries) {
        const fullPath = path.join(current, entry.name);
        if (entry.isDirectory()) {
          walk(fullPath);
        } else if (entry.name.toLowerCase() === "skill.md") {
          results.push(fullPath);
        }
      }
    }

    walk(dir);
  }

  return results;
}

/** Load all skills from the given directories. */
export function loadSkillsFromDirs(dirs: string[]): SkillDef[] {
  const files = scanSkillDirs(dirs);
  return files
    .map((f) => loadSkillFile(f))
    .filter((s): s is SkillDef => s !== null);
}

/** Save a skill to disk as a SKILL.md file. */
export function saveSkillFile(skill: SkillDef, dir: string): string {
  const skillDir = path.join(dir, skill.name);
  fs.mkdirSync(skillDir, { recursive: true });

  const lines: string[] = ["---"];
  lines.push(`name: ${skill.name}`);
  lines.push(`description: ${skill.description}`);
  if (skill.version) lines.push(`version: ${skill.version}`);
  if (skill.author) lines.push(`author: ${skill.author}`);
  if (skill.tags?.length) lines.push(`tags: [${skill.tags.join(", ")}]`);
  if (skill.when) lines.push(`when: ${skill.when}`);
  if (skill.costBudget) lines.push(`cost_budget: ${skill.costBudget}`);
  if (skill.synthesized) lines.push(`synthesized: true`);

  if (skill.workflow?.length) {
    lines.push("workflow:");
    for (const step of skill.workflow) {
      lines.push(`  - tool: ${step.tool}`);
      if (Object.keys(step.input).length) {
        lines.push("    input:");
        for (const [k, v] of Object.entries(step.input)) {
          const val = typeof v === "string" ? `"${v}"` : JSON.stringify(v);
          lines.push(`      ${k}: ${val}`);
        }
      }
      if (step.when) lines.push(`    when: ${step.when}`);
    }
  }

  if (skill.swarm?.enabled) {
    lines.push("swarm:");
    lines.push(`  enabled: true`);
    if (skill.swarm.preset) lines.push(`  preset: ${skill.swarm.preset}`);
    if (skill.swarm.agents?.length) {
      lines.push("  agents:");
      for (const agent of skill.swarm.agents) {
        lines.push(`    - role: ${agent.role}`);
        lines.push(`      description: ${agent.description}`);
        if (agent.model) lines.push(`      model: ${agent.model}`);
      }
    }
  }

  lines.push("---");
  lines.push("");
  lines.push(skill.instructions);

  const filePath = path.join(skillDir, "SKILL.md");
  fs.writeFileSync(filePath, lines.join("\n"), "utf-8");

  return filePath;
}
