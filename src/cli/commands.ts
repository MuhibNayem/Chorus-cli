import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import type { Dispatch } from "react";
import type { FeedAction, FeedEntry } from "./state/feedReducer.js";
import { sessionManager } from "../session/manager.js";
import { listCheckpoints } from "../harness/checkpointReplay.js";
import { clearPersistedApprovals, loadPersistedApprovals } from "../settings/storage.js";
import { readApprovalLog } from "../harness/approvalLog.js";
import { formatCost } from "../llm/pricing.js";

export interface CommandContext {
  dispatch: Dispatch<FeedAction>;
  clearHistory: () => void;
  getTokens: () => number;
  getModel: () => string;
  getCost: () => { totalCost: number; totalInputTokens: number; totalOutputTokens: number };
  getFeedEntries: () => FeedEntry[];
  exit: () => void;
  onResumeSession: (id: string) => void;
  onNewSession: () => void;
}

export interface SlashCommand {
  name: string;
  description: string;
}

export const SLASH_COMMANDS: SlashCommand[] = [
  { name: "/help",        description: "Show available commands" },
  { name: "/clear",       description: "Clear the conversation feed" },
  { name: "/compact",     description: "Compact conversation history" },
  { name: "/cwd",         description: "Show workspace directory" },
  { name: "/model",       description: "Show current model" },
  { name: "/tokens",      description: "Show context token count" },
  { name: "/sessions",    description: "List sessions for this workspace" },
  { name: "/session",     description: "Rename: /session rename <name>" },
  { name: "/resume",      description: "Resume a past session: /resume <id-or-name>" },
  { name: "/session-new", description: "Start a fresh session" },
  { name: "/exit",        description: "Exit the CLI" },
  { name: "/replay",      description: "List worker checkpoints: /replay [thread-id]" },
  { name: "/approval",   description: "Approval commands: /approval log | /approval clear-saved" },
  { name: "/cost",       description: "Show session token usage and estimated cost" },
  { name: "/export",     description: "Export conversation to Markdown" },
];

const HELP_TEXT = SLASH_COMMANDS.map(
  (c) => `  ${c.name.padEnd(12)} ${c.description}`
).join("\n");

const FULL_HELP = `Available slash commands:\n${HELP_TEXT}\n\nType @<filename> to inject file contents into your message.`;

function feedEntriesToMarkdown(entries: FeedEntry[]): string {
  const lines: string[] = [`# Conversation Export\n\nExported: ${new Date().toLocaleString()}\n`];
  for (const entry of entries) {
    if (entry.kind === "user") {
      lines.push(`## User\n\n${entry.text}\n`);
    } else if (entry.kind === "turn") {
      lines.push(`## Agent\n`);
      if (entry.thinking.text) {
        lines.push(`<details><summary>Thinking</summary>\n\n${entry.thinking.text}\n\n</details>\n`);
      }
      for (const tc of entry.toolCalls) {
        lines.push(`### Tool: \`${tc.name}\`\n\n**Args:** \`${JSON.stringify(tc.args)}\`\n\n**Result:** ${tc.result ?? "(running)"}\n`);
      }
      const text = entry.tokens.join("");
      if (text) lines.push(`${text}\n`);
    } else if (entry.kind === "system") {
      lines.push(`> **System:** ${entry.text}\n`);
    } else if (entry.kind === "error") {
      lines.push(`> **Error:** ${entry.message}\n`);
    }
  }
  return lines.join("\n");
}

export function handleSlashCommand(
  input: string,
  ctx: CommandContext
): boolean {
  if (!input.startsWith("/")) return false;

  const [cmdRaw] = input.trim().split(/\s+/);
  const cmd = cmdRaw.toLowerCase();

  const ts  = Date.now();
  const id  = `sys-${ts}`;

  // Echo the command as a user message so the chat flow is visible
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
      // Signal to useAgentStream to compact on the next turn
      ctx.dispatch({
        type: "APPEND_SYSTEM",
        id,
        text: "Context will be compacted on the next message.",
      });
      return true;

    case "/cwd":
      ctx.dispatch({ type: "APPEND_SYSTEM", id, text: `Workspace: ${process.cwd()}` });
      return true;

    case "/model":
      ctx.dispatch({
        type: "APPEND_SYSTEM",
        id,
        text: `Model: ${ctx.getModel()}`,
      });
      return true;

    case "/tokens":
      ctx.dispatch({
        type: "APPEND_SYSTEM",
        id,
        text: `Context tokens: ${ctx.getTokens().toLocaleString()}`,
      });
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
        const name = (s.name || "(unnamed)").slice(0, 28).padEnd(28);
        const msgs = `${s.messageCount} msg${s.messageCount !== 1 ? "s" : ""}`.padStart(7);
        const ago  = timeAgo(s.updatedAt).padStart(10);
        const idHint = s.id.slice(0, 8);
        return `  ${String(i + 1).padStart(2)}.  ${name}  ${msgs}  ${ago}  ${idHint}`;
      });
      ctx.dispatch({ type: "APPEND_SYSTEM", id, text: `Sessions:\n${rows.join("\n")}` });
      return true;
    }

    case "/session": {
      const parts = input.trim().split(/\s+/);
      const sub   = parts[1]?.toLowerCase();
      if (sub === "rename" && parts[2]) {
        const newName = parts.slice(2).join(" ");
        sessionManager.renameSession(newName);
        ctx.dispatch({ type: "APPEND_SYSTEM", id, text: `Session renamed to: ${newName}` });
      } else {
        const curr = sessionManager.getCurrent();
        const info = curr
          ? `Current session: ${curr.name || "(unnamed)"}  ·  id: ${curr.id.slice(0, 8)}  ·  ${curr.messageCount} messages`
          : "No active session.";
        ctx.dispatch({ type: "APPEND_SYSTEM", id, text: info });
      }
      return true;
    }

    case "/resume": {
      const query = input.trim().split(/\s+/).slice(1).join(" ").toLowerCase();
      if (!query) {
        ctx.dispatch({ type: "APPEND_SYSTEM", id, text: "Usage: /resume <id-prefix-or-name>" });
        return true;
      }
      const sessions = sessionManager.listForWorkspace();
      const matched  = sessions.find(
        (s) => s.id.startsWith(query) || s.name.toLowerCase().includes(query)
      );
      if (!matched) {
        ctx.dispatch({ type: "APPEND_SYSTEM", id, text: `No session matching: ${query}` });
        return true;
      }
      ctx.onResumeSession(matched.id);
      return true;
    }

    case "/session-new": {
      ctx.onNewSession();
      ctx.dispatch({ type: "APPEND_SYSTEM", id, text: "Started a new session." });
      return true;
    }

    case "/export": {
      const sessionId = sessionManager.getCurrent()?.id ?? "unknown";
      const exportDir = path.join(os.homedir(), ".chorus", "exports");
      fs.mkdirSync(exportDir, { recursive: true });
      const exportPath = path.join(exportDir, `${sessionId}.md`);
      const markdown = feedEntriesToMarkdown(ctx.getFeedEntries());
      try {
        fs.writeFileSync(exportPath, markdown, "utf-8");
        ctx.dispatch({ type: "APPEND_SYSTEM", id, text: `Exported to: ${exportPath}` });
      } catch (err) {
        ctx.dispatch({ type: "APPEND_SYSTEM", id, text: `Export failed: ${err instanceof Error ? err.message : String(err)}` });
      }
      return true;
    }

    case "/cost": {
      const { totalCost, totalInputTokens, totalOutputTokens } = ctx.getCost();
      const model = ctx.getModel();
      const budget = process.env.CHORUS_BUDGET_USD ? parseFloat(process.env.CHORUS_BUDGET_USD) : null;
      const lines = [
        `Model:          ${model}`,
        `Input tokens:   ${totalInputTokens.toLocaleString()}`,
        `Output tokens:  ${totalOutputTokens.toLocaleString()}`,
        `Estimated cost: ${formatCost(totalCost)}`,
      ];
      if (budget !== null) {
        const pct = budget > 0 ? Math.round((totalCost / budget) * 100) : 0;
        lines.push(`Budget:         ${formatCost(budget)} (${pct}% used)`);
      }
      ctx.dispatch({ type: "APPEND_SYSTEM", id, text: lines.join("\n") });
      return true;
    }

    case "/approval": {
      const parts = input.trim().split(/\s+/);
      const sub = parts[1]?.toLowerCase();
      if (sub === "clear-saved") {
        clearPersistedApprovals();
        ctx.dispatch({ type: "APPEND_SYSTEM", id, text: "Cleared all persisted tool approvals." });
      } else if (sub === "log") {
        const entries = readApprovalLog(20);
        if (entries.length === 0) {
          ctx.dispatch({ type: "APPEND_SYSTEM", id, text: "No approval log entries found." });
        } else {
          const rows = entries.map((e) => {
            const ts = new Date(e.timestamp).toLocaleString();
            return `  ${e.decision.padEnd(14)} ${e.tool.padEnd(20)} ${ts}`;
          });
          ctx.dispatch({ type: "APPEND_SYSTEM", id, text: `Recent approvals:\n${rows.join("\n")}` });
        }
      } else {
        const active = loadPersistedApprovals();
        const lines = active.length === 0
          ? ["No persisted tool approvals."]
          : active.map((a) => `  ${a.name.padEnd(24)} expires ${new Date(a.expiresAt).toLocaleDateString()}`);
        ctx.dispatch({ type: "APPEND_SYSTEM", id, text: `Persisted approvals:\n${lines.join("\n")}` });
      }
      return true;
    }

    case "/exit":
      ctx.exit();
      return true;

    case "/replay": {
      const parts = input.trim().split(/\s+/);
      const threadId = parts[1] ?? sessionManager.getCurrent()?.id;
      if (!threadId) {
        ctx.dispatch({ type: "APPEND_SYSTEM", id, text: "No active session to replay. Usage: /replay <thread-id>" });
        return true;
      }
      listCheckpoints(threadId).then((checkpoints) => {
        if (checkpoints.length === 0) {
          ctx.dispatch({ type: "APPEND_SYSTEM", id: `${id}-r`, text: `No checkpoints found for thread: ${threadId.slice(0, 8)}` });
        } else {
          const rows = checkpoints.map((cp, i) => {
            const ts = cp.ts ? new Date(cp.ts).toLocaleString() : "unknown";
            return `  ${String(i + 1).padStart(2)}. ${cp.checkpointId.slice(0, 16)}  step:${cp.step}  ${ts}`;
          });
          ctx.dispatch({ type: "APPEND_SYSTEM", id: `${id}-r`, text: `Checkpoints for ${threadId.slice(0, 8)}:\n${rows.join("\n")}` });
        }
      }).catch((err) => {
        ctx.dispatch({ type: "APPEND_SYSTEM", id: `${id}-r`, text: `Replay error: ${err.message}` });
      });
      return true;
    }

    default: {
      ctx.dispatch({
        type: "APPEND_SYSTEM",
        id,
        text: `Unknown command: ${cmd}. Type /help for available commands.`,
      });
      return true;
    }
  }
}
