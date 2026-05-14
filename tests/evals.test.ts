import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { score } from "../src/evals/scorer.js";
import {
  saveEvalSuite,
  loadEvalSuite,
  listEvalSuites,
  deleteEvalSuite,
  saveEvalRun,
  loadEvalRun,
  listEvalRuns,
} from "../src/evals/storage.js";
import { formatEvalRun } from "../src/evals/runner.js";
import type { EvalSuite, EvalRun } from "../src/evals/types.js";

// ─── Scorer tests ─────────────────────────────────────────────────────────────

describe("score — exact", () => {
  it("passes when trimmed outputs match", async () => {
    const r = await score({ type: "exact" }, "q", "  hello  ", "hello");
    expect(r.verdict).toBe("pass");
  });

  it("fails when outputs differ", async () => {
    const r = await score({ type: "exact" }, "q", "hello", "world");
    expect(r.verdict).toBe("fail");
    expect(r.reason).toContain("Expected");
  });
});

describe("score — contains", () => {
  it("passes when all required strings are present", async () => {
    const r = await score(
      { type: "contains", required: ["foo", "bar"] },
      "q",
      "The foo and bar are here",
    );
    expect(r.verdict).toBe("pass");
  });

  it("fails when a required string is missing", async () => {
    const r = await score(
      { type: "contains", required: ["foo", "baz"] },
      "q",
      "Only foo here",
    );
    expect(r.verdict).toBe("fail");
    expect(r.reason).toContain("baz");
  });
});

describe("score — regex", () => {
  it("passes when pattern matches", async () => {
    const r = await score({ type: "regex", pattern: "^[A-Z]" }, "q", "Hello world");
    expect(r.verdict).toBe("pass");
  });

  it("fails when pattern does not match", async () => {
    const r = await score({ type: "regex", pattern: "^[A-Z]" }, "q", "hello world");
    expect(r.verdict).toBe("fail");
  });

  it("returns error for invalid regex", async () => {
    const r = await score({ type: "regex", pattern: "[invalid" }, "q", "test");
    expect(r.verdict).toBe("error");
    expect(r.reason).toContain("Invalid regex");
  });
});

describe("score — llm-judge without provider", () => {
  it("returns error when provider is missing", async () => {
    const r = await score({ type: "llm-judge" }, "q", "some output");
    expect(r.verdict).toBe("error");
    expect(r.reason).toContain("provider");
  });
});

// ─── Storage tests ────────────────────────────────────────────────────────────

describe("eval storage", () => {
  let tmpHome: string;
  let origHome: string | undefined;

  const setup = () => {
    tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "chorus-eval-test-"));
    origHome = process.env.CHORUS_HOME_DIR;
    process.env.CHORUS_HOME_DIR = tmpHome;
  };

  const teardown = () => {
    if (origHome === undefined) delete process.env.CHORUS_HOME_DIR;
    else process.env.CHORUS_HOME_DIR = origHome;
    fs.rmSync(tmpHome, { recursive: true, force: true });
  };

  const sampleSuite = (): EvalSuite => ({
    name: "my-suite",
    cases: [
      { id: "case-1", input: "What is 2+2?", expectedOutput: "4" },
    ],
    scorer: { type: "exact" },
    passThreshold: 1.0,
  });

  it("saves and loads a suite", () => {
    setup();
    try {
      saveEvalSuite(sampleSuite());
      const loaded = loadEvalSuite("my-suite");
      expect(loaded).not.toBeNull();
      expect(loaded!.name).toBe("my-suite");
      expect(loaded!.cases).toHaveLength(1);
    } finally { teardown(); }
  });

  it("lists suites", () => {
    setup();
    try {
      saveEvalSuite(sampleSuite());
      saveEvalSuite({ ...sampleSuite(), name: "suite-b" });
      const names = listEvalSuites();
      expect(names).toContain("my-suite");
      expect(names).toContain("suite-b");
    } finally { teardown(); }
  });

  it("deletes a suite", () => {
    setup();
    try {
      saveEvalSuite(sampleSuite());
      deleteEvalSuite("my-suite");
      expect(loadEvalSuite("my-suite")).toBeNull();
    } finally { teardown(); }
  });

  it("returns null for missing suite", () => {
    setup();
    try {
      expect(loadEvalSuite("no-such-suite")).toBeNull();
    } finally { teardown(); }
  });

  it("saves and loads a run", () => {
    setup();
    try {
      const run: EvalRun = {
        runId: "eval-12345",
        suiteName: "my-suite",
        startedAt: Date.now(),
        completedAt: Date.now() + 1000,
        results: [
          {
            caseId: "case-1",
            input: "q",
            actualOutput: "4",
            verdict: "pass",
            durationMs: 100,
            inputTokens: 10,
            outputTokens: 5,
            costUsd: 0.001,
          },
        ],
        passCount: 1,
        failCount: 0,
        errorCount: 0,
        passRate: 1.0,
        passed: true,
        totalInputTokens: 10,
        totalOutputTokens: 5,
        totalCostUsd: 0.001,
        durationMs: 1000,
      };
      saveEvalRun(run);
      const loaded = loadEvalRun("eval-12345");
      expect(loaded!.runId).toBe("eval-12345");
      expect(loaded!.passRate).toBe(1.0);
    } finally { teardown(); }
  });

  it("lists runs filtered by suite name", () => {
    setup();
    try {
      const base: EvalRun = {
        runId: "r1",
        suiteName: "suite-a",
        startedAt: Date.now(),
        completedAt: Date.now(),
        results: [],
        passCount: 0,
        failCount: 0,
        errorCount: 0,
        passRate: 1,
        passed: true,
        totalInputTokens: 0,
        totalOutputTokens: 0,
        totalCostUsd: 0,
        durationMs: 0,
      };
      saveEvalRun(base);
      saveEvalRun({ ...base, runId: "r2", suiteName: "suite-b" });

      const aRuns = listEvalRuns("suite-a");
      expect(aRuns).toHaveLength(1);
      expect(aRuns[0].runId).toBe("r1");
    } finally { teardown(); }
  });
});

// ─── Format tests ─────────────────────────────────────────────────────────────

describe("formatEvalRun", () => {
  it("includes suite name and pass rate", () => {
    const run: EvalRun = {
      runId: "test-run",
      suiteName: "smoke-test",
      startedAt: Date.now(),
      completedAt: Date.now() + 500,
      results: [
        { caseId: "c1", input: "q", actualOutput: "a", verdict: "pass", durationMs: 100, inputTokens: 5, outputTokens: 2, costUsd: 0 },
        { caseId: "c2", input: "q", actualOutput: "b", verdict: "fail", reason: "wrong answer", durationMs: 100, inputTokens: 5, outputTokens: 2, costUsd: 0 },
      ],
      passCount: 1,
      failCount: 1,
      errorCount: 0,
      passRate: 0.5,
      passed: false,
      totalInputTokens: 10,
      totalOutputTokens: 4,
      totalCostUsd: 0,
      durationMs: 500,
    };

    const text = formatEvalRun(run);
    expect(text).toContain("smoke-test");
    expect(text).toContain("FAILED");
    expect(text).toContain("50.0%");
    expect(text).toContain("wrong answer");
    expect(text).toContain("✓");
    expect(text).toContain("✗");
  });
});
