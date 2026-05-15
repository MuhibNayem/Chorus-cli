import { describe, it, expect } from "vitest";
import {
  feedReducer,
  initialFeedState,
  type FeedState,
  type FeedAction,
} from "../src/cli/state/feedReducer.js";

// ── Swarm helpers ─────────────────────────────────────────────────────────────

function getSwarmTurns(state: FeedState) {
  return state.entries.filter((e) => e.kind === "swarm-turn");
}

const SWARM_ID = "test-swarm-abc";
const SWARM_START: FeedAction = {
  type: "SWARM_START",
  swarmId: SWARM_ID,
  presetName: "plan-build-review",
  agents: ["coordinator", "planner", "builder"],
  startedAt: 1000,
};
const AGENT_START: FeedAction = {
  type: "SWARM_AGENT_START",
  swarmId: SWARM_ID,
  agentName: "coordinator",
  contextMode: "shared",
  startedAt: 1010,
};

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

describe("subagent sessions", () => {
  it("creates a live session when a subagent is added", () => {
    const state = applyActions([
      { type: "APPEND_USER", id: "u1", text: "plan this" },
      {
        type: "ADD_SUBAGENT",
        subagent: {
          id: "sub-1",
          name: "planner",
          task: "Plan an API",
          status: "running",
          text: "",
          sessionId: "session-sub-1",
        },
      },
    ]);

    expect(state.sessions["session-sub-1"]).toMatchObject({
      id: "session-sub-1",
      name: "planner",
      type: "subagent",
      status: "running",
      parentTurnId: "sub-1",
      events: [],
    });
    const [turn] = getTurns(state);
    if (turn?.kind === "turn" && turn.events[0]?.kind === "subagent") {
      expect(turn.events[0].card.sessionId).toBe("session-sub-1");
      expect(turn.events[0].card.expanded).toBe(false);
    }
  });

  it("mirrors subagent response tokens into the child session and parent card", () => {
    const state = applyActions([
      { type: "APPEND_USER", id: "u1", text: "plan this" },
      {
        type: "ADD_SUBAGENT",
        subagent: {
          id: "sub-1",
          name: "planner",
          task: "Plan an API",
          status: "running",
          text: "",
          sessionId: "session-sub-1",
        },
      },
      { type: "APPEND_SUBAGENT_TOKEN", id: "session-sub-1", text: "Step 1" },
      { type: "APPEND_SUBAGENT_TOKEN", id: "session-sub-1", text: " done" },
    ]);

    expect(state.sessions["session-sub-1"].events).toEqual([
      { kind: "response", text: "Step 1 done" },
    ]);
    const [turn] = getTurns(state);
    if (turn?.kind === "turn" && turn.events[0]?.kind === "subagent") {
      expect(turn.events[0].card.text).toBe("Step 1 done");
    }
  });

  it("records subagent thinking in the child session", () => {
    const state = applyActions([
      { type: "APPEND_USER", id: "u1", text: "plan this" },
      {
        type: "ADD_SUBAGENT",
        subagent: {
          id: "sub-1",
          name: "planner",
          task: "Plan an API",
          status: "running",
          text: "",
          sessionId: "session-sub-1",
        },
      },
      { type: "APPEND_SESSION_THINK_TOKEN", sessionId: "session-sub-1", text: "Need " },
      { type: "APPEND_SESSION_THINK_TOKEN", sessionId: "session-sub-1", text: "schema" },
    ]);

    expect(state.sessions["session-sub-1"].events).toMatchObject([
      {
        kind: "thinking",
        text: "Need schema",
        expanded: true,
      },
    ]);
  });
});

// ── Swarm reducer tests ───────────────────────────────────────────────────────

describe("SWARM_START", () => {
  it("creates a swarm-turn entry with running status", () => {
    const state = applyActions([SWARM_START]);
    const swarms = getSwarmTurns(state);
    expect(swarms).toHaveLength(1);
    expect(swarms[0]).toMatchObject({
      kind: "swarm-turn",
      swarmId: SWARM_ID,
      presetName: "plan-build-review",
      status: "running",
      done: false,
      handoffCount: 0,
      agentSections: [],
      handoffs: [],
      artifactKeys: [],
    });
  });
});

describe("SWARM_AGENT_START", () => {
  it("appends a new agent section in running state", () => {
    const state = applyActions([SWARM_START, AGENT_START]);
    const [swarm] = getSwarmTurns(state);
    if (swarm?.kind !== "swarm-turn") return;
    expect(swarm.agentSections).toHaveLength(1);
    expect(swarm.agentSections[0]).toMatchObject({
      agentName: "coordinator",
      contextMode: "shared",
      status: "running",
      text: "",
      tools: [],
      expanded: true,
    });
  });
});

describe("SWARM_AGENT_TOKEN", () => {
  it("appends text to the active running section", () => {
    const state = applyActions([
      SWARM_START,
      AGENT_START,
      { type: "SWARM_AGENT_TOKEN", swarmId: SWARM_ID, agentName: "coordinator", text: "Hello " },
      { type: "SWARM_AGENT_TOKEN", swarmId: SWARM_ID, agentName: "coordinator", text: "world" },
    ]);
    const [swarm] = getSwarmTurns(state);
    if (swarm?.kind !== "swarm-turn") return;
    expect(swarm.agentSections[0].text).toBe("Hello world");
  });

  it("only updates the last running section for the named agent", () => {
    const state = applyActions([
      SWARM_START,
      AGENT_START,
      { type: "SWARM_AGENT_DONE", swarmId: SWARM_ID, agentName: "coordinator", completedAt: 1100 },
      { type: "SWARM_AGENT_START", swarmId: SWARM_ID, agentName: "coordinator", contextMode: "shared", startedAt: 1200 },
      { type: "SWARM_AGENT_TOKEN", swarmId: SWARM_ID, agentName: "coordinator", text: "second" },
    ]);
    const [swarm] = getSwarmTurns(state);
    if (swarm?.kind !== "swarm-turn") return;
    expect(swarm.agentSections[0].text).toBe("");
    expect(swarm.agentSections[1].text).toBe("second");
  });
});

describe("SWARM_TOOL_START + SWARM_TOOL_DONE", () => {
  it("adds a tool to the active section and marks it done", () => {
    const state = applyActions([
      SWARM_START,
      AGENT_START,
      {
        type: "SWARM_TOOL_START",
        swarmId: SWARM_ID,
        agentName: "coordinator",
        toolCall: { id: "t1", name: "list_files", args: { path: "." }, status: "running" },
      },
      {
        type: "SWARM_TOOL_DONE",
        swarmId: SWARM_ID,
        agentName: "coordinator",
        toolId: "t1",
        result: "src/ tests/",
        status: "done",
      },
    ]);
    const [swarm] = getSwarmTurns(state);
    if (swarm?.kind !== "swarm-turn") return;
    expect(swarm.agentSections[0].tools).toHaveLength(1);
    expect(swarm.agentSections[0].tools[0]).toMatchObject({
      id: "t1",
      name: "list_files",
      result: "src/ tests/",
      status: "done",
    });
  });

  it("marks a tool as error on SWARM_TOOL_DONE with status=error", () => {
    const state = applyActions([
      SWARM_START,
      AGENT_START,
      { type: "SWARM_TOOL_START", swarmId: SWARM_ID, agentName: "coordinator", toolCall: { id: "t1", name: "shell", args: {}, status: "running" } },
      { type: "SWARM_TOOL_DONE", swarmId: SWARM_ID, agentName: "coordinator", toolId: "t1", result: "not found", status: "error" },
    ]);
    const [swarm] = getSwarmTurns(state);
    if (swarm?.kind !== "swarm-turn") return;
    expect(swarm.agentSections[0].tools[0].status).toBe("error");
  });
});

describe("SWARM_AGENT_DONE", () => {
  it("marks the section done and collapsed", () => {
    const state = applyActions([
      SWARM_START,
      AGENT_START,
      { type: "SWARM_AGENT_DONE", swarmId: SWARM_ID, agentName: "coordinator", completedAt: 2000 },
    ]);
    const [swarm] = getSwarmTurns(state);
    if (swarm?.kind !== "swarm-turn") return;
    expect(swarm.agentSections[0].status).toBe("done");
    expect(swarm.agentSections[0].completedAt).toBe(2000);
    expect(swarm.agentSections[0].expanded).toBe(false);
  });
});

describe("SWARM_HANDOFF", () => {
  it("appends a handoff record and increments handoffCount", () => {
    const state = applyActions([
      SWARM_START,
      AGENT_START,
      { type: "SWARM_HANDOFF", swarmId: SWARM_ID, from: "coordinator", to: "planner", taskDescription: "Plan the feature", reasoning: "needs planning" },
    ]);
    const [swarm] = getSwarmTurns(state);
    if (swarm?.kind !== "swarm-turn") return;
    expect(swarm.handoffs).toHaveLength(1);
    expect(swarm.handoffs[0]).toMatchObject({ from: "coordinator", to: "planner", taskDescription: "Plan the feature" });
    expect(swarm.handoffCount).toBe(1);
  });
});

describe("SWARM_ARTIFACT", () => {
  it("adds artifact key once and deduplicates", () => {
    const state = applyActions([
      SWARM_START,
      { type: "SWARM_ARTIFACT", swarmId: SWARM_ID, key: "plan" },
      { type: "SWARM_ARTIFACT", swarmId: SWARM_ID, key: "plan" },
      { type: "SWARM_ARTIFACT", swarmId: SWARM_ID, key: "review" },
    ]);
    const [swarm] = getSwarmTurns(state);
    if (swarm?.kind !== "swarm-turn") return;
    expect(swarm.artifactKeys).toEqual(["plan", "review"]);
  });
});

describe("SWARM_VALIDATION_FAIL", () => {
  it("sets the active section status to error with reason", () => {
    const state = applyActions([
      SWARM_START,
      AGENT_START,
      { type: "SWARM_VALIDATION_FAIL", swarmId: SWARM_ID, agentName: "coordinator", reason: "Missing PASS/FAIL verdict" },
    ]);
    const [swarm] = getSwarmTurns(state);
    if (swarm?.kind !== "swarm-turn") return;
    expect(swarm.agentSections[0].status).toBe("error");
    expect(swarm.agentSections[0].errorReason).toBe("Missing PASS/FAIL verdict");
  });
});

describe("SWARM_CIRCUIT_BREAK", () => {
  it("sets swarm status to error with circuitBreakReason", () => {
    const state = applyActions([
      SWARM_START,
      { type: "SWARM_CIRCUIT_BREAK", swarmId: SWARM_ID, agent: "coordinator", reason: "Max handoffs exceeded" },
    ]);
    const [swarm] = getSwarmTurns(state);
    if (swarm?.kind !== "swarm-turn") return;
    expect(swarm.status).toBe("error");
    expect(swarm.circuitBreakReason).toBe("Max handoffs exceeded");
  });
});

describe("SWARM_DONE", () => {
  it("marks swarm done with final stats", () => {
    const state = applyActions([
      SWARM_START,
      { type: "SWARM_DONE", swarmId: SWARM_ID, handoffCount: 3, totalAgentRounds: 12, completedAt: 9999 },
    ]);
    const [swarm] = getSwarmTurns(state);
    if (swarm?.kind !== "swarm-turn") return;
    expect(swarm.done).toBe(true);
    expect(swarm.status).toBe("done");
    expect(swarm.handoffCount).toBe(3);
    expect(swarm.totalAgentRounds).toBe(12);
    expect(swarm.completedAt).toBe(9999);
  });
});

describe("SWARM_ERROR", () => {
  it("marks swarm done with error status", () => {
    const state = applyActions([
      SWARM_START,
      { type: "SWARM_ERROR", swarmId: SWARM_ID, message: "Provider unreachable" },
    ]);
    const [swarm] = getSwarmTurns(state);
    if (swarm?.kind !== "swarm-turn") return;
    expect(swarm.done).toBe(true);
    expect(swarm.status).toBe("error");
  });
});

describe("SWARM_TOGGLE_AGENT", () => {
  it("toggles the expanded state of an agent section", () => {
    const state = applyActions([SWARM_START, AGENT_START]);
    const [swarm0] = getSwarmTurns(state);
    if (swarm0?.kind !== "swarm-turn") return;
    const sectionId = swarm0.agentSections[0].sectionId;

    const toggled = feedReducer(state, { type: "SWARM_TOGGLE_AGENT", swarmId: SWARM_ID, sectionId });
    const [swarm1] = getSwarmTurns(toggled);
    if (swarm1?.kind !== "swarm-turn") return;
    expect(swarm1.agentSections[0].expanded).toBe(false);

    const reToggled = feedReducer(toggled, { type: "SWARM_TOGGLE_AGENT", swarmId: SWARM_ID, sectionId });
    const [swarm2] = getSwarmTurns(reToggled);
    if (swarm2?.kind !== "swarm-turn") return;
    expect(swarm2.agentSections[0].expanded).toBe(true);
  });
});

describe("LOAD_HISTORY", () => {
  it("reconstructs user and assistant messages", () => {
    const state = feedReducer(initialFeedState, {
      type: "LOAD_HISTORY",
      messages: [
        { role: "user", content: "Hello" },
        { role: "assistant", content: "Hi there" },
      ],
    });
    expect(state.entries).toHaveLength(2);
    expect(state.entries[0]).toMatchObject({ kind: "user", text: "Hello" });
    if (state.entries[1]?.kind === "turn") {
      expect(state.entries[1].events).toEqual([{ kind: "response", text: "Hi there" }]);
    }
  });

  it("preserves reasoning_content as a thinking block above the response", () => {
    const state = feedReducer(initialFeedState, {
      type: "LOAD_HISTORY",
      messages: [
        { role: "user", content: "Hello" },
        { role: "assistant", content: "Hi there", reasoning_content: "Let me greet the user." },
      ],
    });
    if (state.entries[1]?.kind === "turn") {
      expect(state.entries[1].events).toHaveLength(2);
      expect(state.entries[1].events[0]).toMatchObject({
        kind: "thinking",
        text: "Let me greet the user.",
        expanded: false,
      });
      expect(state.entries[1].events[1]).toMatchObject({
        kind: "response",
        text: "Hi there",
      });
    }
  });
});

describe("swarm actions on wrong swarmId", () => {
  it("does not mutate entries when swarmId does not match", () => {
    const state = applyActions([SWARM_START]);
    const next = feedReducer(state, { type: "SWARM_AGENT_START", swarmId: "other-id", agentName: "x", contextMode: "shared", startedAt: 0 });
    const [swarm] = getSwarmTurns(next);
    if (swarm?.kind !== "swarm-turn") return;
    expect(swarm.agentSections).toHaveLength(0);
  });
});
