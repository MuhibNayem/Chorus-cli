import type { Dispatch } from "react";
import type { FeedAction } from "../cli/state/feedReducer.js";
import type { LLMProvider } from "../llm/provider.js";
import type { WorkerAssignment, WorkerRole } from "./types.js";
import { getWorkerSystemPrompt } from "./workerPrompts.js";

export interface WorkerExecutionOptions {
  assignments: WorkerAssignment[];
  taskText: string;
  provider: LLMProvider;
  model: string;
  dispatch: Dispatch<FeedAction>;
  parentTurnId: string;
}

export interface WorkerExecutionResult {
  workerId: string;
  role: WorkerRole;
  summary: string;
  findings: string[];
  durationMs: number;
}

function roleEmoji(role: WorkerRole): string {
  switch (role) {
    case "researcher": return "🔍";
    case "planner": return "🏗️";
    case "coder": return "💻";
    case "reviewer": return "👁️";
    case "tester": return "🧪";
    case "orchestrator": return "🎛️";
    case "advisor": return "🧠";
    default: return "🤖";
  }
}

function roleColor(role: WorkerRole): string {
  switch (role) {
    case "researcher": return "cyan";
    case "planner": return "blue";
    case "coder": return "green";
    case "reviewer": return "yellow";
    case "tester": return "magenta";
    case "orchestrator": return "white";
    case "advisor": return "cyanBright";
    default: return "gray";
  }
}

function parseFindings(summary: string): string[] {
  const findings: string[] = [];
  const lines = summary.split("\n");
  let inList = false;
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith("- ") || trimmed.startsWith("* ") || /^\d+\./.test(trimmed)) {
      findings.push(trimmed.replace(/^[-*\d.\s]+/, "").trim());
      inList = true;
    } else if (inList && trimmed && !trimmed.startsWith("#")) {
      if (findings.length > 0) {
        findings[findings.length - 1] += " " + trimmed;
      }
    } else if (trimmed.startsWith("##")) {
      inList = false;
    }
  }
  return findings.length > 0 ? findings : [summary.slice(0, 200)];
}

async function executeSingleWorker(
  assignment: WorkerAssignment,
  taskText: string,
  provider: LLMProvider,
  model: string,
  dispatch: Dispatch<FeedAction>,
  parentTurnId: string
): Promise<WorkerExecutionResult> {
  const startedAt = Date.now();
  const workerId = assignment.workerId;
  const role = assignment.role;
  const sessionId = `session-${workerId}`;

  // Dispatch "worker starting" UI event in the main turn
  dispatch({
    type: "ADD_WORKER",
    worker: {
      id: workerId,
      role,
      emoji: roleEmoji(role),
      color: roleColor(role),
      status: "running",
      summary: `${roleEmoji(role)} ${role} analyzing…`,
      sessionId,
    },
  });

  // Add a thinking event to the worker session
  dispatch({
    type: "ADD_SESSION_EVENT",
    sessionId,
    event: {
      kind: "thinking",
      id: `${sessionId}-think-0`,
      text: `Starting ${role} analysis…`,
      expanded: false,
    },
  });

  try {
    const systemPrompt = getWorkerSystemPrompt(role);
    const result = await provider.generate({
      model,
      systemPrompt,
      messages: [
        { role: "user", content: `Task: ${taskText}\n\nProvide your analysis.` },
      ],
    });

    const summary = result.text.trim();
    const findings = parseFindings(summary);
    const durationMs = Date.now() - startedAt;

    // Add response to worker session
    dispatch({
      type: "ADD_SESSION_EVENT",
      sessionId,
      event: {
        kind: "response",
        text: summary,
      },
    });

    dispatch({
      type: "FINALIZE_SESSION",
      sessionId,
      completedAt: Date.now(),
    });

    dispatch({
      type: "UPDATE_WORKER",
      id: workerId,
      status: "done",
      result: `${roleEmoji(role)} ${role} — ${findings.length} finding${findings.length === 1 ? "" : "s"}`,
    });

    return {
      workerId,
      role,
      summary,
      findings,
      durationMs,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const durationMs = Date.now() - startedAt;

    dispatch({
      type: "ADD_SESSION_EVENT",
      sessionId,
      event: {
        kind: "response",
        text: `Error: ${message}`,
      },
    });

    dispatch({
      type: "FINALIZE_SESSION",
      sessionId,
      completedAt: Date.now(),
    });

    dispatch({
      type: "UPDATE_WORKER",
      id: workerId,
      status: "error",
      result: `${roleEmoji(role)} ${role} failed: ${message}`,
    });

    return {
      workerId,
      role,
      summary: `Worker ${role} failed: ${message}`,
      findings: [message],
      durationMs,
    };
  }
}

export async function executeWorkers(
  options: WorkerExecutionOptions
): Promise<WorkerExecutionResult[]> {
  if (options.assignments.length === 0) return [];

  const { assignments, taskText, provider, model, dispatch, parentTurnId } = options;

  const promises = assignments.map((assignment) =>
    executeSingleWorker(assignment, taskText, provider, model, dispatch, parentTurnId)
  );

  const results = await Promise.all(promises);
  return results;
}

export function formatWorkerResults(results: WorkerExecutionResult[]): string {
  if (results.length === 0) return "";

  const lines: string[] = ["\n--- Worker Analysis ---\n"];
  for (const result of results) {
    lines.push(`## ${result.role} (${result.durationMs}ms)`);
    lines.push(result.summary);
    lines.push("");
  }
  lines.push("--- End Worker Analysis ---\n");

  return lines.join("\n");
}
