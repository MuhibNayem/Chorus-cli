import { describe, expect, it, vi } from "vitest";
import { processAgentStream } from "../src/cli/agent/streamProcessor.js";
import type { AgentEvent } from "../src/agent/types.js";
import type { FeedAction } from "../src/cli/state/feedReducer.js";

function createIterator(events: AgentEvent[]): AsyncIterator<AgentEvent> {
  return (async function* () {
    for (const event of events) {
      yield event;
    }
  })();
}

describe("processAgentStream", () => {
  it("collects streamed tokens and reasoning, then returns final history", async () => {
    const dispatch = vi.fn() as (action: FeedAction) => void;
    const dbg = () => {};

    const result = await processAgentStream(
      createIterator([
        { type: "thinking", text: "Need context. " },
        { type: "token", text: "Hello" },
        { type: "token", text: " world" },
        {
          type: "done",
          response: "Hello world",
          reasoning: "Need context. ",
          toolCount: 0,
          history: [{ role: "assistant", content: "Hello world", reasoning_content: "Need context. " }],
        },
      ]),
      dispatch,
      dbg,
    );

    expect(result.responseText).toBe("Hello world");
    expect(result.reasoningContent).toBe("Need context.");
    expect(result.history.at(-1)).toMatchObject({ role: "assistant", content: "Hello world" });
  });

  it("tracks tool start and completion events", async () => {
    const dispatch = vi.fn() as (action: FeedAction) => void;
    const dbg = vi.fn();

    await processAgentStream(
      createIterator([
        { type: "tool-start", id: "tool-1", name: "run_command", args: { command: "npm test" } },
        { type: "tool-done", id: "tool-1", name: "run_command", result: "ok", durationMs: 12 },
        {
          type: "done",
          response: "Finished",
          reasoning: "",
          toolCount: 1,
          history: [{ role: "assistant", content: "Finished" }],
        },
      ]),
      dispatch,
      dbg,
    );

    expect(dispatch).toHaveBeenCalledWith({
      type: "ADD_TOOL_CALL",
      toolCall: {
        id: "tool-1",
        name: "run_command",
        args: { command: "npm test" },
        status: "running",
      },
    });
    expect(dispatch).toHaveBeenCalledWith({
      type: "UPDATE_TOOL_CALL",
      id: "tool-1",
      result: "ok",
      status: "done",
    });
  });

  it("returns HITL interrupts without closing the active run", async () => {
    const dispatch = vi.fn() as (action: FeedAction) => void;
    const dbg = () => {};

    const result = await processAgentStream(
      createIterator([
        {
          type: "hitl",
          resumeKey: "hitl-1",
          requests: [{ id: "tool-1", name: "run_command", args: { command: "npm run build" } }],
        },
      ]),
      dispatch,
      dbg,
    );

    expect(result.interrupt).toEqual({
      resumeKey: "hitl-1",
      actionRequests: [{ id: "tool-1", name: "run_command", args: { command: "npm run build" } }],
    });
  });

  it("marks unresolved tool calls complete when the loop ends unexpectedly", async () => {
    const dispatch = vi.fn() as (action: FeedAction) => void;
    const dbg = vi.fn();

    await processAgentStream(
      createIterator([
        { type: "tool-start", id: "tool-1", name: "run_command", args: { command: "npm test" } },
      ]),
      dispatch,
      dbg,
    );

    expect(dispatch).toHaveBeenCalledWith({
      type: "UPDATE_TOOL_CALL",
      id: "tool-1",
      result: "Tool call ended without a result from the agent loop.",
      status: "done",
    });
  });

  it("surfaces fatal runtime errors to the feed", async () => {
    const dispatch = vi.fn() as (action: FeedAction) => void;
    const dbg = vi.fn();

    const result = await processAgentStream(
      createIterator([
        { type: "error", message: "Agent loop exceeded max rounds (500).", fatal: true },
      ]),
      dispatch,
      dbg,
    );

    expect(result.hadError).toBe(true);
    expect(dispatch).toHaveBeenCalledWith({
      type: "APPEND_SYSTEM",
      id: expect.any(String),
      text: "Stream interrupted: Agent loop exceeded max rounds (500).",
    });
  });
});
