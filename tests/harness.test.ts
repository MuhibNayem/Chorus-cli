import { describe, expect, it } from "vitest";
import {
  prepareTaskExecution,
  routeTask,
  summarizeWorkerAssignment,
  verifyTaskCompletion,
  WorkerPool,
} from "../src/harness/index.js";
import { filterToolsForPolicy, toolNamesForPolicy } from "../src/cli/hooks/agent/toolPolicy.js";

describe("routeTask", () => {
  it("routes simple work directly without worker orchestration", () => {
    const route = routeTask({
      text: "what does this project do?",
      expandedText: "what does this project do?",
    });

    expect(route.lane).toBe("cheap_triage");
    expect(route.path).toBe("direct_agent_path");
    expect(route.usesCheapTriage).toBe(true);
  });

  it("routes freshness-sensitive work to the research path", () => {
    const route = routeTask({
      text: "search web for the latest vLLM Gemma support",
      expandedText: "search web for the latest vLLM Gemma support",
    });

    expect(route.path).toBe("research_then_plan_path");
    expect(route.requiresResearch).toBe(true);
    expect(route.kind).toBe("research");
  });

  it("classifies edit work with verification and diff-review criteria", () => {
    const prepared = prepareTaskExecution({
      text: "fix the broken model selector",
      expandedText: "fix the broken model selector",
      basePrompt: "system prompt",
      messages: [{ role: "user", content: "fix the broken model selector" }],
    });

    expect(prepared.route.kind).toBe("single_file_edit");
    expect(prepared.protocol.stages).toEqual([
      "classified",
      "inspected",
      "planned",
      "edited",
      "verified",
      "reviewed",
      "finalized",
    ]);
    expect(prepared.protocol.requiresVerification).toBe(true);
    expect(prepared.runtimePrompt).toContain("## Execution Protocol");
    expect(prepared.runtimePrompt).toContain("## Repository Intelligence");
    expect(prepared.runtimePrompt).toContain("## Project Memory");
    expect(prepared.task.verificationCriteria.map((c) => c.id)).toEqual(
      expect.arrayContaining(["diff-review", "verification"])
    );
  });

  it("makes plan mode read-only and plan-finalized", () => {
    const prepared = prepareTaskExecution({
      text: "fix the broken model selector",
      expandedText: "fix the broken model selector",
      basePrompt: "system prompt",
      messages: [{ role: "user", content: "fix the broken model selector" }],
      mode: "plan",
    });

    expect(prepared.mode).toBe("plan");
    expect(prepared.workerAssignments).toHaveLength(0);
    expect(prepared.protocol.stages).toEqual(["classified", "inspected", "planned", "finalized"]);
    expect(prepared.task.verificationCriteria.map((c) => c.id)).toContain("plan-only");
    expect(prepared.task.verificationCriteria.map((c) => c.id)).not.toContain("diff-review");
  });

  it("maps approval policy to tool capability sets", () => {
    expect(toolNamesForPolicy("plan", "full_auto")?.has("write_file")).toBe(false);
    expect(toolNamesForPolicy("build", "suggest")?.has("edit_file")).toBe(false);
    expect(toolNamesForPolicy("build", "auto_edit")?.has("edit_file")).toBe(true);
    expect(toolNamesForPolicy("build", "auto_edit")?.has("run_command")).toBe(false);
    expect(toolNamesForPolicy("build", "full_auto")).toBeNull();
  });

  it("filters MCP tools conservatively outside full automation", () => {
    const tools = [
      { name: "read_file" },
      { name: "mcp__docs__search", mcpServerName: "docs", mcpReadOnly: true },
      { name: "mcp__jira__create_issue", mcpServerName: "jira", mcpReadOnly: false },
    ];

    expect(filterToolsForPolicy(tools, "plan", "full_auto").map((t) => t.name)).toEqual([
      "read_file",
      "mcp__docs__search",
    ]);
    expect(filterToolsForPolicy(tools, "build", "suggest").map((t) => t.name)).toEqual([
      "read_file",
      "mcp__docs__search",
    ]);
    expect(filterToolsForPolicy(tools, "build", "auto_edit").map((t) => t.name)).toContain("mcp__jira__create_issue");
  });

  it("routes broad repo work to background async", () => {
    const route = routeTask({
      text: "audit the full codebase",
      expandedText: "audit the full codebase",
    });

    expect(route.lane).toBe("background_async");
    expect(route.path).toBe("background_or_batch_path");
  });
});

describe("prepareTaskExecution", () => {
  it("does not create worker assignments for direct simple tasks", () => {
    const prepared = prepareTaskExecution({
      text: "simple task",
      expandedText: "simple task",
      basePrompt: "system prompt",
      messages: [{ role: "user", content: "simple task" }],
    });

    expect(prepared.route.path).toBe("direct_agent_path");
    expect(prepared.workerAssignments).toHaveLength(0);
    expect(prepared.runtimePrompt).toContain("direct-agent:(main conversation owns execution)");
  });

  it("creates task, context, worker assignments, and runtime prompt", () => {
    const prepared = prepareTaskExecution({
      text: "update src/foo.ts and src/bar.ts",
      expandedText: "[File: src/foo.ts]\n[File: src/bar.ts]",
      basePrompt: "system prompt",
      messages: [{ role: "user", content: "update src/foo.ts and src/bar.ts" }],
    });

    expect(prepared.task.status).toBe("running");
    expect(prepared.contextBundle.id).toBe(`ctx-${prepared.task.taskId}`);
    expect(prepared.workerAssignments.length).toBeGreaterThan(1);
    expect(prepared.runtimePrompt).toContain("## Harness Task");
  });

  it("creates a single worker only for complex single-worker tasks", () => {
    const prepared = prepareTaskExecution({
      text: "investigate the root cause of the failing release flow",
      expandedText: "investigate the root cause of the failing release flow",
      basePrompt: "system prompt",
      messages: [{ role: "user", content: "investigate the root cause of the failing release flow" }],
    });

    expect(prepared.route.path).toBe("tool_or_single_worker_path");
    expect(prepared.workerAssignments).toHaveLength(1);
    expect(prepared.workerAssignments[0].role).toBe("orchestrator");
  });
});

describe("WorkerPool", () => {
  it("tracks assignment lifecycle and results", () => {
    const prepared = prepareTaskExecution({
      text: "investigate the release pipeline failure",
      expandedText: "investigate the release pipeline failure",
      basePrompt: "system prompt",
      messages: [{ role: "user", content: "investigate the release pipeline failure" }],
    });
    const pool = new WorkerPool();
    const [assignment] = pool.register(prepared.workerAssignments);

    pool.markRunning(assignment.workerId);
    pool.complete(assignment.workerId, summarizeWorkerAssignment(assignment));

    expect(pool.snapshotAssignments()[0].status).toBe("completed");
    expect(pool.snapshotResults()[0]).toMatchObject({
      workerId: assignment.workerId,
      status: "completed",
    });
  });
});

describe("verifyTaskCompletion", () => {
  it("fails empty successful responses", () => {
    const prepared = prepareTaskExecution({
      text: "answer this",
      expandedText: "answer this",
      basePrompt: "system prompt",
      messages: [{ role: "user", content: "answer this" }],
    });

    const completion = verifyTaskCompletion({
      task: prepared.task,
      responseText: "",
      toolCallsObserved: 0,
      hadError: false,
      durationMs: 10,
      modelCalls: 1,
    });

    expect(completion.verification.ok).toBe(false);
    expect(completion.task.status).toBe("failed");
  });

  it("fails edit tasks that omit verification and diff review reporting", () => {
    const prepared = prepareTaskExecution({
      text: "fix broken code",
      expandedText: "fix broken code",
      basePrompt: "system prompt",
      messages: [{ role: "user", content: "fix broken code" }],
    });

    const completion = verifyTaskCompletion({
      task: prepared.task,
      responseText: "Fixed it.",
      toolCallsObserved: 1,
      hadError: false,
      durationMs: 10,
      modelCalls: 1,
    });

    expect(completion.verification.ok).toBe(false);
    expect(completion.verification.findings.join("\n")).toContain("verification");
    expect(completion.verification.findings.join("\n")).toContain("diff review");
  });
});
