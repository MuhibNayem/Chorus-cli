import type { Dispatch } from "react";
import type { FeedAction } from "./state/feedReducer.js";
import { sessionManager } from "../session/manager.js";

export interface CommandContext {
  dispatch: Dispatch<FeedAction>;
  clearHistory: () => void;
  getTokens: () => number;
  getModel: () => string;
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
];

const HELP_TEXT = SLASH_COMMANDS.map(
  (c) => `  ${c.name.padEnd(12)} ${c.description}`
).join("\n");

const FULL_HELP = `Available slash commands:\n${HELP_TEXT}\n\nType @<filename> to inject file contents into your message.`;

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

    case "/exit":
      ctx.exit();
      return true;

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
