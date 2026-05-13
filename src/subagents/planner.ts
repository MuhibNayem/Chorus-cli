import { SubAgent } from "deepagents";
import { gitTools } from "../tools/index.js";
import { buildSubagentPrompt } from "../prompts/system.js";
import { StructuredTool } from "langchain";

export const plannerSubagent: SubAgent = {
  name: "planner",
  description: "Expert system architect for deep architectural decisions and system design",
  systemPrompt: buildSubagentPrompt("planner"),
  tools: [...gitTools] as unknown as StructuredTool[],
};
