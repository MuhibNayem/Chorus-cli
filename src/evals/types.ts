/**
 * Eval harness types — dataset-backed offline regression testing for Chorus.
 *
 * EvalCase  → single input/expected-output pair
 * EvalResult → actual output + scored pass/fail for a case
 * EvalSuite  → named collection of cases with scoring config
 * EvalRun    → timestamped execution of an EvalSuite
 */

export type ScorerType =
  | "exact"        // output === expected (trimmed)
  | "contains"     // output includes every string in expected array
  | "regex"        // output matches regex pattern
  | "llm-judge";   // LLM rates quality 1-5, pass threshold configurable

export interface ExactScorerConfig { type: "exact" }
export interface ContainsScorerConfig { type: "contains"; required: string[] }
export interface RegexScorerConfig { type: "regex"; pattern: string; flags?: string }
export interface LlmJudgeScorerConfig {
  type: "llm-judge";
  prompt?: string;
  passThreshold?: number;  // 1-5 scale, default 3
}

export type ScorerConfig =
  | ExactScorerConfig
  | ContainsScorerConfig
  | RegexScorerConfig
  | LlmJudgeScorerConfig;

export interface EvalCase {
  id: string;
  description?: string;
  input: string;
  expectedOutput?: string;
  expectedContains?: string[];
  tags?: string[];
}

export interface EvalSuite {
  name: string;
  description?: string;
  cases: EvalCase[];
  scorer: ScorerConfig;
  /** Minimum pass rate (0-1) to mark the suite as passing. Default: 1.0 */
  passThreshold?: number;
}

export type EvalVerdict = "pass" | "fail" | "error";

export interface EvalCaseResult {
  caseId: string;
  input: string;
  expectedOutput?: string;
  actualOutput: string;
  verdict: EvalVerdict;
  score?: number;
  reason?: string;
  durationMs: number;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
}

export interface EvalRun {
  runId: string;
  suiteName: string;
  startedAt: number;
  completedAt: number;
  results: EvalCaseResult[];
  passCount: number;
  failCount: number;
  errorCount: number;
  passRate: number;
  passed: boolean;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCostUsd: number;
  durationMs: number;
}
