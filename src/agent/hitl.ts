import type { ApprovalPolicy } from "../harness/types.js";
import type { ToolCall } from "../llm/provider.js";
import type { HitlDecision } from "./types.js";

const HITL_TOOL_NAMES = new Set([
  "file_write",
  "file_edit",
  "run_command",
  "git_commit",
  "delegate_to_subagent",
]);

export class HitlGate {
  private readonly gates = new Map<string, (decision: HitlDecision) => void>();
  private readonly sessionApproved = new Set<string>();
  private readonly pending = new Map<string, HitlDecision>();

  shouldPause(
    toolCalls: ToolCall[],
    policy: ApprovalPolicy,
  ): boolean {
    if (policy === "full_auto" || policy === "suggest") return false;
    return toolCalls.some((toolCall) => {
      const name = toolCall.function.name ?? "";
      return HITL_TOOL_NAMES.has(name) && !this.sessionApproved.has(name);
    });
  }

  wait(resumeKey: string): Promise<HitlDecision> {
    const queued = this.pending.get(resumeKey);
    if (queued) {
      this.pending.delete(resumeKey);
      return Promise.resolve(queued);
    }
    return new Promise((resolve) => {
      this.gates.set(resumeKey, resolve);
    });
  }

  resolve(resumeKey: string, decision: HitlDecision): void {
    if (decision.type === "approve_session") {
      for (const toolName of decision.toolNames ?? []) {
        this.sessionApproved.add(toolName);
      }
    }

    const resolver = this.gates.get(resumeKey);
    const normalized = decision.type === "approve_session" ? { type: "approve" as const } : decision;
    if (!resolver) {
      this.pending.set(resumeKey, normalized);
      return;
    }
    resolver(normalized);
    this.gates.delete(resumeKey);
  }

  resetSessionApprovals(): void {
    this.sessionApproved.clear();
    this.pending.clear();
  }
}
