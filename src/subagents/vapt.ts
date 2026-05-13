import { SubAgent } from "deepagents";
import { webSearchTools } from "../tools/index.js";
import { buildSubagentPrompt } from "../prompts/system.js";
import { StructuredTool } from "langchain";

export const vaptSubagent: SubAgent = {
  name: "vapt",
  description: "Offensive security researcher and penetration tester for vulnerability assessment",
  systemPrompt: buildSubagentPrompt("vapt"),
  tools: [...webSearchTools] as unknown as StructuredTool[],
};
