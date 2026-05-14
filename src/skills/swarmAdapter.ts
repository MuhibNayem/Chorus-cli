/**
 * Skill-Swarm Adapter
 *
 * Bridges skill swarm declarations to the existing swarm orchestrator.
 * Converts a SkillSwarmConfig into a SwarmConfig that runSwarm() can execute.
 */

import type { SkillSwarmConfig } from "./types.js";
import type { SwarmConfig, SwarmAgent } from "../swarm/types.js";
import type { LLMProvider } from "../llm/provider.js";
import type { Checkpointer } from "../agent/types.js";

/** Build a SwarmConfig from a skill's swarm declaration. */
export function buildSwarmConfigFromSkill(
  skillName: string,
  swarmConfig: SkillSwarmConfig,
  task: string,
  provider: LLMProvider,
  modelName: string,
  checkpointer?: Checkpointer,
): SwarmConfig {
  const agents: SwarmAgent[] =
    swarmConfig.agents?.map((agentDecl) => ({
      name: agentDecl.role,
      description: agentDecl.description,
      systemPrompt: buildAgentSystemPrompt(agentDecl.role, agentDecl.description, task),
      tools: [], // Skills inherit tools from parent context
      handoffDestinations: swarmConfig.agents
        ?.filter((a) => a.role !== agentDecl.role)
        .map((a) => a.role) ?? [],
      contextMode: "shared",
      maxRounds: 10,
      model: agentDecl.model,
    })) ?? [];

  // If no agents declared, create a single specialist
  if (agents.length === 0) {
    agents.push({
      name: `${skillName}-agent`,
      description: `Execute ${skillName}`,
      systemPrompt: `You are executing the "${skillName}" skill. Task: ${task}`,
      tools: [],
      handoffDestinations: [],
      contextMode: "shared",
      maxRounds: 10,
    });
  }

  return {
    agents,
    initialAgent: agents[0].name,
    task,
    provider,
    modelName,
    maxHandoffs: agents.length * 3,
    checkpointer,
    policy: "full_auto",
  };
}

function buildAgentSystemPrompt(role: string, description: string, task: string): string {
  return `You are a specialized agent with the role: ${role}.

Description: ${description}

You are part of a multi-agent workflow executing the following task:
${task}

Focus on your specific expertise. Coordinate with other agents via handoffs when needed.
Be concise and actionable in your responses.`;
}

/** Merge swarm results based on the skill's merge strategy. */
export function mergeSwarmResults(
  results: Array<{ agent: string; output: string }>,
  strategy: "concatenate_results" | "vote" | "first_success",
): string {
  switch (strategy) {
    case "concatenate_results":
      return results.map((r) => `## ${r.agent}\n\n${r.output}`).join("\n\n---\n\n");

    case "vote":
      // Simple: return the longest output (proxy for most detailed)
      return results.reduce((best, r) => (r.output.length > best.length ? r.output : best), "");

    case "first_success":
      return results[0]?.output ?? "";

    default:
      return results.map((r) => `${r.agent}: ${r.output.slice(0, 200)}`).join("\n");
  }
}
