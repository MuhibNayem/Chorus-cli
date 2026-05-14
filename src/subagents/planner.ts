import { gitTools } from "../tools/index.js";
import { buildSubagentPrompt } from "../prompts/system.js";
import type { AgentTool } from "../agent/types.js";
import type { SubAgentDef } from "./types.js";

export const plannerSubagent: SubAgentDef = {
  name: "planner",
  description: "Expert system architect for deep architectural decisions and system design",
  systemPrompt: buildSubagentPrompt("planner"),
  tools: gitTools as unknown as AgentTool[],
};
