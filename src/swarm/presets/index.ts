import type { LLMProvider } from "../../llm/provider.js";
import type { SwarmConfig } from "../types.js";
import { createPlanBuildReviewSwarm } from "./plan-build-review.js";
import { createResearchSynthesizeSwarm } from "./research-synthesize.js";
import { createVaptReportSwarm } from "./vapt-report.js";

export interface PresetDef {
  name: string;
  description: string;
  agents: string[];
  factory: (task: string, provider: LLMProvider, modelName: string) => SwarmConfig;
}

export const SWARM_PRESETS: PresetDef[] = [
  {
    name: "plan-build-review",
    description: "Three-phase engineering workflow: architect → implement → code review",
    agents: ["coordinator", "planner", "builder", "reviewer"],
    factory: createPlanBuildReviewSwarm,
  },
  {
    name: "research-synthesize",
    description: "Research a topic and synthesize findings into a polished document",
    agents: ["coordinator", "researcher", "synthesizer"],
    factory: createResearchSynthesizeSwarm,
  },
  {
    name: "vapt-report",
    description: "Vulnerability assessment: recon → deep analysis → professional security report",
    agents: ["coordinator", "scanner", "analyst", "reporter"],
    factory: createVaptReportSwarm,
  },
];

export function findPreset(name: string): PresetDef | undefined {
  return SWARM_PRESETS.find((p) => p.name === name);
}

export function buildPresetSwarm(
  presetName: string,
  task: string,
  provider: LLMProvider,
  modelName: string,
): SwarmConfig {
  const preset = findPreset(presetName);
  if (!preset) {
    throw new Error(
      `Unknown swarm preset: "${presetName}". Available: ${SWARM_PRESETS.map((p) => p.name).join(", ")}`,
    );
  }
  return preset.factory(task, provider, modelName);
}

export { createPlanBuildReviewSwarm, createResearchSynthesizeSwarm, createVaptReportSwarm };
