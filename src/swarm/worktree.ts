/**
 * Git worktree lifecycle management for isolated agent execution.
 *
 * Each worktree is a full checkout of the repo in a temp directory on a
 * dedicated branch. Agents running in isolation get filesystem tools scoped
 * to their worktree root, preventing file conflicts between concurrent agents.
 */

import { execSync } from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

export interface WorktreeHandle {
  /** Absolute path to the worktree directory. */
  path: string;
  /** Git branch created for this worktree. */
  branch: string;
  /** Remove the worktree and delete its branch. Best-effort — never throws. */
  remove(): Promise<void>;
}

/** Returns true if `dir` is inside a git repository. */
export function isGitRepo(dir: string): boolean {
  try {
    execSync("git rev-parse --git-dir", { cwd: dir, stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

/**
 * Returns the top-level git repository root for `dir`, or null if not in a repo.
 */
export function getRepoRoot(dir: string): string | null {
  try {
    return execSync("git rev-parse --show-toplevel", {
      cwd: dir,
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return null;
  }
}

/**
 * Create an isolated git worktree for an agent.
 *
 * The worktree is placed in the system temp directory and checked out on a
 * new branch named `chorus/<swarmId>/<agentName>`. The branch is created from
 * HEAD of the current branch so the agent starts with the same code.
 *
 * @throws if the directory is not a git repo or `git worktree add` fails.
 */
export function createWorktree(agentName: string, swarmId: string): WorktreeHandle {
  const repoRoot = getRepoRoot(process.cwd());
  if (!repoRoot) {
    throw new Error("Not inside a git repository — worktree isolation requires git.");
  }

  // Sanitize to safe branch name chars
  const safeName = `${swarmId}-${agentName}`.replace(/[^a-zA-Z0-9-]/g, "-").slice(0, 60);
  const branch = `chorus/${safeName}`;
  const wtPath = path.join(os.tmpdir(), `chorus-wt-${safeName}`);

  // Remove stale worktree dir if it exists from a previous crashed run
  if (fs.existsSync(wtPath)) {
    try {
      execSync(`git worktree remove --force "${wtPath}"`, {
        cwd: repoRoot,
        stdio: "ignore",
      });
    } catch {
      fs.rmSync(wtPath, { recursive: true, force: true });
    }
  }

  execSync(`git worktree add "${wtPath}" -b "${branch}"`, {
    cwd: repoRoot,
    stdio: "pipe",
  });

  return {
    path: wtPath,
    branch,
    remove: async () => {
      // Remove the worktree directory
      try {
        execSync(`git worktree remove --force "${wtPath}"`, {
          cwd: repoRoot,
          stdio: "ignore",
        });
      } catch {
        // If git worktree remove fails, fall back to plain rm
        try {
          fs.rmSync(wtPath, { recursive: true, force: true });
        } catch {
          // Never throw on cleanup failure
        }
      }
      // Prune the dangling worktree reference
      try {
        execSync("git worktree prune", { cwd: repoRoot, stdio: "ignore" });
      } catch {
        // Ignore
      }
      // Delete the branch
      try {
        execSync(`git branch -D "${branch}"`, { cwd: repoRoot, stdio: "ignore" });
      } catch {
        // Ignore — branch may already be gone
      }
    },
  };
}
