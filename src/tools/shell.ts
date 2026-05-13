import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { exec } from "child_process";
import { promisify } from "util";
import * as path from "path";
import * as fs from "fs";

const execAsync = promisify(exec);
const WORKSPACE = process.cwd();
const WORKSPACE_SEP = WORKSPACE.endsWith(path.sep) ? WORKSPACE : WORKSPACE + path.sep;

const SAFE_COMMANDS = new Set([
  "git",
  "npm",
  "yarn",
  "pnpm",
  "bun",
  "node",
  "ts-node",
  "tsx",
  "npx",
  "bunx",
  "cargo",
  "go",
  "python",
  "python3",
  "pip",
  "pip3",
  "uv",
  "rustc",
  "tsc",
  "eslint",
  "prettier",
  "jest",
  "vitest",
  "mocha",
  "curl",
  "wget",
  "cat",
  "ls",
  "find",
  "grep",
  "echo",
  "mkdir",
  "cp",
  "mv",
  "touch",
  "head",
  "tail",
  "wc",
  "sort",
  "uniq",
  "diff",
  "jq",
  "sed",
  "awk",
]);

function getBaseCommand(command: string): string {
  const parts = command.trim().split(/\s+/);
  for (const part of parts) {
    if (!/^[A-Z_]+=/.test(part)) return part;
  }
  return parts[0];
}

/**
 * Returns an error string if the command references any paths outside WORKSPACE,
 * or null if the command is safe to run.
 *
 * Checks:
 *   1. Absolute paths not under WORKSPACE
 *   2. Relative paths with .. that escape WORKSPACE when resolved
 *   3. Home directory shortcuts (~ / $HOME / $TMPDIR / /tmp)
 */
function validateWorkspacePaths(command: string): string | null {
  // Tokenize: split on whitespace, strip surrounding quotes
  const tokens = (command.match(/(?:[^\s'"]+|'[^']*'|"[^"]*")+/g) ?? []).map(
    (t) => t.replace(/^['"]|['"]$/g, "")
  );

  for (const token of tokens) {
    // Skip short flags like -f, --dry-run, KEY=val prefixes
    if (token.startsWith("-") || /^[A-Z_]+=/.test(token)) continue;

    // ── Absolute paths ────────────────────────────────────────────────────────
    if (path.isAbsolute(token)) {
      const resolved = path.resolve(token);
      if (resolved !== WORKSPACE && !resolved.startsWith(WORKSPACE_SEP)) {
        return (
          `Blocked: "${token}" is outside the workspace.\n` +
          `All paths must be relative to or within: ${WORKSPACE}`
        );
      }
      // Symlink resolution: verify real path is still inside workspace
      try {
        const real = fs.realpathSync(resolved);
        if (real !== WORKSPACE && !real.startsWith(WORKSPACE_SEP)) {
          return `Blocked: symlink "${token}" resolves outside the workspace (→ ${real}).`;
        }
      } catch { /* path doesn't exist yet — no symlink to follow */ }
    }

    // ── Relative paths with traversal (../../../etc) ──────────────────────────
    if (token.includes("..")) {
      const resolved = path.resolve(WORKSPACE, token);
      if (resolved !== WORKSPACE && !resolved.startsWith(WORKSPACE_SEP)) {
        return (
          `Blocked: path traversal "${token}" escapes the workspace.\n` +
          `Resolved to: ${resolved}\n` +
          `Workspace is: ${WORKSPACE}`
        );
      }
    }

    // ── Home-dir shortcuts ────────────────────────────────────────────────────
    if (token === "~" || token.startsWith("~/")) {
      return `Blocked: home directory reference "${token}" is outside the workspace.`;
    }
  }

  // ── Env-var shortcuts that expand outside workspace ───────────────────────
  const dangerousVars = ["$HOME", "${HOME}", "$TMPDIR", "${TMPDIR}", "$TMP", "${TMP}"];
  for (const v of dangerousVars) {
    if (command.includes(v)) {
      return `Blocked: "${v}" expands outside the workspace.`;
    }
  }

  // ── Block /tmp and other well-known system dirs explicitly ────────────────
  const systemDirs = ["/tmp", "/var", "/etc", "/usr", "/bin", "/sbin", "/opt", "/private"];
  for (const dir of systemDirs) {
    // Look for these as path prefixes in the raw command string
    const re = new RegExp(`(?:^|\\s|['"])${dir.replace("/", "\\/")}(?:[/\\s'"]|$)`);
    if (re.test(command)) {
      return (
        `Blocked: system directory "${dir}" is outside the workspace.\n` +
        `Use paths relative to the workspace: ${WORKSPACE}`
      );
    }
  }

  return null;
}

export const ExecuteTool = tool(
  async ({ command }: { command: string }) => {
    const base = getBaseCommand(command);
    if (!SAFE_COMMANDS.has(base)) {
      return `Command not allowed: "${base}". Allowed commands: ${[...SAFE_COMMANDS].join(", ")}`;
    }

    const pathError = validateWorkspacePaths(command);
    if (pathError) return pathError;

    try {
      const { stdout, stderr } = await execAsync(command, {
        cwd: WORKSPACE,
        timeout: 60000,
        env: { ...process.env, FORCE_COLOR: "0" },
      });
      const out = [stdout, stderr].filter(Boolean).join("\n--- stderr ---\n").trim();
      return out || "[no output]";
    } catch (err) {
      const e = err as { stdout?: string; stderr?: string; message?: string };
      const out = [e.stdout, e.stderr, e.message].filter(Boolean).join("\n").trim();
      return `Error (exit non-zero):\n${out}`;
    }
  },
  {
    name: "run_command",
    description: `Execute a shell command in the workspace directory (${WORKSPACE}).
Allowed base commands: git, npm, yarn, pnpm, bun, node, tsx, tsc, cargo, go, python, pip, curl, wget, cat, ls, find, grep, echo, mkdir, cp, mv, touch, head, tail, wc, sort, uniq, diff, jq, sed, awk, eslint, prettier, jest, vitest.
All paths MUST be relative to the workspace. Absolute paths outside the workspace are rejected.`,
    schema: z.object({
      command: z.string().describe("Shell command to run. Use relative paths only."),
    }),
  }
);

export const shellTools = [ExecuteTool];
