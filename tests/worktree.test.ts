import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { execSync } from "child_process";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createFilesystemTools } from "../src/tools/filesystem.js";
import { isGitRepo, getRepoRoot, createWorktree } from "../src/swarm/worktree.js";

// ─── createFilesystemTools ────────────────────────────────────────────────────

describe("createFilesystemTools", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "chorus-fstest-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("reads a file within the scoped root", async () => {
    const tools = createFilesystemTools(tmpDir);
    const readTool = tools.find((t) => t.name === "file_read")!;
    const filePath = path.join(tmpDir, "hello.txt");
    fs.writeFileSync(filePath, "hello world");

    const result = await readTool.invoke({ path: "hello.txt" });
    expect(result).toBe("hello world");
  });

  it("writes a file within the scoped root", async () => {
    const tools = createFilesystemTools(tmpDir);
    const writeTool = tools.find((t) => t.name === "file_write")!;

    await writeTool.invoke({ path: "output.txt", content: "written content" });
    expect(fs.readFileSync(path.join(tmpDir, "output.txt"), "utf-8")).toBe("written content");
  });

  it("rejects paths outside the scoped root", async () => {
    const tools = createFilesystemTools(tmpDir);
    const readTool = tools.find((t) => t.name === "file_read")!;

    const result = await readTool.invoke({ path: "../../etc/passwd" });
    expect(String(result)).toMatch(/Access denied/);
  });

  it("two tool sets from different roots are independent", async () => {
    const dirA = fs.mkdtempSync(path.join(os.tmpdir(), "chorus-a-"));
    const dirB = fs.mkdtempSync(path.join(os.tmpdir(), "chorus-b-"));

    try {
      fs.writeFileSync(path.join(dirA, "a.txt"), "in A");
      fs.writeFileSync(path.join(dirB, "b.txt"), "in B");

      const toolsA = createFilesystemTools(dirA);
      const toolsB = createFilesystemTools(dirB);
      const readA = toolsA.find((t) => t.name === "file_read")!;
      const readB = toolsB.find((t) => t.name === "file_read")!;

      expect(await readA.invoke({ path: "a.txt" })).toBe("in A");
      expect(await readB.invoke({ path: "b.txt" })).toBe("in B");

      // A cannot read B's file and vice versa
      const resultAreadB = await readA.invoke({ path: path.join(dirB, "b.txt") });
      expect(String(resultAreadB)).toMatch(/Access denied/);
    } finally {
      fs.rmSync(dirA, { recursive: true, force: true });
      fs.rmSync(dirB, { recursive: true, force: true });
    }
  });

  it("module-level filesystemTools still work (process.cwd() scoped)", async () => {
    const { filesystemTools } = await import("../src/tools/filesystem.js");
    expect(filesystemTools).toHaveLength(6);
    // All tools have expected names
    const names = filesystemTools.map((t) => t.name);
    expect(names).toContain("file_read");
    expect(names).toContain("file_write");
    expect(names).toContain("file_edit");
  });
});

// ─── worktree utilities ───────────────────────────────────────────────────────

describe("isGitRepo", () => {
  it("returns true for the project root (which is a git repo)", () => {
    expect(isGitRepo(process.cwd())).toBe(true);
  });

  it("returns false for a plain temp directory", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "chorus-nogit-"));
    try {
      expect(isGitRepo(tmpDir)).toBe(false);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});

describe("getRepoRoot", () => {
  it("returns the git repo root for the project directory", () => {
    const root = getRepoRoot(process.cwd());
    expect(root).not.toBeNull();
    expect(fs.existsSync(path.join(root!, ".git"))).toBe(true);
  });

  it("returns null for a plain directory", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "chorus-noroot-"));
    try {
      expect(getRepoRoot(tmpDir)).toBeNull();
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});

describe("createWorktree", () => {
  // Clean up any leftover chorus test branches before/after each test
  function pruneTestBranches() {
    try {
      execSync("git worktree prune", { stdio: "ignore" });
    } catch {}
    try {
      const branches = execSync('git branch --list "chorus/*"', { encoding: "utf-8" });
      for (const b of branches.split("\n").map((l) => l.trim()).filter(Boolean)) {
        try {
          execSync(`git branch -D "${b}"`, { stdio: "ignore" });
        } catch {}
      }
    } catch {}
  }

  beforeEach(pruneTestBranches);
  afterEach(pruneTestBranches);

  it("creates a worktree directory with the repo's files", async () => {
    const handle = createWorktree("test-agent", "test-swarm-id");
    try {
      expect(fs.existsSync(handle.path)).toBe(true);
      // package.json should be present (it's in the repo)
      expect(fs.existsSync(path.join(handle.path, "package.json"))).toBe(true);
      expect(handle.branch).toMatch(/^chorus\//);
    } finally {
      await handle.remove();
    }
  });

  it("removes the worktree directory on remove()", async () => {
    const handle = createWorktree("cleanup-agent", "test-swarm-clean");
    const { path: wtPath } = handle;

    expect(fs.existsSync(wtPath)).toBe(true);
    await handle.remove();
    expect(fs.existsSync(wtPath)).toBe(false);
  });

  it("worktree filesystem tools are scoped to the worktree root", async () => {
    const handle = createWorktree("fs-scope-agent", "test-swarm-scope");
    try {
      const tools = createFilesystemTools(handle.path);
      const writeTool = tools.find((t) => t.name === "file_write")!;
      const readTool = tools.find((t) => t.name === "file_read")!;

      // Write a file into the worktree
      await writeTool.invoke({ path: "wt-test.txt", content: "isolated" });
      expect(fs.existsSync(path.join(handle.path, "wt-test.txt"))).toBe(true);

      // Read it back
      const content = await readTool.invoke({ path: "wt-test.txt" });
      expect(content).toBe("isolated");

      // Verify the file does NOT exist in the original workspace
      expect(fs.existsSync(path.join(process.cwd(), "wt-test.txt"))).toBe(false);
    } finally {
      await handle.remove();
    }
  });
});
