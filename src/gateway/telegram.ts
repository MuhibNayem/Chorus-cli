/**
 * Telegram gateway — gives Chorus a persistent chat interface on Telegram.
 *
 * Each Telegram chat (user or group) gets its own agent session with full
 * multi-turn conversation history. The agent streams tokens back as Telegram
 * message edits, throttled to stay within Telegram's rate limits.
 *
 * Commands:
 *   /start  — welcome message
 *   /new    — reset conversation history for this chat
 *   /stop   — abort the currently running agent task
 *   /status — show how many turns are in the current session
 */

import { Telegraf, type Context } from "telegraf";
import { runHeadlessAgent } from "../a2a/headless-runner.js";
import { getTelegramBotToken, getTelegramAllowedUserIds } from "../settings/storage.js";
import { RateLimiter } from "./rate-limiter.js";
import { sanitizeError, validateInput } from "./sanitize.js";
import type { ChatMessage } from "../llm/provider.js";

// Telegram hard limit is 4096 chars; leave room for the streaming cursor.
const MAX_MESSAGE_LEN = 4000;
// How often (ms) to flush accumulated tokens as a message edit.
// Telegram allows ~1 edit/sec per chat; 700ms keeps us comfortably under.
const EDIT_THROTTLE_MS = 700;
// Max agent turns per user per minute.
const RATE_LIMIT_RPM = 10;

interface ChatSession {
  history: ChatMessage[];
  abortController: AbortController | null;
}

function splitText(text: string): string[] {
  if (text.length <= MAX_MESSAGE_LEN) return [text];

  const chunks: string[] = [];
  let remaining = text;
  while (remaining.length > 0) {
    if (remaining.length <= MAX_MESSAGE_LEN) {
      chunks.push(remaining);
      break;
    }
    // Prefer splitting at paragraph > line > word boundary.
    let at = remaining.lastIndexOf("\n\n", MAX_MESSAGE_LEN);
    if (at < MAX_MESSAGE_LEN / 2) at = remaining.lastIndexOf("\n", MAX_MESSAGE_LEN);
    if (at < MAX_MESSAGE_LEN / 2) at = remaining.lastIndexOf(" ", MAX_MESSAGE_LEN);
    if (at < 0) at = MAX_MESSAGE_LEN;
    chunks.push(remaining.slice(0, at).trimEnd());
    remaining = remaining.slice(at).trimStart();
  }
  return chunks.filter(Boolean);
}

export interface TelegramGatewayConfig {
  token: string;
  /** Comma-separated list of numeric Telegram user IDs allowed to use the bot.
   *  Leave empty to allow anyone who messages the bot. */
  allowedUserIds?: string;
}

export class TelegramGateway {
  private bot: Telegraf;
  private sessions = new Map<number, ChatSession>();
  private allowedIds: Set<number>;
  private rateLimiter: RateLimiter;

  constructor(config: TelegramGatewayConfig) {
    this.bot = new Telegraf(config.token);
    this.allowedIds = config.allowedUserIds
      ? new Set(config.allowedUserIds.split(",").map((s) => parseInt(s.trim(), 10)).filter(isFinite))
      : new Set();
    this.rateLimiter = new RateLimiter(RATE_LIMIT_RPM, 60_000);

    this.registerHandlers();
  }

  private isAllowed(ctx: Context): boolean {
    if (this.allowedIds.size === 0) return true;
    const userId = ctx.from?.id;
    return userId !== undefined && this.allowedIds.has(userId);
  }

  private getSession(chatId: number): ChatSession {
    if (!this.sessions.has(chatId)) {
      this.sessions.set(chatId, { history: [], abortController: null });
    }
    return this.sessions.get(chatId)!;
  }

  private registerHandlers(): void {
    this.bot.command("start", async (ctx) => {
      await ctx.reply(
        "👋 *Chorus Agent* — your autonomous AI assistant.\n\n" +
          "Send me any message and I'll work on it.\n\n" +
          "Commands:\n" +
          "  /new — start a fresh conversation\n" +
          "  /stop — abort the running task\n" +
          "  /status — show conversation stats",
        { parse_mode: "Markdown" },
      );
    });

    this.bot.command("new", async (ctx) => {
      const session = this.getSession(ctx.chat.id);
      session.abortController?.abort();
      session.abortController = null;
      session.history = [];
      await ctx.reply("🆕 Conversation reset. What would you like to work on?");
    });

    this.bot.command("stop", async (ctx) => {
      const session = this.getSession(ctx.chat.id);
      if (session.abortController) {
        session.abortController.abort();
        session.abortController = null;
        await ctx.reply("⛔ Task stopped.");
      } else {
        await ctx.reply("No active task to stop.");
      }
    });

    this.bot.command("status", async (ctx) => {
      const session = this.getSession(ctx.chat.id);
      const turns = session.history.filter((m) => m.role === "user").length;
      const active = session.abortController ? " — task running" : "";
      await ctx.reply(`📊 Session: ${turns} turn(s)${active}`);
    });

    this.bot.on("text", async (ctx) => {
      if (!this.isAllowed(ctx)) {
        await ctx.reply("⛔ You are not authorized to use this bot.");
        return;
      }

      const chatId = ctx.chat.id;
      const userText = ctx.message.text;
      if (userText.startsWith("/")) return; // ignore unknown commands

      // Rate limit per user.
      const rl = this.rateLimiter.check(ctx.from?.id ?? chatId);
      if (!rl.allowed) {
        const secs = Math.ceil(rl.retryAfterMs / 1000);
        await ctx.reply(`⏱ Slow down — try again in ${secs}s.`);
        return;
      }

      // Validate input length.
      const validation = validateInput(userText);
      if (!validation.ok) {
        await ctx.reply(`⚠️ ${validation.reason}`);
        return;
      }

      const session = this.getSession(chatId);

      // Abort any in-flight task for this chat before starting a new one.
      session.abortController?.abort();
      const abort = new AbortController();
      session.abortController = abort;

      // Send the "thinking" placeholder that we'll edit as tokens arrive.
      const placeholder = await ctx.reply("⏳", {
        reply_parameters: { message_id: ctx.message.message_id },
      });

      let accumulated = "";
      let lastEditAt = 0;
      // Track extra message IDs created for overflow chunks.
      let currentMsgId = placeholder.message_id;
      let sentChunks = 1; // number of Telegram messages in use for this response

      const editCurrent = async (text: string, final: boolean) => {
        const cursor = final ? "" : " ▌";
        const parts = splitText(text);

        try {
          // Update the current tail message.
          const tailPart = parts[sentChunks - 1] ?? parts[parts.length - 1];
          await ctx.telegram.editMessageText(
            chatId,
            currentMsgId,
            undefined,
            (tailPart + cursor).trim() || "⏳",
          );

          // Send overflow messages if we've grown past 4000 chars.
          for (let i = sentChunks; i < parts.length; i++) {
            const overflow = await ctx.telegram.sendMessage(
              chatId,
              parts[i] + (final && i === parts.length - 1 ? "" : cursor),
            );
            currentMsgId = overflow.message_id;
            sentChunks++;
          }
        } catch {
          // Ignore stale edits (content unchanged, or rate-limited by Telegram).
        }

        lastEditAt = Date.now();
      };

      try {
        let updatedHistory: ChatMessage[] = [...session.history];

        for await (const token of runHeadlessAgent({
          input: validation.text,
          threadId: `tg-${chatId}`,
          history: session.history,
          abortSignal: abort.signal,
          onHistoryUpdate: (h) => { updatedHistory = h; },
        })) {
          if (abort.signal.aborted) break;
          accumulated += token;

          if (Date.now() - lastEditAt >= EDIT_THROTTLE_MS) {
            await editCurrent(accumulated, false);
          }
        }

        // Final edit: complete text, no cursor.
        if (accumulated) await editCurrent(accumulated, true);

        // Persist history for next turn (if task wasn't aborted mid-stream).
        if (!abort.signal.aborted) {
          session.history = updatedHistory;
        }
      } catch (err) {
        await ctx.telegram
          .editMessageText(chatId, currentMsgId, undefined, `❌ ${sanitizeError(err)}`)
          .catch(() => {});
      } finally {
        if (session.abortController === abort) {
          session.abortController = null;
        }
      }
    });
  }

  async sendNotification(chatId: number, text: string): Promise<void> {
    const parts = splitText(text);
    for (const part of parts) {
      await this.bot.telegram.sendMessage(chatId, part).catch(() => {});
    }
  }

  async launch(): Promise<void> {
    // Validate token immediately — throws on bad/revoked token before we commit.
    await this.bot.telegram.getMe();
    // Polling loop runs forever; don't await it or launch() never returns.
    void this.bot.launch({ dropPendingUpdates: true });
  }

  async stop(): Promise<void> {
    for (const session of this.sessions.values()) {
      session.abortController?.abort();
    }
    this.rateLimiter.dispose();
    this.bot.stop("SIGTERM");
  }
}

export function createTelegramGateway(): TelegramGateway {
  const token = getTelegramBotToken();
  if (!token) {
    throw new Error(
      "Telegram bot token is not configured. " +
        "Run `chorus` → open API Keys config, or set TELEGRAM_BOT_TOKEN in your environment.",
    );
  }
  return new TelegramGateway({
    token,
    allowedUserIds: getTelegramAllowedUserIds(),
  });
}
