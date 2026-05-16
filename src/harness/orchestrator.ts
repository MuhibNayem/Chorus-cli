import { allSubagents } from "../subagents/index.js";
import { allTools } from "../tools/index.js";
import { isAdvisorEnabled, getAdvisorSettings } from "../settings/storage.js";
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
  isAgentInvocation?: boolean;
}

function createWorkerAssignments(taskId: string, route: TaskRoute, _mode: ExecutionMode): WorkerAssignment[] {
  if (route.path === "direct_agent_path") return [];

  const advisorSettings = getAdvisorSettings();
  const advisorEnabled = isAdvisorEnabled()
    || (advisorSettings?.autoOnComplexTasks === true
        && (route.lane === "background_async"
            || route.lane === "foreground_sync"
            || route.canParallelize));

  const roles: WorkerRole[] =
    route.requiresResearch ? ["researcher", "planner", "reviewer"] :
    route.lane === "background_async" ? ["planner", "reviewer", "tester"] :
    route.canParallelize ? ["planner", "coder", "reviewer", "tester"] :
    ["orchestrator"];

  // Insert advisor between planner and coder when enabled
  const withAdvisor: WorkerRole[] = [];
  for (const role of roles) {
    withAdvisor.push(role);
    if (advisorEnabled && role === "planner" && roles.includes("coder")) {
      withAdvisor.push("advisor");
    }
  }

  return withAdvisor.map((role, index) => ({
    workerId: `${taskId}-${role}-${index}`,
    role,
    ownedScope:
      role === "coder" ? ["workspace"] :
      role === "reviewer" ? ["changed-surface"] :
      role === "tester" ? ["verification-surface"] :
      role === "advisor" ? ["plan-review"] :
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
    verificationCriteria: buildVerificationCriteria(route, mode, input.isAgentInvocation),
  };

  const workerAssignments = mode === "plan" ? [] : createWorkerAssignments(task.taskId, route, mode);
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
