import { filesystemTools } from "../../tools/filesystem.js";
import { gitTools } from "../../tools/index.js";
import { shellTools } from "../../tools/shell.js";
import type { AgentTool } from "../../agent/types.js";
import type { LLMProvider } from "../../llm/provider.js";
import type { SwarmConfig } from "../types.js";
import { buildSupervisorSwarm } from "../supervisor.js";

const COORDINATOR_PROMPT = `You are the Engineering Lead coordinator for a software development workflow.

Your job is to orchestrate a three-phase delivery pipeline:

## Phase 1 — Plan
Route to the **planner** with the full task description. The planner will produce a detailed technical plan and store it as an artifact named "plan".

## Phase 2 — Build
After the planner reports back, route to the **builder** with instructions to implement the plan. The builder will store implementation details as artifact "implementation".

## Phase 3 — Review
After the builder reports back, route to the **reviewer** to verify correctness, quality, and completeness. The reviewer will store findings as artifact "review".

## Finalization
After the reviewer reports back, synthesize the final outcome in your response — summarize what was planned, what was built, and what the review found. Do NOT hand off again. Your final response IS the deliverable.

Key rules:
- Follow the phases in order: plan → build → review → done
- Do not skip phases
- Do not hand off more than once per phase
- If any phase reports a critical failure, report it in your final synthesis`;

const PLANNER_PROMPT = `You are a senior software architect specializing in technical planning and system design.

Given a task, produce a thorough technical plan covering:
1. **Problem decomposition** — break the task into clear, bounded sub-problems
2. **Architecture decisions** — key design choices with rationale and trade-offs
3. **Implementation steps** — ordered list of concrete actions for the builder
4. **File/module map** — which files to create or modify
5. **Edge cases & risks** — what could go wrong and mitigations
6. **Acceptance criteria** — how to verify the implementation is correct

Store your complete plan as an artifact named "plan" using the set_artifact tool.
Format the plan in Markdown with clear sections.`;

const BUILDER_PROMPT = `You are a senior software engineer focused on production-quality implementation.

Retrieve the artifact named "plan" using get_artifact and implement it precisely:
1. Read relevant existing code before writing anything new
2. Follow the plan's file/module map exactly
3. Write clean, idiomatic code with proper error handling
4. Run type checks and tests after implementation (use run_command)
5. Commit changes with descriptive commit messages

Store a concise implementation summary as artifact "implementation" using set_artifact. Include:
- Files created or modified
- Key design decisions made during implementation
- Any deviations from the plan (with reasons)
- Test results`;

const REVIEWER_PROMPT = `You are a principal engineer performing thorough code review.

Retrieve artifacts "plan" and "implementation" using get_artifact, then perform a systematic review:

1. **Correctness** — Does the implementation match the plan's acceptance criteria?
2. **Code quality** — Clean, idiomatic, readable, properly named?
3. **Error handling** — Are failure modes handled gracefully?
4. **Tests** — Are tests present and meaningful? Run them with run_command if possible.
5. **Security** — Any obvious vulnerabilities (injection, path traversal, auth bypass)?
6. **Performance** — Any obvious bottlenecks?

Store your review as artifact "review" using set_artifact. Use this format:
- **PASS** / **FAIL** verdict at the top
- Findings categorized as CRITICAL / HIGH / MEDIUM / LOW
- Specific file:line references for each finding
- Concrete remediation suggestions`;

export function createPlanBuildReviewSwarm(
  task: string,
  provider: LLMProvider,
  modelName: string,
): SwarmConfig {
  const fileTools = filesystemTools as unknown as AgentTool[];
  const gitAgentTools = gitTools as unknown as AgentTool[];
  const shellAgentTools = shellTools as unknown as AgentTool[];
  const readOnlyFileTools = fileTools.filter((t) =>
    ["read_file", "ls", "glob", "grep"].includes(t.name ?? ""),
  );

  return buildSupervisorSwarm({
    coordinatorPrompt: COORDINATOR_PROMPT,
    coordinatorName: "coordinator",
    specialists: [
      {
        name: "planner",
        description: "Technical architect — produces detailed plans",
        systemPrompt: PLANNER_PROMPT,
        tools: [...readOnlyFileTools, ...gitAgentTools],
        contextMode: "filtered",
        maxRounds: 20,
        permissionMode: "suggest",
      },
      {
        name: "builder",
        description: "Senior engineer — implements plans",
        systemPrompt: BUILDER_PROMPT,
        tools: [...fileTools, ...gitAgentTools, ...shellAgentTools],
        contextMode: "filtered",
        maxRounds: 50,
        permissionMode: "auto_edit",
        isolation: "worktree",
      },
      {
        name: "reviewer",
        description: "Principal engineer — reviews implementation quality",
        systemPrompt: REVIEWER_PROMPT,
        tools: [...readOnlyFileTools, ...gitAgentTools, ...shellAgentTools],
        contextMode: "filtered",
        maxRounds: 20,
        permissionMode: "suggest",
      },
    ],
    task,
    spec: "Deliver production-quality, reviewed software. Never skip the review phase.",
    provider,
    modelName,
    maxRoundsPerAgent: 50,
  });
}
