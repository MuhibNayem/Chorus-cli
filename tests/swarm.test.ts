import * as fs from "fs";
import * as path from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { LLMProvider, ToolDef, ToolStreamEvent } from "../src/llm/provider.js";
import type { SwarmAgent, SwarmConfig, SwarmEvent } from "../src/swarm/types.js";
import { createSession, applyHandoff, createArtifactTools, broadcastToSharedState } from "../src/swarm/session.js";
import { checkCircuitBreaker } from "../src/swarm/circuit-breaker.js";
import { validateOutput } from "../src/swarm/validator.js";
import { SwarmTracer } from "../src/swarm/trace.js";
import { buildAgentContext, buildSystemPrompt, createHandoffTools, isHandoffResult } from "../src/swarm/handoff.js";
import { runSwarm } from "../src/swarm/orchestrator.js";

// ── Helpers ────────────────────────────────────────────────────────────────────

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join("/tmp", "chorus-swarm-test-"));
  process.env.CHORUS_HOME_DIR = tmpDir;
});

afterEach(() => {
  delete process.env.CHORUS_HOME_DIR;
});

function makeAgent(overrides: Partial<SwarmAgent> = {}): SwarmAgent {
  return {
    name: "alpha",
    description: "Test agent alpha",
    systemPrompt: "You are alpha.",
    tools: [],
    handoffDestinations: [],
    contextMode: "isolated",
    maxRounds: 5,
    ...overrides,
  };
}

function makeConfig(
  agents: SwarmAgent[],
  provider: LLMProvider,
  overrides: Partial<SwarmConfig> = {},
): SwarmConfig {
  return {
    agents,
    initialAgent: agents[0].name,
    task: "Do the thing",
    provider,
    modelName: "fake-model",
    ...overrides,
  };
}

class FakeProvider implements LLMProvider {
  readonly name = "ollama" as const;
  private readonly responses: string[];
  private callIndex = 0;

  constructor(responses: string[] = ["Done."]) {
    this.responses = responses;
  }

  async generate() {
    return { text: "", model: "fake" };
  }
  async *stream(): AsyncIterable<never> {
    throw new Error("Not implemented");
    yield;
  }
  async *streamWithTools(
    _input: { model: string; messages: unknown[]; systemPrompt?: string; tools: ToolDef[] },
  ): AsyncIterable<ToolStreamEvent> {
    const text = this.responses[this.callIndex] ?? this.responses[this.responses.length - 1];
    this.callIndex += 1;
    yield { type: "token", text };
    yield { type: "done", response: { content: text } };
  }
  async health() {
    return { ok: true, provider: this.name };
  }
}

class HandoffProvider implements LLMProvider {
  readonly name = "ollama" as const;

  constructor(
    private readonly handoffTo: string,
    private readonly thenRespond: string = "Beta done.",
  ) {}

  private called = false;

  async generate() {
    return { text: "", model: "fake" };
  }
  async *stream(): AsyncIterable<never> {
    throw new Error("Not implemented");
    yield;
  }
  async *streamWithTools(
    input: { model: string; messages: unknown[]; systemPrompt?: string; tools: ToolDef[] },
  ): AsyncIterable<ToolStreamEvent> {
    if (!this.called && input.tools.some((t) => t.function.name === `handoff_to_${this.handoffTo}`)) {
      this.called = true;
      const handoffTool = input.tools.find((t) => t.function.name === `handoff_to_${this.handoffTo}`)!;
      yield {
        type: "done",
        response: {
          content: "",
          tool_calls: [
            {
              id: "tc-1",
              type: "function",
              function: {
                name: handoffTool.function.name,
                arguments: JSON.stringify({
                  taskDescription: "Continue the work",
                  artifacts: [],
                  reasoning: "Specialist needed",
                }),
              },
            },
          ],
        },
      };
    } else {
      yield { type: "token", text: this.thenRespond };
      yield { type: "done", response: { content: this.thenRespond } };
    }
  }
  async health() {
    return { ok: true, provider: this.name };
  }
}

// ── Session ────────────────────────────────────────────────────────────────────

describe("createSession", () => {
  it("initializes all fields", () => {
    const alpha = makeAgent();
    const config = makeConfig([alpha], new FakeProvider());
    const session = createSession(config);

    expect(session.activeAgent).toBeNull();
    expect(session.handoffCount).toBe(0);
    expect(session.maxHandoffs).toBe(10);
    expect(session.sharedMessages).toHaveLength(0);
    expect(session.artifacts).toEqual({});
    expect(session.tokenBudget.perAgent[alpha.name]).toBeGreaterThan(0);
    expect(session.swarmId).toMatch(/^swarm-/);
  });

  it("respects custom maxHandoffs", () => {
    const alpha = makeAgent();
    const config = makeConfig([alpha], new FakeProvider(), { maxHandoffs: 3 });
    const session = createSession(config);
    expect(session.maxHandoffs).toBe(3);
  });
});

describe("applyHandoff", () => {
  it("increments handoffCount and updates activeAgent", () => {
    const alpha = makeAgent();
    const beta = makeAgent({ name: "beta" });
    const config = makeConfig([alpha, beta], new FakeProvider());
    const session = createSession(config);
    session.activeAgent = "alpha";

    applyHandoff(session, {
      targetAgent: "beta",
      taskDescription: "Beta task",
      artifacts: [],
    });

    expect(session.handoffCount).toBe(1);
    expect(session.activeAgent).toBe("beta");
    expect(session.lastHandoffDescription["beta"]).toBe("Beta task");
    expect(session.agentHistory).toContain("beta");
  });
});

// ── Artifact Tools ─────────────────────────────────────────────────────────────

describe("createArtifactTools", () => {
  it("set and get artifact round-trip", async () => {
    const alpha = makeAgent();
    const session = createSession(makeConfig([alpha], new FakeProvider()));
    const tools = createArtifactTools(session);

    const setTool = tools.find((t) => t.name === "set_artifact")!;
    const getTool = tools.find((t) => t.name === "get_artifact")!;

    await setTool.invoke({ key: "my-key", value: "hello world" });
    const result = await getTool.invoke({ key: "my-key" });
    expect(result).toBe("hello world");
  });

  it("sanitizes artifact keys", async () => {
    const alpha = makeAgent();
    const session = createSession(makeConfig([alpha], new FakeProvider()));
    const tools = createArtifactTools(session);
    const setTool = tools.find((t) => t.name === "set_artifact")!;

    await setTool.invoke({ key: "my key/with spaces!", value: "v" });
    expect(session.artifacts["my_key_with_spaces_"]).toBe("v");
  });

  it("list_artifacts returns all keys", async () => {
    const alpha = makeAgent();
    const session = createSession(makeConfig([alpha], new FakeProvider()));
    const tools = createArtifactTools(session);
    const setTool = tools.find((t) => t.name === "set_artifact")!;
    const listTool = tools.find((t) => t.name === "list_artifacts")!;

    await setTool.invoke({ key: "a", value: "1" });
    await setTool.invoke({ key: "b", value: "2" });
    const list = await listTool.invoke({});
    expect(String(list)).toContain("a");
    expect(String(list)).toContain("b");
  });

  it("get_artifact reports missing key", async () => {
    const alpha = makeAgent();
    const session = createSession(makeConfig([alpha], new FakeProvider()));
    const tools = createArtifactTools(session);
    const getTool = tools.find((t) => t.name === "get_artifact")!;

    const result = String(await getTool.invoke({ key: "missing" }));
    expect(result).toContain("not found");
  });
});

// ── Circuit Breaker ────────────────────────────────────────────────────────────

describe("checkCircuitBreaker", () => {
  it("trips on maxHandoffs exceeded", () => {
    const alpha = makeAgent();
    const config = makeConfig([alpha], new FakeProvider(), { maxHandoffs: 2 });
    const session = createSession(config);
    session.handoffCount = 2;

    const result = checkCircuitBreaker(session, alpha);
    expect(result.tripped).toBe(true);
    expect(result.reason).toMatch(/Max handoffs/);
  });

  it("trips on same-agent loop (3 consecutive)", () => {
    const alpha = makeAgent();
    const session = createSession(makeConfig([alpha], new FakeProvider()));
    session.agentHistory = ["alpha", "alpha", "alpha"];

    const result = checkCircuitBreaker(session, alpha);
    expect(result.tripped).toBe(true);
    expect(result.reason).toMatch(/infinite loop/);
  });

  it("does not trip on 2 consecutive same agent", () => {
    const alpha = makeAgent();
    const session = createSession(makeConfig([alpha], new FakeProvider()));
    session.agentHistory = ["beta", "alpha", "alpha"];

    const result = checkCircuitBreaker(session, alpha);
    expect(result.tripped).toBe(false);
  });

  it("does not trip on normal state", () => {
    const alpha = makeAgent();
    const session = createSession(makeConfig([alpha], new FakeProvider()));
    session.agentHistory = ["alpha"];

    const result = checkCircuitBreaker(session, alpha);
    expect(result.tripped).toBe(false);
  });
});

// ── Validator ──────────────────────────────────────────────────────────────────

describe("validateOutput", () => {
  it("passes when no validator defined", () => {
    const alpha = makeAgent();
    expect(validateOutput("anything", alpha)).toEqual({ ok: true });
  });

  it("delegates to outputValidator", () => {
    const alpha = makeAgent({
      outputValidator: (out) => out.includes("DONE") ? { ok: true } : { ok: false, reason: "missing DONE" },
    });
    expect(validateOutput("Task DONE", alpha).ok).toBe(true);
    expect(validateOutput("incomplete", alpha).ok).toBe(false);
  });

  it("catches validator throws", () => {
    const alpha = makeAgent({
      outputValidator: () => { throw new Error("boom"); },
    });
    const result = validateOutput("anything", alpha);
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/Validator threw/);
  });
});

// ── SwarmTracer ────────────────────────────────────────────────────────────────

describe("SwarmTracer", () => {
  it("writes events to JSONL file", async () => {
    const tracer = new SwarmTracer("test-swarm-123");
    tracer.record({ type: "swarm-start", swarmId: "test-swarm-123", agents: ["a"] });
    tracer.flush();

    const dir = path.join(tmpDir, "swarm-traces");
    const files = fs.readdirSync(dir);
    expect(files).toHaveLength(1);
    expect(files[0]).toBe("test-swarm-123.jsonl");

    const lines = fs.readFileSync(path.join(dir, files[0]), "utf-8").trim().split("\n");
    expect(lines).toHaveLength(1);
    const parsed = JSON.parse(lines[0]) as { type: string };
    expect(parsed.type).toBe("swarm-start");
  });
});

// ── Handoff ────────────────────────────────────────────────────────────────────

describe("isHandoffResult", () => {
  it("detects handoff payloads", async () => {
    const alpha = makeAgent({ handoffDestinations: ["beta"] });
    const beta = makeAgent({ name: "beta" });
    const agentsByName = new Map([["alpha", alpha], ["beta", beta]]);
    const session = createSession(makeConfig([alpha, beta], new FakeProvider()));
    const tools = createHandoffTools(session, alpha, agentsByName);

    const result = await tools[0].invoke({
      taskDescription: "Continue",
      artifacts: [],
      reasoning: "Needed",
    });
    const parsed = JSON.parse(String(result)) as unknown;
    expect(isHandoffResult(parsed)).toBe(true);
  });
});

describe("buildAgentContext", () => {
  it("returns per-agent messages for isolated mode", () => {
    const alpha = makeAgent({ contextMode: "isolated" });
    const session = createSession(makeConfig([alpha], new FakeProvider()));
    session.agentMessages["alpha"] = [{ role: "user", content: "hello" }];

    const ctx = buildAgentContext(session, alpha);
    expect(ctx).toHaveLength(1);
    expect(ctx[0].content).toBe("hello");
  });

  it("returns shared messages for shared mode", () => {
    const alpha = makeAgent({ contextMode: "shared" });
    const session = createSession(makeConfig([alpha], new FakeProvider()));
    session.sharedMessages = [{ role: "assistant", content: "shared msg" }];

    const ctx = buildAgentContext(session, alpha);
    expect(ctx[0].content).toBe("shared msg");
  });

  it("returns filtered context with task and artifacts", () => {
    const alpha = makeAgent({ contextMode: "filtered" });
    const session = createSession(makeConfig([alpha], new FakeProvider()));
    session.lastHandoffDescription["alpha"] = "Do X";
    session.artifacts["report"] = "My report content";

    const ctx = buildAgentContext(session, alpha);
    expect(ctx.some((m) => m.content.includes("Do X"))).toBe(true);
    expect(ctx.some((m) => m.content.includes("report"))).toBe(true);
  });
});

describe("buildSystemPrompt", () => {
  it("includes agent system prompt and spec", () => {
    const alpha = makeAgent({ handoffDestinations: ["beta"] });
    const session = createSession(makeConfig([alpha], new FakeProvider(), { spec: "INVARIANT: be safe" }));
    session.lastHandoffDescription["alpha"] = "task";

    const prompt = buildSystemPrompt(session, alpha);
    expect(prompt).toContain("You are alpha.");
    expect(prompt).toContain("INVARIANT: be safe");
    expect(prompt).toContain("beta");
  });
});

// ── Orchestrator (integration) ─────────────────────────────────────────────────

describe("runSwarm", () => {
  it("runs a single agent to completion", async () => {
    const alpha = makeAgent();
    const config = makeConfig([alpha], new FakeProvider(["All done."]));
    const events: SwarmEvent[] = [];

    for await (const event of runSwarm(config)) {
      events.push(event);
    }

    expect(events.find((e) => e.type === "swarm-start")).toBeTruthy();
    expect(events.find((e) => e.type === "swarm-done")).toBeTruthy();
    expect(events.find((e) => e.type === "agent-start")).toBeTruthy();
    expect(events.find((e) => e.type === "agent-done")).toBeTruthy();
  });

  it("emits handoff event when agent uses handoff tool", async () => {
    const alpha = makeAgent({ name: "alpha", handoffDestinations: ["beta"] });
    const beta = makeAgent({ name: "beta", handoffDestinations: [] });
    const provider = new HandoffProvider("beta", "Beta finished.");
    const config = makeConfig([alpha, beta], provider);
    const events: SwarmEvent[] = [];

    for await (const event of runSwarm(config)) {
      events.push(event);
    }

    const handoffEvent = events.find((e) => e.type === "handoff") as
      | { type: "handoff"; from: string; to: string }
      | undefined;
    expect(handoffEvent).toBeTruthy();
    expect(handoffEvent?.from).toBe("alpha");
    expect(handoffEvent?.to).toBe("beta");

    const doneEvent = events.find((e) => e.type === "swarm-done") as
      | { type: "swarm-done"; handoffCount: number }
      | undefined;
    expect(doneEvent?.handoffCount).toBe(1);
  });

  it("trips circuit breaker on maxHandoffs", async () => {
    const alpha = makeAgent({ name: "alpha", handoffDestinations: ["beta"] });
    const beta = makeAgent({ name: "beta", handoffDestinations: ["alpha"] });
    const provider = new HandoffProvider("beta");
    const config = makeConfig([alpha, beta], provider, { maxHandoffs: 1 });
    const events: SwarmEvent[] = [];

    for await (const event of runSwarm(config)) {
      events.push(event);
    }

    const cbEvent = events.find((e) => e.type === "circuit-break");
    expect(cbEvent).toBeTruthy();
  });

  it("throws for unknown initialAgent", async () => {
    const alpha = makeAgent();
    const config = makeConfig([alpha], new FakeProvider(), { initialAgent: "nonexistent" });
    await expect(async () => {
      for await (const _ of runSwarm(config)) { /* drain */ }
    }).rejects.toThrow("not found");
  });

  it("emits swarm-start with all agent names", async () => {
    const alpha = makeAgent({ name: "alpha" });
    const beta = makeAgent({ name: "beta" });
    const config = makeConfig([alpha, beta], new FakeProvider());
    const events: SwarmEvent[] = [];

    for await (const event of runSwarm(config)) {
      events.push(event);
    }

    const startEvent = events.find((e) => e.type === "swarm-start") as
      | { type: "swarm-start"; agents: string[] }
      | undefined;
    expect(startEvent?.agents).toContain("alpha");
    expect(startEvent?.agents).toContain("beta");
  });

  it("emits validation-fail when agent output validator rejects", async () => {
    const alpha = makeAgent({
      outputValidator: (out) =>
        out.includes("DONE") ? { ok: true } : { ok: false, reason: "missing DONE marker" },
    });
    const config = makeConfig([alpha], new FakeProvider(["incomplete response"]));
    const events: SwarmEvent[] = [];

    for await (const event of runSwarm(config)) {
      events.push(event);
    }

    const valFail = events.find((e) => e.type === "validation-fail") as
      | { type: "validation-fail"; reason: string }
      | undefined;
    expect(valFail).toBeTruthy();
    expect(valFail?.reason).toContain("missing DONE marker");
  });
});
