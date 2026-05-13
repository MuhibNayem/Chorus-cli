import { SubAgent } from "deepagents";
import { gitTools } from "../tools/index.js";
import { buildSubagentPrompt } from "../prompts/system.js";
import { StructuredTool } from "langchain";

export const builderSubagent: SubAgent = {
  name: "builder",
  description: "Senior software engineer for production-quality code implementation",
  systemPrompt: buildSubagentPrompt("builder"),
  tools: [...gitTools] as unknown as StructuredTool[],
};
