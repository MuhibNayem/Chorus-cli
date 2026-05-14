import { isAdvisorEnabled } from "../settings/storage.js";
import type { ExecutionMode, ExecutionProtocol, ExecutionStage, RepoIntelligence, TaskRoute } from "./types.js";

export function buildExecutionProtocol(
  route: TaskRoute,
  _repoIntelligence: RepoIntelligence,
  mode: ExecutionMode
): ExecutionProtocol {
  const stages: ExecutionStage[] = ["classified"];

  if (route.requiresResearch || mode === "plan") stages.push("inspected");
  if (mode === "plan" || route.kind === "project_phase" || route.path === "research_then_plan_path") stages.push("planned");
  if (mode === "build" && route.kind !== "inspect_only" && route.kind !== "answer_only") {
    stages.push("inspected", "planned", "edited", "verified", "reviewed");
  }
  if (mode === "build" && (route.kind === "multi_file_edit" || route.kind === "project_phase") && isAdvisorEnabled()) {
    stages.splice(stages.indexOf("edited"), 0, "advised");
  }
  stages.push("finalized");

  const requiresPlan =
    mode === "plan" ||
    route.kind === "project_phase" ||
    route.path === "parallel_multi_worker_path" ||
    route.path === "research_then_plan_path";

  const requiresPatchDiscipline =
    route.kind === "multi_file_edit" ||
    route.kind === "single_file_edit" ||
    route.kind === "debug";

  const requiresVerification =
    mode === "build" &&
    (route.kind === "single_file_edit" ||
      route.kind === "multi_file_edit" ||
      route.kind === "debug" ||
      route.kind === "project_phase");

  const requiresSelfReview =
    route.kind === "multi_file_edit" || route.kind === "project_phase";

  const suggestedChecks: string[] = [];
  if (requiresVerification) {
    suggestedChecks.push("npm test", "npm run build");
  }
  if (route.requiresResearch) {
    suggestedChecks.push("internet_search for relevant documentation");
  }

  const delegationPolicy =
    route.canParallelize
      ? "Delegate independent subtasks to workers using delegate_to_subagent when beneficial."
      : "Execute work directly as the primary agent; delegation is not required for this task.";

  const finalResponseContract: string[] = ["Provide a non-empty final response summarizing the outcome."];
  if (requiresVerification) {
    finalResponseContract.push("Report verification checks run and their pass/fail status.");
    finalResponseContract.push("State changed files or confirm no files were changed.");
  }
  if (mode === "plan") {
    finalResponseContract.push("Produce an implementation plan only; do not modify files.");
  }

  return {
    mode,
    kind: route.kind,
    stages,
    requiresPlan,
    requiresPatchDiscipline,
    requiresVerification,
    requiresSelfReview,
    suggestedChecks,
    delegationPolicy,
    finalResponseContract,
  };
}
