import type { LLMProvider } from "../../llm/provider.js";
import type { SwarmConfig } from "../types.js";
import { createPlanBuildReviewSwarm } from "./plan-build-review.js";
import { createResearchSynthesizeSwarm } from "./research-synthesize.js";
import { createVaptReportSwarm } from "./vapt-report.js";
import { createParallelResearchSwarm } from "./research-parallel.js";

export interface PresetDef {
  name: string;
  description: string;
  agents: string[];
  executionModel: "handoff" | "graph";
  factory: (task: string, provider: LLMProvider, modelName: string) => SwarmConfig;
}

export const SWARM_PRESETS: PresetDef[] = [
  {
    name: "plan-build-review",
    description: "Three-phase engineering workflow: architect → implement → code review",
    agents: ["coordinator", "planner", "builder", "reviewer"],
    executionModel: "handoff",
    factory: createPlanBuildReviewSwarm,
  },
  {
    name: "research-synthesize",
    description: "Research a topic and synthesize findings into a polished document",
    agents: ["coordinator", "researcher", "synthesizer"],
    executionModel: "handoff",
    factory: createResearchSynthesizeSwarm,
  },
  {
    name: "vapt-report",
    description: "Vulnerability assessment: recon → deep analysis → professional security report",
    agents: ["coordinator", "scanner", "analyst", "reporter"],
    executionModel: "handoff",
    factory: createVaptReportSwarm,
  },
  {
    name: "research-parallel",
    description: "Parallel research: two researchers run concurrently, then a synthesizer combines results (graph execution)",
    agents: ["researcher-a", "researcher-b", "synthesizer"],
    executionModel: "graph",
    factory: createParallelResearchSwarm,
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

export {
  createPlanBuildReviewSwarm,
  createResearchSynthesizeSwarm,
  createVaptReportSwarm,
  createParallelResearchSwarm,
};
