import { describe, expect, it, vi } from "vitest";
import { executeSubagent } from "../src/subagents/runtime.js";
import type { FeedAction } from "../src/cli/state/feedReducer.js";

// Mock deepagents
vi.mock("deepagents", () => ({
  createDeepAgent: vi.fn(() => ({
    stream: vi.fn(async () => {
      // Return a mock stream
      return (async function* () {
        yield ["messages", [{ type: "AIMessageChunk", role: "assistant", content: "Hello from subagent" }]];
        yield ["updates", { agent: { messages: [{ type: "AIMessage", role: "assistant", content: "Final response" }] } }];
      })();
    }),
  })),
}));

describe("executeSubagent", () => {
  it("executes a known subagent and returns its response", async () => {
    const dispatched: FeedAction[] = [];
    const dispatch = (action: FeedAction) => dispatched.push(action);

    const mockModel = {} as import("@langchain/core/language_models/chat_models").BaseChatModel;

    const result = await executeSubagent({
      subagentName: "planner",
      task: "Design a new API",
      model: mockModel,
      dispatch,
      parentTurnId: "turn-1",
    });

    expect(result).toContain("Hello from subagent");

    const addActions = dispatched.filter((a) => a.type === "ADD_SUBAGENT");
    expect(addActions).toHaveLength(1);
    expect((addActions[0] as { subagent: { name: string } }).subagent.name).toBe("planner");
  });

  it("throws for unknown subagent", async () => {
    const dispatch = () => {};
    const mockModel = {} as import("@langchain/core/language_models/chat_models").BaseChatModel;

    await expect(
      executeSubagent({
        subagentName: "unknown-subagent",
        task: "Do something",
        model: mockModel,
        dispatch,
        parentTurnId: "turn-1",
      })
    ).rejects.toThrow("Unknown subagent");
  });
});
