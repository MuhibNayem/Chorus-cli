import * as fs from "fs";
import * as path from "path";
import { afterEach, describe, expect, it } from "vitest";
import { BtwQueue } from "../src/agent/btw.js";
import { JsonFileCheckpointer } from "../src/agent/checkpointer.js";
import { HitlGate } from "../src/agent/hitl.js";
import { runAgentLoop } from "../src/agent/loop.js";
import type { AgentEvent, AgentTool } from "../src/agent/types.js";
import type { LLMProvider, ToolDef, ToolStreamEvent } from "../src/llm/provider.js";

class FakeProvider implements LLMProvider {
  readonly name = "ollama" as const;

  constructor(
    private readonly rounds: Array<Array<ToolStreamEvent>>,
  ) {}

  async generate() {
    return { text: "", model: "fake" };
  }

  async *stream(): AsyncIterable<any> {
    yield { type: "response.completed" as const };
  }

  async *streamWithTools(_input: { model: string; messages: any[]; systemPrompt?: string; tools: ToolDef[] }): AsyncIterable<ToolStreamEvent> {
    const next = this.rounds.shift() ?? [{ type: "done" as const, response: { content: "" } }];
    for (const event of next) {
      yield event;
    }
  }

  async health() {
    return { ok: true, provider: this.name };
  }
}

async function collect(stream: AsyncIterable<AgentEvent>): Promise<AgentEvent[]> {
  const events: AgentEvent[] = [];
  for await (const event of stream) {
    events.push(event);
  }
  return events;
}

describe("runAgentLoop", () => {
  afterEach(() => {
    delete process.env.CHORUS_HOME_DIR;
  });

  it("executes a tool round and returns the final assistant response", async () => {
    const homeDir = fs.mkdtempSync(path.join("/tmp", "chorus-loop-"));
    process.env.CHORUS_HOME_DIR = homeDir;

    const provider = new FakeProvider([
      [
        { type: "token", text: "Searching..." },
        {
          type: "done",
          response: {
            content: "Searching...",
            tool_calls: [
              {
                id: "tool-1",
                type: "function",
                function: {
                  name: "internet_search",
                  arguments: '{"query":"iphone"}',
                },
              },
            ],
          },
        },
      ],
      [
        { type: "token", text: "Here you go." },
        {
          type: "done",
          response: {
            content: "Here you go.",
          },
        },
      ],
    ]);

    const tools: AgentTool[] = [
      {
        name: "internet_search",
        description: "Search",
        async invoke(input) {
          return `ok: ${(input as { query: string }).query}`;
        },
      },
    ];

    const events = await collect(
      runAgentLoop({
        provider,
        model: "fake-model",
        tools,
        messages: [{ role: "user", content: "Find it" }],
        systemPrompt: "Be useful.",
        threadId: "thread-1",
        hitlGate: new HitlGate(),
        btwQueue: new BtwQueue(),
        policy: "full_auto",
        checkpointer: new JsonFileCheckpointer(),
      }),
    );

    expect(events.some((event) => event.type === "tool-start")).toBe(true);
    expect(events.some((event) => event.type === "tool-done")).toBe(true);
    expect(events.at(-1)).toMatchObject({
      type: "done",
      response: "Here you go.",
    });
  });

  it("pauses on HITL tools and can resume after approval", async () => {
    const homeDir = fs.mkdtempSync(path.join("/tmp", "chorus-hitl-"));
    process.env.CHORUS_HOME_DIR = homeDir;

    const provider = new FakeProvider([
      [
        {
          type: "done",
          response: {
            content: "",
            tool_calls: [
              {
                id: "tool-1",
                type: "function",
                function: {
                  name: "run_command",
                  arguments: '{"command":"npm test"}',
                },
              },
            ],
          },
        },
      ],
      [
        {
          type: "done",
          response: {
            content: "Done",
          },
        },
      ],
    ]);

    const hitlGate = new HitlGate();
    const iterator = runAgentLoop({
      provider,
      model: "fake-model",
      tools: [
        {
          name: "run_command",
          async invoke() {
            return "ok";
          },
        },
      ],
      messages: [{ role: "user", content: "Run it" }],
      systemPrompt: "Be useful.",
      threadId: "thread-2",
      hitlGate,
      btwQueue: new BtwQueue(),
      policy: "auto_edit",
      checkpointer: new JsonFileCheckpointer(),
    })[Symbol.asyncIterator]();

    const first = await iterator.next();
    expect(first.value).toMatchObject({ type: "checkpoint" });
    const second = await iterator.next();
    expect(second.value).toMatchObject({
      type: "hitl",
      resumeKey: "hitl-thread-2-0",
    });

    hitlGate.resolve("hitl-thread-2-0", { type: "approve" });

    const third = await iterator.next();
    expect(third.value).toMatchObject({ type: "tool-start", name: "run_command" });
    const remaining: AgentEvent[] = [];
    while (true) {
      const item = await iterator.next();
      if (item.done || !item.value) break;
      remaining.push(item.value);
    }
    expect(remaining.at(-1)).toMatchObject({ type: "done", response: "Done" });
  });

  it("writes checkpoints that can be loaded later", async () => {
    const homeDir = fs.mkdtempSync(path.join("/tmp", "chorus-checkpoint-"));
    process.env.CHORUS_HOME_DIR = homeDir;

    const checkpointer = new JsonFileCheckpointer();
    await collect(
      runAgentLoop({
        provider: new FakeProvider([
          [{ type: "done", response: { content: "Complete" } }],
        ]),
        model: "fake-model",
        tools: [],
        messages: [{ role: "user", content: "Hello" }],
        systemPrompt: "Be useful.",
        threadId: "thread-3",
        hitlGate: new HitlGate(),
        btwQueue: new BtwQueue(),
        policy: "full_auto",
        checkpointer,
      }),
    );

    const checkpoint = await checkpointer.load("thread-3");
    expect(checkpoint?.messages.at(-1)).toMatchObject({ role: "assistant", content: "Complete" });
  });

  it("stops and returns done when HITL is denied", async () => {
    const homeDir = fs.mkdtempSync(path.join("/tmp", "chorus-deny-"));
    process.env.CHORUS_HOME_DIR = homeDir;

    const provider = new FakeProvider([
      [
        {
          type: "done",
          response: {
            content: "",
            tool_calls: [
              { id: "t1", type: "function", function: { name: "run_command", arguments: '{"command":"rm -rf /"}' } },
            ],
          },
        },
      ],
    ]);

    const hitlGate = new HitlGate();
    const iterator = runAgentLoop({
      provider,
      model: "fake-model",
      tools: [{ name: "run_command", async invoke() { return "ok"; } }],
      messages: [{ role: "user", content: "Do it" }],
      systemPrompt: "Be useful.",
      threadId: "thread-deny",
      hitlGate,
      btwQueue: new BtwQueue(),
      policy: "auto_edit",
      checkpointer: new JsonFileCheckpointer(),
    })[Symbol.asyncIterator]();

    // checkpoint, then hitl
    await iterator.next(); // checkpoint
    const hitlEvent = await iterator.next();
    expect(hitlEvent.value).toMatchObject({ type: "hitl" });

    hitlGate.resolve("hitl-thread-deny-0", { type: "reject", message: "Not allowed." });

    const events: AgentEvent[] = [];
    while (true) {
      const item = await iterator.next();
      if (item.done || !item.value) break;
      events.push(item.value);
    }

    // Should get checkpoint + done; no tool-start
    expect(events.some((e) => e.type === "tool-start")).toBe(false);
    expect(events.at(-1)).toMatchObject({ type: "done" });
    // The denial message should appear in history
    const doneEvent = events.find((e) => e.type === "done") as Extract<AgentEvent, { type: "done" }> | undefined;
    expect(doneEvent?.history.some((m) => m.role === "user" && m.content === "Not allowed.")).toBe(true);
  });

  it("session-approves a tool so subsequent calls skip the gate", async () => {
    const homeDir = fs.mkdtempSync(path.join("/tmp", "chorus-session-"));
    process.env.CHORUS_HOME_DIR = homeDir;

    const callsBlocked: string[] = [];
    const callsExecuted: string[] = [];

    const provider = new FakeProvider([
      [
        {
          type: "done",
          response: {
            content: "",
            tool_calls: [
              { id: "t1", type: "function", function: { name: "run_command", arguments: '{"command":"echo 1"}' } },
            ],
          },
        },
      ],
      [{ type: "done", response: { content: "Done" } }],
    ]);

    const hitlGate = new HitlGate();
    const iterator = runAgentLoop({
      provider,
      model: "fake-model",
      tools: [
        {
          name: "run_command",
          async invoke(input) {
            callsExecuted.push((input as { command: string }).command);
            return "ok";
          },
        },
      ],
      messages: [{ role: "user", content: "Run it" }],
      systemPrompt: "Be useful.",
      threadId: "thread-session",
      hitlGate,
      btwQueue: new BtwQueue(),
      policy: "auto_edit",
      checkpointer: new JsonFileCheckpointer(),
    })[Symbol.asyncIterator]();

    await iterator.next(); // checkpoint
    const hitlEvent = await iterator.next();
    expect(hitlEvent.value).toMatchObject({ type: "hitl" });

    // Approve for the session — run_command should not gate again on the same hitlGate instance
    hitlGate.resolve("hitl-thread-session-0", { type: "approve_session", toolNames: ["run_command"] });

    const events: AgentEvent[] = [];
    while (true) {
      const item = await iterator.next();
      if (item.done || !item.value) break;
      events.push(item.value);
    }

    expect(events.some((e) => e.type === "tool-start")).toBe(true);
    expect(callsExecuted).toContain("echo 1");
    expect(callsBlocked).toHaveLength(0);
    // Gate should now consider run_command session-approved
    expect(hitlGate.shouldPause(
      [{ id: "t2", type: "function", function: { name: "run_command", arguments: "{}" } }],
      "auto_edit",
    )).toBe(false);
  });

  it("does not restore a completed-turn checkpoint when starting a new turn", async () => {
    const homeDir = fs.mkdtempSync(path.join("/tmp", "chorus-multiturn-"));
    process.env.CHORUS_HOME_DIR = homeDir;

    const checkpointer = new JsonFileCheckpointer();

    // Turn 1
    const turn1Messages = [{ role: "user" as const, content: "Hello" }];
    await collect(
      runAgentLoop({
        provider: new FakeProvider([[{ type: "done", response: { content: "Hi there" } }]]),
        model: "fake-model",
        tools: [],
        messages: turn1Messages,
        systemPrompt: "Be useful.",
        threadId: "thread-multi",
        hitlGate: new HitlGate(),
        btwQueue: new BtwQueue(),
        policy: "full_auto",
        checkpointer,
      }),
    );

    // Turn 2: caller appends new user message to the existing array
    const turn2Messages = [
      { role: "user" as const, content: "Hello" },
      { role: "assistant" as const, content: "Hi there" },
      { role: "user" as const, content: "How are you?" },
    ];
    const turn2Events = await collect(
      runAgentLoop({
        provider: new FakeProvider([[{ type: "done", response: { content: "Fine, thanks!" } }]]),
        model: "fake-model",
        tools: [],
        messages: turn2Messages,
        systemPrompt: "Be useful.",
        threadId: "thread-multi",
        hitlGate: new HitlGate(),
        btwQueue: new BtwQueue(),
        policy: "full_auto",
        checkpointer,
      }),
    );

    const doneEvent = turn2Events.find((e) => e.type === "done") as Extract<AgentEvent, { type: "done" }> | undefined;
    // The new user message must be present in the history the loop used
    expect(doneEvent?.history.some((m) => m.role === "user" && m.content === "How are you?")).toBe(true);
  });

  it("supports checkpointer fork and loadAt for time travel", async () => {
    const homeDir = fs.mkdtempSync(path.join("/tmp", "chorus-fork-"));
    process.env.CHORUS_HOME_DIR = homeDir;

    const checkpointer = new JsonFileCheckpointer();

    // Run a two-round loop: round 0 calls a tool (checkpoint saved as round 1 after
    // tool execution), round 1 has no tools (final done checkpoint also at round 1).
    await collect(
      runAgentLoop({
        provider: new FakeProvider([
          [
            {
              type: "done",
              response: {
                content: "searching",
                tool_calls: [
                  { id: "t1", type: "function", function: { name: "noop", arguments: "{}" } },
                ],
              },
            },
          ],
          [{ type: "done", response: { content: "all done" } }],
        ]),
        model: "fake-model",
        tools: [{ name: "noop", async invoke() { return "ok"; } }],
        messages: [{ role: "user", content: "Go" }],
        systemPrompt: "Be useful.",
        threadId: "thread-fork",
        hitlGate: new HitlGate(),
        btwQueue: new BtwQueue(),
        policy: "full_auto",
        checkpointer,
      }),
    );

    // After tool execution the loop increments round to 1 before saving, so the
    // post-tool checkpoint is stored as round 1.
    const round1 = await checkpointer.loadAt("thread-fork", 1);
    expect(round1).not.toBeNull();
    // The checkpoint should include the tool result message
    expect(round1?.messages.some((m) => m.role === "tool")).toBe(true);

    // Fork from round 1 into a new thread (time travel)
    await checkpointer.fork("thread-fork", 1, "thread-fork-v2");
    const forked = await checkpointer.load("thread-fork-v2");
    expect(forked).not.toBeNull();
    expect(forked?.messages).toEqual(round1?.messages);
  });
});
