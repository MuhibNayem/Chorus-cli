import { gitTools } from "../tools/index.js";
import { buildSubagentPrompt } from "../prompts/system.js";
import type { AgentTool } from "../agent/types.js";
import type { SubAgentDef } from "./types.js";

export const builderSubagent: SubAgentDef = {
  name: "builder",
  description: "Senior software engineer for production-quality code implementation",
  systemPrompt: buildSubagentPrompt("builder"),
  tools: gitTools as unknown as AgentTool[],
};
