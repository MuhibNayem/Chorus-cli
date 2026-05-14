import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import {
  extractSkillContent,
  loadSkillFile,
  saveSkillFile,
  loadSkillsFromDirs,
  scanSkillDirs,
} from "../src/skills/loader.js";
import { KeywordEmbedder, cosineSimilarity } from "../src/skills/embedder.js";
import { SkillIndex } from "../src/skills/semanticIndex.js";
import {
  estimateSkillTokens,
  buildRouterTable,
  selectOptimalSubset,
  createTokenBudget,
  compressSchema,
} from "../src/skills/budget.js";
import { SkillRegistry } from "../src/skills/registry.js";
import { extractIntent, evaluateWhenCondition, routeSkillsForTurn } from "../src/skills/router.js";
import { SkillHarness, createSkillHarness } from "../src/skills/harness.js";
import { TrajectorySynthesizer, longestCommonSubsequence } from "../src/skills/synthesizer.js";
import { executePatternWorkflow, executeSkill } from "../src/skills/executor.js";
import { buildSwarmConfigFromSkill, mergeSwarmResults } from "../src/skills/swarmAdapter.js";
import { SkillAnnealer } from "../src/skills/annealer.js";
import type { SkillDef, PatternDef, ChatMessage, TokenBudget, ToolTrajectory } from "../src/skills/types.js";
import type { AgentTool } from "../src/agent/types.js";
import type { LLMProvider } from "../src/llm/provider.js";

// ─── Helpers ──────────────────────────────────────────────────────────────────

const previousEmbedder = process.env.CHORUS_EMBEDDER;

beforeAll(() => {
  process.env.CHORUS_EMBEDDER = "keyword";
});

afterAll(() => {
  if (previousEmbedder === undefined) {
    delete process.env.CHORUS_EMBEDDER;
  } else {
    process.env.CHORUS_EMBEDDER = previousEmbedder;
  }
});

function tmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "skills-test-"));
}

function cleanup(dir: string): void {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch { /* ignore */ }
}

function makeSkillDir(dir: string, name: string, content: string): void {
  const skillDir = path.join(dir, name);
  fs.mkdirSync(skillDir, { recursive: true });
  fs.writeFileSync(path.join(skillDir, "SKILL.md"), content, "utf-8");
}

// ─── Loader Tests ─────────────────────────────────────────────────────────────

describe("Skill Loader", () => {
  it("extracts frontmatter and body from SKILL.md", () => {
    const raw = `---
name: test-skill
description: A test skill
tags: [code, test]
---
# Instructions

Do the thing.
`;
    const { frontmatter, body } = extractSkillContent(raw);
    expect(frontmatter.name).toBe("test-skill");
    expect(frontmatter.description).toBe("A test skill");
    expect(frontmatter.tags).toEqual(["code", "test"]);
    expect(body).toContain("Do the thing.");
  });

  it("handles SKILL.md without frontmatter", () => {
    const raw = "# Just markdown\n\nNo frontmatter here.";
    const { frontmatter, body } = extractSkillContent(raw);
    expect(Object.keys(frontmatter).length).toBe(0);
    expect(body).toContain("No frontmatter here.");
  });

  it("parses boolean and number frontmatter values", () => {
    const raw = `---
name: num-skill
cost_budget: 500
swarm: true
---
Body`;
    const { frontmatter } = extractSkillContent(raw);
    expect(frontmatter.cost_budget).toBe(500);
    expect(frontmatter.swarm).toBe(true);
  });

  it("loads a skill from disk", () => {
    const dir = tmpDir();
    const skillPath = path.join(dir, "my-skill", "SKILL.md");
    fs.mkdirSync(path.join(dir, "my-skill"), { recursive: true });
    fs.writeFileSync(
      skillPath,
      `---
name: my-skill
description: My skill
---
# Do it

Instructions here.`,
      "utf-8",
    );

    const skill = loadSkillFile(skillPath);
    expect(skill).not.toBeNull();
    expect(skill!.name).toBe("my-skill");
    expect(skill!.description).toBe("My skill");
    expect(skill!.instructions).toContain("Instructions here.");

    cleanup(dir);
  });

  it("scans directories recursively for SKILL.md files", () => {
    const dir = tmpDir();
    makeSkillDir(dir, "skill-a", "---\nname: a\n---\nA");
    makeSkillDir(dir, "nested/skill-b", "---\nname: b\n---\nB");

    const files = scanSkillDirs([dir]);
    expect(files.length).toBe(2);

    cleanup(dir);
  });

  it("loads all skills from directories", () => {
    const dir = tmpDir();
    makeSkillDir(dir, "skill-a", "---\nname: skill-a\ndescription: A\n---\nA");
    makeSkillDir(dir, "skill-b", "---\nname: skill-b\ndescription: B\n---\nB");

    const skills = loadSkillsFromDirs([dir]);
    expect(skills.length).toBe(2);
    expect(skills.map((s) => s.name)).toContain("skill-a");
    expect(skills.map((s) => s.name)).toContain("skill-b");

    cleanup(dir);
  });

  it("saves a skill to disk round-trip", () => {
    const dir = tmpDir();
    const skill: SkillDef = {
      name: "roundtrip-skill",
      description: "Roundtrip test",
      instructions: "Do the roundtrip.",
      tags: ["test"],
      when: "*.ts exists",
      costBudget: 1000,
    };

    const filePath = saveSkillFile(skill, dir);
    expect(fs.existsSync(filePath)).toBe(true);

    const loaded = loadSkillFile(filePath);
    expect(loaded).not.toBeNull();
    expect(loaded!.name).toBe("roundtrip-skill");
    expect(loaded!.description).toBe("Roundtrip test");
    expect(loaded!.tags).toEqual(["test"]);
    expect(loaded!.when).toBe("*.ts exists");
    expect(loaded!.costBudget).toBe(1000);

    cleanup(dir);
  });
});

// ─── Embedder Tests ───────────────────────────────────────────────────────────

describe("Keyword Embedder", () => {
  const embedder = new KeywordEmbedder();

  it("embeds text into a normalized vector", async () => {
    const vec = await embedder.embed("hello world");
    expect(vec.length).toBe(256);

    // Should be L2 normalized
    const norm = Math.sqrt(vec.reduce((s, v) => s + v * v, 0));
    expect(norm).toBeCloseTo(1, 5);
  });

  it("produces different embeddings for different texts", async () => {
    const a = await embedder.embed("debug javascript error");
    const b = await embedder.embed("deploy kubernetes cluster");

    const sim = cosineSimilarity(a, b);
    expect(sim).toBeLessThan(0.9); // should be fairly different
  });

  it("produces similar embeddings for related texts", async () => {
    const a = await embedder.embed("fix bug in login code");
    const b = await embedder.embed("debug login authentication bug");

    const sim = cosineSimilarity(a, b);
    expect(sim).toBeGreaterThan(0.1); // should share some keywords (bug, login)
  });
});

describe("cosineSimilarity", () => {
  it("returns 1 for identical vectors", () => {
    const v = [1, 2, 3];
    expect(cosineSimilarity(v, v)).toBeCloseTo(1, 5);
  });

  it("returns 0 for orthogonal vectors", () => {
    expect(cosineSimilarity([1, 0, 0], [0, 1, 0])).toBe(0);
  });

  it("returns -1 for opposite vectors", () => {
    expect(cosineSimilarity([1, 0], [-1, 0])).toBeCloseTo(-1, 5);
  });
});

// ─── Semantic Index Tests ─────────────────────────────────────────────────────

describe("SkillIndex", () => {
  let index: SkillIndex;
  let homeDir: string;
  const embedder = new KeywordEmbedder();

  beforeEach(() => {
    homeDir = tmpDir();
    process.env.CHORUS_HOME_DIR = homeDir;
    index = new SkillIndex(embedder, 100);
  });

  afterEach(() => {
    delete process.env.CHORUS_HOME_DIR;
    cleanup(homeDir);
  });

  it("indexes and searches skills", async () => {
    const skill: SkillDef = {
      name: "debug-skill",
      description: "Debug and fix code errors",
      instructions: "...",
    };

    await index.indexSkill(skill, "skill");
    const results = await index.search("fix bug", 5, 0);

    expect(results.length).toBeGreaterThan(0);
    expect(results[0].skill.name).toBe("debug-skill");
    expect(results[0].kind).toBe("skill");
  });

  it("finds patterns via semantic search", async () => {
    const pattern: PatternDef = {
      name: "refactor-pattern",
      description: "Refactor code by extracting functions",
      parameters: [],
      workflow: [],
      estimatedTokens: 100,
      evidenceCount: 3,
      sourceTrajectories: [],
      synthesizedAt: Date.now(),
    };

    await index.indexSkill(pattern, "pattern");
    const results = await index.search("extract function", 5, 0);

    expect(results.length).toBeGreaterThan(0);
    expect(results[0].kind).toBe("pattern");
  });

  it("respects minScore threshold", async () => {
    const skill: SkillDef = {
      name: "deploy-skill",
      description: "Deploy to production",
      instructions: "...",
    };

    await index.indexSkill(skill, "skill");
    const results = await index.search("completely unrelated query about cooking", 5, 0.9);

    expect(results.length).toBe(0);
  });

  it("searches by tag prefix", async () => {
    const skill: SkillDef = {
      name: "tagged-skill",
      description: "A tagged skill",
      instructions: "...",
      tags: ["code", "refactor"],
    };

    await index.indexSkill(skill, "skill");
    expect(index.searchByTag("ref")).toContain("tagged-skill");
    expect(index.searchByTag("cod")).toContain("tagged-skill");
    expect(index.searchByTag("deploy")).toHaveLength(0);
  });

  it("evicts old entries when over capacity", async () => {
    const smallIndex = new SkillIndex(embedder, 2);

    await smallIndex.indexSkill({ name: "a", description: "A", instructions: "" }, "skill");
    await smallIndex.indexSkill({ name: "b", description: "B", instructions: "" }, "skill");
    await smallIndex.indexSkill({ name: "c", description: "C", instructions: "" }, "skill");

    expect(smallIndex.size()).toBe(2);
  });
});

// ─── Budget Tests ─────────────────────────────────────────────────────────────

describe("Token Budget", () => {
  it("estimates skill schema tokens", () => {
    const skill: SkillDef = {
      name: "test",
      description: "A test skill for unit testing",
      instructions: "Run tests and report results.",
    };

    const tokens = estimateSkillTokens(skill);
    expect(tokens).toBeGreaterThan(0);
  });

  it("builds router table", () => {
    const skills: SkillDef[] = [
      { name: "a", description: "Skill A", instructions: "" },
      { name: "b", description: "Skill B is longer", instructions: "" },
    ];

    const table = buildRouterTable(skills);
    expect(table).toContain("a:");
    expect(table).toContain("b:");
  });

  it("selects optimal subset within budget", () => {
    const matches = [
      { skill: { name: "s1", description: "Skill 1", instructions: "" } as SkillDef, score: 0.9 },
      { skill: { name: "s2", description: "Skill 2", instructions: "" } as SkillDef, score: 0.5 },
      { skill: { name: "s3", description: "Skill 3", instructions: "" } as SkillDef, score: 0.8 },
    ];

    const budget = 100; // generous budget
    const selected = selectOptimalSubset(matches, budget);

    expect(selected.length).toBe(3);
    // Should be sorted by score descending
    expect(selected[0].score).toBe(0.9);
  });

  it("respects token budget in selection", () => {
    // Create skills with very long instructions to blow up token count
    const longText = "word ".repeat(500);
    const matches = [
      { skill: { name: "s1", description: "Skill 1", instructions: longText } as SkillDef, score: 0.9 },
      { skill: { name: "s2", description: "Skill 2", instructions: longText } as SkillDef, score: 0.8 },
      { skill: { name: "s3", description: "Skill 3", instructions: longText } as SkillDef, score: 0.7 },
    ];

    const budget = 50; // very tight
    const selected = selectOptimalSubset(matches, budget);

    // Should select 0 or very few because each skill is too expensive
    expect(selected.length).toBeLessThanOrEqual(1);
  });

  it("creates token budget with skill reserve", () => {
    const budget = createTokenBudget(100_000, 80_000);
    expect(budget.total).toBe(100_000);
    expect(budget.reserved).toBe(80_000);
    expect(budget.available).toBeGreaterThan(0);
    expect(budget.available).toBeLessThanOrEqual(20_000); // 15% reserve
  });

  it("compresses schemas", () => {
    const skill: SkillDef = {
      name: "compress-test",
      description: "A test",
      instructions: "Very long instructions here that should be stripped.",
    };

    const compressed = compressSchema(skill);
    expect(compressed).toContain("compress-test");
    expect(compressed).not.toContain("Very long instructions");
  });
});

// ─── Router Tests ─────────────────────────────────────────────────────────────

describe("Intent Extraction", () => {
  it("extracts last user message", () => {
    const history: ChatMessage[] = [
      { role: "user", content: "Hello" },
      { role: "assistant", content: "Hi there" },
      { role: "user", content: "Fix the bug please" },
    ];

    const intent = extractIntent(history);
    expect(intent).toContain("Fix the bug please");
  });

  it("includes assistant reasoning if present", () => {
    const history: ChatMessage[] = [
      { role: "user", content: "Hello" },
      { role: "assistant", content: "Hi", reasoning_content: "I should greet the user" },
      { role: "user", content: "Do it" },
    ];

    const intent = extractIntent(history);
    expect(intent).toContain("Do it");
    expect(intent).toContain("I should greet the user");
  });
});

describe("When Condition Evaluation", () => {
  it("allows skills with no condition", () => {
    expect(evaluateWhenCondition(undefined, process.cwd())).toBe(true);
  });

  it("evaluates file existence", () => {
    const dir = tmpDir();
    fs.writeFileSync(path.join(dir, "package.json"), "{}", "utf-8");

    expect(evaluateWhenCondition("package.json exists", dir)).toBe(true);
    expect(evaluateWhenCondition("nonexistent.txt exists", dir)).toBe(false);

    cleanup(dir);
  });

  it("evaluates directory existence", () => {
    const dir = tmpDir();
    fs.mkdirSync(path.join(dir, "src"), { recursive: true });

    expect(evaluateWhenCondition("src/ exists", dir)).toBe(true);
    expect(evaluateWhenCondition("dist/ exists", dir)).toBe(false);

    cleanup(dir);
  });

  it("evaluates glob patterns", () => {
    const dir = tmpDir();
    fs.writeFileSync(path.join(dir, "test.ts"), "", "utf-8");

    expect(evaluateWhenCondition("*.ts exists", dir)).toBe(true);
    expect(evaluateWhenCondition("*.py exists", dir)).toBe(false);

    cleanup(dir);
  });
});

describe("Skill Router", () => {
  let registry: SkillRegistry;
  let dir: string;
  let homeDir: string;

  beforeEach(async () => {
    dir = tmpDir();
    homeDir = tmpDir();
    process.env.CHORUS_HOME_DIR = homeDir;

    makeSkillDir(dir, "debug", `---
name: debug
description: Debug and fix code errors
tags: [code, debug]
---
# Debug

Use this to debug.`);
    makeSkillDir(dir, "deploy", `---
name: deploy
description: Deploy to production
tags: [ops, deploy]
---
# Deploy

Deploy the app.`);
    makeSkillDir(dir, "test", `---
name: test
description: Run unit tests
tags: [code, test]
---
# Test

Run tests.`);

    registry = new SkillRegistry([dir]);
    await new Promise((r) => setTimeout(r, 100));
  });

  afterEach(() => {
    registry.dispose();
    delete process.env.CHORUS_HOME_DIR;
    cleanup(dir);
    cleanup(homeDir);
  });

  it("routes relevant skills for a debugging query", async () => {
    const history: ChatMessage[] = [
      { role: "user", content: "There's a bug in my code, can you fix it?" },
    ];

    const budget: TokenBudget = { total: 100_000, reserved: 10_000, available: 10_000 };
    const selection = await routeSkillsForTurn(registry, history, budget, {
      maxSkills: 3,
      minScore: 0,
    });

    expect(selection.skills.length).toBeGreaterThan(0);
    const names = selection.skills.map((s) => s.name);
    expect(names).toContain("debug");
  });

  it("routes relevant skills for a deployment query", async () => {
    const history: ChatMessage[] = [
      { role: "user", content: "Deploy this to production" },
    ];

    const budget: TokenBudget = { total: 100_000, reserved: 10_000, available: 10_000 };
    const selection = await routeSkillsForTurn(registry, history, budget, {
      maxSkills: 3,
      minScore: 0,
    });

    const names = selection.skills.map((s) => s.name);
    expect(names).toContain("deploy");
  });

  it("respects maxSkills limit", async () => {
    const history: ChatMessage[] = [
      { role: "user", content: "Do everything" },
    ];

    const budget: TokenBudget = { total: 100_000, reserved: 10_000, available: 10_000 };
    const selection = await routeSkillsForTurn(registry, history, budget, {
      maxSkills: 2,
      minScore: 0,
    });

    expect(selection.skills.length).toBeLessThanOrEqual(2);
  });

  it("respects token budget", async () => {
    const history: ChatMessage[] = [
      { role: "user", content: "Fix the bug" },
    ];

    // Very tight budget
    const budget: TokenBudget = { total: 100_000, reserved: 99_900, available: 50 };
    const selection = await routeSkillsForTurn(registry, history, budget, {
      maxSkills: 10,
      minScore: 0,
    });

    expect(selection.tokensUsed).toBeLessThanOrEqual(50);
  });

  it("always includes router table in schemas", async () => {
    const history: ChatMessage[] = [{ role: "user", content: "Hello" }];
    const budget: TokenBudget = { total: 100_000, reserved: 10_000, available: 10_000 };
    const selection = await routeSkillsForTurn(registry, history, budget, { minScore: 0 });

    const joined = selection.schemas.join("\n");
    expect(joined).toContain("Available Skills");
  });
});

// ─── Registry Tests ───────────────────────────────────────────────────────────

describe("SkillRegistry", () => {
  let registry: SkillRegistry;
  let dir: string;
  let homeDir: string;

  beforeEach(() => {
    dir = tmpDir();
    homeDir = tmpDir();
    process.env.CHORUS_HOME_DIR = homeDir;
    registry = new SkillRegistry([dir]);
  });

  afterEach(() => {
    registry.dispose();
    delete process.env.CHORUS_HOME_DIR;
    cleanup(dir);
    cleanup(homeDir);
  });

  it("loads skills from disk", async () => {
    makeSkillDir(dir, "loaded", `---
name: loaded
description: A loaded skill
---
Body`);

    await registry.reload();
    expect(registry.getSkill("loaded")).toBeDefined();
    expect(registry.getSkill("loaded")!.description).toBe("A loaded skill");
  });

  it("registers skills programmatically", async () => {
    const skill: SkillDef = {
      name: "prog",
      description: "Programmatic skill",
      instructions: "...",
    };

    await registry.registerSkill(skill);
    expect(registry.getSkill("prog")).toBeDefined();
  });

  it("tracks metrics", () => {
    registry.recordInvocation("my-skill", { success: true, tokens: 100, latency: 50 });
    registry.recordInvocation("my-skill", { success: true, tokens: 200, latency: 100 });

    const metrics = registry.getMetrics("my-skill");
    expect(metrics).toBeDefined();
    expect(metrics!.invocations).toBe(2);
    expect(metrics!.successes).toBe(2);
    expect(metrics!.avgTokens).toBe(150);
    expect(metrics!.avgLatency).toBe(75);
  });

  it("sets skill status for curation", () => {
    registry.recordInvocation("s", { success: true, tokens: 10, latency: 10 });
    registry.setStatus("s", "trusted");

    expect(registry.getMetrics("s")!.status).toBe("trusted");
  });

  it("saves and loads metrics", () => {
    registry.recordInvocation("persisted", { success: true, tokens: 10, latency: 10 });
    registry.saveMetrics();

    // Create new registry pointing to same dir
    const registry2 = new SkillRegistry([dir]);
    const metrics = registry2.getMetrics("persisted");
    expect(metrics).toBeDefined();
    expect(metrics!.invocations).toBe(1);
    registry2.dispose();
  });
});

// ─── Harness Tests ────────────────────────────────────────────────────────────

describe("SkillHarness", () => {
  let harness: SkillHarness;
  let dir: string;
  let homeDir: string;

  beforeEach(() => {
    dir = tmpDir();
    homeDir = tmpDir();
    process.env.CHORUS_HOME_DIR = homeDir;
    harness = createSkillHarness([dir]);
  });

  afterEach(() => {
    harness.dispose();
    delete process.env.CHORUS_HOME_DIR;
    cleanup(dir);
    cleanup(homeDir);
  });

  it("routes skills for a turn", async () => {
    makeSkillDir(dir, "route-test", `---
name: route-test
description: A routing test skill
---
Body`);

    // Reload to pick up the new skill
    await harness.getRegistry().reload();

    const history: ChatMessage[] = [{ role: "user", content: "routing test" }];
    const selection = await harness.routeForTurn(history, 128_000, "");

    expect(selection.schemas.length).toBeGreaterThan(0);
  });

  it("returns schemas for turn injection", async () => {
    makeSkillDir(dir, "schema-skill", `---
name: schema-skill
description: Schema test
---
Test`);

    await harness.getRegistry().reload();

    const history: ChatMessage[] = [{ role: "user", content: "schema test" }];
    await harness.routeForTurn(history, 128_000, "");

    const schemas = harness.getSchemasForTurn();
    expect(schemas.length).toBeGreaterThan(0);
  });

  it("generates health report", () => {
    // Use a clean harness without default dirs to avoid existing metrics
    const cleanHarness = new SkillHarness({ skillDirs: [dir] });
    cleanHarness.getRegistry().recordInvocation("a", { success: true, tokens: 10, latency: 10 });
    cleanHarness.getRegistry().setStatus("a", "trusted");

    const report = cleanHarness.generateHealthReport();
    expect(report.trusted.length).toBe(1);
    expect(report.active.length).toBe(0);
    cleanHarness.dispose();
  });

  it("observes trajectories", () => {
    const trajectory: ToolTrajectory = {
      id: "t1",
      task: "fix bug",
      tools: [{ name: "search", input: {}, output: "found it" }],
      success: true,
      tokens: 100,
      duration: 50,
      skillUsed: "debug",
      timestamp: Date.now(),
    };

    harness.observe(trajectory);

    const metrics = harness.getRegistry().getMetrics("debug");
    expect(metrics).toBeDefined();
    expect(metrics!.invocations).toBe(1);
    expect(metrics!.successes).toBe(1);
  });

  it("applies curation rules on update", () => {
    // Promotion: 5+ invocations, >80% success
    for (let i = 0; i < 5; i++) {
      harness.getRegistry().recordInvocation("promote-me", { success: true, tokens: 10, latency: 10 });
    }

    harness.updateMetrics();

    const metrics = harness.getRegistry().getMetrics("promote-me");
    expect(metrics!.status).toBe("trusted");
  });

  it("deprecates failing skills", () => {
    // Deprecation: 10+ invocations, <40% success
    for (let i = 0; i < 10; i++) {
      harness.getRegistry().recordInvocation("fail-skill", {
        success: i < 3, // 3/10 = 30% success
        tokens: 10,
        latency: 10,
      });
    }

    harness.updateMetrics();

    const metrics = harness.getRegistry().getMetrics("fail-skill");
    expect(metrics!.status).toBe("deprecated");
  });
});

// ─── Synthesizer Tests ────────────────────────────────────────────────────────

describe("LCS", () => {
  it("finds longest common subsequence", () => {
    const a = ["search", "read", "edit"];
    const b = ["search", "write", "read", "edit"];
    expect(longestCommonSubsequence(a, b)).toEqual(["search", "read", "edit"]);
  });

  it("handles no common elements", () => {
    expect(longestCommonSubsequence(["a", "b"], ["c", "d"])).toEqual([]);
  });

  it("handles identical sequences", () => {
    expect(longestCommonSubsequence(["a", "b", "c"], ["a", "b", "c"])).toEqual(["a", "b", "c"]);
  });
});

describe("TrajectorySynthesizer", () => {
  let registry: SkillRegistry;
  let synthesizer: TrajectorySynthesizer;
  let dir: string;
  let homeDir: string;

  beforeEach(() => {
    dir = tmpDir();
    homeDir = tmpDir();
    process.env.CHORUS_HOME_DIR = homeDir;
    registry = new SkillRegistry([dir]);
    synthesizer = new TrajectorySynthesizer(registry, {
      minTrajectories: 3,
      similarityThreshold: 0.5,
    });
  });

  afterEach(() => {
    registry.dispose();
    delete process.env.CHORUS_HOME_DIR;
    cleanup(dir);
    cleanup(homeDir);
  });

  it("does not synthesize with too few trajectories", () => {
    const t1: ToolTrajectory = {
      id: "1",
      task: "fix auth",
      tools: [
        { name: "search", input: { pattern: "auth" }, output: "found" },
        { name: "read", input: { path: "auth.ts" }, output: "code" },
      ],
      success: true,
      tokens: 100,
      duration: 50,
      timestamp: Date.now(),
    };

    synthesizer.observe(t1);
    expect(registry.getAllPatterns().length).toBe(0);
  });

  it("synthesizes pattern from similar trajectories", () => {
    const base = {
      tools: [
        { name: "search", input: { pattern: "auth" }, output: "found" },
        { name: "read", input: { path: "auth.ts" }, output: "code" },
        { name: "edit", input: { path: "auth.ts", old: "x", new: "y" }, output: "done" },
      ],
      success: true,
      tokens: 100,
      duration: 50,
      timestamp: Date.now(),
    };

    // Need 3 similar trajectories (minTrajectories)
    synthesizer.observe({ id: "1", task: "fix auth", ...base });
    synthesizer.observe({ id: "2", task: "fix login", ...base });
    synthesizer.observe({ id: "3", task: "fix session", ...base });

    const patterns = registry.getAllPatterns();
    expect(patterns.length).toBeGreaterThan(0);

    const pattern = patterns[0];
    expect(pattern.workflow.length).toBe(3);
    expect(pattern.workflow.map((s) => s.tool)).toEqual(["search", "read", "edit"]);
  });

  it("extracts varying fields as parameters", () => {
    const t1: ToolTrajectory = {
      id: "1",
      task: "fix auth",
      tools: [
        { name: "search", input: { pattern: "auth" }, output: "found" },
        { name: "read", input: { path: "auth.ts" }, output: "code" },
      ],
      success: true,
      tokens: 100,
      duration: 50,
      timestamp: Date.now(),
    };

    const t2: ToolTrajectory = {
      id: "2",
      task: "fix login",
      tools: [
        { name: "search", input: { pattern: "login" }, output: "found" },
        { name: "read", input: { path: "login.ts" }, output: "code" },
      ],
      success: true,
      tokens: 100,
      duration: 50,
      timestamp: Date.now(),
    };

    const t3: ToolTrajectory = {
      id: "3",
      task: "fix session",
      tools: [
        { name: "search", input: { pattern: "session" }, output: "found" },
        { name: "read", input: { path: "session.ts" }, output: "code" },
      ],
      success: true,
      tokens: 100,
      duration: 50,
      timestamp: Date.now(),
    };

    synthesizer.observe(t1);
    synthesizer.observe(t2);
    synthesizer.observe(t3);

    const patterns = registry.getAllPatterns();
    expect(patterns.length).toBeGreaterThan(0);

    const pattern = patterns[0];
    // "pattern" field varies across trajectories → should be a parameter
    const searchPatternParam = pattern.parameters.find((p) => p.name === "search_pattern");
    expect(searchPatternParam).toBeDefined();
    expect(searchPatternParam!.type).toBe("string");

    // "path" field varies → should be a parameter
    const readPathParam = pattern.parameters.find((p) => p.name === "read_path");
    expect(readPathParam).toBeDefined();
  });

  it("ignores failed trajectories", () => {
    const base = {
      tools: [{ name: "search", input: {}, output: "" }],
      success: false,
      tokens: 100,
      duration: 50,
      timestamp: Date.now(),
    };

    synthesizer.observe({ id: "1", task: "fail", ...base });
    synthesizer.observe({ id: "2", task: "fail", ...base });
    synthesizer.observe({ id: "3", task: "fail", ...base });

    expect(registry.getAllPatterns().length).toBe(0);
  });

  it("extracts trajectory from conversation history", () => {
    const history: ChatMessage[] = [
      { role: "user", content: "Fix the bug" },
      {
        role: "assistant",
        content: "Let me search",
        tool_calls: [{ id: "tc1", type: "function", function: { name: "search", arguments: '{"pattern":"bug"}' } }],
      },
      { role: "tool", content: "Found in file.ts", tool_call_id: "tc1" },
    ];

    const traj = TrajectorySynthesizer.extractTrajectory(history);
    expect(traj.tools.length).toBe(1);
    expect(traj.tools[0].name).toBe("search");
    expect(traj.tools[0].input.pattern).toBe("bug");
    expect(traj.task).toContain("Fix the bug");
  });
});

// ─── Executor Tests ──────────────────────────────────────────────────────────

describe("Skill Executor", () => {
  it("executes pattern workflows with params and previous step results", async () => {
    const calls: Array<{ tool: string; input: unknown }> = [];
    const toolsByName = new Map<string, AgentTool>([
      ["search", {
        invoke: async (input) => {
          calls.push({ tool: "search", input });
          return { matches: [{ path: "src/app.ts" }] };
        },
      }],
      ["read", {
        invoke: async (input) => {
          calls.push({ tool: "read", input });
          return "file contents";
        },
      }],
    ]);
    const pattern: PatternDef = {
      name: "inspect-file",
      description: "Find and read a file",
      parameters: [{ name: "query", type: "string", description: "Search query" }],
      workflow: [
        { tool: "search", input: { pattern: "{{query}}" } },
        { tool: "read", input: { path: "{{search.matches.0.path}}" } },
      ],
      estimatedTokens: 100,
      evidenceCount: 3,
      sourceTrajectories: ["t1", "t2", "t3"],
      synthesizedAt: Date.now(),
    };

    const result = await executePatternWorkflow(pattern, { query: "app" }, toolsByName);

    expect(result.success).toBe(true);
    expect(calls).toEqual([
      { tool: "search", input: { pattern: "app" } },
      { tool: "read", input: { path: "src/app.ts" } },
    ]);
    expect(result.output).toContain("[search]:");
    expect(result.output).toContain("[read]: file contents");
    expect(result.tokensUsed).toBeGreaterThan(0);
  });

  it("returns a failed execution result for unknown workflow tools", async () => {
    const pattern: PatternDef = {
      name: "missing-tool-pattern",
      description: "Uses a missing tool",
      parameters: [],
      workflow: [{ tool: "missing", input: {} }],
      estimatedTokens: 10,
      evidenceCount: 1,
      sourceTrajectories: [],
      synthesizedAt: Date.now(),
    };

    const result = await executePatternWorkflow(pattern, {}, new Map());

    expect(result.success).toBe(false);
    expect(result.output).toContain("Unknown tool in workflow: missing");
  });

  it("dispatches swarm-enabled skills to swarm execution placeholder", async () => {
    const skill: SkillDef = {
      name: "review-swarm",
      description: "Review with multiple agents",
      instructions: "Coordinate a review.",
      swarm: {
        enabled: true,
        agents: [
          { role: "planner", description: "Plans the work" },
          { role: "reviewer", description: "Reviews the work" },
        ],
      },
    };

    const result = await executeSkill(skill, {}, new Map());

    expect(result.success).toBe(true);
    expect(result.output).toContain('Swarm execution for "review-swarm"');
    expect(result.swarmResults?.map((r) => r.agent)).toEqual(["planner", "reviewer"]);
  });

  it("falls back to instructions for non-executable skills", async () => {
    const skill: SkillDef = {
      name: "manual-skill",
      description: "Manual guidance",
      instructions: "Follow these manual steps carefully.",
    };

    const result = await executeSkill(skill, {}, new Map());

    expect(result.success).toBe(true);
    expect(result.output).toContain('Skill "manual-skill" invoked');
    expect(result.output).toContain("Follow these manual steps");
  });
});

// ─── Swarm Adapter Tests ─────────────────────────────────────────────────────

describe("Skill Swarm Adapter", () => {
  const provider: LLMProvider = {
    name: "ollama",
    generate: async () => ({ text: "ok", model: "test-model" }),
    stream: async function* () { yield { type: "response.completed" }; },
    streamWithTools: async function* () { yield { type: "done", response: { content: "ok" } }; },
    health: async () => ({ ok: true, provider: "ollama" }),
  };

  it("builds a swarm config from declared skill agents", () => {
    const config = buildSwarmConfigFromSkill(
      "audit",
      {
        enabled: true,
        agents: [
          { role: "planner", description: "Breaks down the work", model: "planner-model" },
          { role: "reviewer", description: "Checks the work" },
        ],
      },
      "Audit the repository",
      provider,
      "default-model",
    );

    expect(config.initialAgent).toBe("planner");
    expect(config.provider).toBe(provider);
    expect(config.modelName).toBe("default-model");
    expect(config.policy).toBe("full_auto");
    expect(config.maxHandoffs).toBe(6);
    expect(config.agents.map((a) => a.name)).toEqual(["planner", "reviewer"]);
    expect(config.agents[0].handoffDestinations).toEqual(["reviewer"]);
    expect(config.agents[1].handoffDestinations).toEqual(["planner"]);
    expect(config.agents[0].model).toBe("planner-model");
    expect(config.agents[0].systemPrompt).toContain("Audit the repository");
  });

  it("creates a default specialist when no agents are declared", () => {
    const config = buildSwarmConfigFromSkill(
      "single",
      { enabled: true },
      "Execute the skill",
      provider,
      "default-model",
    );

    expect(config.initialAgent).toBe("single-agent");
    expect(config.agents).toHaveLength(1);
    expect(config.agents[0].handoffDestinations).toEqual([]);
    expect(config.maxHandoffs).toBe(3);
  });

  it("merges swarm results using each supported strategy", () => {
    const results = [
      { agent: "a", output: "short" },
      { agent: "b", output: "a much longer and more detailed answer" },
    ];

    expect(mergeSwarmResults(results, "concatenate_results")).toContain("## a");
    expect(mergeSwarmResults(results, "concatenate_results")).toContain("---");
    expect(mergeSwarmResults(results, "vote")).toBe("a much longer and more detailed answer");
    expect(mergeSwarmResults(results, "first_success")).toBe("short");
  });
});

// ─── Annealer Tests ──────────────────────────────────────────────────────────

describe("SkillAnnealer", () => {
  function metrics(errorPatterns: Array<{ pattern: string; count: number }>, status: "active" | "annealing" = "active") {
    return {
      name: "debug-skill",
      invocations: 3,
      successes: 0,
      failures: 3,
      avgTokens: 100,
      avgLatency: 50,
      userOverrides: 0,
      lastUsed: Date.now(),
      status,
      errorPatterns,
    };
  }

  it("detects repeated failure patterns but skips skills already annealing", () => {
    const annealer = new SkillAnnealer();

    expect(annealer.shouldAnneal(metrics([{ pattern: "tool not found", count: 3 }]))).toBe(true);
    expect(annealer.shouldAnneal(metrics([{ pattern: "tool not found", count: 2 }]))).toBe(false);
    expect(annealer.shouldAnneal(metrics([{ pattern: "tool not found", count: 5 }], "annealing"))).toBe(false);
  });

  it("patches instructions for known error classes and saves the skill", async () => {
    const dir = tmpDir();
    const skill: SkillDef = {
      name: "debug-skill",
      description: "Debugs code",
      instructions: "Use the right tool.",
    };
    const annealer = new SkillAnnealer([dir]);

    const result = await annealer.anneal(skill, metrics([{ pattern: "schema validation failed", count: 4 }]));
    const saved = loadSkillFile(path.join(dir, "debug-skill", "SKILL.md"));

    expect(result.patched).toBe(true);
    expect(result.reason).toBe("Added argument validation reminder");
    expect(result.diff).toContain("Added argument validation reminder");
    expect(saved?.instructions).toContain("Validate all arguments against the tool schema");

    cleanup(dir);
  });

  it("anneals only skills whose metrics cross the threshold", async () => {
    const dir = tmpDir();
    const annealer = new SkillAnnealer([dir]);
    const skills: SkillDef[] = [
      { name: "needs-patch", description: "Patch me", instructions: "Original." },
      { name: "healthy", description: "Do not patch", instructions: "Original." },
    ];
    const metricsMap = new Map([
      ["needs-patch", metrics([{ pattern: "file not found", count: 3 }])],
      ["healthy", metrics([{ pattern: "timeout", count: 1 }])],
    ]);

    const results = await annealer.annealAll(skills, metricsMap);

    expect(results).toHaveLength(1);
    expect(results[0].skillName).toBe("needs-patch");
    expect(results[0].patched).toBe(true);
    expect(fs.existsSync(path.join(dir, "needs-patch", "SKILL.md"))).toBe(true);
    expect(fs.existsSync(path.join(dir, "healthy", "SKILL.md"))).toBe(false);

    cleanup(dir);
  });
});
