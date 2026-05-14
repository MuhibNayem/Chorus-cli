/**
 * Resolves file-defined AgentDef records into SubAgentDef instances.
 *
 * Tool names declared in the JSON are mapped to live AgentTool instances via
 * TOOL_REGISTRY. Unknown names are silently skipped so a typo in one tool
 * name does not kill the whole agent.
 *
 * Default tool set (when agent JSON has no "tools" field): filesystem + git.
 */

import { filesystemTools } from "../tools/filesystem.js";
import { gitTools, webSearchTools } from "../tools/index.js";
import { ExecuteTool } from "../tools/shell.js";
import type { AgentTool } from "../agent/types.js";
import type { AgentDef } from "./types.js";
import type { SubAgentDef } from "../subagents/types.js";

/** All tools that file-defined agents may request by name. */
const TOOL_REGISTRY = new Map<string, AgentTool>(
  [
    ...filesystemTools,
    ...gitTools,
    ...webSearchTools,
    ExecuteTool as AgentTool,
  ]
    .filter((t): t is AgentTool & { name: string } => typeof t.name === "string")
    .map((t) => [t.name, t]),
);

const DEFAULT_TOOLS: AgentTool[] = [...filesystemTools, ...gitTools];

/** Map a tool-name string to a live AgentTool instance, or undefined. */
export function resolveTool(name: string): AgentTool | undefined {
  return TOOL_REGISTRY.get(name);
}

/** Resolve an array of tool name strings to AgentTool instances. Unknown names are skipped. */
export function resolveTools(toolNames: string[]): AgentTool[] {
  return toolNames
    .map((name) => TOOL_REGISTRY.get(name))
    .filter((t): t is AgentTool => t !== undefined);
}

/** All registered tool names — used for documentation and validation. */
export function availableToolNames(): string[] {
  return Array.from(TOOL_REGISTRY.keys()).sort();
}

/**
 * Convert a file-loaded AgentDef into a SubAgentDef ready for execution.
 * Tools default to filesystem + git if none are declared in the JSON.
 */
export function agentDefToSubAgent(def: AgentDef): SubAgentDef {
  const tools =
    def.tools && def.tools.length > 0 ? resolveTools(def.tools) : DEFAULT_TOOLS;

  return {
    name: def.name,
    description: def.description,
    systemPrompt: def.systemPrompt,
    tools,
    permissionMode: def.permissionMode,
  };
}
