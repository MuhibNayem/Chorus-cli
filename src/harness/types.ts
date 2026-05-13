export type ExecutionMode = "plan" | "build";

export type ExecutionLane =
  | "foreground_sync"
  | "background_async"
  | "cheap_triage";

export type TaskPath =
  | "direct_agent_path"
  | "tool_or_single_worker_path"
  | "parallel_multi_worker_path"
  | "research_then_plan_path"
  | "background_or_batch_path";

export type ExecutionStage =
  | "classified"
  | "inspected"
  | "planned"
  | "edited"
  | "verified"
  | "reviewed"
  | "finalized";

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
export type ApprovalPolicy = "suggest" | "auto_edit" | "full_auto";

export type TaskKind =
  | "answer_only"
  | "inspect_only"
  | "single_file_edit"
  | "multi_file_edit"
  | "debug"
  | "research"
  | "project_phase";

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
