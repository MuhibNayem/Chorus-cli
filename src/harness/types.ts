export type ExecutionLane =
  | "foreground_sync"
  | "background_async"
  | "batch_offline"
  | "cheap_triage";

export type ExecutionMode = "plan" | "build";
export type ApprovalPolicy = "suggest" | "auto_edit" | "full_auto";

export type TaskPath =
  | "direct_agent_path"
  | "tool_or_single_worker_path"
  | "parallel_multi_worker_path"
  | "research_then_plan_path"
  | "background_or_batch_path"
  | "cache_amplified_path";

export type TaskKind =
  | "answer_only"
  | "inspect_only"
  | "single_file_edit"
  | "multi_file_edit"
  | "debug"
  | "research"
  | "project_phase";

export type ExecutionStage =
  | "classified"
  | "inspected"
  | "planned"
  | "advised"
  | "edited"
  | "verified"
  | "reviewed"
  | "finalized";

export type TaskStatus =
  | "queued"
  | "running"
  | "blocked"
  | "verifying"
  | "completed"
  | "failed"
  | "backgrounded";

export type WorkerRole =
  | "orchestrator"
  | "planner"
  | "coder"
  | "researcher"
  | "reviewer"
  | "tester"
  | "advisor";

export interface VerificationCriterion {
  id: string;
  description: string;
}

export interface TaskRecord {
  taskId: string;
  owner: WorkerRole;
  lane: ExecutionLane;
  path: TaskPath;
  status: TaskStatus;
  createdAt: number;
  updatedAt: number;
  verificationCriteria: VerificationCriterion[];
}

export interface WorkerAssignment {
  workerId: string;
  role: WorkerRole;
  ownedScope: string[];
  inputBundleId: string;
  status: Exclude<TaskStatus, "backgrounded">;
}

export interface WorkerResult {
  workerId: string;
  status: "completed" | "failed";
  summary: string;
  changedFiles: string[];
  findings: string[];
  risks: string[];
  nextActions: string[];
  verification: {
    checksRun: string[];
    checksPending: string[];
  };
}

export interface ContextBundle {
  id: string;
  prefixHash: string;
  taskDelta: string;
  repoFactsVersion: string;
  compactionRef?: string;
  toolSchemaVersion: string;
}

export interface TaskRoute {
  kind: TaskKind;
  lane: ExecutionLane;
  path: TaskPath;
  requiresResearch: boolean;
  canParallelize: boolean;
  usesCheapTriage: boolean;
}

export interface ExecutionProtocol {
  mode: ExecutionMode;
  kind: TaskKind;
  stages: ExecutionStage[];
  requiresPlan: boolean;
  requiresPatchDiscipline: boolean;
  requiresVerification: boolean;
  requiresSelfReview: boolean;
  suggestedChecks: string[];
  delegationPolicy: string;
  finalResponseContract: string[];
}

export interface RepoIntelligence {
  version: string;
  summary: string;
  packageManager?: string;
  languages: string[];
  importantFiles: string[];
  commands: string[];
  testSignals: string[];
  generatedAt: number;
}

export interface ProjectMemory {
  version: number;
  workspace: string;
  decisions: string[];
  knownIssues: string[];
  completedTasks: Array<{
    taskId: string;
    kind: TaskKind;
    summary: string;
    completedAt: number;
  }>;
  updatedAt: number;
}

export interface PreparedTaskExecution {
  mode: ExecutionMode;
  task: TaskRecord;
  route: TaskRoute;
  protocol: ExecutionProtocol;
  repoIntelligence: RepoIntelligence;
  projectMemory: ProjectMemory;
  contextBundle: ContextBundle;
  workerAssignments: WorkerAssignment[];
  runtimePrompt: string;
}

export interface VerificationResult {
  ok: boolean;
  findings: string[];
}

export interface CompletedTaskExecution {
  task: TaskRecord;
  verification: VerificationResult;
  modelCalls: number;
  durationMs: number;
}

export interface HarnessRunRecord {
  task: TaskRecord;
  route: TaskRoute;
  protocol?: ExecutionProtocol;
  repoIntelligence?: RepoIntelligence;
  projectMemory?: ProjectMemory;
  contextBundle: ContextBundle;
  workerAssignments: WorkerAssignment[];
  workerResults: WorkerResult[];
  completed?: CompletedTaskExecution;
}

export interface HarnessMetrics {
  tasksStarted: number;
  tasksCompleted: number;
  tasksFailed: number;
  modelCalls: number;
  verifierFailures: number;
  workerAssignments: number;
  routes: Record<string, number>;
  lanes: Record<string, number>;
  totalDurationMs: number;
  updatedAt: number;
}
