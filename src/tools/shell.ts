import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { execFile } from "child_process";
import { promisify } from "util";
import * as path from "path";
import * as fs from "fs";
import { assessCommandSafety, auditCommand } from "./safety.js";

const execFileAsync = promisify(execFile);
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

function tokenizeCommand(command: string): string[] {
  const tokens: string[] = [];
  let current = "";
  let quote: "'" | "\"" | null = null;
  let escaping = false;

  for (const char of command.trim()) {
    if (escaping) {
      current += char;
      escaping = false;
      continue;
    }
    if (char === "\\" && quote !== "'") {
      escaping = true;
      continue;
    }
    if ((char === "'" || char === "\"") && !quote) {
      quote = char;
      continue;
    }
    if (quote === char) {
      quote = null;
      continue;
    }
    if (!quote && /\s/.test(char)) {
      if (current) {
        tokens.push(current);
        current = "";
      }
      continue;
    }
    current += char;
  }

  if (quote) throw new Error("Unclosed quote in command.");
  if (escaping) current += "\\";
  if (current) tokens.push(current);
  return tokens;
}

function hasShellSyntax(command: string): boolean {
  return /[;&|<>`\n\r]/.test(command) || command.includes("$(");
}

function splitEnvAssignments(tokens: string[]): { env: Record<string, string>; argv: string[] } {
  const env: Record<string, string> = {};
  let index = 0;
  while (index < tokens.length) {
    const match = tokens[index].match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match) break;
    env[match[1]] = match[2];
    index += 1;
  }
  return { env, argv: tokens.slice(index) };
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
function validateWorkspacePaths(tokens: string[]): string | null {
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

    // ── Symlink check for relative paths (catches link-to-outside/file) ───────
    if (!path.isAbsolute(token) && !token.startsWith("-") && token.includes("/")) {
      const resolved = path.resolve(WORKSPACE, token);
      try {
        const real = fs.realpathSync(resolved);
        if (real !== WORKSPACE && !real.startsWith(WORKSPACE_SEP)) {
          return `Blocked: symlink "${token}" resolves outside the workspace (→ ${real}).`;
        }
      } catch { /* path doesn't exist yet — no symlink to follow */ }
    }

    // ── Home-dir shortcuts ────────────────────────────────────────────────────
    if (token === "~" || token.startsWith("~/")) {
      return `Blocked: home directory reference "${token}" is outside the workspace.`;
    }
  }

  // ── Env-var shortcuts that expand outside workspace ───────────────────────
  const dangerousVars = ["$HOME", "${HOME}", "$TMPDIR", "${TMPDIR}", "$TMP", "${TMP}"];
  for (const token of tokens) {
    for (const v of dangerousVars) {
      if (token.includes(v)) {
        return `Blocked: "${v}" expands outside the workspace.`;
      }
    }
  }

  // ── Block /tmp and other well-known system dirs explicitly ────────────────
  const systemDirs = ["/tmp", "/var", "/etc", "/usr", "/bin", "/sbin", "/opt", "/private"];
  for (const dir of systemDirs) {
    if (tokens.some((token) => token === dir || token.startsWith(`${dir}/`))) {
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
    if (hasShellSyntax(command)) {
      auditCommand({ command, allowed: false, reason: "shell syntax/operator blocked" });
      return "Blocked: shell operators, redirection, command substitution, and pipelines are not allowed.";
    }

    let tokens: string[];
    try {
      tokens = tokenizeCommand(command);
    } catch (err) {
      return `Blocked: ${err instanceof Error ? err.message : String(err)}`;
    }
    const { env, argv } = splitEnvAssignments(tokens);
    const [base, ...args] = argv;
    if (!base) return "Blocked: empty command.";

    if (!SAFE_COMMANDS.has(base)) {
      return `Command not allowed: "${base}". Allowed commands: ${[...SAFE_COMMANDS].join(", ")}`;
    }

    const safety = assessCommandSafety(base, args);
    if (!safety.ok) {
      auditCommand({ command, allowed: false, reason: safety.reason });
      return safety.reason ?? "Blocked destructive command.";
    }

    const pathError = validateWorkspacePaths(tokens);
    if (pathError) {
      auditCommand({ command, allowed: false, reason: pathError });
      return pathError;
    }

    try {
      auditCommand({ command, allowed: true });
      const { stdout, stderr } = await execFileAsync(base, args, {
        cwd: WORKSPACE,
        timeout: 60000,
        env: { ...process.env, ...env, FORCE_COLOR: "0" },
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
