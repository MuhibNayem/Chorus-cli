import { describe, it, expect } from "vitest";
import {
  feedReducer,
  initialFeedState,
  type FeedState,
  type FeedAction,
} from "../src/cli/state/feedReducer.js";

function applyActions(actions: FeedAction[]): FeedState {
  return actions.reduce(feedReducer, initialFeedState);
}

describe("APPEND_USER", () => {
  it("adds a user entry and a pending turn entry", () => {
    const state = applyActions([{ type: "APPEND_USER", id: "u1", text: "hello" }]);
    expect(state.entries).toHaveLength(2);
    expect(state.entries[0]).toMatchObject({ kind: "user", id: "u1", text: "hello" });
    expect(state.entries[1]).toMatchObject({
      kind: "turn",
      id: "turn-u1",
      done: false,
      tokens: [],
      toolCalls: [],
    });
    expect(state.processing).toBe(true);
  });
});

describe("APPEND_THINK_TOKEN", () => {
  it("appends to the live turn's thinking text", () => {
    const state = applyActions([
      { type: "APPEND_USER", id: "u1", text: "hi" },
      { type: "APPEND_THINK_TOKEN", text: "step 1 " },
      { type: "APPEND_THINK_TOKEN", text: "step 2" },
    ]);
    const turn = state.entries.find((e) => e.kind === "turn");
    if (turn?.kind === "turn") {
      expect(turn.thinking.text).toBe("step 1 step 2");
    }
  });

  it("does not mutate a finalized turn", () => {
    const state = applyActions([
      { type: "APPEND_USER", id: "u1", text: "hi" },
      { type: "FINALIZE_TURN" },
      { type: "APPEND_USER", id: "u2", text: "second" },
      { type: "APPEND_THINK_TOKEN", text: "only second turn" },
    ]);
    const turns = state.entries.filter((e) => e.kind === "turn");
    expect(turns).toHaveLength(2);
    if (turns[0].kind === "turn") expect(turns[0].thinking.text).toBe("");
    if (turns[1].kind === "turn") expect(turns[1].thinking.text).toBe("only second turn");
  });
});

describe("APPEND_RESPONSE_TOKEN", () => {
  it("appends tokens to the live turn", () => {
    const state = applyActions([
      { type: "APPEND_USER", id: "u1", text: "hi" },
      { type: "APPEND_RESPONSE_TOKEN", text: "Hello" },
      { type: "APPEND_RESPONSE_TOKEN", text: " world" },
    ]);
    const turn = state.entries.find((e) => e.kind === "turn");
    if (turn?.kind === "turn") {
      expect(turn.tokens).toEqual(["Hello", " world"]);
    }
  });
});

describe("ADD_TOOL_CALL + UPDATE_TOOL_CALL", () => {
  it("adds a running tool card and updates to done", () => {
    const state = applyActions([
      { type: "APPEND_USER", id: "u1", text: "run git" },
      {
        type: "ADD_TOOL_CALL",
        toolCall: { id: "tc1", name: "git_status", args: { cwd: "." }, status: "running" },
      },
      { type: "UPDATE_TOOL_CALL", id: "tc1", result: "nothing to commit", status: "done" },
    ]);
    const turn = state.entries.find((e) => e.kind === "turn");
    if (turn?.kind === "turn") {
      expect(turn.toolCalls).toHaveLength(1);
      expect(turn.toolCalls[0]).toMatchObject({
        id: "tc1",
        name: "git_status",
        status: "done",
        result: "nothing to commit",
        expanded: false,
      });
    }
  });

  it("marks tool as error on UPDATE_TOOL_CALL with status=error", () => {
    const state = applyActions([
      { type: "APPEND_USER", id: "u1", text: "run" },
      { type: "ADD_TOOL_CALL", toolCall: { id: "tc1", name: "shell", args: {}, status: "running" } },
      { type: "UPDATE_TOOL_CALL", id: "tc1", result: "command not found", status: "error" },
    ]);
    const turn = state.entries.find((e) => e.kind === "turn");
    if (turn?.kind === "turn") {
      expect(turn.toolCalls[0].status).toBe("error");
    }
  });
});

describe("FINALIZE_TURN", () => {
  it("marks done=true and sets processing=false", () => {
    const state = applyActions([
      { type: "APPEND_USER", id: "u1", text: "hi" },
      { type: "APPEND_RESPONSE_TOKEN", text: "hello" },
      { type: "FINALIZE_TURN" },
    ]);
    expect(state.processing).toBe(false);
    const turn = state.entries.find((e) => e.kind === "turn");
    if (turn?.kind === "turn") {
      expect(turn.done).toBe(true);
      expect(turn.thinking.durationMs).toBeGreaterThanOrEqual(0);
    }
  });
});

describe("TOGGLE_EXPANDED", () => {
  it("toggles thinking block expanded state", () => {
    const state = applyActions([
      { type: "APPEND_USER", id: "u1", text: "hi" },
      { type: "APPEND_THINK_TOKEN", text: "some thought" },
      { type: "TOGGLE_EXPANDED", id: "turn-u1-thinking" },
    ]);
    const turn = state.entries.find((e) => e.kind === "turn");
    if (turn?.kind === "turn") expect(turn.thinking.expanded).toBe(true);
  });

  it("toggles back to collapsed on second toggle", () => {
    const state = applyActions([
      { type: "APPEND_USER", id: "u1", text: "hi" },
      { type: "APPEND_THINK_TOKEN", text: "thought" },
      { type: "TOGGLE_EXPANDED", id: "turn-u1-thinking" },
      { type: "TOGGLE_EXPANDED", id: "turn-u1-thinking" },
    ]);
    const turn = state.entries.find((e) => e.kind === "turn");
    if (turn?.kind === "turn") expect(turn.thinking.expanded).toBe(false);
  });

  it("toggles a tool card expanded state", () => {
    const state = applyActions([
      { type: "APPEND_USER", id: "u1", text: "hi" },
      { type: "ADD_TOOL_CALL", toolCall: { id: "tc1", name: "git_status", args: {}, status: "done" } },
      { type: "TOGGLE_EXPANDED", id: "tc1" },
    ]);
    const turn = state.entries.find((e) => e.kind === "turn");
    if (turn?.kind === "turn") expect(turn.toolCalls[0].expanded).toBe(true);
  });

  it("does not affect other entries when toggling", () => {
    const state = applyActions([
      { type: "APPEND_USER", id: "u1", text: "first" },
      { type: "FINALIZE_TURN" },
      { type: "APPEND_USER", id: "u2", text: "second" },
      { type: "ADD_TOOL_CALL", toolCall: { id: "tc2", name: "ls", args: {}, status: "done" } },
      { type: "TOGGLE_EXPANDED", id: "tc2" },
    ]);
    // First turn's toolCalls unaffected (empty)
    const turns = state.entries.filter((e) => e.kind === "turn");
    if (turns[0].kind === "turn") expect(turns[0].toolCalls).toHaveLength(0);
    if (turns[1].kind === "turn") expect(turns[1].toolCalls[0].expanded).toBe(true);
  });
});

describe("SET_ERROR", () => {
  it("adds an error entry and stops processing", () => {
    const state = applyActions([
      { type: "APPEND_USER", id: "u1", text: "hi" },
      { type: "SET_ERROR", id: "e1", message: "Connection refused" },
    ]);
    expect(state.processing).toBe(false);
    const errEntry = state.entries.find((e) => e.kind === "error");
    expect(errEntry).toMatchObject({ kind: "error", id: "e1", message: "Connection refused" });
  });
});
