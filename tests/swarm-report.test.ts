import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildSwarmReport, formatSwarmReport, listSwarmTraces } from "../src/swarm/report.js";
import type { SwarmEvent } from "../src/swarm/types.js";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeEvent(event: SwarmEvent & { ts?: number }): string {
  return JSON.stringify({ ts: Date.now(), ...event });
}

function writeTrace(dir: string, swarmId: string, events: SwarmEvent[]): void {
  const tracesDir = path.join(dir, "swarm-traces");
  fs.mkdirSync(tracesDir, { recursive: true });
  const lines = events.map((e) => makeEvent(e));
  fs.writeFileSync(path.join(tracesDir, `${swarmId}.jsonl`), lines.join("\n") + "\n", "utf-8");
}

function sampleGraphEvents(swarmId: string): SwarmEvent[] {
  return [
    { type: "swarm-start", swarmId, agents: ["researcher-a", "researcher-b", "synthesizer"] },
    { type: "wave-start", wave: 0, agents: ["researcher-a", "researcher-b"] },
    { type: "agent-start", agent: "researcher-a", traceId: "t1", contextMode: "filtered" },
    { type: "agent-start", agent: "researcher-b", traceId: "t2", contextMode: "filtered" },
    {
      type: "agent-done",
      agent: "researcher-a",
      responseText: "Research A done",
      metrics: { inputTokens: 1000, outputTokens: 500, costUsd: 0.01, durationMs: 2000, rounds: 2, toolCalls: 3 },
    },
    {
      type: "agent-done",
      agent: "researcher-b",
      responseText: "Research B done",
      metrics: { inputTokens: 1200, outputTokens: 600, costUsd: 0.012, durationMs: 2200, rounds: 2, toolCalls: 4 },
    },
    { type: "wave-done", wave: 0, agents: ["researcher-a", "researcher-b"], artifacts: [] },
    { type: "wave-start", wave: 1, agents: ["synthesizer"] },
    { type: "agent-start", agent: "synthesizer", traceId: "t3", contextMode: "filtered" },
    {
      type: "agent-done",
      agent: "synthesizer",
      responseText: "Synthesis done",
      metrics: { inputTokens: 2000, outputTokens: 800, costUsd: 0.02, durationMs: 3000, rounds: 3, toolCalls: 2 },
    },
    { type: "wave-done", wave: 1, agents: ["synthesizer"], artifacts: ["synthesis"] },
    {
      type: "swarm-done",
      swarmId,
      handoffCount: 0,
      totalAgentRounds: 7,
      totalInputTokens: 4200,
      totalOutputTokens: 1900,
      totalCostUsd: 0.042,
      durationMs: 7200,
    },
  ];
}

// ─── Test Suite ───────────────────────────────────────────────────────────────

describe("buildSwarmReport", () => {
  let tmpHome: string;
  let originalChorusHome: string | undefined;

  beforeEach(() => {
    tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "chorus-report-test-"));
    originalChorusHome = process.env.CHORUS_HOME_DIR;
    process.env.CHORUS_HOME_DIR = tmpHome;
  });

  afterEach(() => {
    if (originalChorusHome === undefined) {
      delete process.env.CHORUS_HOME_DIR;
    } else {
      process.env.CHORUS_HOME_DIR = originalChorusHome;
    }
    fs.rmSync(tmpHome, { recursive: true, force: true });
  });

  it("returns null for a non-existent swarm", () => {
    expect(buildSwarmReport("does-not-exist")).toBeNull();
  });

  it("parses a complete graph swarm trace", () => {
    const swarmId = "swarm-graph-test-1";
    writeTrace(tmpHome, swarmId, sampleGraphEvents(swarmId));

    const report = buildSwarmReport(swarmId);
    expect(report).not.toBeNull();
    expect(report!.swarmId).toBe(swarmId);
    expect(report!.status).toBe("done");
    expect(report!.durationMs).toBe(7200);
    expect(report!.totalInputTokens).toBe(4200);
    expect(report!.totalOutputTokens).toBe(1900);
    expect(report!.totalCostUsd).toBeCloseTo(0.042, 5);
  });

  it("includes all three agents with correct metrics", () => {
    const swarmId = "swarm-agents-test";
    writeTrace(tmpHome, swarmId, sampleGraphEvents(swarmId));

    const report = buildSwarmReport(swarmId)!;
    expect(report.agents).toHaveLength(3);

    const a = report.agents.find((x) => x.name === "researcher-a")!;
    expect(a.status).toBe("done");
    expect(a.metrics.inputTokens).toBe(1000);
    expect(a.metrics.toolCalls).toBe(3);

    const s = report.agents.find((x) => x.name === "synthesizer")!;
    expect(s.metrics.rounds).toBe(3);
  });

  it("extracts wave structure", () => {
    const swarmId = "swarm-waves-test";
    writeTrace(tmpHome, swarmId, sampleGraphEvents(swarmId));

    const report = buildSwarmReport(swarmId)!;
    expect(report.waves).toHaveLength(2);
    expect(report.waves[0].sort()).toEqual(["researcher-a", "researcher-b"]);
    expect(report.waves[1]).toEqual(["synthesizer"]);
  });

  it("collects circuit-break failures", () => {
    const swarmId = "swarm-fail-test";
    const events: SwarmEvent[] = [
      { type: "swarm-start", swarmId, agents: ["agent-a"] },
      { type: "wave-start", wave: 0, agents: ["agent-a"] },
      { type: "agent-start", agent: "agent-a", traceId: "t1", contextMode: "filtered" },
      { type: "circuit-break", agent: "agent-a", reason: "Something went wrong" },
    ];
    writeTrace(tmpHome, swarmId, events);

    const report = buildSwarmReport(swarmId)!;
    expect(report.status).toBe("failed");
    expect(report.failures).toHaveLength(1);
    expect(report.failures[0].type).toBe("circuit-break");
    expect(report.failures[0].agent).toBe("agent-a");
    expect(report.failures[0].reason).toContain("Something went wrong");
  });

  it("collects artifact-missing failures", () => {
    const swarmId = "swarm-artifact-fail";
    const events: SwarmEvent[] = [
      { type: "swarm-start", swarmId, agents: ["writer"] },
      { type: "wave-start", wave: 0, agents: ["writer"] },
      { type: "agent-start", agent: "writer", traceId: "t1", contextMode: "filtered" },
      { type: "artifact-missing", agent: "writer", key: "final-report" },
      { type: "circuit-break", agent: "writer", reason: `Required artifact "final-report" was not produced by agent "writer".` },
    ];
    writeTrace(tmpHome, swarmId, events);

    const report = buildSwarmReport(swarmId)!;
    const missing = report.failures.find((f) => f.type === "artifact-missing");
    expect(missing).toBeDefined();
    expect(missing!.reason).toContain("final-report");
  });

  it("produces a DAG text containing wave labels", () => {
    const swarmId = "swarm-dag-test";
    writeTrace(tmpHome, swarmId, sampleGraphEvents(swarmId));

    const report = buildSwarmReport(swarmId)!;
    expect(report.dagText).toContain("Wave 0");
    expect(report.dagText).toContain("Wave 1");
    expect(report.dagText).toContain("researcher-a");
    expect(report.dagText).toContain("synthesizer");
  });

  it("produces a cost table with agent names and totals", () => {
    const swarmId = "swarm-cost-table";
    writeTrace(tmpHome, swarmId, sampleGraphEvents(swarmId));

    const report = buildSwarmReport(swarmId)!;
    expect(report.costTable).toContain("researcher-a");
    expect(report.costTable).toContain("synthesizer");
    expect(report.costTable).toContain("TOTAL");
  });

  it("handles corrupt lines in trace without crashing", () => {
    const tracesDir = path.join(tmpHome, "swarm-traces");
    fs.mkdirSync(tracesDir, { recursive: true });
    const content = [
      makeEvent({ type: "swarm-start", swarmId: "swarm-corrupt", agents: ["a"] }),
      "{ not valid json",
      makeEvent({ type: "swarm-done", swarmId: "swarm-corrupt", handoffCount: 0, totalAgentRounds: 1, totalInputTokens: 0, totalOutputTokens: 0, totalCostUsd: 0, durationMs: 100 }),
    ].join("\n");
    fs.writeFileSync(path.join(tracesDir, "swarm-corrupt.jsonl"), content, "utf-8");

    const report = buildSwarmReport("swarm-corrupt");
    expect(report).not.toBeNull();
    expect(report!.status).toBe("done");
  });
});

describe("formatSwarmReport", () => {
  let tmpHome: string;
  let originalChorusHome: string | undefined;

  beforeEach(() => {
    tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "chorus-fmt-test-"));
    originalChorusHome = process.env.CHORUS_HOME_DIR;
    process.env.CHORUS_HOME_DIR = tmpHome;
  });

  afterEach(() => {
    if (originalChorusHome === undefined) {
      delete process.env.CHORUS_HOME_DIR;
    } else {
      process.env.CHORUS_HOME_DIR = originalChorusHome;
    }
    fs.rmSync(tmpHome, { recursive: true, force: true });
  });

  it("produces a formatted string with all sections", () => {
    const swarmId = "swarm-fmt-test";
    writeTrace(tmpHome, swarmId, sampleGraphEvents(swarmId));

    const report = buildSwarmReport(swarmId)!;
    const text = formatSwarmReport(report);

    expect(text).toContain("Swarm Report:");
    expect(text).toContain("DAG Execution Graph");
    expect(text).toContain("Per-Agent Metrics");
    expect(text).toContain("DONE");
    expect(text).toContain("researcher-a");
  });

  it("includes Failures section when failures are present", () => {
    const swarmId = "swarm-fail-fmt";
    const events: SwarmEvent[] = [
      { type: "swarm-start", swarmId, agents: ["agent-x"] },
      { type: "wave-start", wave: 0, agents: ["agent-x"] },
      { type: "agent-start", agent: "agent-x", traceId: "t1", contextMode: "filtered" },
      { type: "circuit-break", agent: "agent-x", reason: "Out of context" },
    ];
    writeTrace(tmpHome, swarmId, events);

    const report = buildSwarmReport(swarmId)!;
    const text = formatSwarmReport(report);
    expect(text).toContain("Failures");
    expect(text).toContain("Out of context");
  });

  it("omits Failures section when no failures", () => {
    const swarmId = "swarm-ok-fmt";
    writeTrace(tmpHome, swarmId, sampleGraphEvents(swarmId));

    const report = buildSwarmReport(swarmId)!;
    const text = formatSwarmReport(report);
    expect(text).not.toContain("Failures");
  });
});

describe("listSwarmTraces", () => {
  let tmpHome: string;
  let originalChorusHome: string | undefined;

  beforeEach(() => {
    tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "chorus-list-test-"));
    originalChorusHome = process.env.CHORUS_HOME_DIR;
    process.env.CHORUS_HOME_DIR = tmpHome;
  });

  afterEach(() => {
    if (originalChorusHome === undefined) {
      delete process.env.CHORUS_HOME_DIR;
    } else {
      process.env.CHORUS_HOME_DIR = originalChorusHome;
    }
    fs.rmSync(tmpHome, { recursive: true, force: true });
  });

  it("returns empty array when no traces exist", () => {
    expect(listSwarmTraces()).toEqual([]);
  });

  it("returns swarm IDs from existing trace files", () => {
    const dir = path.join(tmpHome, "swarm-traces");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "swarm-aaa.jsonl"), "", "utf-8");
    fs.writeFileSync(path.join(dir, "swarm-bbb.jsonl"), "", "utf-8");

    const list = listSwarmTraces();
    expect(list).toContain("swarm-aaa");
    expect(list).toContain("swarm-bbb");
    expect(list).toHaveLength(2);
  });

  it("ignores non-jsonl files", () => {
    const dir = path.join(tmpHome, "swarm-traces");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "swarm-aaa.jsonl"), "", "utf-8");
    fs.writeFileSync(path.join(dir, "readme.txt"), "", "utf-8");

    expect(listSwarmTraces()).toEqual(["swarm-aaa"]);
  });
});
