import { describe, expect, it } from "vitest";
import { executeWorkers, formatWorkerResults } from "../src/harness/workerEngine.js";
import type { LLMProvider } from "../src/llm/provider.js";
import type { WorkerAssignment } from "../src/harness/types.js";
import type { FeedAction } from "../src/cli/state/feedReducer.js";

function createMockProvider(responses: Record<string, string>): LLMProvider {
  return {
    name: "ollama",
    async createChatModel() {
      throw new Error("Not implemented");
    },
    async generate(input) {
      // Use the system prompt to determine which role this is
      const role = input.systemPrompt?.includes("research analyst")
        ? "researcher"
        : input.systemPrompt?.includes("system architect")
        ? "planner"
        : input.systemPrompt?.includes("senior software engineer")
        ? "coder"
        : input.systemPrompt?.includes("code reviewer")
        ? "reviewer"
        : input.systemPrompt?.includes("QA engineer")
        ? "tester"
        : "orchestrator";
      return {
        text: responses[role] ?? `Default response for ${role}`,
        model: "mock-model",
      };
    },
    async *stream() {
      yield { type: "response.completed" as const };
    },
    async health() {
      return { ok: true, provider: "ollama" };
    },
  };
}

describe("executeWorkers", () => {
  it("executes multiple workers in parallel", async () => {
    const dispatched: FeedAction[] = [];
    const dispatch = (action: FeedAction) => dispatched.push(action);

    const provider = createMockProvider({
      researcher: "## Research Summary\nFound 3 relevant articles.\n## Key Findings\n- Finding 1\n- Finding 2",
      planner: "## Architecture Overview\nUse modular design.",
    });

    const assignments: WorkerAssignment[] = [
      { workerId: "w-1", role: "researcher", ownedScope: [], inputBundleId: "ctx-1", status: "queued" },
      { workerId: "w-2", role: "planner", ownedScope: [], inputBundleId: "ctx-1", status: "queued" },
    ];

    const results = await executeWorkers({
      assignments,
      taskText: "Build a login system",
      provider,
      model: "mock-model",
      dispatch,
      parentTurnId: "turn-1",
    });

    expect(results).toHaveLength(2);
    expect(results[0].role).toBe("researcher");
    expect(results[1].role).toBe("planner");
    expect(results[0].findings.length).toBeGreaterThan(0);
    expect(results[0].durationMs).toBeGreaterThanOrEqual(0);

    // Verify dispatch actions
    const addWorkerActions = dispatched.filter((a) => a.type === "ADD_WORKER");
    expect(addWorkerActions).toHaveLength(2);

    const updateWorkerActions = dispatched.filter((a) => a.type === "UPDATE_WORKER");
    expect(updateWorkerActions).toHaveLength(2);
    expect(updateWorkerActions.every((a) => "status" in a && (a as { status: string }).status === "done")).toBe(true);
  });

  it("returns empty array for no assignments", async () => {
    const dispatched: FeedAction[] = [];
    const results = await executeWorkers({
      assignments: [],
      taskText: "test",
      provider: createMockProvider({}),
      model: "mock-model",
      dispatch: (a) => dispatched.push(a),
      parentTurnId: "turn-1",
    });

    expect(results).toHaveLength(0);
    expect(dispatched).toHaveLength(0);
  });

  it("handles worker failures gracefully", async () => {
    const dispatched: FeedAction[] = [];
    const failingProvider: LLMProvider = {
      name: "ollama",
      async createChatModel() { throw new Error("Not implemented"); },
      async generate() { throw new Error("Network error"); },
      async *stream() { yield { type: "response.completed" as const }; },
      async health() { return { ok: true, provider: "ollama" }; },
    };

    const assignments: WorkerAssignment[] = [
      { workerId: "w-1", role: "coder", ownedScope: [], inputBundleId: "ctx-1", status: "queued" },
    ];

    const results = await executeWorkers({
      assignments,
      taskText: "Build a login system",
      provider: failingProvider,
      model: "mock-model",
      dispatch: (a) => dispatched.push(a),
      parentTurnId: "turn-1",
    });

    expect(results).toHaveLength(1);
    expect(results[0].summary).toContain("failed");
    expect(results[0].summary).toContain("Network error");

    const updateActions = dispatched.filter((a) => a.type === "UPDATE_WORKER");
    expect(updateActions).toHaveLength(1);
    expect((updateActions[0] as { status: string }).status).toBe("error");
  });
});

describe("formatWorkerResults", () => {
  it("formats worker results into a prompt section", () => {
    const results = [
      { workerId: "w-1", role: "researcher", summary: "Found 3 articles", findings: ["a", "b"], durationMs: 100 },
      { workerId: "w-2", role: "planner", summary: "Use modular design", findings: ["c"], durationMs: 200 },
    ];

    const formatted = formatWorkerResults(results);
    expect(formatted).toContain("--- Worker Analysis ---");
    expect(formatted).toContain("## researcher (100ms)");
    expect(formatted).toContain("## planner (200ms)");
    expect(formatted).toContain("Found 3 articles");
    expect(formatted).toContain("Use modular design");
  });

  it("returns empty string for no results", () => {
    expect(formatWorkerResults([])).toBe("");
  });
});
