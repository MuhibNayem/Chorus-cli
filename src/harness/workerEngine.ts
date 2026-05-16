import type { LLMProvider } from "../llm/provider.js";
import type { WorkerAssignment, WorkerRole } from "./types.js";
import { getWorkerSystemPrompt } from "./workerPrompts.js";

// ── Worker event types (replaces Dispatch<FeedAction>) ────────────────────────

export type WorkerEvent =
  | {
      type: "worker-add";
      workerId: string;
      role: WorkerRole;
      emoji: string;
      color: string;
      status: "running";
      summary: string;
      sessionId: string;
    }
  | {
      type: "worker-thinking";
      sessionId: string;
      id: string;
      text: string;
      expanded: boolean;
    }
  | {
      type: "worker-response";
      sessionId: string;
      text: string;
    }
  | {
      type: "worker-main-turn-thinking";
      sessionId: string;
      id: string;
      text: string;
      expanded: boolean;
    }
  | {
      type: "worker-session-complete";
      sessionId: string;
      completedAt: number;
    }
  | {
      type: "worker-update";
      workerId: string;
      status: "done" | "error";
      result: string;
    };

export type WorkerEventCallback = (event: WorkerEvent) => void;

// ── Interfaces ────────────────────────────────────────────────────────────────

export interface WorkerExecutionOptions {
  assignments: WorkerAssignment[];
  taskText: string;
  provider: LLMProvider;
  model: string;
  onEvent: WorkerEventCallback;
  parentTurnId: string;
}

export interface WorkerExecutionResult {
  workerId: string;
  role: WorkerRole;
  summary: string;
  findings: string[];
  durationMs: number;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function roleEmoji(role: WorkerRole): string {
  switch (role) {
    case "researcher":   return "🔍";
    case "planner":      return "🏗️";
    case "coder":        return "💻";
    case "reviewer":     return "👁️";
    case "tester":       return "🧪";
    case "orchestrator": return "🎛️";
    case "advisor":      return "🧠";
    default:             return "🤖";
  }
}

function roleColor(role: WorkerRole): string {
  switch (role) {
    case "researcher":   return "cyan";
    case "planner":      return "blue";
    case "coder":        return "green";
    case "reviewer":     return "yellow";
    case "tester":       return "magenta";
    case "orchestrator": return "white";
    case "advisor":      return "cyanBright";
    default:             return "gray";
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

// ── Core execution ────────────────────────────────────────────────────────────

async function executeSingleWorker(
  assignment: WorkerAssignment,
  taskText: string,
  provider: LLMProvider,
  model: string,
  onEvent: WorkerEventCallback,
  parentTurnId: string,
): Promise<WorkerExecutionResult> {
  const startedAt = Date.now();
  const workerId = assignment.workerId;
  const role = assignment.role;
  const sessionId = `session-${workerId}`;

  onEvent({
    type: "worker-add",
    workerId,
    role,
    emoji: roleEmoji(role),
    color: roleColor(role),
    status: "running",
    summary: `${roleEmoji(role)} ${role} analyzing…`,
    sessionId,
  });

  onEvent({
    type: "worker-thinking",
    sessionId,
    id: `${sessionId}-think-0`,
    text: `Starting ${role} analysis…`,
    expanded: false,
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

    onEvent({ type: "worker-response", sessionId, text: summary });

    onEvent({
      type: "worker-main-turn-thinking",
      sessionId,
      id: `${sessionId}-result`,
      text: `${roleEmoji(role)} ${role} completed in ${durationMs}ms:\n\n${summary}`,
      expanded: false,
    });

    onEvent({ type: "worker-session-complete", sessionId, completedAt: Date.now() });

    onEvent({
      type: "worker-update",
      workerId,
      status: "done",
      result: `${roleEmoji(role)} ${role} — ${findings.length} finding${findings.length === 1 ? "" : "s"} (${durationMs}ms)`,
    });

    return { workerId, role, summary, findings, durationMs };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const durationMs = Date.now() - startedAt;

    onEvent({ type: "worker-response", sessionId, text: `Error: ${message}` });
    onEvent({ type: "worker-session-complete", sessionId, completedAt: Date.now() });
    onEvent({
      type: "worker-update",
      workerId,
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
  options: WorkerExecutionOptions,
): Promise<WorkerExecutionResult[]> {
  if (options.assignments.length === 0) return [];

  const { assignments, taskText, provider, model, onEvent, parentTurnId } = options;

  const promises = assignments.map((assignment) =>
    executeSingleWorker(assignment, taskText, provider, model, onEvent, parentTurnId),
  );

  return Promise.all(promises);
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
