import { describe, expect, it } from "vitest";
import { computeWaves } from "../src/swarm/graph-executor.js";
import type { SwarmAgent } from "../src/swarm/types.js";

function makeAgent(
  name: string,
  overrides: Partial<SwarmAgent> = {},
): SwarmAgent {
  return {
    name,
    description: `Agent ${name}`,
    systemPrompt: `You are ${name}`,
    tools: [],
    handoffDestinations: [],
    contextMode: "filtered",
    maxRounds: 10,
    ...overrides,
  };
}

describe("computeWaves", () => {
  it("returns single wave for agents with no dependencies", () => {
    const agents = [makeAgent("a"), makeAgent("b"), makeAgent("c")];
    const waves = computeWaves(agents);
    expect(waves).toHaveLength(1);
    expect(waves[0].map((a) => a.name).sort()).toEqual(["a", "b", "c"]);
  });

  it("returns sequential waves for a linear chain", () => {
    const agents = [
      makeAgent("a"),
      makeAgent("b", { dependsOn: ["a"] }),
      makeAgent("c", { dependsOn: ["b"] }),
    ];
    const waves = computeWaves(agents);
    expect(waves).toHaveLength(3);
    expect(waves[0].map((a) => a.name)).toEqual(["a"]);
    expect(waves[1].map((a) => a.name)).toEqual(["b"]);
    expect(waves[2].map((a) => a.name)).toEqual(["c"]);
  });

  it("groups independent agents into the same wave", () => {
    // researcher-a and researcher-b both have no deps → wave 0
    // synthesizer depends on both → wave 1
    const agents = [
      makeAgent("researcher-a"),
      makeAgent("researcher-b"),
      makeAgent("synthesizer", { dependsOn: ["researcher-a", "researcher-b"] }),
    ];
    const waves = computeWaves(agents);
    expect(waves).toHaveLength(2);
    expect(waves[0].map((a) => a.name).sort()).toEqual(["researcher-a", "researcher-b"]);
    expect(waves[1].map((a) => a.name)).toEqual(["synthesizer"]);
  });

  it("handles diamond dependency (A→B, A→C, B+C→D)", () => {
    const agents = [
      makeAgent("A"),
      makeAgent("B", { dependsOn: ["A"] }),
      makeAgent("C", { dependsOn: ["A"] }),
      makeAgent("D", { dependsOn: ["B", "C"] }),
    ];
    const waves = computeWaves(agents);
    expect(waves).toHaveLength(3);
    expect(waves[0].map((a) => a.name)).toEqual(["A"]);
    expect(waves[1].map((a) => a.name).sort()).toEqual(["B", "C"]);
    expect(waves[2].map((a) => a.name)).toEqual(["D"]);
  });

  it("throws on circular dependencies", () => {
    const agents = [
      makeAgent("a", { dependsOn: ["b"] }),
      makeAgent("b", { dependsOn: ["a"] }),
    ];
    expect(() => computeWaves(agents)).toThrow(/[Cc]ircular/);
  });

  it("throws on unknown dependency reference", () => {
    const agents = [makeAgent("a", { dependsOn: ["nonexistent"] })];
    expect(() => computeWaves(agents)).toThrow(/unknown agent/);
  });

  it("returns empty waves for empty input", () => {
    expect(computeWaves([])).toEqual([]);
  });

  it("handles a single agent", () => {
    const waves = computeWaves([makeAgent("solo")]);
    expect(waves).toHaveLength(1);
    expect(waves[0][0].name).toBe("solo");
  });
});

describe("graph executor safety validation", () => {
  it("auto_edit agents are unsafe in parallel waves — verify via wave structure", () => {
    // The actual HITL safety check happens in runSwarmGraph at runtime.
    // We verify here that auto_edit agents CAN be placed in solo waves via
    // dependsOn and that computeWaves itself does not reject them.
    const agents = [
      makeAgent("researcher", { permissionMode: "full_auto" }),
      // auto_edit agent is alone in its wave (depends on researcher)
      makeAgent("builder", { permissionMode: "auto_edit", dependsOn: ["researcher"] }),
    ];
    const waves = computeWaves(agents);
    expect(waves).toHaveLength(2);
    // wave 1 has only the auto_edit agent — safe (single-agent wave)
    expect(waves[1]).toHaveLength(1);
    expect(waves[1][0].name).toBe("builder");
  });
});

describe("buildGraphSwarm integration", () => {
  it("produces a SwarmConfig with executionModel graph", async () => {
    const { buildGraphSwarm } = await import("../src/swarm/graph-executor.js");
    const mockProvider = {} as import("../src/llm/provider.js").LLMProvider;

    const config = buildGraphSwarm({
      task: "test task",
      provider: mockProvider,
      modelName: "test-model",
      agents: [
        { name: "agent-a", description: "A", systemPrompt: "You are A" },
        { name: "agent-b", description: "B", systemPrompt: "You are B", dependsOn: ["agent-a"] },
      ],
    });

    expect(config.executionModel).toBe("graph");
    expect(config.agents).toHaveLength(2);
    expect(config.agents[1].dependsOn).toEqual(["agent-a"]);
  });
});
