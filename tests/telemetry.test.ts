import { describe, it, expect } from "vitest";
import { swarmEventsToSpans } from "../src/telemetry/bridge.js";
import { attr, toNanos } from "../src/telemetry/exporter.js";
import type { SwarmEvent } from "../src/swarm/types.js";

type TimedEvent = SwarmEvent & { ts: number };

function ts(offset = 0): number {
  return 1_000_000 + offset;
}

function sampleEvents(swarmId: string): TimedEvent[] {
  return [
    { type: "swarm-start", swarmId, agents: ["a", "b"], ts: ts(0) },
    { type: "wave-start", wave: 0, agents: ["a", "b"], ts: ts(10) },
    { type: "agent-start", agent: "a", traceId: "t1", contextMode: "filtered", ts: ts(20) },
    { type: "agent-start", agent: "b", traceId: "t2", contextMode: "filtered", ts: ts(20) },
    {
      type: "agent-done", agent: "a", responseText: "done",
      metrics: { inputTokens: 100, outputTokens: 50, costUsd: 0.01, durationMs: 500, rounds: 1, toolCalls: 0 },
      ts: ts(520),
    },
    {
      type: "agent-done", agent: "b", responseText: "done",
      metrics: { inputTokens: 200, outputTokens: 80, costUsd: 0.02, durationMs: 700, rounds: 2, toolCalls: 1 },
      ts: ts(720),
    },
    { type: "wave-done", wave: 0, agents: ["a", "b"], artifacts: [], ts: ts(730) },
    {
      type: "swarm-done", swarmId, handoffCount: 0, totalAgentRounds: 3,
      totalInputTokens: 300, totalOutputTokens: 130, totalCostUsd: 0.03, durationMs: 730,
      ts: ts(730),
    },
  ];
}

describe("swarmEventsToSpans", () => {
  it("returns empty array for empty events", () => {
    expect(swarmEventsToSpans([])).toEqual([]);
  });

  it("creates a root swarm span", () => {
    const spans = swarmEventsToSpans(sampleEvents("s1"));
    const root = spans.find((s) => s.name.startsWith("swarm "));
    expect(root).toBeDefined();
    expect(root!.name).toBe("swarm s1");
    expect(root!.status.code).toBe(1);
    expect(root!.parentSpanId).toBeUndefined();
  });

  it("creates wave spans as children of the root", () => {
    const spans = swarmEventsToSpans(sampleEvents("s1"));
    const root = spans.find((s) => s.name.startsWith("swarm "))!;
    const wave = spans.find((s) => s.name === "wave 0")!;
    expect(wave.parentSpanId).toBe(root.spanId);
  });

  it("creates agent spans for each agent", () => {
    const spans = swarmEventsToSpans(sampleEvents("s1"));
    const agentA = spans.find((s) => s.name === "agent a");
    const agentB = spans.find((s) => s.name === "agent b");
    expect(agentA).toBeDefined();
    expect(agentB).toBeDefined();
  });

  it("agent spans carry cost attributes", () => {
    const spans = swarmEventsToSpans(sampleEvents("s1"));
    const agentA = spans.find((s) => s.name === "agent a")!;
    const costAttr = agentA.attributes.find((a) => a.key === "chorus.cost_usd");
    expect(costAttr?.value).toMatchObject({ doubleValue: 0.01 });
  });

  it("circuit-break creates a span with ERROR status", () => {
    const events: TimedEvent[] = [
      { type: "swarm-start", swarmId: "s2", agents: ["x"], ts: ts(0) },
      { type: "wave-start", wave: 0, agents: ["x"], ts: ts(5) },
      { type: "agent-start", agent: "x", traceId: "t", contextMode: "filtered", ts: ts(10) },
      { type: "circuit-break", agent: "x", reason: "Over budget", ts: ts(100) },
    ];
    const spans = swarmEventsToSpans(events);
    const broken = spans.find((s) => s.name.includes("circuit-broken"));
    expect(broken).toBeDefined();
    expect(broken!.status.code).toBe(2);
    const reasonAttr = broken!.attributes.find((a) => a.key === "chorus.failure_reason");
    expect(reasonAttr?.value).toMatchObject({ stringValue: "Over budget" });
  });

  it("all spans share the same traceId", () => {
    const spans = swarmEventsToSpans(sampleEvents("s1"));
    const traceIds = new Set(spans.map((s) => s.traceId));
    expect(traceIds.size).toBe(1);
  });
});

describe("attr helper", () => {
  it("creates string attribute", () => {
    const a = attr("k", "v");
    expect(a.value).toMatchObject({ stringValue: "v" });
  });

  it("creates integer attribute", () => {
    const a = attr("k", 42);
    expect(a.value).toMatchObject({ intValue: "42" });
  });

  it("creates boolean attribute", () => {
    const a = attr("k", true);
    expect(a.value).toMatchObject({ boolValue: true });
  });

  it("creates double attribute for non-integer numbers", () => {
    const a = attr("k", 3.14);
    expect(a.value).toMatchObject({ doubleValue: 3.14 });
  });
});

describe("toNanos", () => {
  it("converts ms to nanoseconds string", () => {
    expect(toNanos(1000)).toBe("1000000000");
    expect(toNanos(0)).toBe("0");
  });
});
