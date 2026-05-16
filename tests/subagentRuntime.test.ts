import * as fs from "fs";
import * as path from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { executeSubagent } from "../src/subagents/runtime.js";
import type { SubagentEvent } from "../src/subagents/runtime.js";
import type { LLMProvider, ToolDef, ToolStreamEvent } from "../src/llm/provider.js";

class FakeProvider implements LLMProvider {
  readonly name = "ollama" as const;

  constructor(
    private readonly response: string = "Hello from subagent",
    private readonly thinking: string = "",
  ) {}

  async generate() { return { text: "", model: "fake" }; }
  async *stream(): AsyncIterable<any> { yield { type: "response.completed" as const }; }

  async *streamWithTools(_input: { model: string; messages: any[]; systemPrompt?: string; tools: ToolDef[] }): AsyncIterable<ToolStreamEvent> {
    if (this.thinking) {
      yield { type: "thinking", text: this.thinking };
    }
    yield { type: "token", text: this.response };
    yield { type: "done", response: { content: this.response } };
  }

  async health() { return { ok: true, provider: this.name }; }
}

let homeDir: string;

beforeEach(() => {
  homeDir = fs.mkdtempSync(path.join("/tmp", "chorus-subagent-"));
  process.env.CHORUS_HOME_DIR = homeDir;
});

afterEach(() => {
  delete process.env.CHORUS_HOME_DIR;
});

describe("executeSubagent", () => {
  it("executes a known subagent and returns its response", async () => {
    const events: SubagentEvent[] = [];
    const onEvent = (e: SubagentEvent) => events.push(e);

    const result = await executeSubagent({
      subagentName: "planner",
      task: "Design a new API",
      provider: new FakeProvider("Hello from subagent"),
      modelName: "fake-model",
      onEvent,
      parentTurnId: "turn-1",
    });

    expect(result).toBe("Hello from subagent");

    const addEvents = events.filter((e) => e.type === "subagent-add");
    expect(addEvents).toHaveLength(1);
    expect((addEvents[0] as Extract<SubagentEvent, { type: "subagent-add" }>).name).toBe("planner");

    const finalizeEvents = events.filter((e) => e.type === "subagent-finalize");
    expect(finalizeEvents).toHaveLength(1);
  });

  it("dispatches token events during execution", async () => {
    const events: SubagentEvent[] = [];
    const onEvent = (e: SubagentEvent) => events.push(e);

    await executeSubagent({
      subagentName: "vapt",
      task: "Find vulnerabilities",
      provider: new FakeProvider("Scan complete"),
      modelName: "fake-model",
      onEvent,
      parentTurnId: "turn-2",
    });

    const tokenEvents = events.filter((e) => e.type === "subagent-token");
    expect(tokenEvents.length).toBeGreaterThan(0);
  });

  it("dispatches thinking events during execution", async () => {
    const events: SubagentEvent[] = [];
    const onEvent = (e: SubagentEvent) => events.push(e);

    await executeSubagent({
      subagentName: "planner",
      task: "Think through the API",
      provider: new FakeProvider("Plan complete", "Need endpoints. "),
      modelName: "fake-model",
      onEvent,
      parentTurnId: "turn-2",
    });

    const thinkEvents = events.filter((e) => e.type === "subagent-think-token");
    expect(thinkEvents.length).toBeGreaterThan(0);
    expect((thinkEvents[0] as Extract<SubagentEvent, { type: "subagent-think-token" }>).text).toBe("Need endpoints. ");
  });

  it("throws for unknown subagent", async () => {
    const onEvent = () => {};

    await expect(
      executeSubagent({
        subagentName: "unknown-subagent",
        task: "Do something",
        provider: new FakeProvider(),
        modelName: "fake-model",
        onEvent,
        parentTurnId: "turn-3",
      })
    ).rejects.toThrow("Unknown subagent");
  });
});
