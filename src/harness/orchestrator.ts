import { allSubagents } from "../subagents/index.js";
import { allTools } from "../tools/index.js";
import { buildVerificationCriteria, routeTask } from "./router.js";
import { buildRuntimePrompt, createContextBundle } from "./contextAssembler.js";
import { buildExecutionProtocol } from "./protocol.js";
import { loadProjectMemory } from "./projectMemory.js";
import { loadRepoIntelligence } from "./repoIntelligence.js";
import type {
  PreparedTaskExecution,
  ExecutionMode,
  TaskRoute,
  TaskRecord,
  WorkerAssignment,
  WorkerRole,
} from "./types.js";

interface PrepareTaskExecutionInput {
  text: string;
  expandedText: string;
  basePrompt: string;
  messages: Array<{ role: string; content: string; reasoning_content?: string }>;
  mode?: ExecutionMode;
}

function createWorkerAssignments(taskId: string, route: TaskRoute): WorkerAssignment[] {
  if (route.path === "direct_agent_path") return [];

  const roles: WorkerRole[] =
    route.requiresResearch ? ["researcher", "planner", "reviewer"] :
    route.lane === "background_async" ? ["planner", "reviewer", "tester"] :
    route.canParallelize ? ["planner", "coder", "reviewer", "tester"] :
    ["orchestrator"];

  return roles.map((role, index) => ({
    workerId: `${taskId}-${role}-${index}`,
    role,
    ownedScope:
      role === "coder" ? ["workspace"] :
      role === "reviewer" ? ["changed-surface"] :
      role === "tester" ? ["verification-surface"] :
      [],
    inputBundleId: `ctx-${taskId}`,
    status: "queued",
  }));
}

export function prepareTaskExecution(input: PrepareTaskExecutionInput): PreparedTaskExecution {
  const mode = input.mode ?? "build";
  const route = routeTask({
    text: input.text,
    expandedText: input.expandedText,
  });
  const repoIntelligence = loadRepoIntelligence();
  const projectMemory = loadProjectMemory();
  const protocol = buildExecutionProtocol(route, repoIntelligence, mode);

  const task: TaskRecord = {
    taskId: `task-${Date.now()}`,
    owner: "orchestrator",
    lane: route.lane,
    path: route.path,
    status: "running",
    createdAt: Date.now(),
    updatedAt: Date.now(),
    verificationCriteria: buildVerificationCriteria(route, mode),
  };

  const workerAssignments = mode === "plan" ? [] : createWorkerAssignments(task.taskId, route);
  const toolNames = allTools.map((tool) => tool.name);
  const subagentNames = allSubagents.map((subagent) => subagent.name);
  const contextBundle = createContextBundle({
    basePrompt: input.basePrompt,
    task,
    messages: input.messages,
    toolNames,
    subagentNames,
    workerAssignments,
    repoIntelligence,
    projectMemory,
  });

  const runtimePrompt = buildRuntimePrompt(
    input.basePrompt,
    task,
    `${route.lane} / ${route.path}`,
    contextBundle,
    workerAssignments,
    protocol,
    repoIntelligence,
    projectMemory
  );

  return {
    mode,
    task,
    route,
    protocol,
    repoIntelligence,
    projectMemory,
    contextBundle,
    workerAssignments,
    runtimePrompt,
  };
}
