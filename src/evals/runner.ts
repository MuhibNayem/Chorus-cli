/**
 * Eval runner — executes an EvalSuite against an agent or swarm.
 */

import { randomUUID } from "crypto";
import type { EvalSuite, EvalRun, EvalCaseResult, EvalVerdict } from "./types.js";
import { score } from "./scorer.js";
import type { LLMProvider } from "../llm/provider.js";
import { runAgentLoop } from "../agent/loop.js";
import { HitlGate } from "../agent/hitl.js";
import { BtwQueue } from "../agent/btw.js";
import { JsonFileCheckpointer } from "../agent/checkpointer.js";
import { createDefaultMiddleware } from "../agent/middleware.js";
import type { AgentTool } from "../agent/types.js";

export interface EvalRunnerConfig {
  provider: LLMProvider;
  model: string;
  systemPrompt?: string;
  tools?: AgentTool[];
  /** Max concurrent cases. Default: 1 (sequential) */
  concurrency?: number;
}

async function runSingleCase(
  input: string,
  config: EvalRunnerConfig,
): Promise<{ output: string; inputTokens: number; outputTokens: number; costUsd: number; durationMs: number }> {
  const threadId = `eval-${randomUUID()}`;
  const hitlGate = new HitlGate();
  const btwQueue = new BtwQueue();
  const checkpointer = new JsonFileCheckpointer();
  const middleware = createDefaultMiddleware(threadId);

  let output = "";
  let inputTokens = 0;
  let outputTokens = 0;
  let costUsd = 0;
  let durationMs = 0;

  for await (const event of runAgentLoop({
    provider: config.provider,
    model: config.model,
    tools: config.tools ?? [],
    messages: [{ role: "user", content: input }],
    systemPrompt: config.systemPrompt ?? "",
    threadId,
    hitlGate,
    btwQueue,
    policy: "full_auto",
    checkpointer,
    middleware,
  })) {
    if (event.type === "done") {
      output = event.response;
      inputTokens = event.inputTokens;
      outputTokens = event.outputTokens;
      costUsd = event.costUsd;
      durationMs = event.durationMs;
    }
  }

  return { output, inputTokens, outputTokens, costUsd, durationMs };
}

export async function runEvalSuite(
  suite: EvalSuite,
  runnerConfig: EvalRunnerConfig,
): Promise<EvalRun> {
  const runId = `eval-${Date.now()}`;
  const startedAt = Date.now();
  const concurrency = runnerConfig.concurrency ?? 1;
  const results: EvalCaseResult[] = [];

  const cases = [...suite.cases];

  // Process in batches of `concurrency`
  while (cases.length > 0) {
    const batch = cases.splice(0, concurrency);
    const batchResults = await Promise.all(
      batch.map(async (evalCase): Promise<EvalCaseResult> => {
        let verdict: EvalVerdict = "error";
        let actualOutput = "";
        let reason: string | undefined;
        let scoreValue: number | undefined;
        let inputTokens = 0;
        let outputTokens = 0;
        let costUsd = 0;
        let durationMs = 0;

        try {
          const result = await runSingleCase(evalCase.input, runnerConfig);
          actualOutput = result.output;
          inputTokens = result.inputTokens;
          outputTokens = result.outputTokens;
          costUsd = result.costUsd;
          durationMs = result.durationMs;

          const scorerConfig = evalCase.expectedContains
            ? { type: "contains" as const, required: evalCase.expectedContains }
            : suite.scorer;

          const scored = await score(
            scorerConfig,
            evalCase.input,
            actualOutput,
            evalCase.expectedOutput,
            runnerConfig.provider,
            runnerConfig.model,
          );
          verdict = scored.verdict;
          reason = scored.reason;
          scoreValue = scored.score;
        } catch (err) {
          verdict = "error";
          reason = String(err);
        }

        return {
          caseId: evalCase.id,
          input: evalCase.input,
          expectedOutput: evalCase.expectedOutput,
          actualOutput,
          verdict,
          score: scoreValue,
          reason,
          durationMs,
          inputTokens,
          outputTokens,
          costUsd,
        };
      }),
    );
    results.push(...batchResults);
  }

  const passCount = results.filter((r) => r.verdict === "pass").length;
  const failCount = results.filter((r) => r.verdict === "fail").length;
  const errorCount = results.filter((r) => r.verdict === "error").length;
  const passRate = results.length > 0 ? passCount / results.length : 0;
  const threshold = suite.passThreshold ?? 1.0;

  return {
    runId,
    suiteName: suite.name,
    startedAt,
    completedAt: Date.now(),
    results,
    passCount,
    failCount,
    errorCount,
    passRate,
    passed: passRate >= threshold,
    totalInputTokens: results.reduce((s, r) => s + r.inputTokens, 0),
    totalOutputTokens: results.reduce((s, r) => s + r.outputTokens, 0),
    totalCostUsd: results.reduce((s, r) => s + r.costUsd, 0),
    durationMs: Date.now() - startedAt,
  };
}

export function formatEvalRun(run: EvalRun): string {
  const statusLine = run.passed
    ? `PASSED  (${run.passCount}/${run.results.length} cases)`
    : `FAILED  (${run.passCount}/${run.results.length} cases, ${run.failCount} fail, ${run.errorCount} error)`;

  const lines = [
    `Eval Run: ${run.runId}`,
    `Suite:    ${run.suiteName}`,
    `Status:   ${statusLine}`,
    `Pass rate: ${(run.passRate * 100).toFixed(1)}%  |  Cost: $${run.totalCostUsd.toFixed(4)}  |  Duration: ${(run.durationMs / 1000).toFixed(1)}s`,
    "",
    "── Case Results ─────────────────────────────────────────────────────",
  ];

  for (const r of run.results) {
    const icon = r.verdict === "pass" ? "✓" : r.verdict === "fail" ? "✗" : "!";
    lines.push(`  [${icon}] ${r.caseId}${r.reason ? `: ${r.reason}` : ""}`);
  }

  return lines.join("\n");
}
