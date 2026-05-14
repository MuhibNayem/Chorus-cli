import { describe, it, expect } from "vitest";
import {
  feedReducer,
  initialFeedState,
  type FeedState,
  type FeedAction,
} from "../src/cli/state/feedReducer.js";

function applyActions(actions: Array<FeedAction | any>): FeedState {
  return actions.map((action) => {
    if (action.type === "APPEND_USER") {
      return { ...action, startedAt: action.startedAt ?? 1000 };
    }
    if (action.type === "FINALIZE_TURN") {
      return { ...action, completedAt: action.completedAt ?? 1100 };
    }
    return action;
  }).reduce(feedReducer, initialFeedState);
}

function getTurns(state: FeedState) {
  return state.entries.filter((entry) => entry.kind === "turn");
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
      events: [],
    });
    expect(state.processing).toBe(true);
  });
});

describe("APPEND_THINK_TOKEN", () => {
  it("appends to the live thinking event", () => {
    const state = applyActions([
      { type: "APPEND_USER", id: "u1", text: "hi" },
      { type: "APPEND_THINK_TOKEN", text: "step 1 " },
      { type: "APPEND_THINK_TOKEN", text: "step 2" },
    ]);
    const [turn] = getTurns(state);
    expect(turn?.kind).toBe("turn");
    if (turn?.kind === "turn") {
      expect(turn.events).toHaveLength(1);
      expect(turn.events[0]).toMatchObject({
        kind: "thinking",
        text: "step 1 step 2",
        expanded: true,
      });
    }
  });

  it("does not mutate a finalized turn", () => {
    const state = applyActions([
      { type: "APPEND_USER", id: "u1", text: "hi" },
      { type: "APPEND_THINK_TOKEN", text: "first turn" },
      { type: "FINALIZE_TURN" },
      { type: "APPEND_USER", id: "u2", text: "second" },
      { type: "APPEND_THINK_TOKEN", text: "only second turn" },
    ]);
    const turns = getTurns(state);
    expect(turns).toHaveLength(2);
    if (turns[0]?.kind === "turn" && turns[1]?.kind === "turn") {
      expect(turns[0].events[0]).toMatchObject({
        kind: "thinking",
        text: "first turn",
        expanded: false,
      });
      expect(turns[1].events[0]).toMatchObject({
        kind: "thinking",
        text: "only second turn",
        expanded: true,
      });
    }
  });
});

describe("APPEND_RESPONSE_TOKEN", () => {
  it("appends tokens to the live response event", () => {
    const state = applyActions([
      { type: "APPEND_USER", id: "u1", text: "hi" },
      { type: "APPEND_RESPONSE_TOKEN", text: "Hello" },
      { type: "APPEND_RESPONSE_TOKEN", text: " world" },
    ]);
    const [turn] = getTurns(state);
    if (turn?.kind === "turn") {
      expect(turn.events).toHaveLength(1);
      expect(turn.events[0]).toMatchObject({
        kind: "response",
        text: "Hello world",
      });
    }
  });
});

describe("ADD_TOOL_CALL + UPDATE_TOOL_CALL", () => {
  it("adds a running tool event and updates it to done", () => {
    const state = applyActions([
      { type: "APPEND_USER", id: "u1", text: "run git" },
      {
        type: "ADD_TOOL_CALL",
        toolCall: { id: "tc1", name: "git_status", args: { cwd: "." }, status: "running" },
      },
      { type: "UPDATE_TOOL_CALL", id: "tc1", result: "nothing to commit", status: "done" },
    ]);
    const [turn] = getTurns(state);
    if (turn?.kind === "turn") {
      expect(turn.events).toHaveLength(1);
      expect(turn.events[0]).toMatchObject({
        kind: "tool",
        card: {
          id: "tc1",
          name: "git_status",
          status: "done",
          result: "nothing to commit",
          expanded: false,
        },
      });
    }
  });

  it("marks tool as error on UPDATE_TOOL_CALL with status=error", () => {
    const state = applyActions([
      { type: "APPEND_USER", id: "u1", text: "run" },
      { type: "ADD_TOOL_CALL", toolCall: { id: "tc1", name: "shell", args: {}, status: "running" } },
      { type: "UPDATE_TOOL_CALL", id: "tc1", result: "command not found", status: "error" },
    ]);
    const [turn] = getTurns(state);
    if (turn?.kind === "turn" && turn.events[0]?.kind === "tool") {
      expect(turn.events[0].card.status).toBe("error");
    }
  });
});

describe("FINALIZE_TURN", () => {
  it("marks done=true, sets processing=false, and collapses thinking events", () => {
    const state = applyActions([
      { type: "APPEND_USER", id: "u1", text: "hi" },
      { type: "APPEND_THINK_TOKEN", text: "hello" },
      { type: "FINALIZE_TURN" },
    ]);
    expect(state.processing).toBe(false);
    const [turn] = getTurns(state);
    if (turn?.kind === "turn" && turn.events[0]?.kind === "thinking") {
      expect(turn.done).toBe(true);
      expect(turn.events[0].expanded).toBe(false);
      expect(turn.events[0].durationMs).toBeGreaterThanOrEqual(0);
    }
  });
});

describe("TOGGLE_EXPANDED", () => {
  it("toggles thinking event expanded state", () => {
    const state = applyActions([
      { type: "APPEND_USER", id: "u1", text: "hi" },
      { type: "APPEND_THINK_TOKEN", text: "some thought" },
      { type: "TOGGLE_EXPANDED", id: "turn-u1-think-0" },
    ]);
    const [turn] = getTurns(state);
    if (turn?.kind === "turn" && turn.events[0]?.kind === "thinking") {
      expect(turn.events[0].expanded).toBe(false);
    }
  });

  it("toggles a tool card expanded state", () => {
    const state = applyActions([
      { type: "APPEND_USER", id: "u1", text: "hi" },
      { type: "ADD_TOOL_CALL", toolCall: { id: "tc1", name: "git_status", args: {}, status: "done" } },
      { type: "TOGGLE_EXPANDED", id: "tc1" },
    ]);
    const [turn] = getTurns(state);
    if (turn?.kind === "turn" && turn.events[0]?.kind === "tool") {
      expect(turn.events[0].card.expanded).toBe(true);
    }
  });

  it("does not affect other turns when toggling", () => {
    const state = applyActions([
      { type: "APPEND_USER", id: "u1", text: "first" },
      { type: "ADD_TOOL_CALL", toolCall: { id: "tc1", name: "ls", args: {}, status: "done" } },
      { type: "FINALIZE_TURN" },
      { type: "APPEND_USER", id: "u2", text: "second" },
      { type: "ADD_TOOL_CALL", toolCall: { id: "tc2", name: "pwd", args: {}, status: "done" } },
      { type: "TOGGLE_EXPANDED", id: "tc2" },
    ]);
    const turns = getTurns(state);
    if (
      turns[0]?.kind === "turn" &&
      turns[1]?.kind === "turn" &&
      turns[0].events[0]?.kind === "tool" &&
      turns[1].events[0]?.kind === "tool"
    ) {
      expect(turns[0].events[0].card.expanded).toBe(false);
      expect(turns[1].events[0].card.expanded).toBe(true);
    }
  });
});

describe("SET_ERROR", () => {
  it("adds an error entry and stops processing", () => {
    const state = applyActions([
      { type: "APPEND_USER", id: "u1", text: "hi" },
      { type: "SET_ERROR", id: "e1", message: "Connection refused" },
    ]);
    expect(state.processing).toBe(false);
    const errEntry = state.entries.find((entry) => entry.kind === "error");
    expect(errEntry).toMatchObject({ kind: "error", id: "e1", message: "Connection refused" });
  });
});
