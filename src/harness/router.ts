import type { ExecutionLane, ExecutionMode, TaskKind, TaskPath, TaskRoute, VerificationCriterion } from "./types.js";

interface RouteTaskInput {
  text: string;
  expandedText: string;
}

const RESEARCH_HINT_RE =
  /\b(latest|current|today|news|look up|search web|verify online|official docs?|version|release notes?)\b/i;
const BACKGROUND_HINT_RE =
  /\b(full project|full codebase|entire repo|nightly|batch|audit all|index all)\b/i;
const MULTI_FILE_HINT_RE =
  /\b(also|plus|across|multiple|several)\b/i;
const EXPLICIT_ORCHESTRATION_RE =
  /\b(orchestrate|coordinate|multi-agent|delegate|workers?|subagents?|parallelize)\b/i;
const COMPLEX_SINGLE_WORK_RE =
  /\b(design|architecture|migration|migrate|refactor|debug|investigate|root cause|end-to-end|e2e|review)\b/i;
const EDIT_HINT_RE =
  /\b(fix|change|update|edit|implement|add|remove|rename|wire|create|delete|modify|refactor)\b/i;
const INSPECT_HINT_RE =
  /\b(explain|show|list|where|what does|how does|inspect|analyze why|analyze|read)\b/i;

function isMultiFileWork(text: string, expandedText: string): boolean {
  return MULTI_FILE_HINT_RE.test(text) || expandedText.includes("[File:");
}

function isComplexSingleWorkerWork(text: string): boolean {
  if (EXPLICIT_ORCHESTRATION_RE.test(text)) return true;
  if (text.length >= 240) return true;
  return COMPLEX_SINGLE_WORK_RE.test(text);
}

function selectLane(text: string): ExecutionLane {
  if (BACKGROUND_HINT_RE.test(text)) return "background_async";
  if (RESEARCH_HINT_RE.test(text)) return "foreground_sync";
  if (!isComplexSingleWorkerWork(text)) return "cheap_triage";
  return "foreground_sync";
}

function isSimpleConversational(text: string): boolean {
  if (text.length > 120) return false;
  return !EDIT_HINT_RE.test(text) && !COMPLEX_SINGLE_WORK_RE.test(text) && !BACKGROUND_HINT_RE.test(text);
}

function selectPath(text: string, expandedText: string): TaskPath {
  if (BACKGROUND_HINT_RE.test(text)) return "background_or_batch_path";
  if (RESEARCH_HINT_RE.test(text)) return "research_then_plan_path";
  if (isSimpleConversational(text)) return "direct_agent_path";
  if (isMultiFileWork(text, expandedText)) return "parallel_multi_worker_path";
  if (!isComplexSingleWorkerWork(text)) return "direct_agent_path";
  return "tool_or_single_worker_path";
}

function selectKind(text: string, expandedText: string): TaskKind {
  if (BACKGROUND_HINT_RE.test(text)) return "project_phase";
  if (RESEARCH_HINT_RE.test(text)) return "research";
  if (/\b(debug|root cause|failing|failure|bug|investigate)\b/i.test(text)) return "debug";
  if (isMultiFileWork(text, expandedText) && EDIT_HINT_RE.test(text)) return "multi_file_edit";
  if (EDIT_HINT_RE.test(text)) return "single_file_edit";
  if (INSPECT_HINT_RE.test(text)) return "inspect_only";
  return "answer_only";
}

export function routeTask(input: RouteTaskInput): TaskRoute {
  const lane = selectLane(input.text);
  const path = selectPath(input.text, input.expandedText);
  const kind = selectKind(input.text, input.expandedText);

  return {
    kind,
    lane,
    path,
    requiresResearch: path === "research_then_plan_path",
    canParallelize: path === "parallel_multi_worker_path",
    usesCheapTriage: lane === "cheap_triage",
  };
}

export function buildVerificationCriteria(route: TaskRoute, mode: ExecutionMode = "build", isAgentInvocation = false): VerificationCriterion[] {
  const criteria: VerificationCriterion[] = [
    {
      id: "non-empty-response",
      description: "Return a non-empty assistant response or a concrete failure explanation.",
    },
  ];

  // Agent-invoked tasks have their own system prompt; diff/verification criteria
  // don't apply because the task description is the agent's role, not a code-edit command.
  if (isAgentInvocation) return criteria;

  if (mode === "plan") {
    criteria.push({
      id: "plan-only",
      description: "Produce an implementation plan and do not modify files or run mutating commands.",
    });
    return criteria;
  }

  if (route.path === "parallel_multi_worker_path") {
    criteria.push({
      id: "scoped-execution",
      description: "Keep work scoped and coherent across multiple owned surfaces.",
    });
  }

  if (route.kind === "single_file_edit" || route.kind === "multi_file_edit" || route.kind === "debug" || route.kind === "project_phase") {
    criteria.push(
      {
        id: "diff-review",
        description: "Review the resulting diff or explicitly state that no files changed.",
      },
      {
        id: "verification",
        description: "Run or identify relevant verification checks and report pass/fail/not-run status.",
      }
    );
  }

  if (route.requiresResearch) {
    criteria.push({
      id: "freshness",
      description: "Use fresh external information before finalizing the response.",
    });
  }

  if (route.lane === "background_async") {
    criteria.push({
      id: "background-suitability",
      description: "Decompose the task so it can continue without blocking the interactive path.",
    });
  }

  return criteria;
}
