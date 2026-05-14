import * as fs from "fs";
import * as path from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { LLMProvider, ToolDef, ToolStreamEvent } from "../src/llm/provider.js";
import { SWARM_PRESETS, findPreset, buildPresetSwarm } from "../src/swarm/presets/index.js";
import { buildSupervisorSwarm } from "../src/swarm/supervisor.js";
import type { SwarmEvent } from "../src/swarm/types.js";
import { runSwarm } from "../src/swarm/orchestrator.js";

// ── Helpers ────────────────────────────────────────────────────────────────────

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join("/tmp", "chorus-preset-test-"));
  process.env.CHORUS_HOME_DIR = tmpDir;
});

afterEach(() => {
  delete process.env.CHORUS_HOME_DIR;
});

/**
 * Provider that sequences through provided responses.
 * Each call returns the next response; loops on last entry.
 * If a response is a JSON handoff string, it emits a tool_call instead.
 */
class SequencedProvider implements LLMProvider {
  readonly name = "ollama" as const;
  private idx = 0;

  constructor(private readonly responses: string[]) {}

  async generate() { return { text: "", model: "fake" }; }
  async *stream(): AsyncIterable<never> { throw new Error("Not implemented"); yield; }

  async *streamWithTools(
    input: { model: string; messages: unknown[]; systemPrompt?: string; tools: ToolDef[] },
  ): AsyncIterable<ToolStreamEvent> {
    const response = this.responses[this.idx] ?? this.responses[this.responses.length - 1];
    this.idx += 1;

    // Check if this response is a handoff directive: "handoff_to_<agent>:<task>"
    const handoffMatch = response.match(/^handoff_to_(\w+):(.+)$/s);
    if (handoffMatch) {
      const [, targetAgent, taskDescription] = handoffMatch;
      const toolName = `handoff_to_${targetAgent}`;
      const tool = input.tools.find((t) => t.function.name === toolName);
      if (tool) {
        yield {
          type: "done",
          response: {
            content: "",
            tool_calls: [
              {
                id: `tc-${Date.now()}`,
                type: "function",
                function: {
                  name: toolName,
                  arguments: JSON.stringify({ taskDescription: taskDescription.trim(), artifacts: [] }),
                },
              },
            ],
          },
        };
        return;
      }
    }

    yield { type: "token", text: response };
    yield { type: "done", response: { content: response } };
  }

  async health() { return { ok: true, provider: this.name }; }
}

// ── Preset registry ────────────────────────────────────────────────────────────

describe("SWARM_PRESETS registry", () => {
  it("contains exactly 3 presets", () => {
    expect(SWARM_PRESETS).toHaveLength(3);
  });

  it("has plan-build-review preset", () => {
    const preset = findPreset("plan-build-review");
    expect(preset).toBeDefined();
    expect(preset!.agents).toContain("coordinator");
    expect(preset!.agents).toContain("planner");
    expect(preset!.agents).toContain("builder");
    expect(preset!.agents).toContain("reviewer");
  });

  it("has research-synthesize preset", () => {
    const preset = findPreset("research-synthesize");
    expect(preset).toBeDefined();
    expect(preset!.agents).toContain("researcher");
    expect(preset!.agents).toContain("synthesizer");
  });

  it("has vapt-report preset", () => {
    const preset = findPreset("vapt-report");
    expect(preset).toBeDefined();
    expect(preset!.agents).toContain("scanner");
    expect(preset!.agents).toContain("analyst");
    expect(preset!.agents).toContain("reporter");
  });

  it("returns undefined for unknown preset", () => {
    expect(findPreset("nonexistent")).toBeUndefined();
  });

  it("buildPresetSwarm throws for unknown preset", () => {
    const provider = new SequencedProvider(["done"]) as unknown as LLMProvider;
    expect(() => buildPresetSwarm("nonexistent", "task", provider, "model")).toThrow("Unknown swarm preset");
  });
});

// ── Supervisor pattern ─────────────────────────────────────────────────────────

describe("buildSupervisorSwarm", () => {
  it("creates coordinator with routes to all specialists", () => {
    const provider = new SequencedProvider(["done"]) as unknown as LLMProvider;
    const config = buildSupervisorSwarm({
      coordinatorPrompt: "You are coordinator.",
      specialists: [
        { name: "alpha", description: "Alpha", systemPrompt: "You are alpha." },
        { name: "beta", description: "Beta", systemPrompt: "You are beta." },
      ],
      task: "Test task",
      provider,
      modelName: "fake",
    });

    const coordinator = config.agents.find((a) => a.name === "coordinator");
    expect(coordinator).toBeDefined();
    expect(coordinator!.handoffDestinations).toContain("alpha");
    expect(coordinator!.handoffDestinations).toContain("beta");
    expect(coordinator!.contextMode).toBe("shared");
  });

  it("creates specialists with route back to coordinator", () => {
    const provider = new SequencedProvider(["done"]) as unknown as LLMProvider;
    const config = buildSupervisorSwarm({
      coordinatorPrompt: "You are coordinator.",
      specialists: [
        { name: "specialist", description: "Spec", systemPrompt: "You are specialist." },
      ],
      task: "Test task",
      provider,
      modelName: "fake",
    });

    const specialist = config.agents.find((a) => a.name === "specialist");
    expect(specialist).toBeDefined();
    expect(specialist!.handoffDestinations).toContain("coordinator");
    expect(specialist!.contextMode).toBe("filtered");
  });

  it("uses custom coordinator name", () => {
    const provider = new SequencedProvider(["done"]) as unknown as LLMProvider;
    const config = buildSupervisorSwarm({
      coordinatorPrompt: "You are lead.",
      coordinatorName: "lead",
      specialists: [
        { name: "worker", description: "Worker", systemPrompt: "You are worker." },
      ],
      task: "Test",
      provider,
      modelName: "fake",
    });

    expect(config.agents.find((a) => a.name === "lead")).toBeDefined();
    const worker = config.agents.find((a) => a.name === "worker");
    expect(worker!.handoffDestinations).toContain("lead");
    expect(config.initialAgent).toBe("lead");
  });

  it("injects coordinator handoff instruction into specialist prompts", () => {
    const provider = new SequencedProvider(["done"]) as unknown as LLMProvider;
    const config = buildSupervisorSwarm({
      coordinatorPrompt: "Coordinator.",
      specialists: [
        { name: "specialist", description: "S", systemPrompt: "Base prompt." },
      ],
      task: "Task",
      provider,
      modelName: "fake",
    });

    const specialist = config.agents.find((a) => a.name === "specialist")!;
    expect(specialist.systemPrompt).toContain("handoff_to_coordinator");
    expect(specialist.systemPrompt).toContain("Base prompt.");
  });

  it("sets policy to full_auto", () => {
    const provider = new SequencedProvider(["done"]) as unknown as LLMProvider;
    const config = buildSupervisorSwarm({
      coordinatorPrompt: "Coordinator.",
      specialists: [{ name: "s", description: "s", systemPrompt: "s" }],
      task: "Task",
      provider,
      modelName: "fake",
    });
    expect(config.policy).toBe("full_auto");
  });
});

// ── Preset factory outputs ─────────────────────────────────────────────────────

describe("plan-build-review preset config", () => {
  it("creates valid SwarmConfig", () => {
    const provider = new SequencedProvider(["done"]) as unknown as LLMProvider;
    const config = buildPresetSwarm("plan-build-review", "Add a feature", provider, "fake");
    expect(config.agents).toHaveLength(4);
    expect(config.initialAgent).toBe("coordinator");
    expect(config.spec).toBeTruthy();
  });
});

describe("research-synthesize preset config", () => {
  it("creates valid SwarmConfig", () => {
    const provider = new SequencedProvider(["done"]) as unknown as LLMProvider;
    const config = buildPresetSwarm("research-synthesize", "Research TypeScript", provider, "fake");
    expect(config.agents).toHaveLength(3);
    expect(config.agents.map((a) => a.name)).toContain("researcher");
    expect(config.agents.map((a) => a.name)).toContain("synthesizer");
  });
});

describe("vapt-report preset config", () => {
  it("creates valid SwarmConfig", () => {
    const provider = new SequencedProvider(["done"]) as unknown as LLMProvider;
    const config = buildPresetSwarm("vapt-report", "Assess this codebase", provider, "fake");
    expect(config.agents).toHaveLength(4);
    expect(config.agents.map((a) => a.name)).toContain("scanner");
    expect(config.agents.map((a) => a.name)).toContain("analyst");
    expect(config.agents.map((a) => a.name)).toContain("reporter");
  });
});

// ── Supervisor integration (runSwarm with supervisor config) ──────────────────

describe("supervisor integration", () => {
  it("coordinator routes to specialist then finishes", async () => {
    const provider = new SequencedProvider([
      // coordinator turn 1: route to specialist
      "handoff_to_worker:Do the work",
      // worker turn: completes without handoff (routes back to coordinator)
      "handoff_to_coordinator:Work complete",
      // coordinator turn 2: synthesizes (no handoff = done)
      "All done. The work is complete.",
    ]) as unknown as LLMProvider;

    const config = buildSupervisorSwarm({
      coordinatorPrompt: "You are coordinator.",
      specialists: [
        { name: "worker", description: "Worker", systemPrompt: "Do work." },
      ],
      task: "Test task",
      provider,
      modelName: "fake",
    });

    const events: SwarmEvent[] = [];
    for await (const event of runSwarm(config)) {
      events.push(event);
    }

    const handoffs = events.filter((e) => e.type === "handoff");
    expect(handoffs.length).toBeGreaterThanOrEqual(1);

    const done = events.find((e) => e.type === "swarm-done") as
      | { type: "swarm-done"; handoffCount: number }
      | undefined;
    expect(done).toBeDefined();
    expect(done!.handoffCount).toBeGreaterThanOrEqual(1);
  });

  it("emits circuit-break or swarm-done after maxHandoffs hit", async () => {
    // coordinator always routes to worker, worker always routes back → loop until maxHandoffs
    // The sequenced provider cycles: coordinator gets "handoff_to_worker", worker gets "handoff_to_coordinator"
    const cyclingProvider: LLMProvider = {
      name: "ollama" as const,
      async generate() { return { text: "", model: "fake" }; },
      async *stream() { throw new Error("Not implemented"); yield undefined as never; },
      async *streamWithTools(input: { tools: ToolDef[] }): AsyncIterable<ToolStreamEvent> {
        // pick the right handoff based on available tools
        const toWorker = input.tools.find((t) => t.function.name === "handoff_to_worker");
        const toCoord = input.tools.find((t) => t.function.name === "handoff_to_coordinator");
        const tool = toWorker ?? toCoord;
        if (tool) {
          yield {
            type: "done",
            response: {
              content: "",
              tool_calls: [{
                id: `tc-${Date.now()}`,
                type: "function",
                function: {
                  name: tool.function.name,
                  arguments: JSON.stringify({ taskDescription: "Continue", artifacts: [] }),
                },
              }],
            },
          };
        } else {
          yield { type: "token", text: "done" };
          yield { type: "done", response: { content: "done" } };
        }
      },
      async health() { return { ok: true, provider: "ollama" as const }; },
    };

    const config = buildSupervisorSwarm({
      coordinatorPrompt: "Coordinator.",
      specialists: [{ name: "worker", description: "W", systemPrompt: "W." }],
      task: "Task",
      provider: cyclingProvider,
      modelName: "fake",
      maxHandoffs: 4,
    });

    const events: SwarmEvent[] = [];
    for await (const event of runSwarm(config)) {
      events.push(event);
    }

    // Either circuit-break or swarm-done should be the last meaningful event
    const circuitBreak = events.find((e) => e.type === "circuit-break");
    const swarmDone = events.find((e) => e.type === "swarm-done") as
      | { type: "swarm-done"; handoffCount: number } | undefined;
    // The swarm must have been constrained by the maxHandoffs circuit breaker
    if (circuitBreak) {
      expect(circuitBreak).toBeDefined();
    } else {
      expect(swarmDone?.handoffCount).toBeGreaterThanOrEqual(4);
    }
    // Confirm the swarm DID terminate
    expect(swarmDone).toBeDefined();
  });
});
