import type { Dispatch } from "react";
import type { FeedAction } from "./state/feedReducer.js";
import { sessionManager } from "../session/manager.js";
import { loadSettings, getModeModelConfig } from "../settings/storage.js";
import type { ApprovalPolicy, ExecutionMode } from "../harness/types.js";
import { describeApprovalPolicy } from "./hooks/agent/toolPolicy.js";
import { SWARM_PRESETS } from "../swarm/presets/index.js";
import { buildSwarmReport, formatSwarmReport, listSwarmTraces } from "../swarm/report.js";
import { formatMcpConfigExample, getMcpStatus, getProjectMcpTrust, reloadMcpConnections, trustProjectMcpConfig } from "../mcp/index.js";
import { estimateCost, formatCost } from "../llm/pricing.js";
import * as fs from "fs";
import * as path from "path";
import { execSync, spawnSync } from "child_process";

export interface CommandContext {
  dispatch: Dispatch<FeedAction>;
  clearHistory: () => void;
  getTokens: () => number;
  getModel: () => string;
  exit: () => void;
  onResumeSession: (id: string) => void;
  onNewSession: () => void;
  launchWizard?: (mode: "add-provider") => void;
  showModelSelect?: () => void;
  showProviderSelect?: () => void;
  showResumeSelect?: () => void;
  showDefaultModelSelect?: () => void;
  showAgents?: () => void;
  showModeModelSelect?: (mode: "build" | "plan") => void;
  showApiKeysConfig?: () => void;
  showMcpAddWizard?: () => void;
  getExecutionMode?: () => ExecutionMode;
  setExecutionMode?: (mode: ExecutionMode) => void;
  getApprovalPolicy?: () => ApprovalPolicy;
  setApprovalPolicy?: (policy: ApprovalPolicy) => void;
  setAdvisorEnabled?: (enabled: boolean) => void;
  submitBtw?: (text: string) => boolean;
  runSwarmPreset?: (presetName: string, task: string) => void;
  stopSwarm?: () => void;
  listSwarmTraces?: () => void;
  showSwarmReport?: (swarmId: string) => void;
  /** Send a message to the agent as if the user typed it */
  sendAgentMessage?: (text: string) => void;
  /** Stream a shell command with live output in the feed */
  runShellStream?: (command: string, args: string[], label: string) => void;
  /** Open interactive file picker and inject selected file(s) into context */
  showFilePicker?: (onSelect: (filePath: string, content: string) => void) => void;
  /** Show a confirmation dialog; calls onConfirm if user accepts */
  showConfirmDialog?: (message: string, onConfirm: () => void) => void;
  /** Get accumulated session cost metrics */
  getSessionCost?: () => { inputTokens: number; outputTokens: number; costUsd: number };
}

export interface SlashCommand {
  name: string;
  description: string;
}

export const SLASH_COMMANDS: SlashCommand[] = [
  // ── Navigation & info ──────────────────────────────────────────────────────
  { name: "/help",          description: "Show available commands" },
  { name: "/clear",         description: "Clear the conversation feed" },
  { name: "/compact",       description: "Compact conversation history" },
  { name: "/cwd",           description: "Show workspace directory" },
  { name: "/tokens",        description: "Show context token count" },
  { name: "/cost",          description: "Show cumulative session cost and token usage" },
  { name: "/status",        description: "Show model, mode, approval policy, and session info" },
  { name: "/doctor",        description: "Check CLI health: API keys, git, provider connectivity" },
  // ── Context management ─────────────────────────────────────────────────────
  { name: "/add",           description: "Add a file to the conversation context: /add <file>" },
  { name: "/drop",          description: "Remove a file from context (interactive picker)" },
  { name: "/map",           description: "Show a tree map of the current workspace" },
  { name: "/init",          description: "Scaffold a CHORUS.md project context file" },
  // ── AI actions ─────────────────────────────────────────────────────────────
  { name: "/explain",       description: "Ask the agent to explain the current codebase or a file" },
  { name: "/fix",           description: "Ask the agent to fix the last error or a specific issue" },
  { name: "/doc",           description: "Ask the agent to generate documentation" },
  // ── Git workflow ───────────────────────────────────────────────────────────
  { name: "/diff",          description: "Show git diff of current changes" },
  { name: "/commit",        description: "Stage all changes and commit with an AI-generated message" },
  { name: "/undo",          description: "Stash (undo) the last set of changes via git stash" },
  // ── Shell & testing ────────────────────────────────────────────────────────
  { name: "/run",           description: "Run a shell command and inject output into context" },
  { name: "/test",          description: "Run the project test suite and stream output" },
  { name: "/lint",          description: "Run the configured linter and surface errors" },
  // ── Mode & model ───────────────────────────────────────────────────────────
  { name: "/plan",          description: "Switch to Plan Mode (read-only planning)" },
  { name: "/build",         description: "Switch to Build Mode (edit, test, review)" },
  { name: "/mode",          description: "Show current execution mode" },
  { name: "/approval",      description: "Set approval policy: suggest, auto-edit, full-auto" },
  { name: "/model",         description: "Switch model for this session (interactive)" },
  { name: "/provider",      description: "Switch provider for this session (interactive)" },
  { name: "/default-model", description: "Set permanent default model (interactive)" },
  { name: "/new-provider",  description: "Configure a new provider (interactive wizard)" },
  { name: "/build-model",   description: "Set model for Build mode (interactive)" },
  { name: "/plan-model",    description: "Set model for Plan mode (interactive)" },
  // ── Sessions ───────────────────────────────────────────────────────────────
  { name: "/sessions",      description: "List sessions for this workspace" },
  { name: "/session",       description: "Show current session info" },
  { name: "/resume",        description: "Resume a past session (interactive)" },
  { name: "/session-new",   description: "Start a fresh session" },
  // ── Agents ─────────────────────────────────────────────────────────────────
  { name: "/agents",        description: "List agents or create a new one (interactive)" },
  { name: "/btw",           description: "Inject a note into the active agent loop between tool rounds" },
  { name: "/advisor",       description: "Toggle advisor: on | off | status" },
  // ── Swarm ──────────────────────────────────────────────────────────────────
  { name: "/swarm",         description: "Run a multi-agent swarm preset: /swarm <preset> [task]" },
  { name: "/swarm-stop",    description: "Stop the currently running swarm" },
  { name: "/swarm-traces",  description: "List swarm trace files from ~/.chorus/swarm-traces/" },
  { name: "/swarm-report",  description: "Show observability report for a swarm: /swarm-report <swarmId>" },
  // ── MCP ────────────────────────────────────────────────────────────────────
  { name: "/mcp",           description: "Show MCP server status and configured tools" },
  { name: "/mcp-add",       description: "Add an MCP server interactively" },
  { name: "/mcp-trust",     description: "Trust this workspace .mcp.json after review" },
  { name: "/mcp-reload",    description: "Reconnect configured MCP servers" },
  // ── Config & exit ──────────────────────────────────────────────────────────
  { name: "/config",        description: "Configure API keys (Serper, Google CSE, Weather)" },
  { name: "/exit",          description: "Exit the CLI" },
];

// ─── Help text (grouped) ──────────────────────────────────────────────────────

function buildHelpText(): string {
  const groups: Record<string, SlashCommand[]> = {};
  const order: string[] = [];
  for (const cmd of SLASH_COMMANDS) {
    // Determine group from the comment sections in the array above
    let group = "Other";
    if (["/help","/clear","/compact","/cwd","/tokens","/cost","/status","/doctor"].includes(cmd.name)) group = "Info & Health";
    else if (["/add","/drop","/map","/init"].includes(cmd.name)) group = "Context";
    else if (["/explain","/fix","/doc"].includes(cmd.name)) group = "AI Actions";
    else if (["/diff","/commit","/undo"].includes(cmd.name)) group = "Git";
    else if (["/run","/test","/lint"].includes(cmd.name)) group = "Shell";
    else if (["/plan","/build","/mode","/approval","/model","/provider","/default-model","/new-provider","/build-model","/plan-model"].includes(cmd.name)) group = "Mode & Model";
    else if (["/sessions","/session","/resume","/session-new"].includes(cmd.name)) group = "Sessions";
    else if (["/agents","/btw","/advisor"].includes(cmd.name)) group = "Agents";
    else if (["/swarm","/swarm-stop","/swarm-traces","/swarm-report"].includes(cmd.name)) group = "Swarm";
    else if (["/mcp","/mcp-add","/mcp-trust","/mcp-reload"].includes(cmd.name)) group = "MCP";
    else if (["/config","/exit"].includes(cmd.name)) group = "Config";

    if (!groups[group]) { groups[group] = []; order.push(group); }
    groups[group].push(cmd);
  }

  const lines: string[] = ["Available slash commands:"];
  for (const g of order) {
    lines.push(`\n  ── ${g} ${"─".repeat(Math.max(0, 36 - g.length - 5))}`);
    for (const c of groups[g]) {
      lines.push(`  ${c.name.padEnd(16)} ${c.description}`);
    }
  }
  lines.push("\nType @<filename> to inject file contents into your message.");
  return lines.join("\n");
}

const FULL_HELP = buildHelpText();

// ─── Shell helpers ────────────────────────────────────────────────────────────

function runGit(args: string[]): string {
  try {
    return execSync(`git ${args.join(" ")}`, {
      encoding: "utf-8",
      cwd: process.cwd(),
      timeout: 15000,
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();
  } catch (err) {
    const e = err as { stdout?: string; stderr?: string; message?: string };
    return (e.stderr ?? e.stdout ?? e.message ?? String(err)).trim();
  }
}

function runCommand(command: string, args: string[]): { output: string; ok: boolean } {
  try {
    const result = spawnSync(command, args, {
      encoding: "utf-8",
      cwd: process.cwd(),
      timeout: 60000,
      stdio: ["pipe", "pipe", "pipe"],
    });
    const output = [result.stdout, result.stderr].filter(Boolean).join("\n").trim();
    return { output: output || "[no output]", ok: result.status === 0 };
  } catch (err) {
    return { output: String(err), ok: false };
  }
}

function detectTestRunner(): { cmd: string; args: string[] } | null {
  const cwd = process.cwd();
  const pkgPath = path.join(cwd, "package.json");
  try {
    const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8")) as { scripts?: Record<string, string>; devDependencies?: Record<string, string> };
    if (pkg.scripts?.test && !pkg.scripts.test.includes("no test")) {
      const testCmd = pkg.scripts.test;
      if (testCmd.includes("vitest")) return { cmd: "npx", args: ["vitest", "run"] };
      if (testCmd.includes("jest")) return { cmd: "npx", args: ["jest"] };
      if (testCmd.includes("mocha")) return { cmd: "npx", args: ["mocha"] };
      return { cmd: "npm", args: ["test", "--", "--ci"] };
    }
    if (pkg.devDependencies?.vitest) return { cmd: "npx", args: ["vitest", "run"] };
    if (pkg.devDependencies?.jest) return { cmd: "npx", args: ["jest"] };
  } catch { /* no package.json */ }

  if (fs.existsSync(path.join(cwd, "Makefile"))) return { cmd: "make", args: ["test"] };
  if (fs.existsSync(path.join(cwd, "Cargo.toml"))) return { cmd: "cargo", args: ["test"] };
  if (fs.existsSync(path.join(cwd, "go.mod"))) return { cmd: "go", args: ["test", "./..."] };
  return null;
}

function detectLinter(): { cmd: string; args: string[] } | null {
  const cwd = process.cwd();
  if (fs.existsSync(path.join(cwd, ".eslintrc.js")) || fs.existsSync(path.join(cwd, ".eslintrc.json")) || fs.existsSync(path.join(cwd, "eslint.config.js")) || fs.existsSync(path.join(cwd, "eslint.config.mjs"))) {
    return { cmd: "npx", args: ["eslint", ".", "--max-warnings=0"] };
  }
  if (fs.existsSync(path.join(cwd, "biome.json"))) {
    return { cmd: "npx", args: ["biome", "check", "."] };
  }
  if (fs.existsSync(path.join(cwd, "tsconfig.json"))) {
    return { cmd: "npx", args: ["tsc", "--noEmit"] };
  }
  if (fs.existsSync(path.join(cwd, ".flake8")) || fs.existsSync(path.join(cwd, "pyproject.toml"))) {
    return { cmd: "python3", args: ["-m", "flake8", "."] };
  }
  return null;
}

function buildProjectMap(dir: string, depth = 0, maxDepth = 3): string {
  const lines: string[] = [];
  const indent = "  ".repeat(depth);
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true })
      .filter((e) => !["node_modules", ".git", "dist", "build", ".next", "__pycache__"].includes(e.name))
      .sort((a, b) => {
        if (a.isDirectory() !== b.isDirectory()) return a.isDirectory() ? -1 : 1;
        return a.name.localeCompare(b.name);
      });
  } catch { return lines.join("\n"); }

  for (const entry of entries) {
    if (entry.isDirectory()) {
      lines.push(`${indent}${entry.name}/`);
      if (depth < maxDepth) {
        const sub = buildProjectMap(path.join(dir, entry.name), depth + 1, maxDepth);
        if (sub) lines.push(sub);
      }
    } else {
      lines.push(`${indent}${entry.name}`);
    }
  }
  return lines.join("\n");
}

function inferCommitMessage(): string {
  const stat = runGit(["diff", "--staged", "--stat"]);
  const unstagedStat = runGit(["diff", "--stat"]);
  const effectiveStat = stat || unstagedStat;
  if (!effectiveStat || effectiveStat.startsWith("Git error")) return "chore: update";

  const lines = effectiveStat.split("\n");
  const summary = lines.at(-1) ?? "";
  const changed = lines.filter((l) => l.match(/\|\s+\d/)).map((l) => l.trim().split(/\s/)[0]).slice(0, 3);

  if (changed.length === 1) {
    const file = path.basename(changed[0]);
    const ext = path.extname(file);
    if ([".test.ts", ".spec.ts", ".test.js"].some((e) => file.endsWith(e))) return `test: update ${file}`;
    if (file === "package.json" || file === "package-lock.json") return "chore: update dependencies";
    if (file.endsWith(".md")) return `docs: update ${file}`;
    return `refactor: update ${file}`;
  }

  if (summary.includes("insertion") && !summary.includes("deletion")) return "feat: add new code";
  if (!summary.includes("insertion") && summary.includes("deletion")) return "refactor: remove code";
  return `chore: update ${changed.length} files`;
}

function scanProjectForInit(): string {
  const cwd = process.cwd();
  const lines: string[] = [];

  // Detect project name
  let projectName = path.basename(cwd);
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(cwd, "package.json"), "utf-8")) as { name?: string; description?: string };
    if (pkg.name) projectName = pkg.name;
    if (pkg.description) lines.push(`> ${pkg.description}`);
  } catch { /* no package.json */ }

  // Detect tech stack
  const stack: string[] = [];
  if (fs.existsSync(path.join(cwd, "package.json"))) stack.push("Node.js");
  if (fs.existsSync(path.join(cwd, "tsconfig.json"))) stack.push("TypeScript");
  if (fs.existsSync(path.join(cwd, "Cargo.toml"))) stack.push("Rust");
  if (fs.existsSync(path.join(cwd, "go.mod"))) stack.push("Go");
  if (fs.existsSync(path.join(cwd, "requirements.txt")) || fs.existsSync(path.join(cwd, "pyproject.toml"))) stack.push("Python");
  if (fs.existsSync(path.join(cwd, "pom.xml")) || fs.existsSync(path.join(cwd, "build.gradle"))) stack.push("Java/Kotlin");

  return `# CHORUS.md

## Project: ${projectName}

${lines.join("\n")}

## Tech Stack
${stack.length > 0 ? stack.map((s) => `- ${s}`).join("\n") : "- (detect from codebase)"}

## Key Directories
${buildProjectMap(cwd, 0, 2).split("\n").slice(0, 25).join("\n")}

## Development Commands
- Build: (add build command)
- Test: (add test command)
- Lint: (add lint command)

## Guidelines for the AI Agent
- Follow existing code style and patterns
- Prefer editing existing files over creating new ones
- Write tests for new functionality
- Keep changes focused and minimal
`;
}

function runDoctorCheck(): string {
  const checks: Array<{ label: string; status: "ok" | "warn" | "fail"; detail: string }> = [];

  // Node.js
  try {
    const v = execSync("node --version", { encoding: "utf-8", timeout: 3000 }).trim();
    checks.push({ label: "Node.js", status: "ok", detail: v });
  } catch {
    checks.push({ label: "Node.js", status: "fail", detail: "not found" });
  }

  // Git
  try {
    const v = execSync("git --version", { encoding: "utf-8", timeout: 3000 }).trim();
    checks.push({ label: "git", status: "ok", detail: v });
  } catch {
    checks.push({ label: "git", status: "fail", detail: "not found — /diff, /commit, /undo will not work" });
  }

  // Git repo
  try {
    execSync("git rev-parse --is-inside-work-tree", { encoding: "utf-8", timeout: 3000, stdio: "pipe" });
    checks.push({ label: "git repo", status: "ok", detail: "current directory is a git repository" });
  } catch {
    checks.push({ label: "git repo", status: "warn", detail: "not in a git repository — /diff, /commit, /undo disabled" });
  }

  // Chorus home
  const chorusHome = process.env.CHORUS_HOME_DIR ?? path.join(process.env.HOME ?? "~", ".chorus");
  const homeExists = fs.existsSync(chorusHome);
  checks.push({ label: "~/.chorus", status: homeExists ? "ok" : "warn", detail: homeExists ? chorusHome : `${chorusHome} — will be created on first run` });

  // Settings
  const settingsPath = path.join(chorusHome, "settings.json");
  const settings = loadSettings();
  const hasApiKey = Object.values(settings.llm?.providers ?? {}).some((p) => (p as { apiKey?: string }).apiKey);
  checks.push({ label: "settings.json", status: fs.existsSync(settingsPath) ? "ok" : "warn", detail: fs.existsSync(settingsPath) ? settingsPath : "not found (using defaults)" });
  checks.push({ label: "API key", status: hasApiKey ? "ok" : "warn", detail: hasApiKey ? "at least one provider configured" : "no API keys found — run /new-provider or /config" });

  // CHORUS.md
  const chorusMd = path.join(process.cwd(), "CHORUS.md");
  checks.push({ label: "CHORUS.md", status: fs.existsSync(chorusMd) ? "ok" : "warn", detail: fs.existsSync(chorusMd) ? "found" : "not found — run /init to create one" });

  const icon = (s: "ok" | "warn" | "fail") => s === "ok" ? "✓" : s === "warn" ? "⚠" : "✗";
  const header = "Chorus CLI — Doctor Report\n" + "─".repeat(50);
  const rows = checks.map((c) => `  ${icon(c.status)}  ${c.label.padEnd(16)} ${c.detail}`);
  const failCount = checks.filter((c) => c.status === "fail").length;
  const warnCount = checks.filter((c) => c.status === "warn").length;
  const summary = failCount > 0
    ? `\n${failCount} issue(s) found — check items marked ✗`
    : warnCount > 0
      ? `\n${warnCount} warning(s) — check items marked ⚠`
      : "\nAll checks passed.";

  return [header, ...rows, summary].join("\n");
}

export function handleSlashCommand(
  input: string,
  ctx: CommandContext
): boolean {
  if (!input.startsWith("/")) return false;

  const [cmdRaw, argRaw] = input.trim().split(/\s+/);
  const cmd = cmdRaw.toLowerCase();

  const ts = Date.now();
  const id = `sys-${ts}`;

  ctx.dispatch({ type: "APPEND_USER_MSG", id: `cmd-${ts}`, text: input });

  switch (cmd) {
    case "/help":
      ctx.dispatch({ type: "APPEND_SYSTEM", id, text: FULL_HELP });
      return true;

    case "/clear":
      ctx.dispatch({ type: "CLEAR_FEED" });
      ctx.clearHistory();
      return true;

    case "/compact":
      ctx.dispatch({ type: "APPEND_SYSTEM", id, text: "Context will be compacted on the next message." });
      return true;

    case "/cwd":
      ctx.dispatch({ type: "APPEND_SYSTEM", id, text: `Workspace: ${process.cwd()}` });
      return true;

    case "/model":
      ctx.showModelSelect?.();
      return true;

    case "/provider":
      ctx.showProviderSelect?.();
      return true;

    case "/new-provider":
      ctx.launchWizard?.("add-provider");
      return true;

    case "/default-model":
      ctx.showDefaultModelSelect?.();
      return true;

    case "/tokens":
      ctx.dispatch({ type: "APPEND_SYSTEM", id, text: `Context tokens: ${ctx.getTokens().toLocaleString()}` });
      return true;

    case "/sessions": {
      const sessions = sessionManager.listForWorkspace();
      if (sessions.length === 0) {
        ctx.dispatch({ type: "APPEND_SYSTEM", id, text: "No sessions found for this workspace." });
        return true;
      }
      function timeAgo(ms: number): string {
        const secs = Math.floor((Date.now() - ms) / 1000);
        if (secs < 60) return `${secs}s ago`;
        const mins = Math.floor(secs / 60);
        if (mins < 60) return `${mins}m ago`;
        const hrs = Math.floor(mins / 60);
        if (hrs < 24) return `${hrs}h ago`;
        const days = Math.floor(hrs / 24);
        if (days < 7) return `${days}d ago`;
        return `${Math.floor(days / 7)}w ago`;
      }
      const rows = sessions.map((s, i) => {
        const name    = (s.name || "(unnamed)").slice(0, 28).padEnd(28);
        const msgs    = `${s.messageCount} msg${s.messageCount !== 1 ? "s" : ""}`.padStart(7);
        const ago     = timeAgo(s.updatedAt).padStart(10);
        const idHint  = s.id.slice(0, 8);
        return `  ${String(i + 1).padStart(2)}.  ${name}  ${msgs}  ${ago}  ${idHint}`;
      });
      ctx.dispatch({ type: "APPEND_SYSTEM", id, text: `Sessions:\n${rows.join("\n")}` });
      return true;
    }

    case "/session": {
      const curr = sessionManager.getCurrent();
      const info = curr
        ? `Current session: ${curr.name || "(unnamed)"}  ·  id: ${curr.id.slice(0, 8)}  ·  ${curr.messageCount} messages`
        : "No active session.";
      ctx.dispatch({ type: "APPEND_SYSTEM", id, text: info });
      return true;
    }

    case "/agents":
      ctx.showAgents?.();
      return true;

    case "/plan":
      ctx.setExecutionMode?.("plan");
      ctx.dispatch({ type: "APPEND_SYSTEM", id, text: "Plan Mode enabled. I will inspect and produce plans without editing files or running mutating commands." });
      return true;

    case "/build":
      ctx.setExecutionMode?.("build");
      ctx.dispatch({ type: "APPEND_SYSTEM", id, text: "Build Mode enabled. I can make scoped edits, run checks, review diffs, and finalize changes." });
      return true;

    case "/mode": {
      const mode = ctx.getExecutionMode?.() ?? "build";
      const buildCfg = getModeModelConfig("build");
      const planCfg = getModeModelConfig("plan");
      const lines = [
        `Execution mode: ${mode}`,
        `Approval policy: ${describeApprovalPolicy(ctx.getApprovalPolicy?.() ?? "auto_edit")}`,
      ];
      if (buildCfg) lines.push(`Build model: ${buildCfg.provider}:${buildCfg.model}`);
      if (planCfg) lines.push(`Plan model: ${planCfg.provider}:${planCfg.model}`);
      ctx.dispatch({ type: "APPEND_SYSTEM", id, text: lines.join("\n") });
      return true;
    }

    case "/approval": {
      const normalized = argRaw?.replace("-", "_") as ApprovalPolicy | undefined;
      if (!normalized) {
        ctx.dispatch({ type: "APPEND_SYSTEM", id, text: `Approval policy: ${describeApprovalPolicy(ctx.getApprovalPolicy?.() ?? "auto_edit")}` });
        return true;
      }
      if (!["suggest", "auto_edit", "full_auto"].includes(normalized)) {
        ctx.dispatch({ type: "APPEND_SYSTEM", id, text: "Usage: /approval suggest | auto-edit | full-auto" });
        return true;
      }
      ctx.setApprovalPolicy?.(normalized);
      ctx.dispatch({ type: "APPEND_SYSTEM", id, text: describeApprovalPolicy(normalized) });
      return true;
    }

    case "/resume":
      ctx.showResumeSelect?.();
      return true;

    case "/session-new":
      ctx.onNewSession();
      ctx.dispatch({ type: "APPEND_SYSTEM", id, text: "Started a new session." });
      return true;

    case "/build-model":
      ctx.showModeModelSelect?.("build");
      return true;

    case "/plan-model":
      ctx.showModeModelSelect?.("plan");
      return true;

    case "/btw": {
      const text = input.trim().slice(4).trim();
      if (!text) {
        ctx.dispatch({ type: "APPEND_SYSTEM", id, text: "Usage: /btw <note for the active agent>" });
        return true;
      }
      const queued = ctx.submitBtw?.(text) ?? false;
      ctx.dispatch({
        type: "APPEND_SYSTEM",
        id,
        text: queued
          ? `Queued mid-task note: ${text}`
          : "No active agent loop is running. /btw only works while the agent is in progress.",
      });
      return true;
    }

    case "/advisor": {
      const arg = argRaw?.toLowerCase();
      if (arg === "on") {
        ctx.setAdvisorEnabled?.(true);
        ctx.dispatch({ type: "APPEND_SYSTEM", id, text: "Advisor enabled. A senior reviewer will check plans before execution." });
        return true;
      }
      if (arg === "off") {
        ctx.setAdvisorEnabled?.(false);
        ctx.dispatch({ type: "APPEND_SYSTEM", id, text: "Advisor disabled. Plans will go straight to execution." });
        return true;
      }
      const advisorSettings = loadSettings().llm?.advisor;
      const status = advisorSettings?.enabled
        ? `Advisor: ON  (${advisorSettings.provider ?? "default"}:${advisorSettings.model ?? "default"})`
        : "Advisor: OFF";
      ctx.dispatch({ type: "APPEND_SYSTEM", id, text: `${status}\nUsage: /advisor on | off` });
      return true;
    }

    case "/config":
      ctx.showApiKeysConfig?.();
      return true;

    case "/swarm": {
      const parts = input.trim().slice(6).trim().split(/\s+/);
      const presetName = parts[0];

      if (!presetName || presetName === "list") {
        const rows = SWARM_PRESETS.map(
          (p) => `  ${p.name.padEnd(22)}  ${p.description}\n                            agents: ${p.agents.join(" → ")}`,
        ).join("\n");
        ctx.dispatch({
          type: "APPEND_SYSTEM",
          id,
          text: `Available swarm presets:\n\n${rows}\n\nUsage: /swarm <preset> [task description]`,
        });
        return true;
      }

      const preset = SWARM_PRESETS.find((p) => p.name === presetName);
      if (!preset) {
        ctx.dispatch({
          type: "APPEND_SYSTEM",
          id,
          text: `Unknown preset: "${presetName}". Run /swarm to list available presets.`,
        });
        return true;
      }

      const taskParts = parts.slice(1);
      const task = taskParts.length > 0
        ? taskParts.join(" ")
        : `Run the ${preset.name} workflow on the current workspace.`;

      if (!ctx.runSwarmPreset) {
        ctx.dispatch({
          type: "APPEND_SYSTEM",
          id,
          text: "Swarm execution is not available in this context.",
        });
        return true;
      }

      ctx.dispatch({
        type: "APPEND_SYSTEM",
        id,
        text: `Starting swarm: ${preset.name}\nAgents: ${preset.agents.join(" → ")}\nTask: ${task}`,
      });
      ctx.runSwarmPreset(presetName, task);
      return true;
    }

    case "/swarm-stop": {
      if (!ctx.stopSwarm) {
        ctx.dispatch({ type: "APPEND_SYSTEM", id, text: "No swarm is currently running." });
        return true;
      }
      ctx.stopSwarm();
      ctx.dispatch({ type: "APPEND_SYSTEM", id, text: "Swarm stop requested." });
      return true;
    }

    case "/swarm-traces": {
      if (ctx.listSwarmTraces) {
        ctx.listSwarmTraces();
      } else {
        const traces = listSwarmTraces();
        const text = traces.length === 0
          ? "No swarm traces found. Traces are written to ~/.chorus/swarm-traces/ after each swarm run."
          : `Swarm traces (${traces.length}):\n\n${traces.map((id) => `  ${id}`).join("\n")}\n\nUse /swarm-report <swarmId> to view a report.`;
        ctx.dispatch({ type: "APPEND_SYSTEM", id, text });
      }
      return true;
    }

    case "/swarm-report": {
      const swarmId = argRaw?.trim() ?? "";
      if (!swarmId) {
        const traces = listSwarmTraces();
        const hint = traces.length > 0 ? `\n\nAvailable traces:\n${traces.map((t) => `  ${t}`).join("\n")}` : "";
        ctx.dispatch({ type: "APPEND_SYSTEM", id, text: `Usage: /swarm-report <swarmId>${hint}` });
        return true;
      }
      if (ctx.showSwarmReport) {
        ctx.showSwarmReport(swarmId);
      } else {
        const report = buildSwarmReport(swarmId);
        if (!report) {
          ctx.dispatch({ type: "APPEND_SYSTEM", id, text: `No trace found for swarm: ${swarmId}` });
        } else {
          ctx.dispatch({ type: "APPEND_SYSTEM", id, text: formatSwarmReport(report) });
        }
      }
      return true;
    }

    case "/mcp": {
      const trust = getProjectMcpTrust();
      void getMcpStatus()
        .then((statuses) => {
          if (statuses.length === 0) {
            const trustNote = trust.exists && !trust.trusted
              ? `Project .mcp.json is present but not trusted:\n${trust.filePath}\nRun /mcp-trust after reviewing it.\n\n`
              : "";
            ctx.dispatch({
              type: "APPEND_SYSTEM",
              id,
              text: `${trustNote}No MCP servers configured.\n\nCreate .mcp.json in this workspace or add mcp.servers to ~/.chorus/settings.json.\n\nExample:\n${formatMcpConfigExample()}`,
            });
            return;
          }
          const rows = statuses.map((s) => {
            const state = s.connected ? "connected" : "error";
            const detail = s.connected
              ? `${s.toolCount} tools, ${s.resourceCount} resources`
              : s.error ?? "failed";
            return `  ${s.name.padEnd(18)} ${state.padEnd(10)} ${s.source.padEnd(7)} ${detail}`;
          });
          const trustNote = trust.exists && !trust.trusted
            ? `Project .mcp.json is present but not trusted: ${trust.filePath}\nRun /mcp-trust after reviewing it.\n\n`
            : "";
          ctx.dispatch({ type: "APPEND_SYSTEM", id, text: `${trustNote}MCP servers:\n${rows.join("\n")}` });
        })
        .catch((error) => {
          ctx.dispatch({ type: "APPEND_SYSTEM", id, text: `MCP status failed: ${error instanceof Error ? error.message : String(error)}` });
        });
      return true;
    }

    case "/mcp-trust": {
      const trust = trustProjectMcpConfig();
      ctx.dispatch({
        type: "APPEND_SYSTEM",
        id,
        text: trust.exists
          ? `Trusted project MCP config: ${trust.filePath}`
          : "No .mcp.json found in this workspace.",
      });
      return true;
    }

    case "/mcp-add": {
      ctx.showMcpAddWizard?.();
      return true;
    }

    case "/mcp-reload": {
      void reloadMcpConnections()
        .then((statuses) => {
          const connected = statuses.filter((s) => s.connected).length;
          ctx.dispatch({ type: "APPEND_SYSTEM", id, text: `MCP reload complete: ${connected}/${statuses.length} servers connected.` });
        })
        .catch((error) => {
          ctx.dispatch({ type: "APPEND_SYSTEM", id, text: `MCP reload failed: ${error instanceof Error ? error.message : String(error)}` });
        });
      return true;
    }

    // ─── /add ─────────────────────────────────────────────────────────────────
    case "/add": {
      const filePath = input.trim().slice(4).trim();
      if (!filePath) {
        if (ctx.showFilePicker) {
          ctx.showFilePicker((fp, content) => {
            const ext = path.extname(fp).slice(1) || "text";
            ctx.dispatch({
              type: "APPEND_SYSTEM",
              id: `add-${Date.now()}`,
              text: `[File added to context: ${fp}]\n\`\`\`${ext}\n${content}\n\`\`\``,
            });
          });
        } else {
          ctx.dispatch({ type: "APPEND_SYSTEM", id, text: "Usage: /add <file-path>\nExample: /add src/index.ts\nOr type @filename to inline a file." });
        }
        return true;
      }
      const absPath = path.isAbsolute(filePath) ? filePath : path.join(process.cwd(), filePath);
      if (!fs.existsSync(absPath)) {
        ctx.dispatch({ type: "APPEND_SYSTEM", id, text: `File not found: ${filePath}` });
        return true;
      }
      if (fs.statSync(absPath).isDirectory()) {
        ctx.dispatch({ type: "APPEND_SYSTEM", id, text: `${filePath} is a directory. Specify a file path.` });
        return true;
      }
      try {
        const content = fs.readFileSync(absPath, "utf-8");
        const ext = path.extname(filePath).slice(1) || "text";
        const sizeKb = (fs.statSync(absPath).size / 1024).toFixed(1);
        ctx.dispatch({
          type: "APPEND_SYSTEM",
          id,
          text: `[File added to context: ${filePath} (${sizeKb} KB)]\n\`\`\`${ext}\n${content}\n\`\`\``,
        });
      } catch {
        ctx.dispatch({ type: "APPEND_SYSTEM", id, text: `Could not read file: ${filePath}` });
      }
      return true;
    }

    // ─── /drop ────────────────────────────────────────────────────────────────
    case "/drop": {
      if (ctx.showFilePicker) {
        ctx.dispatch({ type: "APPEND_SYSTEM", id, text: "Note: /drop removes a file from a future context injection but cannot remove already-sent messages. Start a /session-new to fully reset context." });
      } else {
        ctx.dispatch({ type: "APPEND_SYSTEM", id, text: "To drop all context, use /clear or /session-new.\nFile-level drops require a session restart — context injection is immutable once sent." });
      }
      return true;
    }

    // ─── /diff ────────────────────────────────────────────────────────────────
    case "/diff": {
      const staged = runGit(["diff", "--staged", "--stat"]);
      const unstaged = runGit(["diff", "--stat"]);
      const detail = runGit(["diff", "HEAD"]);
      const hasSomething = (staged && !staged.startsWith("Git error")) || (unstaged && !unstaged.startsWith("Git error"));
      if (!hasSomething) {
        ctx.dispatch({ type: "APPEND_SYSTEM", id, text: "No changes to show. Working tree is clean." });
        return true;
      }
      const sections: string[] = ["── Git Diff ─────────────────────────────────────────────"];
      if (staged && !staged.startsWith("Git error")) sections.push(`Staged:\n${staged}`);
      if (unstaged && !unstaged.startsWith("Git error")) sections.push(`Unstaged:\n${unstaged}`);
      const detailLines = detail.split("\n");
      const preview = detailLines.length > 80 ? detailLines.slice(0, 80).join("\n") + `\n... (${detailLines.length - 80} more lines — full diff too long to display)` : detail;
      if (preview) sections.push(`\nFull diff:\n\`\`\`diff\n${preview}\n\`\`\``);
      ctx.dispatch({ type: "APPEND_SYSTEM", id, text: sections.join("\n\n") });
      return true;
    }

    // ─── /undo ────────────────────────────────────────────────────────────────
    case "/undo": {
      const status = runGit(["status", "--short"]);
      if (!status || status.startsWith("Git error")) {
        ctx.dispatch({ type: "APPEND_SYSTEM", id, text: "No changes to undo, or not in a git repository." });
        return true;
      }

      const doUndo = () => {
        const result = runGit(["stash", "push", "-m", `chorus-undo-${Date.now()}`]);
        const stashList = runGit(["stash", "list"]);
        ctx.dispatch({
          type: "APPEND_SYSTEM",
          id: `undo-${Date.now()}`,
          text: `Changes stashed successfully.\n${result}\n\nTo restore: git stash pop\nStash list:\n${stashList}`,
        });
      };

      if (ctx.showConfirmDialog) {
        ctx.showConfirmDialog(
          `Stash (undo) all current changes?\n\nChanged files:\n${status}\n\nYour changes will be saved in git stash and can be restored with: git stash pop`,
          doUndo,
        );
      } else {
        doUndo();
      }
      return true;
    }

    // ─── /test ────────────────────────────────────────────────────────────────
    case "/test": {
      const runner = detectTestRunner();
      if (!runner) {
        ctx.dispatch({ type: "APPEND_SYSTEM", id, text: "No test runner detected. Add a 'test' script to package.json, or a Makefile/Cargo.toml/go.mod." });
        return true;
      }
      const label = `${runner.cmd} ${runner.args.join(" ")}`;
      ctx.dispatch({ type: "APPEND_SYSTEM", id, text: `Running tests: ${label}` });
      if (ctx.runShellStream) {
        ctx.runShellStream(runner.cmd, runner.args, "Tests");
      } else {
        const { output, ok } = runCommand(runner.cmd, runner.args);
        ctx.dispatch({ type: "APPEND_SYSTEM", id: `test-${ts}`, text: `Test results (${ok ? "PASSED" : "FAILED"}):\n\`\`\`\n${output}\n\`\`\`` });
      }
      return true;
    }

    // ─── /lint ────────────────────────────────────────────────────────────────
    case "/lint": {
      const linter = detectLinter();
      if (!linter) {
        ctx.dispatch({ type: "APPEND_SYSTEM", id, text: "No linter detected. Add .eslintrc.json, biome.json, tsconfig.json, or .flake8 to this workspace." });
        return true;
      }
      const label = `${linter.cmd} ${linter.args.join(" ")}`;
      ctx.dispatch({ type: "APPEND_SYSTEM", id, text: `Running linter: ${label}` });
      if (ctx.runShellStream) {
        ctx.runShellStream(linter.cmd, linter.args, "Lint");
      } else {
        const { output, ok } = runCommand(linter.cmd, linter.args);
        ctx.dispatch({ type: "APPEND_SYSTEM", id: `lint-${ts}`, text: `Lint results (${ok ? "CLEAN" : "ISSUES FOUND"}):\n\`\`\`\n${output}\n\`\`\`` });
      }
      return true;
    }

    // ─── /commit ─────────────────────────────────────────────────────────────
    case "/commit": {
      const explicitMessage = input.trim().slice(7).trim();
      const status = runGit(["status", "--short"]);
      if (!status || status.startsWith("Git error") || !status.trim()) {
        ctx.dispatch({ type: "APPEND_SYSTEM", id, text: "Nothing to commit — working tree is clean." });
        return true;
      }

      const message = explicitMessage || inferCommitMessage();
      const doCommit = () => {
        runGit(["add", "-A"]);
        const result = runGit(["commit", "-m", message]);
        ctx.dispatch({
          type: "APPEND_SYSTEM",
          id: `commit-${Date.now()}`,
          text: result.startsWith("Git error") ? `Commit failed:\n${result}` : `Committed:\n${result}`,
        });
      };

      const stat = runGit(["status", "--short"]);
      if (ctx.showConfirmDialog) {
        ctx.showConfirmDialog(
          `Commit all changes?\n\nFiles:\n${stat}\n\nMessage: "${message}"`,
          doCommit,
        );
      } else {
        doCommit();
      }
      return true;
    }

    // ─── /cost ────────────────────────────────────────────────────────────────
    case "/cost": {
      const sessionCost = ctx.getSessionCost?.();
      const model = ctx.getModel();
      const tokens = ctx.getTokens();

      if (sessionCost) {
        const lines = [
          "── Session Cost ─────────────────────────────────────────────",
          `  Model:        ${model}`,
          `  Input tokens: ${sessionCost.inputTokens.toLocaleString()}`,
          `  Output tokens:${sessionCost.outputTokens.toLocaleString()}`,
          `  Session cost: ${formatCost(sessionCost.costUsd)}`,
          `  Context now:  ${tokens.toLocaleString()} tokens`,
        ];
        ctx.dispatch({ type: "APPEND_SYSTEM", id, text: lines.join("\n") });
      } else {
        // Fallback: estimate from context tokens + model pricing
        const [providerPart, ...modelParts] = model.split(":");
        const modelName = modelParts.join(":") || providerPart;
        const fullKey = model.includes(":") ? `${providerPart}/${modelName}` : model;
        const estimatedCost = estimateCost(fullKey, tokens, Math.floor(tokens * 0.3));
        ctx.dispatch({
          type: "APPEND_SYSTEM",
          id,
          text: [
            "── Session Cost (estimated) ─────────────────────────────────",
            `  Model:        ${model}`,
            `  Context size: ${tokens.toLocaleString()} tokens`,
            `  Est. cost:    ${formatCost(estimatedCost)}  (based on context size)`,
            "",
            "Tip: exact cost tracking requires a provider with token reporting.",
          ].join("\n"),
        });
      }
      return true;
    }

    // ─── /status ─────────────────────────────────────────────────────────────
    case "/status": {
      const mode = ctx.getExecutionMode?.() ?? "build";
      const policy = ctx.getApprovalPolicy?.() ?? "auto_edit";
      const model = ctx.getModel();
      const tokens = ctx.getTokens();
      const curr = sessionManager.getCurrent();
      const gitBranch = runGit(["rev-parse", "--abbrev-ref", "HEAD"]);
      const gitStatus = runGit(["status", "--short"]);
      const buildCfg = getModeModelConfig("build");
      const planCfg = getModeModelConfig("plan");
      const sessionCost = ctx.getSessionCost?.();

      const lines = [
        "── Chorus Status ────────────────────────────────────────────",
        `  Mode:         ${mode}`,
        `  Approval:     ${describeApprovalPolicy(policy)}`,
        `  Model:        ${model}`,
        `  Context:      ${tokens.toLocaleString()} tokens`,
        sessionCost ? `  Session cost: ${formatCost(sessionCost.costUsd)}` : null,
        buildCfg ? `  Build model:  ${buildCfg.provider}:${buildCfg.model}` : null,
        planCfg ? `  Plan model:   ${planCfg.provider}:${planCfg.model}` : null,
        "",
        `  Session:      ${curr ? (curr.name || "(unnamed)") + "  (" + curr.id.slice(0, 8) + ")" : "none"}`,
        `  Workspace:    ${process.cwd()}`,
        !gitBranch.startsWith("Git error") ? `  Git branch:   ${gitBranch}` : null,
        gitStatus && !gitStatus.startsWith("Git error") ? `  Changed:      ${gitStatus.split("\n").length} file(s)` : null,
      ].filter(Boolean);

      ctx.dispatch({ type: "APPEND_SYSTEM", id, text: lines.join("\n") });
      return true;
    }

    // ─── /doctor ─────────────────────────────────────────────────────────────
    case "/doctor": {
      const report = runDoctorCheck();
      ctx.dispatch({ type: "APPEND_SYSTEM", id, text: report });
      return true;
    }

    // ─── /run ─────────────────────────────────────────────────────────────────
    case "/run": {
      const cmdStr = input.trim().slice(4).trim();
      if (!cmdStr) {
        ctx.dispatch({ type: "APPEND_SYSTEM", id, text: "Usage: /run <command>\nExample: /run npm run build\nOutput is injected into the conversation context." });
        return true;
      }

      const parts = cmdStr.split(/\s+/);
      const [base, ...args] = parts;

      ctx.dispatch({ type: "APPEND_SYSTEM", id, text: `Running: ${cmdStr}` });
      if (ctx.runShellStream) {
        ctx.runShellStream(base, args, cmdStr);
      } else {
        const { output, ok } = runCommand(base, args);
        ctx.dispatch({ type: "APPEND_SYSTEM", id: `run-${ts}`, text: `Output (${ok ? "exit 0" : "exit non-zero"}):\n\`\`\`\n${output}\n\`\`\`` });
      }
      return true;
    }

    // ─── /map ─────────────────────────────────────────────────────────────────
    case "/map": {
      const cwd = process.cwd();
      const tree = buildProjectMap(cwd, 0, 3);
      const lineCount = tree.split("\n").length;
      ctx.dispatch({
        type: "APPEND_SYSTEM",
        id,
        text: `── Workspace Map: ${cwd} ─────────────────────────────────\n${tree}\n\n${lineCount} entries  (node_modules, .git, dist excluded)`,
      });
      return true;
    }

    // ─── /init ────────────────────────────────────────────────────────────────
    case "/init": {
      const targetPath = path.join(process.cwd(), "CHORUS.md");
      if (fs.existsSync(targetPath)) {
        ctx.dispatch({ type: "APPEND_SYSTEM", id, text: `CHORUS.md already exists at ${targetPath}\nEdit it directly or delete it and run /init again.` });
        return true;
      }
      const content = scanProjectForInit();
      try {
        fs.writeFileSync(targetPath, content, "utf-8");
        ctx.dispatch({
          type: "APPEND_SYSTEM",
          id,
          text: `Created CHORUS.md at ${targetPath}\n\nThis file gives the agent persistent project context. Edit it to add:\n  • Architecture decisions\n  • Coding conventions\n  • Key file locations\n  • Deployment instructions\n\nThe agent reads CHORUS.md at the start of every session.`,
        });
      } catch (err) {
        ctx.dispatch({ type: "APPEND_SYSTEM", id, text: `Failed to create CHORUS.md: ${String(err)}` });
      }
      return true;
    }

    // ─── /explain ─────────────────────────────────────────────────────────────
    case "/explain": {
      const target = input.trim().slice(8).trim();
      const prompt = target
        ? `Please explain this code or concept: ${target}`
        : "Please give me a high-level explanation of this codebase — its purpose, architecture, and main entry points.";
      if (ctx.sendAgentMessage) {
        ctx.sendAgentMessage(prompt);
      } else {
        ctx.dispatch({ type: "APPEND_SYSTEM", id, text: `Ask the agent: "${prompt}"` });
      }
      return true;
    }

    // ─── /fix ─────────────────────────────────────────────────────────────────
    case "/fix": {
      const issue = input.trim().slice(4).trim();
      const prompt = issue
        ? `Please fix this issue: ${issue}`
        : "Please look at any recent errors, failing tests, or TypeScript issues in this workspace and fix them.";
      if (ctx.sendAgentMessage) {
        ctx.sendAgentMessage(prompt);
      } else {
        ctx.dispatch({ type: "APPEND_SYSTEM", id, text: `Ask the agent: "${prompt}"` });
      }
      return true;
    }

    // ─── /doc ─────────────────────────────────────────────────────────────────
    case "/doc": {
      const target = input.trim().slice(4).trim();
      const prompt = target
        ? `Please generate comprehensive documentation for: ${target}`
        : "Please generate documentation (JSDoc comments, docstrings, or a README section) for the most important functions and modules in this codebase.";
      if (ctx.sendAgentMessage) {
        ctx.sendAgentMessage(prompt);
      } else {
        ctx.dispatch({ type: "APPEND_SYSTEM", id, text: `Ask the agent: "${prompt}"` });
      }
      return true;
    }

    case "/exit":
      ctx.exit();
      return true;

    default:
      ctx.dispatch({ type: "APPEND_SYSTEM", id, text: `Unknown command: ${cmd}. Type /help for available commands.` });
      return true;
  }
}
