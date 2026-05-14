import type { SubAgentDef } from "./types.js";
import { plannerSubagent } from "./planner.js";
import { vaptSubagent } from "./vapt.js";
import { builderSubagent } from "./builder.js";

export const allSubagents: SubAgentDef[] = [
  plannerSubagent,
  vaptSubagent,
  builderSubagent,
];

export { plannerSubagent, vaptSubagent, builderSubagent };
export type { SubAgentDef };