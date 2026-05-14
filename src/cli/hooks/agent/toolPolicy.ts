import type { ApprovalPolicy, ExecutionMode } from "../../../harness/types.js";
export type { ApprovalPolicy, ExecutionMode };

type ToolLike = { name?: string };

const MUTATING_TOOLS = new Set(["file_write", "file_edit", "run_command", "git_commit", "delegate_to_subagent"]);
const SHELL_TOOLS = new Set(["run_command"]);

export function filterToolsForPolicy(
  tools: ToolLike[],
  mode: ExecutionMode,
  policy: ApprovalPolicy
): ToolLike[] {
  if (mode === "plan") {
    return tools.filter((t) => !MUTATING_TOOLS.has(t.name ?? ""));
  }
  if (policy === "suggest") {
    return tools.filter((t) => !SHELL_TOOLS.has(t.name ?? ""));
  }
  return tools;
}

export function toolNamesForPolicy(mode: ExecutionMode, policy: ApprovalPolicy): Set<string> | null {
  if (mode === "plan") {
    return new Set(["file_read", "grep", "internet_search", "weather"]);
  }
  if (policy === "suggest") {
    return new Set(["file_read", "grep", "internet_search", "weather", "file_write"]);
  }
  if (policy === "auto_edit") {
    return new Set(["file_read", "grep", "internet_search", "weather", "file_write", "file_edit"]);
  }
  if (policy === "full_auto") {
    return null; // null = all tools
  }
  return null;
}

export function describeApprovalPolicy(policy: ApprovalPolicy): string {
  switch (policy) {
    case "suggest":
      return "Approval policy: suggest — the agent will propose changes but not execute shell commands or commit without review.";
    case "auto_edit":
      return "Approval policy: auto-edit — file edits are applied automatically; destructive actions require approval.";
    case "full_auto":
      return "Approval policy: full-auto — all actions including delegation run without per-step confirmation.";
    default:
      return `Approval policy: ${policy as string}`;
  }
}
