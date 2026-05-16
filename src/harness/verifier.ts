import type { CompletedTaskExecution, TaskRecord, VerificationResult } from "./types.js";

interface VerifyTaskInput {
  task: TaskRecord;
  responseText: string;
  toolCallsObserved: number;
  hadError: boolean;
  durationMs: number;
  modelCalls: number;
}

export function verifyTaskCompletion(input: VerifyTaskInput): CompletedTaskExecution {
  const findings: string[] = [];

  if (!input.responseText.trim() && !input.hadError) {
    findings.push("The assistant completed without producing a final response.");
  }

  if (input.task.verificationCriteria.some((criterion) => criterion.id === "freshness")) {
    const hasEvidence = input.toolCallsObserved > 0 || /\bsource|official|docs?\b/i.test(input.responseText);
    if (!hasEvidence) {
      findings.push("The task was routed as freshness-sensitive but no research evidence was observed.");
    }
  }

  if (input.task.verificationCriteria.some((criterion) => criterion.id === "verification")) {
    const mentionsVerification = /\b(test|tests|tested|build|built|check|checked|lint|verify|verification|not run|could not run|failed|passed)\b/i
      .test(input.responseText);
    if (!mentionsVerification) {
      findings.push("The task required verification, but the final response did not report checks run or explicitly state why checks were not run.");
    }
  }

  if (input.task.verificationCriteria.some((criterion) => criterion.id === "diff-review")) {
    // Skip diff review for analysis-only tasks that made no changes
    if (input.toolCallsObserved === 0) {
      // No tools called — nothing to diff. Not a failure.
    } else {
      const mentionsDiffReview = /\b(diff|git status|git diff|reviewed changes|changed files|no files changed|no file changes)\b/i
        .test(input.responseText);
      if (!mentionsDiffReview) {
        findings.push("The task required diff review, but the final response did not report changed files or explicitly state that no files changed.");
      }
    }
  }

  const verification: VerificationResult = {
    ok: findings.length === 0 && !input.hadError,
    findings,
  };

  return {
    task: {
      ...input.task,
      status: verification.ok ? "completed" : "failed",
      updatedAt: Date.now(),
    },
    verification,
    modelCalls: input.modelCalls,
    durationMs: input.durationMs,
  };
}
