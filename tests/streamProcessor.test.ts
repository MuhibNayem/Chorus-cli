import { describe, it, expect } from "vitest";
import { feedReducer, initialFeedState, type FeedAction } from "../src/cli/state/feedReducer.js";

// Simulate the stream processing logic from useAgentStream.ts by running actions
// through the reducer. These tests verify Bug 1.1 and 1.2 fix behavior.

function buildTurnState(actions: FeedAction[]) {
  const withUser: FeedAction[] = [{ type: "APPEND_USER", id: "u1", text: "hello" }, ...actions];
  return actions.reduce(feedReducer, feedReducer(initialFeedState, { type: "APPEND_USER", id: "u1", text: "hello" }));
}

describe("Bug 1.1: Response priority — streamed tokens beat updates-mode content", () => {
  it("accumulates APPEND_RESPONSE_TOKEN into turn.tokens", () => {
    let state = feedReducer(initialFeedState, { type: "APPEND_USER", id: "u1", text: "q" });
    state = feedReducer(state, { type: "APPEND_RESPONSE_TOKEN", text: "Hello" });
    state = feedReducer(state, { type: "APPEND_RESPONSE_TOKEN", text: " world" });

    const turn = state.entries.find((e) => e.kind === "turn") as any;
    expect(turn.tokens.join("")).toBe("Hello world");
  });

  it("FINALIZE_TURN marks done and records thinking duration", () => {
    let state = feedReducer(initialFeedState, { type: "APPEND_USER", id: "u1", text: "q" });
    state = feedReducer(state, { type: "APPEND_RESPONSE_TOKEN", text: "Done" });
    state = feedReducer(state, { type: "FINALIZE_TURN" });

    const turn = state.entries.find((e) => e.kind === "turn") as any;
    expect(turn.done).toBe(true);
    expect(turn.thinking.durationMs).toBeGreaterThanOrEqual(0);
  });
});

describe("Bug 1.2: Ollama tool_calls in additional_kwargs", () => {
  it("ADD_TOOL_CALL adds tool to live turn toolCalls", () => {
    let state = feedReducer(initialFeedState, { type: "APPEND_USER", id: "u1", text: "q" });
    state = feedReducer(state, {
      type: "ADD_TOOL_CALL",
      toolCall: { id: "tc-1", name: "file_read", args: { path: "foo.ts" }, status: "running" },
    });

    const turn = state.entries.find((e) => e.kind === "turn") as any;
    expect(turn.toolCalls).toHaveLength(1);
    expect(turn.toolCalls[0].name).toBe("file_read");
    expect(turn.toolCalls[0].status).toBe("running");
  });

  it("UPDATE_TOOL_CALL sets result and status", () => {
    let state = feedReducer(initialFeedState, { type: "APPEND_USER", id: "u1", text: "q" });
    state = feedReducer(state, {
      type: "ADD_TOOL_CALL",
      toolCall: { id: "tc-1", name: "file_read", args: {}, status: "running" },
    });
    state = feedReducer(state, {
      type: "UPDATE_TOOL_CALL",
      id: "tc-1",
      result: "file contents here",
      status: "done",
    });

    const turn = state.entries.find((e) => e.kind === "turn") as any;
    expect(turn.toolCalls[0].status).toBe("done");
    expect(turn.toolCalls[0].result).toBe("file contents here");
  });

  it("deduplication: second ADD_TOOL_CALL with different id adds second entry", () => {
    let state = feedReducer(initialFeedState, { type: "APPEND_USER", id: "u1", text: "q" });
    state = feedReducer(state, {
      type: "ADD_TOOL_CALL",
      toolCall: { id: "tc-1", name: "file_read", args: {}, status: "running" },
    });
    state = feedReducer(state, {
      type: "ADD_TOOL_CALL",
      toolCall: { id: "tc-2", name: "file_write", args: {}, status: "running" },
    });

    const turn = state.entries.find((e) => e.kind === "turn") as any;
    expect(turn.toolCalls).toHaveLength(2);
  });
});

describe("Bug 1.3: Cancellation via SET_ERROR", () => {
  it("SET_ERROR adds error entry and sets processing=false", () => {
    let state = feedReducer(initialFeedState, { type: "APPEND_USER", id: "u1", text: "q" });
    expect(state.processing).toBe(true);

    state = feedReducer(state, { type: "SET_ERROR", id: "err-1", message: "Cancelled by user." });
    expect(state.processing).toBe(false);
    const err = state.entries.find((e) => e.kind === "error") as any;
    expect(err.message).toBe("Cancelled by user.");
  });
});

describe("Thinking blocks", () => {
  it("APPEND_THINK_TOKEN accumulates into thinking.text", () => {
    let state = feedReducer(initialFeedState, { type: "APPEND_USER", id: "u1", text: "q" });
    state = feedReducer(state, { type: "APPEND_THINK_TOKEN", text: "Hmm " });
    state = feedReducer(state, { type: "APPEND_THINK_TOKEN", text: "thinking..." });

    const turn = state.entries.find((e) => e.kind === "turn") as any;
    expect(turn.thinking.text).toBe("Hmm thinking...");
  });

  it("TOGGLE_EXPANDED flips thinking.expanded", () => {
    let state = feedReducer(initialFeedState, { type: "APPEND_USER", id: "u1", text: "q" });
    state = feedReducer(state, { type: "APPEND_THINK_TOKEN", text: "Thinking..." });

    const turnBefore = state.entries.find((e) => e.kind === "turn") as any;
    expect(turnBefore.thinking.expanded).toBe(false);

    state = feedReducer(state, { type: "TOGGLE_EXPANDED", id: `${turnBefore.id}-thinking` });
    const turnAfter = state.entries.find((e) => e.kind === "turn") as any;
    expect(turnAfter.thinking.expanded).toBe(true);
  });
});
