import { SubAgent } from "deepagents";
import { plannerSubagent } from "./planner.js";
import { vaptSubagent } from "./vapt.js";
import { builderSubagent } from "./builder.js";

export const allSubagents: SubAgent[] = [
  plannerSubagent,
  vaptSubagent,
  builderSubagent,
];

export { plannerSubagent, vaptSubagent, builderSubagent };