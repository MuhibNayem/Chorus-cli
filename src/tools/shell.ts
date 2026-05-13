import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { execFile } from "child_process";
import { promisify } from "util";
import * as path from "path";
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

const EVAL_FLAGS_BY_COMMAND: Record<string, Set<string>> = {
  node: new Set(["-e", "--eval", "-p", "--print"]),
  python: new Set(["-c"]),
  python3: new Set(["-c"]),
  "ts-node": new Set(["-e", "--eval", "-p", "--print"]),
  tsx: new Set(["-e", "--eval"]),
};

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

  if (quote) {
    throw new Error("Unclosed quote in command.");
  }
  if (escaping) {
    current += "\\";
  }
  if (current) {
    tokens.push(current);
  }

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

function getDisallowedFlag(base: string, args: string[]): string | null {
  const disallowed = EVAL_FLAGS_BY_COMMAND[base];
  if (!disallowed) return null;

  for (const arg of args) {
    if (disallowed.has(arg)) return arg;
    if ([...disallowed].some((flag) => arg.startsWith(`${flag}=`))) return arg;
  }

  return null;
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
    const envMatch = token.match(/^[A-Za-z_][A-Za-z0-9_]*=(.*)$/);
    const value = envMatch ? envMatch[1] : token;

    // Skip short flags like -f and --dry-run.
    if (!envMatch && value.startsWith("-")) continue;

    // ── Absolute paths ────────────────────────────────────────────────────────
    if (path.isAbsolute(value)) {
      const resolved = path.resolve(value);
      if (resolved !== WORKSPACE && !resolved.startsWith(WORKSPACE_SEP)) {
        return (
          `Blocked: "${value}" is outside the workspace.\n` +
          `All paths must be relative to or within: ${WORKSPACE}`
        );
      }
    }

    // ── Relative paths with traversal (../../../etc) ──────────────────────────
    if (value.includes("..")) {
      const resolved = path.resolve(WORKSPACE, value);
      if (resolved !== WORKSPACE && !resolved.startsWith(WORKSPACE_SEP)) {
        return (
          `Blocked: path traversal "${value}" escapes the workspace.\n` +
          `Resolved to: ${resolved}\n` +
          `Workspace is: ${WORKSPACE}`
        );
      }
    }

    // ── Home-dir shortcuts ────────────────────────────────────────────────────
    if (value === "~" || value.startsWith("~/")) {
      return `Blocked: home directory reference "${value}" is outside the workspace.`;
    }

    // ── Env-var shortcuts that expand outside workspace ─────────────────────
    const dangerousVars = ["$HOME", "${HOME}", "$TMPDIR", "${TMPDIR}", "$TMP", "${TMP}"];
    for (const variable of dangerousVars) {
      if (value.includes(variable)) {
        return `Blocked: "${variable}" expands outside the workspace.`;
      }
    }

    // ── Block /tmp and other well-known system dirs explicitly ──────────────
    const systemDirs = ["/tmp", "/var", "/etc", "/usr", "/bin", "/sbin", "/opt", "/private"];
    for (const dir of systemDirs) {
      if (value === dir || value.startsWith(`${dir}/`)) {
        return (
          `Blocked: system directory "${dir}" is outside the workspace.\n` +
          `Use paths relative to the workspace: ${WORKSPACE}`
        );
      }
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
    } catch (error) {
      auditCommand({ command, allowed: false, reason: `parse error: ${error instanceof Error ? error.message : String(error)}` });
      return `Command parse error: ${error instanceof Error ? error.message : String(error)}`;
    }

    const { env, argv } = splitEnvAssignments(tokens);
    const [base, ...args] = argv;

    if (!base) {
      auditCommand({ command, allowed: false, reason: "empty command" });
      return "Command not allowed: empty command.";
    }
    if (!SAFE_COMMANDS.has(base)) {
      auditCommand({ command, allowed: false, reason: `base command not allowed: ${base}` });
      return `Command not allowed: "${base}". Allowed commands: ${[...SAFE_COMMANDS].join(", ")}`;
    }

    const disallowedFlag = getDisallowedFlag(base, args);
    if (disallowedFlag) {
      auditCommand({ command, allowed: false, reason: `inline execution flag: ${disallowedFlag}` });
      return `Blocked: "${base} ${disallowedFlag}" can execute arbitrary inline code. Use a file in the workspace instead.`;
    }

    const safety = assessCommandSafety(base, args);
    if (!safety.ok) {
      auditCommand({ command, allowed: false, reason: safety.reason });
      return safety.reason ?? "Blocked by command safety policy.";
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
