import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resolveTools, agentDefToSubAgent, availableToolNames } from "../src/agents/resolver.js";
import { allSubagents, getAllSubagents } from "../src/subagents/index.js";
import type { AgentDef } from "../src/agents/types.js";

// ─── resolver ─────────────────────────────────────────────────────────────────

describe("resolveTools", () => {
  it("resolves known tool names to AgentTool instances", () => {
    const tools = resolveTools(["file_read", "git_status", "internet_search"]);
    expect(tools).toHaveLength(3);
    expect(tools.map((t) => t.name)).toEqual(["file_read", "git_status", "internet_search"]);
  });

  it("silently skips unknown tool names", () => {
    const tools = resolveTools(["file_read", "nonexistent_tool", "git_log"]);
    expect(tools).toHaveLength(2);
    expect(tools.map((t) => t.name)).toEqual(["file_read", "git_log"]);
  });

  it("returns empty array for empty input", () => {
    expect(resolveTools([])).toEqual([]);
  });
});

describe("availableToolNames", () => {
  it("lists all registered tool names sorted", () => {
    const names = availableToolNames();
    expect(names).toContain("file_read");
    expect(names).toContain("file_write");
    expect(names).toContain("git_status");
    expect(names).toContain("internet_search");
    expect(names).toContain("run_command");
    // sorted
    expect(names).toEqual([...names].sort());
  });
});

describe("agentDefToSubAgent", () => {
  const makeAgentDef = (overrides: Partial<AgentDef> = {}): AgentDef => ({
    name: "test-agent",
    description: "A test agent",
    systemPrompt: "You are a test agent",
    source: "user",
    filePath: "/fake/path/test-agent.json",
    ...overrides,
  });

  it("converts an AgentDef with explicit tools to a SubAgentDef", () => {
    const def = makeAgentDef({ tools: ["file_read", "git_status"] });
    const sub = agentDefToSubAgent(def);

    expect(sub.name).toBe("test-agent");
    expect(sub.description).toBe("A test agent");
    expect(sub.tools.map((t) => t.name)).toEqual(["file_read", "git_status"]);
  });

  it("uses filesystem + git defaults when tools is not specified", () => {
    const sub = agentDefToSubAgent(makeAgentDef());
    const names = sub.tools.map((t) => t.name);
    expect(names).toContain("file_read");
    expect(names).toContain("git_status");
    // No shell by default
    expect(names).not.toContain("run_command");
  });

  it("threads permissionMode through", () => {
    const sub = agentDefToSubAgent(makeAgentDef({ permissionMode: "suggest" }));
    expect(sub.permissionMode).toBe("suggest");
  });

  it("permissionMode is undefined when not set", () => {
    const sub = agentDefToSubAgent(makeAgentDef());
    expect(sub.permissionMode).toBeUndefined();
  });
});

// ─── getAllSubagents + precedence ─────────────────────────────────────────────

describe("getAllSubagents", () => {
  let tmpChorusHome: string;
  let tmpCwd: string;
  let originalCwd: string;
  let originalChorusHome: string | undefined;

  beforeEach(() => {
    tmpChorusHome = fs.mkdtempSync(path.join(os.tmpdir(), "chorus-agents-home-"));
    tmpCwd = fs.mkdtempSync(path.join(os.tmpdir(), "chorus-agents-cwd-"));
    originalCwd = process.cwd();
    originalChorusHome = process.env.CHORUS_HOME_DIR;

    // Point loader at temp dirs via env var + cwd
    process.env.CHORUS_HOME_DIR = tmpChorusHome;
    process.chdir(tmpCwd);
  });

  afterEach(() => {
    if (originalChorusHome === undefined) {
      delete process.env.CHORUS_HOME_DIR;
    } else {
      process.env.CHORUS_HOME_DIR = originalChorusHome;
    }
    process.chdir(originalCwd);
    fs.rmSync(tmpChorusHome, { recursive: true, force: true });
    fs.rmSync(tmpCwd, { recursive: true, force: true });
  });

  function writeAgent(baseDir: string, agentData: object): void {
    const agentsDir = path.join(baseDir, "agents");
    fs.mkdirSync(agentsDir, { recursive: true });
    const name = (agentData as { name: string }).name;
    fs.writeFileSync(path.join(agentsDir, `${name}.json`), JSON.stringify(agentData), "utf-8");
  }

  function writeProjectAgent(agentData: object): void {
    const agentsDir = path.join(tmpCwd, ".chorus", "agents");
    fs.mkdirSync(agentsDir, { recursive: true });
    const name = (agentData as { name: string }).name;
    fs.writeFileSync(path.join(agentsDir, `${name}.json`), JSON.stringify(agentData), "utf-8");
  }

  it("includes all built-in subagents", () => {
    const all = getAllSubagents();
    const names = all.map((a) => a.name);
    expect(names).toContain("planner");
    expect(names).toContain("vapt");
    expect(names).toContain("builder");
  });

  it("includes file-defined agents alongside built-ins", () => {
    writeAgent(tmpChorusHome, {
      name: "custom-reviewer",
      description: "Reviews PRs",
      systemPrompt: "You review code",
    });

    const all = getAllSubagents();
    const names = all.map((a) => a.name);
    expect(names).toContain("custom-reviewer");
    expect(names).toContain("planner"); // built-ins still present
  });

  it("file-defined agent overrides built-in of same name", () => {
    writeAgent(tmpChorusHome, {
      name: "planner",
      description: "Custom planner",
      systemPrompt: "My custom planner prompt",
    });

    const all = getAllSubagents();
    const planner = all.find((a) => a.name === "planner");
    expect(planner).toBeDefined();
    expect(planner!.description).toBe("Custom planner");
    expect(planner!.systemPrompt).toBe("My custom planner prompt");

    // Should not have duplicates
    const plannerCount = all.filter((a) => a.name === "planner").length;
    expect(plannerCount).toBe(1);
  });

  it("project-scoped agent overrides user-scoped agent of same name", () => {
    writeAgent(tmpChorusHome, {
      name: "shared-agent",
      description: "User version",
      systemPrompt: "user prompt",
    });
    writeProjectAgent({
      name: "shared-agent",
      description: "Project version",
      systemPrompt: "project prompt",
    });

    const all = getAllSubagents();
    const agent = all.find((a) => a.name === "shared-agent");
    expect(agent).toBeDefined();
    expect(agent!.description).toBe("Project version");

    const count = all.filter((a) => a.name === "shared-agent").length;
    expect(count).toBe(1);
  });

  it("skips malformed JSON agent files without crashing", () => {
    const agentsDir = path.join(tmpChorusHome, "agents");
    fs.mkdirSync(agentsDir, { recursive: true });
    fs.writeFileSync(path.join(agentsDir, "broken.json"), "{ not valid json", "utf-8");
    fs.writeFileSync(
      path.join(agentsDir, "missing-fields.json"),
      JSON.stringify({ name: "no-prompt" }),
      "utf-8",
    );

    // Should not throw — just return the built-ins
    const all = getAllSubagents();
    expect(all.map((a) => a.name)).toContain("planner");
  });
});
