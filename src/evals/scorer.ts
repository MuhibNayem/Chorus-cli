/**
 * Eval scorers — deterministic and LLM-as-judge scoring strategies.
 */

import type { ScorerConfig, EvalVerdict } from "./types.js";
import type { LLMProvider } from "../llm/provider.js";

export interface ScorerResult {
  verdict: EvalVerdict;
  score?: number;
  reason?: string;
}

const DEFAULT_JUDGE_PROMPT = `You are an impartial evaluator. Rate the quality of the following AI response on a scale of 1 to 5, where:
1 = completely wrong or harmful
2 = mostly wrong with minor correct elements
3 = partially correct but missing important aspects
4 = mostly correct with minor issues
5 = fully correct and high quality

Task input: {INPUT}
Expected output: {EXPECTED}
Actual output: {ACTUAL}

Respond with ONLY a JSON object: {"score": <1-5>, "reason": "<one sentence explanation>"}`;

export async function score(
  config: ScorerConfig,
  input: string,
  actual: string,
  expected?: string,
  provider?: LLMProvider,
  model?: string,
): Promise<ScorerResult> {
  switch (config.type) {
    case "exact": {
      const pass = actual.trim() === (expected ?? "").trim();
      return {
        verdict: pass ? "pass" : "fail",
        reason: pass ? undefined : `Expected: ${expected}\nActual: ${actual}`,
      };
    }

    case "contains": {
      const missing = config.required.filter((s) => !actual.includes(s));
      return {
        verdict: missing.length === 0 ? "pass" : "fail",
        reason: missing.length > 0 ? `Missing: ${missing.join(", ")}` : undefined,
      };
    }

    case "regex": {
      try {
        const re = new RegExp(config.pattern, config.flags);
        const pass = re.test(actual);
        return {
          verdict: pass ? "pass" : "fail",
          reason: pass ? undefined : `Did not match /${config.pattern}/${config.flags ?? ""}`,
        };
      } catch (err) {
        return { verdict: "error", reason: `Invalid regex: ${String(err)}` };
      }
    }

    case "llm-judge": {
      if (!provider || !model) {
        return { verdict: "error", reason: "llm-judge scorer requires provider and model" };
      }
      const threshold = config.passThreshold ?? 3;
      const judgePrompt = (config.prompt ?? DEFAULT_JUDGE_PROMPT)
        .replace("{INPUT}", input)
        .replace("{EXPECTED}", expected ?? "(none)")
        .replace("{ACTUAL}", actual);

      try {
        const messages = [{ role: "user" as const, content: judgePrompt }];
        let fullResponse = "";
        for await (const chunk of provider.stream({ model, messages })) {
          if (chunk.type === "response.delta") fullResponse += chunk.text;
          if (chunk.type === "response.completed") break;
        }
        const parsed = JSON.parse(fullResponse.trim()) as { score: number; reason: string };
        const pass = parsed.score >= threshold;
        return { verdict: pass ? "pass" : "fail", score: parsed.score, reason: parsed.reason };
      } catch (err) {
        return { verdict: "error", reason: `Judge error: ${String(err)}` };
      }
    }
  }
}
