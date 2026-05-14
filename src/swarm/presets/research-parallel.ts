/**
 * Parallel Research preset — demonstrates graph execution.
 *
 * Two researchers run concurrently in Wave 0, then the synthesizer runs in
 * Wave 1 once both researchers have stored their artifacts.
 *
 * Wave 0 (parallel): researcher-a, researcher-b
 * Wave 1 (sequential): synthesizer (depends on researcher-a AND researcher-b)
 */

import { webSearchTools } from "../../tools/index.js";
import { filesystemTools } from "../../tools/filesystem.js";
import type { AgentTool } from "../../agent/types.js";
import type { LLMProvider } from "../../llm/provider.js";
import type { SwarmConfig } from "../types.js";
import { buildGraphSwarm } from "../graph-executor.js";

const RESEARCHER_A_PROMPT = `You are a rigorous research analyst investigating the primary angle of a research topic.

Given a research topic:
1. **Scope** — Define the key questions for this angle
2. **Search** — Use internet_search to gather information. Run at least 3 distinct searches.
3. **Evaluate** — Filter out unreliable or contradictory information
4. **Organize** — Structure findings by theme

Focus on: factual background, historical context, current state of affairs, and primary sources.

Store comprehensive findings as artifact "research-a" using set_artifact. Include:
- Key facts with source references
- Timeline and context
- Data points and statistics
- Identified gaps or uncertainties`;

const RESEARCHER_B_PROMPT = `You are a rigorous research analyst investigating the secondary angle of a research topic.

Given a research topic:
1. **Scope** — Define the key questions for this angle
2. **Search** — Use internet_search to gather information. Run at least 3 distinct searches.
3. **Evaluate** — Filter out unreliable or contradictory information
4. **Organize** — Structure findings by theme

Focus on: expert opinions, criticism, counter-arguments, emerging developments, and diverse perspectives.

Store comprehensive findings as artifact "research-b" using set_artifact. Include:
- Expert views and debates
- Competing perspectives or schools of thought
- Recent developments and trends
- Practical implications`;

const SYNTHESIZER_PROMPT = `You are an expert technical writer and knowledge synthesizer.

Retrieve both research artifacts ("research-a" and "research-b") using get_artifact, then create a unified polished document:

1. **Integrate** — Combine both research streams, resolving any contradictions
2. **Structure** — Design a logical document outline
3. **Write** — Transform raw findings into clear, engaging prose
4. **Cite** — Reference sources inline where appropriate
5. **Refine** — Ensure coherence, eliminate repetition, verify consistency

Document standards:
- Use Markdown formatting (headers, lists, code blocks as appropriate)
- Lead with an executive summary
- Use concrete examples and data points
- End with key takeaways or next steps

Store the final document as artifact "synthesis" using set_artifact.`;

export function createParallelResearchSwarm(
  task: string,
  provider: LLMProvider,
  modelName: string,
): SwarmConfig {
  const webAgentTools = webSearchTools as unknown as AgentTool[];
  const fileAgentTools = (filesystemTools as unknown as AgentTool[]).filter((t) =>
    ["read_file", "ls", "glob"].includes(t.name ?? ""),
  );

  return buildGraphSwarm({
    task,
    spec: "Produce accurate, well-sourced, clearly written research output.",
    provider,
    modelName,
    agents: [
      {
        name: "researcher-a",
        description: "Research analyst (primary angle) — factual background and primary sources",
        systemPrompt: RESEARCHER_A_PROMPT,
        tools: [...webAgentTools, ...fileAgentTools],
        maxRounds: 30,
        permissionMode: "full_auto",
        requiredArtifacts: ["research-a"],
      },
      {
        name: "researcher-b",
        description: "Research analyst (secondary angle) — expert views and diverse perspectives",
        systemPrompt: RESEARCHER_B_PROMPT,
        tools: [...webAgentTools, ...fileAgentTools],
        maxRounds: 30,
        permissionMode: "full_auto",
        requiredArtifacts: ["research-b"],
      },
      {
        name: "synthesizer",
        description: "Technical writer — creates polished documents from parallel research streams",
        systemPrompt: SYNTHESIZER_PROMPT,
        tools: [...fileAgentTools],
        maxRounds: 20,
        permissionMode: "full_auto",
        dependsOn: ["researcher-a", "researcher-b"],
        requiredArtifacts: ["synthesis"],
      },
    ],
  });
}
