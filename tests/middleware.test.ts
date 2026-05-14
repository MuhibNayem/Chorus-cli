import * as fs from "fs";
import * as path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BtwQueue } from "../src/agent/btw.js";
import { JsonFileCheckpointer } from "../src/agent/checkpointer.js";
import { HitlGate } from "../src/agent/hitl.js";
import { runAgentLoop } from "../src/agent/loop.js";
import {
  LargeOutputOffloadMiddleware,
  ObservabilityMiddleware,
  SummarizationMiddleware,
  TodoMiddleware,
} from "../src/agent/middleware.js";
import { FileMemoryStore } from "../src/agent/memory-store.js";
import type { AgentEvent } from "../src/agent/types.js";
import type { LLMProvider, ToolDef, ToolStreamEvent } from "../src/llm/provider.js";

// ─── helpers ─────────────────────────────────────────────────────────────────

class FakeProvider implements LLMProvider {
  readonly name = "ollama" as const;
  private rounds: Array<Array<ToolStreamEvent>>;

  constructor(rounds: Array<Array<ToolStreamEvent>>) {
    this.rounds = rounds;
  }

  async generate() { return { text: "", model: "fake" }; }
  async *stream(): AsyncIterable<any> { yield { type: "response.completed" as const }; }

  async *streamWithTools(_input: { model: string; messages: any[]; systemPrompt?: string; tools: ToolDef[] }): AsyncIterable<ToolStreamEvent> {
    const next = this.rounds.shift() ?? [{ type: "done" as const, response: { content: "" } }];
    for (const ev of next) yield ev;
  }

  async health() { return { ok: true, provider: this.name }; }
}

async function collect(stream: AsyncIterable<AgentEvent>): Promise<AgentEvent[]> {
  const events: AgentEvent[] = [];
  for await (const event of stream) events.push(event);
  return events;
}

let homeDir: string;

beforeEach(() => {
  homeDir = fs.mkdtempSync(path.join("/tmp", "chorus-mw-"));
  process.env.CHORUS_HOME_DIR = homeDir;
});

afterEach(() => {
  delete process.env.CHORUS_HOME_DIR;
  vi.restoreAllMocks();
});

// ─── FileMemoryStore ──────────────────────────────────────────────────────────

describe("FileMemoryStore", () => {
  it("put/get/list/delete/search", async () => {
    const store = new FileMemoryStore();
    const ns = "test-ns";

    expect(await store.get(ns, "missing")).toBeNull();

    await store.put(ns, "greeting", "hello world");
    expect(await store.get(ns, "greeting")).toBe("hello world");

    await store.put(ns, "farewell", "goodbye");
    const keys = await store.list(ns);
    expect(keys).toContain("greeting");
    expect(keys).toContain("farewell");

    const results = await store.search(ns, "hello");
    expect(results.some((r) => r.key === "greeting" && r.value === "hello world")).toBe(true);

    await store.delete(ns, "greeting");
    expect(await store.get(ns, "greeting")).toBeNull();
    const keysAfter = await store.list(ns);
    expect(keysAfter).not.toContain("greeting");
  });

  it("sanitizes unsafe key characters", async () => {
    const store = new FileMemoryStore();
    await store.put("ns", "path/to/../key", "value");
    expect(await store.get("ns", "path/to/../key")).toBe("value");
  });
});

// ─── LargeOutputOffloadMiddleware ─────────────────────────────────────────────

describe("LargeOutputOffloadMiddleware", () => {
  it("passes through small results unchanged", async () => {
    const mw = new LargeOutputOffloadMiddleware();
    const result = await mw.afterTool({ id: "t1", name: "noop", result: "small", durationMs: 1 });
    expect(result).toBeUndefined();
  });

  it("offloads large results to disk and returns a summary", async () => {
    const mw = new LargeOutputOffloadMiddleware();
    const large = "x".repeat(9_000);
    const result = await mw.afterTool({ id: "t2", name: "big_tool", result: large, durationMs: 5 });
    expect(result).toContain("offloaded");
    expect(result).toContain("t2.txt");
    const offloadPath = path.join(homeDir, "tool-outputs", "t2.txt");
    expect(fs.existsSync(offloadPath)).toBe(true);
    expect(fs.readFileSync(offloadPath, "utf-8")).toBe(large);
  });
});

// ─── ObservabilityMiddleware ──────────────────────────────────────────────────

describe("ObservabilityMiddleware", () => {
  it("writes a JSONL file after afterRound", async () => {
    const mw = new ObservabilityMiddleware("thread-obs");
    const ctx = { round: 0, threadId: "thread-obs", model: "fake", history: [], toolCallsThisRound: 1 };
    await mw.beforeRound(ctx);
    await mw.afterTool({ id: "t1", name: "search", result: "ok", durationMs: 10 });
    await mw.afterRound({ ...ctx, round: 1 });

    const runFiles = fs.readdirSync(path.join(homeDir, "runs"));
    expect(runFiles.length).toBeGreaterThan(0);

    const logContent = fs.readFileSync(path.join(homeDir, "runs", runFiles[0]), "utf-8");
    const lines = logContent.trim().split("\n").map((l) => JSON.parse(l));
    expect(lines.some((l) => l.type === "round-start")).toBe(true);
    expect(lines.some((l) => l.type === "tool-done" && l.name === "search")).toBe(true);
    expect(lines.some((l) => l.type === "round-end")).toBe(true);
  });
});

// ─── SummarizationMiddleware ──────────────────────────────────────────────────

describe("SummarizationMiddleware", () => {
  it("returns null when under threshold", async () => {
    const mw = new SummarizationMiddleware("thread-sum");
    const history = [{ role: "user" as const, content: "short" }];
    const result = await mw.maybeCompact(history, { model: "fake-model", systemPrompt: "sys" });
    expect(result).toBeNull();
  });

  it("compacts and saves history snapshot when over threshold", async () => {
    const { shouldCompact, compactMessages } = await import("../src/context/compaction.js");
    vi.spyOn(await import("../src/context/compaction.js"), "shouldCompact").mockResolvedValue(true);
    vi.spyOn(await import("../src/context/compaction.js"), "compactMessages").mockResolvedValue({
      summary: "Summary of past events",
      originalCount: 50_000,
      compressedCount: 5_000,
      messages: [{ role: "system", content: "[Previous conversation summary: Summary of past events]" }],
    });

    const mw = new SummarizationMiddleware("thread-sum2");
    const history = [
      { role: "user" as const, content: "a".repeat(1000) },
      { role: "assistant" as const, content: "b".repeat(1000) },
    ];
    const result = await mw.maybeCompact([...history], { model: "fake-model", systemPrompt: "sys" });

    expect(result).not.toBeNull();
    expect(result!.savedTokens).toBe(45_000);
    expect(result!.replacement[0].content).toContain("Summary");

    // History snapshot should have been written
    const snapshotPath = path.join(homeDir, "history", "thread-sum2.md");
    expect(fs.existsSync(snapshotPath)).toBe(true);
  });
});

// ─── TodoMiddleware ───────────────────────────────────────────────────────────

describe("TodoMiddleware", () => {
  it("exposes todo_read and todo_write tools", async () => {
    const mw = new TodoMiddleware();
    const tools = mw.extraTools();
    expect(tools.map((t) => t.name)).toContain("todo_read");
    expect(tools.map((t) => t.name)).toContain("todo_write");
  });

  it("writes and reads todo content", async () => {
    const mw = new TodoMiddleware();
    const tools = mw.extraTools();
    const write = tools.find((t) => t.name === "todo_write")!;
    const read = tools.find((t) => t.name === "todo_read")!;

    await write.invoke({ content: "- [ ] Task A\n- [ ] Task B" });
    const content = await read.invoke({});
    expect(content).toContain("Task A");
    expect(content).toContain("Task B");
  });

  it("includes extra system prompt", () => {
    const mw = new TodoMiddleware();
    expect(mw.extraSystemPrompt()).toContain("todo");
  });
});

// ─── Loop integration: middleware hooks fire ──────────────────────────────────

describe("runAgentLoop with middleware", () => {
  it("fires beforeRound and afterRound on each loop iteration", async () => {
    const calls: string[] = [];
    const mw = {
      async beforeRound() { calls.push("before"); },
      async afterRound() { calls.push("after"); },
    };

    await collect(
      runAgentLoop({
        provider: new FakeProvider([[{ type: "done", response: { content: "Done" } }]]),
        model: "fake",
        tools: [],
        messages: [{ role: "user", content: "Go" }],
        systemPrompt: "sys",
        threadId: "thread-mw1",
        hitlGate: new HitlGate(),
        btwQueue: new BtwQueue(),
        policy: "full_auto",
        checkpointer: new JsonFileCheckpointer(),
        middleware: [mw],
      }),
    );

    expect(calls).toContain("before");
    // No tools → no afterRound (loop exits before incrementing round)
    // beforeRound fires once for round 0
    expect(calls.filter((c) => c === "before").length).toBe(1);
  });

  it("afterRound fires after tool execution and beforeRound for next round", async () => {
    const calls: Array<{ type: string; round: number }> = [];
    const mw = {
      async beforeRound(ctx: { round: number }) { calls.push({ type: "before", round: ctx.round }); },
      async afterRound(ctx: { round: number }) { calls.push({ type: "after", round: ctx.round }); },
    };

    await collect(
      runAgentLoop({
        provider: new FakeProvider([
          [{
            type: "done",
            response: {
              content: "",
              tool_calls: [{ id: "t1", type: "function", function: { name: "noop", arguments: "{}" } }],
            },
          }],
          [{ type: "done", response: { content: "Finished" } }],
        ]),
        model: "fake",
        tools: [{ name: "noop", async invoke() { return "ok"; } }],
        messages: [{ role: "user", content: "Go" }],
        systemPrompt: "sys",
        threadId: "thread-mw2",
        hitlGate: new HitlGate(),
        btwQueue: new BtwQueue(),
        policy: "full_auto",
        checkpointer: new JsonFileCheckpointer(),
        middleware: [mw],
      }),
    );

    // Round 0: before → (tool) → after. Round 1: before → (no tools) → done
    expect(calls[0]).toMatchObject({ type: "before", round: 0 });
    expect(calls[1]).toMatchObject({ type: "after" }); // after round 0 tools
    expect(calls[2]).toMatchObject({ type: "before", round: 1 });
  });

  it("yields compacted event when maybeCompact returns a result", async () => {
    const replacement = [{ role: "system" as const, content: "[summary]" }];
    const mw = {
      async maybeCompact() {
        return { replacement, removedMessages: 5, savedTokens: 10_000 };
      },
    };

    const events = await collect(
      runAgentLoop({
        provider: new FakeProvider([[{ type: "done", response: { content: "Done" } }]]),
        model: "fake",
        tools: [],
        messages: [{ role: "user", content: "Go" }],
        systemPrompt: "sys",
        threadId: "thread-compact",
        hitlGate: new HitlGate(),
        btwQueue: new BtwQueue(),
        policy: "full_auto",
        checkpointer: new JsonFileCheckpointer(),
        middleware: [mw],
      }),
    );

    const compacted = events.find((e) => e.type === "compacted");
    expect(compacted).toMatchObject({ type: "compacted", removedMessages: 5, savedTokens: 10_000 });
  });

  it("extraTools from middleware are invocable inside the loop", async () => {
    const invoked: string[] = [];
    const mw = {
      extraTools() {
        return [{
          name: "mw_tool",
          async invoke(input: unknown) {
            invoked.push((input as { q: string }).q);
            return "mw_result";
          },
        }];
      },
    };

    const events = await collect(
      runAgentLoop({
        provider: new FakeProvider([
          [{
            type: "done",
            response: {
              content: "",
              tool_calls: [{ id: "t1", type: "function", function: { name: "mw_tool", arguments: '{"q":"hello"}' } }],
            },
          }],
          [{ type: "done", response: { content: "Done" } }],
        ]),
        model: "fake",
        tools: [],
        messages: [{ role: "user", content: "Go" }],
        systemPrompt: "sys",
        threadId: "thread-extratool",
        hitlGate: new HitlGate(),
        btwQueue: new BtwQueue(),
        policy: "full_auto",
        checkpointer: new JsonFileCheckpointer(),
        middleware: [mw],
      }),
    );

    expect(invoked).toContain("hello");
    expect(events.some((e) => e.type === "tool-done")).toBe(true);
  });

  it("afterTool can transform the result stored in history", async () => {
    const mw = {
      async afterTool(ctx: { result: string }) {
        return `[transformed] ${ctx.result}`;
      },
    };

    const events = await collect(
      runAgentLoop({
        provider: new FakeProvider([
          [{
            type: "done",
            response: {
              content: "",
              tool_calls: [{ id: "t1", type: "function", function: { name: "echo", arguments: '{"msg":"original"}' } }],
            },
          }],
          [{ type: "done", response: { content: "Done" } }],
        ]),
        model: "fake",
        tools: [{ name: "echo", async invoke(input: unknown) { return (input as { msg: string }).msg; } }],
        messages: [{ role: "user", content: "Go" }],
        systemPrompt: "sys",
        threadId: "thread-transform",
        hitlGate: new HitlGate(),
        btwQueue: new BtwQueue(),
        policy: "full_auto",
        checkpointer: new JsonFileCheckpointer(),
        middleware: [mw],
      }),
    );

    const done = events.find((e) => e.type === "done") as Extract<AgentEvent, { type: "done" }> | undefined;
    const toolMsg = done?.history.find((m) => m.role === "tool");
    expect(toolMsg?.content).toBe("[transformed] original");
  });
});
