import type { SubAgentDef } from "./types.js";
import { plannerSubagent } from "./planner.js";
import { vaptSubagent } from "./vapt.js";
import { builderSubagent } from "./builder.js";
import { loadAgents } from "../agents/loader.js";
import { agentDefToSubAgent } from "../agents/resolver.js";

/** Built-in hardcoded subagents. */
export const allSubagents: SubAgentDef[] = [
  plannerSubagent,
  vaptSubagent,
  builderSubagent,
];

/**
 * All subagents: built-ins merged with file-defined agents from
 * ~/.chorus/agents/ (user scope) and .chorus/agents/ (project scope).
 *
 * Precedence (highest first):
 *   project-scoped file > user-scoped file > built-in
 *
 * A file-defined agent with the same name as a built-in overrides it.
 */
export function getAllSubagents(): SubAgentDef[] {
  const fileAgents = loadAgents().map(agentDefToSubAgent);

  // Start with built-ins, then overlay file-defined (higher precedence)
  const merged = new Map<string, SubAgentDef>(
    allSubagents.map((s) => [s.name, s]),
  );
  for (const agent of fileAgents) {
    merged.set(agent.name, agent);
  }

  return Array.from(merged.values());
}

export { plannerSubagent, vaptSubagent, builderSubagent };
export type { SubAgentDef };