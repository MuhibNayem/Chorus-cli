import { describe, expect, it, vi } from "vitest";
import { processAgentStream } from "../src/cli/agent/streamProcessor.js";
import type { FeedAction } from "../src/cli/state/feedReducer.js";

describe("processAgentStream", () => {
  it("collects reasoning_content from AIMessageChunk deltas", async () => {
    const dispatch = vi.fn() as (action: FeedAction) => void;
    const dbg = () => {};

    async function* mockStream() {
      yield ["messages", [{ type: "AIMessageChunk", content: "", additional_kwargs: { reasoning_content: "Let me think" } }]];
      yield ["messages", [{ type: "AIMessageChunk", content: "", additional_kwargs: { reasoning_content: " about this" } }]];
      yield ["messages", [{ type: "AIMessageChunk", content: "Hello", additional_kwargs: {} }]];
    }

    const result = await processAgentStream(mockStream() as any, dispatch, dbg);
    expect(result.responseText).toBe("Hello");
    expect(result.reasoningContent).toBe("Let me think about this");
  });

  it("collects reasoning_content from updates fallback", async () => {
    const dispatch = vi.fn() as (action: FeedAction) => void;
    const dbg = () => {};

    async function* mockStream() {
      yield ["updates", {
        someNode: {
          messages: [{ type: "AIMessage", content: "", additional_kwargs: { reasoning_content: "Fallback thought" } }],
        },
      }];
      yield ["messages", [{ type: "AIMessageChunk", content: "World", additional_kwargs: {} }]];
    }

    const result = await processAgentStream(mockStream() as any, dispatch, dbg);
    expect(result.responseText).toBe("World");
    expect(result.reasoningContent).toBe("Fallback thought");
  });

  it("returns empty reasoningContent when no thinking content present", async () => {
    const dispatch = vi.fn() as (action: FeedAction) => void;
    const dbg = () => {};

    async function* mockStream() {
      yield ["messages", [{ type: "AIMessageChunk", content: "No thinking here", additional_kwargs: {} }]];
    }

    const result = await processAgentStream(mockStream() as any, dispatch, dbg);
    expect(result.responseText).toBe("No thinking here");
    expect(result.reasoningContent).toBe("");
  });

  it("extracts <think> tags from content as thinking tokens", async () => {
    const dispatch = vi.fn() as (action: FeedAction) => void;
    const dbg = () => {};

    async function* mockStream() {
      yield ["messages", [{ type: "AIMessageChunk", content: "<think>Let me analyze</think>Hello user", additional_kwargs: {} }]];
    }

    const result = await processAgentStream(mockStream() as any, dispatch, dbg);
    expect(result.responseText).toBe("Hello user");
    expect(result.reasoningContent).toBe("Let me analyze");

    // Verify thinking was dispatched
    const thinkCalls = dispatch.mock.calls.filter((call) => call[0].type === "APPEND_THINK_TOKEN");
    expect(thinkCalls.length).toBe(1);
    expect(thinkCalls[0][0].text).toBe("Let me analyze");

    // Verify response was dispatched
    const responseCalls = dispatch.mock.calls.filter((call) => call[0].type === "APPEND_RESPONSE_TOKEN");
    expect(responseCalls.length).toBe(1);
    expect(responseCalls[0][0].text).toBe("Hello user");
  });

  it("handles <think> tags split across chunks", async () => {
    const dispatch = vi.fn() as (action: FeedAction) => void;
    const dbg = () => {};

    async function* mockStream() {
      yield ["messages", [{ type: "AIMessageChunk", content: "<think>Let me", additional_kwargs: {} }]];
      yield ["messages", [{ type: "AIMessageChunk", content: " analyze</think>Hello", additional_kwargs: {} }]];
    }

    const result = await processAgentStream(mockStream() as any, dispatch, dbg);
    expect(result.responseText).toBe("Hello");
    expect(result.reasoningContent).toBe("Let me analyze");
  });

  it("handles multiple <think> blocks in one chunk", async () => {
    const dispatch = vi.fn() as (action: FeedAction) => void;
    const dbg = () => {};

    async function* mockStream() {
      yield ["messages", [{ type: "AIMessageChunk", content: "<think>First thought</think>text<think>Second thought</think>more", additional_kwargs: {} }]];
    }

    const result = await processAgentStream(mockStream() as any, dispatch, dbg);
    expect(result.responseText).toBe("textmore");
    expect(result.reasoningContent).toBe("First thoughtSecond thought");
  });

  it("ignores unmatched <think> tags (no closing tag)", async () => {
    const dispatch = vi.fn() as (action: FeedAction) => void;
    const dbg = () => {};

    async function* mockStream() {
      yield ["messages", [{ type: "AIMessageChunk", content: "<think>incomplete thought", additional_kwargs: {} }]];
    }

    const result = await processAgentStream(mockStream() as any, dispatch, dbg);
    expect(result.responseText).toBe("");
    expect(result.reasoningContent).toBe("");
  });

  it("extracts <think> tags from AIMessage (non-chunk) type", async () => {
    const dispatch = vi.fn() as (action: FeedAction) => void;
    const dbg = () => {};

    async function* mockStream() {
      yield ["messages", [{ type: "AIMessage", content: "<think>Full message thought</think>Hello", additional_kwargs: {} }]];
    }

    const result = await processAgentStream(mockStream() as any, dispatch, dbg);
    expect(result.responseText).toBe("Hello");
    expect(result.reasoningContent).toBe("Full message thought");

    const thinkCalls = dispatch.mock.calls.filter((call) => call[0].type === "APPEND_THINK_TOKEN");
    expect(thinkCalls.length).toBe(1);
  });

  it("extracts <think> tags from updates mode for history without duplicating UI events", async () => {
    const dispatch = vi.fn() as (action: FeedAction) => void;
    const dbg = () => {};

    async function* mockStream() {
      yield ["updates", {
        someNode: {
          messages: [{ type: "AIMessage", content: "<think>Update thought</think>Response text", additional_kwargs: {} }],
        },
      }];
    }

    const result = await processAgentStream(mockStream() as any, dispatch, dbg);
    // Final content strips <think> tags from updates-mode messages
    expect(result.responseText).toBe("Response text");
    // Reasoning is extracted for history
    expect(result.reasoningContent).toBe("Update thought");

    // No UI events dispatched from updates mode (messages mode handles streaming)
    const thinkCalls = dispatch.mock.calls.filter((call) => call[0].type === "APPEND_THINK_TOKEN");
    expect(thinkCalls.length).toBe(0);
    const tokenCalls = dispatch.mock.calls.filter((call) => call[0].type === "APPEND_RESPONSE_TOKEN");
    expect(tokenCalls.length).toBe(0);
  });

  it("returns native HITL interrupts from updates mode", async () => {
    const dispatch = vi.fn() as (action: FeedAction) => void;
    const dbg = vi.fn();

    async function* mockStream() {
      yield ["updates", {
        __interrupt__: [
          {
            value: {
              actionRequests: [
                {
                  name: "run_command",
                  args: { command: "npm run build" },
                  description: "Review this shell command before it runs.",
                },
              ],
              reviewConfigs: [
                {
                  actionName: "run_command",
                  allowedDecisions: ["approve", "reject"],
                },
              ],
            },
          },
        ],
      }];
    }

    const result = await processAgentStream(mockStream() as any, dispatch, dbg);
    expect(result.interrupt?.actionRequests[0]).toMatchObject({
      name: "run_command",
      args: { command: "npm run build" },
    });
    expect(result.interrupt?.reviewConfigs[0].allowedDecisions).toEqual(["approve", "reject"]);
    expect(dbg).toHaveBeenCalledWith("HITL_INTERRUPT", { actions: ["run_command"] });
  });
});

describe("ChatMessage reasoning_content support", () => {
  it("accepts reasoning_content in message type", () => {
    // This is a type-level test — if it compiles, it passes
    const msg = {
      role: "assistant" as const,
      content: "Hello",
      reasoning_content: "I thought about this",
    };
    expect(msg.role).toBe("assistant");
    expect(msg.reasoning_content).toBe("I thought about this");
  });
});
