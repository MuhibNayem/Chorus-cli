import { createHash } from "crypto";
import type {
  ContextBundle,
  ExecutionProtocol,
  ProjectMemory,
  RepoIntelligence,
  TaskRecord,
  WorkerAssignment,
  WorkerResult,
} from "./types.js";

interface AssembleContextInput {
  basePrompt: string;
  task: TaskRecord;
  messages: Array<{ role: string; content: string; reasoning_content?: string }>;
  toolNames: string[];
  subagentNames: string[];
  workerAssignments: WorkerAssignment[];
  repoIntelligence: RepoIntelligence;
  projectMemory: ProjectMemory;
}

function stableHash(parts: string[]): string {
  return createHash("sha256").update(parts.join("\n||\n")).digest("hex").slice(0, 16);
}

function formatOwnedScopes(assignments: WorkerAssignment[]): string {
  if (assignments.length === 0) return "- direct-agent:(main conversation owns execution)";

  return assignments
    .map((assignment) => `${assignment.role}:${assignment.ownedScope.join(",") || "(none)"}`)
    .join("\n");
}

export function createContextBundle(input: AssembleContextInput): ContextBundle {
  const prefixHash = stableHash([
    input.basePrompt,
    ...input.toolNames,
    ...input.subagentNames,
  ]);

  const taskDelta = input.messages.at(-1)?.content ?? "";
  const repoFactsVersion = stableHash([
    process.cwd(),
    input.toolNames.join(","),
    input.subagentNames.join(","),
    input.repoIntelligence.version,
  ]);

  return {
    id: `ctx-${input.task.taskId}`,
    prefixHash,
    taskDelta,
    repoFactsVersion,
    compactionRef: input.messages[0]?.role === "system" ? "compacted-history" : undefined,
    toolSchemaVersion: stableHash(input.toolNames),
  };
}

export function buildRuntimePrompt(
  basePrompt: string,
  task: TaskRecord,
  routeSummary: string,
  bundle: ContextBundle,
  assignments: WorkerAssignment[],
  protocol: ExecutionProtocol,
  repoIntelligence: RepoIntelligence,
  projectMemory: ProjectMemory
): string {
  const ownedScopes = formatOwnedScopes(assignments);
  const recentTasks = projectMemory.completedTasks.slice(0, 5);

  return `${basePrompt}
## Workspace

Working directory: ${process.cwd()}
Platform: ${process.platform}
Node version: ${process.version}

## Harness Task

Task ID: ${task.taskId}
Lane: ${task.lane}
Path: ${task.path}
Route Summary: ${routeSummary}
Context Bundle: ${bundle.id}
Prefix Hash: ${bundle.prefixHash}
Repo Facts Version: ${bundle.repoFactsVersion}

## Task Classifier

Kind: ${protocol.kind}
Mode: ${protocol.mode}
Lifecycle: ${protocol.stages.join(" -> ")}
Requires Plan: ${protocol.requiresPlan ? "yes" : "no"}
Requires Patch Discipline: ${protocol.requiresPatchDiscipline ? "yes" : "no"}
Requires Verification: ${protocol.requiresVerification ? "yes" : "no"}
Requires Self Review: ${protocol.requiresSelfReview ? "yes" : "no"}

## Execution Protocol

- Follow the lifecycle in order. Do not edit before inspecting relevant files.
- In Plan Mode, do not write files, commit changes, install dependencies, or run mutating commands.
- In Build Mode, execute the approved task using scoped edits and verification.
- For edit/debug/project work, make targeted patch-style edits, then inspect the diff.
- Prefer focused verification first, then broader checks when the blast radius is shared or user-facing.
- Finalize only after reporting verification status and residual risks.
- ${protocol.delegationPolicy}

Suggested checks:
${protocol.suggestedChecks.length ? protocol.suggestedChecks.map((cmd) => `- ${cmd}`).join("\n") : "- none inferred"}

Final response contract:
${protocol.finalResponseContract.map((item) => `- ${item}`).join("\n")}

## Repository Intelligence

Summary: ${repoIntelligence.summary}
Package Manager: ${repoIntelligence.packageManager ?? "unknown"}
Languages: ${repoIntelligence.languages.join(", ") || "unknown"}
Important Files:
${repoIntelligence.importantFiles.length ? repoIntelligence.importantFiles.map((file) => `- ${file}`).join("\n") : "- none detected"}
Known Commands:
${repoIntelligence.commands.length ? repoIntelligence.commands.map((cmd) => `- ${cmd}`).join("\n") : "- none detected"}
Test Signals:
${repoIntelligence.testSignals.length ? repoIntelligence.testSignals.map((signal) => `- ${signal}`).join("\n") : "- none detected"}

## Project Memory

Recent Completed Tasks:
${recentTasks.length ? recentTasks.map((task) => `- ${task.kind}: ${task.summary}`).join("\n") : "- none recorded"}
Known Issues:
${projectMemory.knownIssues.length ? projectMemory.knownIssues.map((issue) => `- ${issue}`).join("\n") : "- none recorded"}
Decisions:
${projectMemory.decisions.length ? projectMemory.decisions.map((decision) => `- ${decision}`).join("\n") : "- none recorded"}

## Verification Criteria

${task.verificationCriteria.map((criterion) => `- ${criterion.description}`).join("\n")}

## Worker Ownership

${ownedScopes}
`;
}

export function appendWorkerResultsToPrompt(prompt: string, results: WorkerResult[]): string {
  if (results.length === 0) return prompt;

  const summary = results
    .map((result) => {
      const findings = result.findings.length ? result.findings.join("; ") : "none";
      const risks = result.risks.length ? result.risks.join("; ") : "none";
      const next = result.nextActions.length ? result.nextActions.join("; ") : "none";
      return `- ${result.workerId} (${result.status}): ${result.summary}\n  findings: ${findings}\n  risks: ${risks}\n  next: ${next}`;
    })
    .join("\n");

  return `${prompt}

## Worker Results

${summary}
`;
}
