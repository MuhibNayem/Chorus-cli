import { webSearchTools } from "../../tools/index.js";
import { filesystemTools } from "../../tools/filesystem.js";
import type { AgentTool } from "../../agent/types.js";
import type { LLMProvider } from "../../llm/provider.js";
import type { SwarmConfig } from "../types.js";
import { buildSupervisorSwarm } from "../supervisor.js";

const COORDINATOR_PROMPT = `You are the Research Director coordinating a two-phase research and synthesis workflow.

## Phase 1 — Research
Route to the **researcher** with the full topic and any specific angles to investigate. The researcher will gather comprehensive information and store findings as artifact "research".

## Phase 2 — Synthesize
After the researcher reports back, route to the **synthesizer** to transform the raw findings into a polished, well-structured document stored as artifact "synthesis".

## Finalization
After the synthesizer reports back, present the final synthesized document to the user. Retrieve artifact "synthesis" using get_artifact and output it as your final response. Do NOT hand off again.`;

const RESEARCHER_PROMPT = `You are a rigorous research analyst with expertise in gathering, evaluating, and organizing information.

Given a research topic:
1. **Scope** — Define the key questions to answer
2. **Search** — Use internet_search to gather information from multiple angles. Run at least 3–5 distinct searches using different query formulations.
3. **Evaluate** — Assess source credibility and filter out unreliable or contradictory information
4. **Organize** — Structure findings by theme, not by source

Store comprehensive research findings as artifact "research" using set_artifact. Include:
- Key facts with source references
- Different perspectives or schools of thought
- Identified gaps or uncertainties
- Raw quotes and statistics where relevant

Be thorough — the synthesizer depends on the quality of your research.`;

const SYNTHESIZER_PROMPT = `You are an expert technical writer and knowledge synthesizer.

Retrieve artifact "research" using get_artifact, then create a polished document:

1. **Understand** — Read all research thoroughly before writing
2. **Structure** — Design a logical document outline suited to the content type
3. **Write** — Transform raw findings into clear, engaging prose
4. **Cite** — Reference sources inline where appropriate
5. **Refine** — Ensure coherence, eliminate repetition, verify consistency

Document standards:
- Use Markdown formatting (headers, lists, code blocks as appropriate)
- Lead with an executive summary
- Use concrete examples and data points
- End with key takeaways or next steps
- Target length: comprehensive but scannable

Store the final document as artifact "synthesis" using set_artifact.`;

export function createResearchSynthesizeSwarm(
  task: string,
  provider: LLMProvider,
  modelName: string,
): SwarmConfig {
  const webAgentTools = webSearchTools as unknown as AgentTool[];
  const fileAgentTools = (filesystemTools as unknown as AgentTool[]).filter((t) =>
    ["read_file", "ls", "glob"].includes(t.name ?? ""),
  );

  return buildSupervisorSwarm({
    coordinatorPrompt: COORDINATOR_PROMPT,
    coordinatorName: "coordinator",
    specialists: [
      {
        name: "researcher",
        description: "Research analyst — gathers and organizes information",
        systemPrompt: RESEARCHER_PROMPT,
        tools: [...webAgentTools, ...fileAgentTools],
        contextMode: "filtered",
        maxRounds: 30,
      },
      {
        name: "synthesizer",
        description: "Technical writer — creates polished documents from research",
        systemPrompt: SYNTHESIZER_PROMPT,
        tools: [...fileAgentTools],
        contextMode: "filtered",
        maxRounds: 20,
      },
    ],
    task,
    spec: "Produce accurate, well-sourced, clearly written research output.",
    provider,
    modelName,
    maxRoundsPerAgent: 30,
  });
}
