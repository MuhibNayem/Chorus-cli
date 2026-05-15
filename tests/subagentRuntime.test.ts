import * as fs from "fs";
import * as path from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { executeSubagent } from "../src/subagents/runtime.js";
import type { LLMProvider, ToolDef, ToolStreamEvent } from "../src/llm/provider.js";
import type { FeedAction } from "../src/cli/state/feedReducer.js";

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
    const dispatched: FeedAction[] = [];
    const dispatch = (action: FeedAction) => dispatched.push(action);

    const result = await executeSubagent({
      subagentName: "planner",
      task: "Design a new API",
      provider: new FakeProvider("Hello from subagent"),
      modelName: "fake-model",
      dispatch,
      parentTurnId: "turn-1",
    });

    expect(result).toBe("Hello from subagent");

    const addActions = dispatched.filter((a) => a.type === "ADD_SUBAGENT");
    expect(addActions).toHaveLength(1);
    expect((addActions[0] as { subagent: { name: string } }).subagent.name).toBe("planner");

    const finalizeActions = dispatched.filter((a) => a.type === "FINALIZE_SUBAGENT");
    expect(finalizeActions).toHaveLength(1);
  });

  it("dispatches token events during execution", async () => {
    const dispatched: FeedAction[] = [];
    const dispatch = (action: FeedAction) => dispatched.push(action);

    await executeSubagent({
      subagentName: "vapt",
      task: "Find vulnerabilities",
      provider: new FakeProvider("Scan complete"),
      modelName: "fake-model",
      dispatch,
      parentTurnId: "turn-2",
    });

    const tokenActions = dispatched.filter((a) => a.type === "APPEND_SUBAGENT_TOKEN");
    expect(tokenActions.length).toBeGreaterThan(0);
  });

  it("dispatches thinking events during execution", async () => {
    const dispatched: FeedAction[] = [];
    const dispatch = (action: FeedAction) => dispatched.push(action);

    await executeSubagent({
      subagentName: "planner",
      task: "Think through the API",
      provider: new FakeProvider("Plan complete", "Need endpoints. "),
      modelName: "fake-model",
      dispatch,
      parentTurnId: "turn-2",
    });

    expect(dispatched).toContainEqual(
      expect.objectContaining({
        type: "APPEND_SESSION_THINK_TOKEN",
        text: "Need endpoints. ",
      }),
    );
  });

  it("throws for unknown subagent", async () => {
    const dispatch = () => {};

    await expect(
      executeSubagent({
        subagentName: "unknown-subagent",
        task: "Do something",
        provider: new FakeProvider(),
        modelName: "fake-model",
        dispatch,
        parentTurnId: "turn-3",
      })
    ).rejects.toThrow("Unknown subagent");
  });
});
