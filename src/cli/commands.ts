import type { Dispatch } from "react";
import type { FeedAction } from "./state/feedReducer.js";
import { sessionManager } from "../session/manager.js";
import type { ApprovalPolicy, ExecutionMode } from "../harness/types.js";
import { describeApprovalPolicy } from "./hooks/agent/toolPolicy.js";

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
  getExecutionMode?: () => ExecutionMode;
  setExecutionMode?: (mode: ExecutionMode) => void;
  getApprovalPolicy?: () => ApprovalPolicy;
  setApprovalPolicy?: (policy: ApprovalPolicy) => void;
}

export interface SlashCommand {
  name: string;
  description: string;
}

export const SLASH_COMMANDS: SlashCommand[] = [
  { name: "/help",          description: "Show available commands" },
  { name: "/clear",         description: "Clear the conversation feed" },
  { name: "/compact",       description: "Compact conversation history" },
  { name: "/cwd",           description: "Show workspace directory" },
  { name: "/agents",        description: "List agents or create a new one (interactive)" },
  { name: "/plan",          description: "Switch to Plan Mode (read-only planning)" },
  { name: "/build",         description: "Switch to Build Mode (edit, test, review)" },
  { name: "/mode",          description: "Show current execution mode" },
  { name: "/approval",      description: "Set approval policy: suggest, auto-edit, full-auto" },
  { name: "/model",         description: "Switch model for this session (interactive)" },
  { name: "/provider",      description: "Switch provider for this session (interactive)" },
  { name: "/default-model", description: "Set permanent default model (interactive)" },
  { name: "/new-provider",  description: "Configure a new provider (interactive wizard)" },
  { name: "/tokens",        description: "Show context token count" },
  { name: "/sessions",      description: "List sessions for this workspace" },
  { name: "/session",       description: "Show current session info" },
  { name: "/resume",        description: "Resume a past session (interactive)" },
  { name: "/session-new",   description: "Start a fresh session" },
  { name: "/exit",          description: "Exit the CLI" },
];

const HELP_TEXT = SLASH_COMMANDS.map(
  (c) => `  ${c.name.padEnd(14)} ${c.description}`
).join("\n");

const FULL_HELP = `Available slash commands:\n${HELP_TEXT}\n\nType @<filename> to inject file contents into your message.`;

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

    case "/mode":
      ctx.dispatch({
        type: "APPEND_SYSTEM",
        id,
        text: `Execution mode: ${ctx.getExecutionMode?.() ?? "build"}\nApproval policy: ${describeApprovalPolicy(ctx.getApprovalPolicy?.() ?? "auto_edit")}`,
      });
      return true;

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

    case "/exit":
      ctx.exit();
      return true;

    default:
      ctx.dispatch({ type: "APPEND_SYSTEM", id, text: `Unknown command: ${cmd}. Type /help for available commands.` });
      return true;
  }
}
