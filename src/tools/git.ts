import { tool } from "./tool.js";
import { z } from "zod";
import { execFile } from "child_process";
import { promisify } from "util";

const execFileAsync = promisify(execFile);

async function git(args: string[]): Promise<string> {
  try {
    const { stdout, stderr } = await execFileAsync("git", args, { timeout: 30000 });
    return stdout || stderr || "[no output]";
  } catch (error) {
    if (error instanceof Error && "stderr" in error) {
      return `Git error: ${(error as { stderr: string }).stderr}`;
    }
    return `Git error: ${error instanceof Error ? error.message : String(error)}`;
  }
}

export const GitStatusTool = tool(
  async () => {
    return await git(["status"]);
  },
  {
    name: "git_status",
    description: "Show the working tree status",
    schema: z.object({}),
  }
);

export const GitDiffTool = tool(
  async () => {
    return await git(["diff"]);
  },
  {
    name: "git_diff",
    description: "Show changes between commits, commit and working tree, etc",
    schema: z.object({}),
  }
);

export const GitLogTool = tool(
  async ({ n }: { n?: number } = {}) => {
    return await git(["log", "--oneline", `-${n ?? 10}`]);
  },
  {
    name: "git_log",
    description: "Show recent commits",
    schema: z.object({
      n: z.number().optional().describe("Number of commits to show (default: 10)"),
    }),
  }
);

export const GitBranchTool = tool(
  async () => {
    return await git(["branch", "-a"]);
  },
  {
    name: "git_branch",
    description: "List all branches",
    schema: z.object({}),
  }
);

export const GitCommitTool = tool(
  async ({ message }: { message: string }) => {
    return await git(["commit", "-m", message]);
  },
  {
    name: "git_commit",
    description: "Commit changes with a message",
    schema: z.object({
      message: z.string().describe("The commit message"),
    }),
  }
);
