import { webSearchTools } from "../tools/index.js";
import { buildSubagentPrompt } from "../prompts/system.js";
import type { AgentTool } from "../agent/types.js";
import type { SubAgentDef } from "./types.js";

export const vaptSubagent: SubAgentDef = {
  name: "vapt",
  description: "Offensive security researcher and penetration tester for vulnerability assessment",
  systemPrompt: buildSubagentPrompt("vapt"),
  tools: webSearchTools as unknown as AgentTool[],
};
