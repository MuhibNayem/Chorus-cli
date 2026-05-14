import type { AgentTool } from "../agent/types.js";

export interface SubAgentDef {
  name: string;
  description: string;
  systemPrompt: string;
  tools: AgentTool[];
}
