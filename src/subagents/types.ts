import type { AgentTool } from "../agent/types.js";
import type { ApprovalPolicy } from "../harness/types.js";

export interface SubAgentDef {
  name: string;
  description: string;
  systemPrompt: string;
  tools: AgentTool[];
  /** Permission mode for this subagent. Defaults to "full_auto". */
  permissionMode?: ApprovalPolicy;
}
