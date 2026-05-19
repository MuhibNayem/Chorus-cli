#!/usr/bin/env node
import "dotenv/config";
import { createElement } from "react";
import { render } from "ink";
import { readFileSync } from "node:fs";
import { App } from "./cli/index.js";
import { hasRequiredLlmSettings } from "./settings/storage.js";
import { ConfigWizard } from "./settings/configWizard.js";
import { sessionManager } from "./session/manager.js";
import { runMcpCliCommand } from "./mcp/manage.js";
import { A2AServer } from "./a2a/server.js";
import { ChannelServer } from "./channels/server.js";
import { globalBroadcaster } from "./channels/broadcaster.js";
import { runHeadlessAgent } from "./a2a/headless-runner.js";
import { createTelegramGateway } from "./gateway/telegram.js";
import { getA2ABearerToken } from "./settings/storage.js";
import { loadHooks, disposeHooks } from "./gateway/hooks.js";
import { loadWebhookConfig } from "./gateway/webhooks.js";
import { Scheduler } from "./scheduler/index.js";

const HELP_TEXT = `Chorus

Usage:
  chorus
  chorus --daemon [--port 3210] [--channel-port 3211] [--telegram]
  chorus --telegram
  chorus mcp list
  chorus mcp trust
  chorus mcp add <name> --type stdio --command <cmd> [--arg value] [--env KEY=VALUE]
  chorus mcp add <name> --type http --url <url> [--header KEY=VALUE] [--bearer-token-env VAR]
  chorus mcp remove <name> [--scope user|project|both] [--all]
  chorus mcp add-json <name> '<json>'
  chorus --help
  chorus --version

Launches the interactive Chorus agent CLI in the current workspace.

Daemon mode (--daemon):
  Starts a headless HTTP server exposing the agent via the Google A2A protocol.
  --port         A2A JSON-RPC endpoint port (default: 3210)
  --channel-port SSE event stream port        (default: 3211)
  --telegram     Also start the Telegram bot gateway (requires TELEGRAM_BOT_TOKEN)

  Endpoints:
    GET  http://127.0.0.1:<port>/tasks            list all persisted tasks (?state=queued|working|…)
    POST http://127.0.0.1:<port>/tasks            tasks/send, tasks/get, tasks/cancel
    POST http://127.0.0.1:<port>/tasks/stream     tasks/sendSubscribe (SSE)
    POST http://127.0.0.1:<port>/tasks/schedule   one-shot or cron-recurring task
    POST http://127.0.0.1:<port>/tasks/goal       goal-driven autonomous task
    GET  http://127.0.0.1:<port>/.well-known/agent.json
    GET  http://127.0.0.1:<channel-port>/events   SSE event feed
    GET  http://127.0.0.1:<channel-port>/health   liveness probe

Telegram mode (--telegram):
  Starts only the Telegram bot gateway (no A2A/SSE servers).
  Requires TELEGRAM_BOT_TOKEN env var. Set TELEGRAM_ALLOWED_USER_IDS to a
  comma-separated list of numeric Telegram user IDs to restrict access.

  Bot commands:
    /start  — welcome message
    /new    — reset conversation history
    /stop   — abort the running task
    /status — show session stats
`;

function getPackageVersion(): string {
  try {
    const packageJson = JSON.parse(
      readFileSync(new URL("../package.json", import.meta.url), "utf-8")
    ) as { version?: string };
    return packageJson.version ?? "unknown";
  } catch {
    return "unknown";
  }
}

function createSynchronizedStdout(stdout: NodeJS.WriteStream): NodeJS.WriteStream {
  // DECSET 2026: synchronized output — tells supported terminals to treat
  // the wrapped write as an atomic frame update, eliminating flicker from
  // intermediate cursor positions during redraws.
  const SYNC_START = "\x1b[?2026h";
  const SYNC_END = "\x1b[?2026l";

  return new Proxy(stdout, {
    get(target, prop) {
      if (prop === "write") {
        return (
          chunk: string | Uint8Array,
          encoding?: BufferEncoding | ((err?: Error | null) => void),
          cb?: (err?: Error | null) => void,
        ) => {
          const callback = typeof encoding === "function" ? encoding : cb;
          const enc = typeof encoding === "string" ? encoding : undefined;
          const wrapped = SYNC_START + chunk + SYNC_END;
          return target.write(wrapped, enc as BufferEncoding, callback);
        };
      }
      // eslint-disable-next-line @typescript-eslint/no-unsafe-return
      return (target as any)[prop];
    },
  }) as NodeJS.WriteStream;
}

function parseIntArg(args: string[], flag: string, defaultValue: number): number {
  const idx = args.indexOf(flag);
  if (idx === -1 || !args[idx + 1]) return defaultValue;
  const parsed = parseInt(args[idx + 1], 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : defaultValue;
}

async function runDaemon(args: string[]): Promise<void> {
  if (!hasRequiredLlmSettings()) {
    console.error(
      "Chorus daemon: LLM not configured. Run `chorus` interactively to complete setup first.",
    );
    process.exitCode = 1;
    return;
  }

  loadHooks();
  loadWebhookConfig();

  const port = parseIntArg(args, "--port", 3210);
  const channelPort = parseIntArg(args, "--channel-port", 3211);
  const withTelegram = args.includes("--telegram");
  const version = getPackageVersion();

  const scheduler = new Scheduler("chorus-agent");

  const a2aBearerToken = getA2ABearerToken();
  const a2aServer = new A2AServer({
    port,
    bearerToken: a2aBearerToken,
    scheduler,
    card: {
      id: "chorus-agent",
      name: "Chorus Agent",
      description: "Chorus AI coding agent — autonomous loops, multi-agent swarms, MCP",
      version,
      capabilities: { streaming: true, pushNotifications: true, stateTransition: true },
      inputModes: ["text/plain"],
      outputModes: ["text/plain"],
      authentication: a2aBearerToken ? { type: "bearer" } : { type: "none" },
    },
    handleTask: (input, taskId) => runHeadlessAgent({ input, threadId: taskId }),
  });

  const channelServer = new ChannelServer({
    port: channelPort,
    broadcaster: globalBroadcaster,
  });

  await a2aServer.start();
  await channelServer.start();
  scheduler.start();

  console.log(`Chorus ${version} daemon started`);
  console.log(`  A2A tasks:    ${a2aServer.baseUrl}/tasks`);
  console.log(`  A2A stream:   ${a2aServer.baseUrl}/tasks/stream`);
  console.log(`  Agent card:   ${a2aServer.baseUrl}/.well-known/agent.json`);
  console.log(`  SSE events:   ${channelServer.baseUrl}/events`);
  console.log(`  Webhooks:     ${a2aServer.baseUrl}/webhooks/<route>`);
  console.log(`  Health:       ${channelServer.baseUrl}/health`);

  let telegram: Awaited<ReturnType<typeof createTelegramGateway>> | null = null;
  if (withTelegram) {
    try {
      telegram = createTelegramGateway();
      await telegram.launch();
      console.log(`  Telegram bot: running (long-polling)`);
    } catch (err) {
      console.error(`  Telegram bot: failed — ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  if (telegram) {
    scheduler.setNotifier((task, output, err) => {
      const chatId = task.metadata?.telegramChatId as number | undefined;
      if (chatId === undefined) return;
      if (err) {
        void telegram.sendNotification(chatId, `❌ Task *${task.id.slice(0, 8)}* failed:\n${err.slice(0, 200)}`);
      } else {
        const preview = output.slice(0, 300);
        void telegram.sendNotification(chatId, `✅ Task *${task.id.slice(0, 8)}* complete.\n${preview}${output.length > 300 ? "..." : ""}`);
      }
    });
  }

  const shutdown = async () => {
    console.log("\nChorus daemon shutting down...");
    scheduler.stop();
    await Promise.all([
      a2aServer.stop(),
      channelServer.stop(),
      telegram?.stop(),
    ]);
    disposeHooks();
    globalBroadcaster.dispose();
    process.exit(0);
  };

  process.on("SIGTERM", () => { void shutdown(); });
  process.on("SIGINT",  () => { void shutdown(); });
}

async function runTelegramOnly(): Promise<void> {
  if (!hasRequiredLlmSettings()) {
    console.error(
      "Chorus: LLM not configured. Run `chorus` interactively to complete setup first.",
    );
    process.exitCode = 1;
    return;
  }

  const telegram = createTelegramGateway(); // throws if TELEGRAM_BOT_TOKEN missing
  const version = getPackageVersion();

  console.log(`Chorus ${version} — Telegram gateway starting...`);
  await telegram.launch();
  console.log(`Telegram bot running (long-polling). Send a message to start.`);

  const shutdown = async () => {
    console.log("\nShutting down Telegram gateway...");
    await telegram.stop();
    process.exit(0);
  };

  process.on("SIGTERM", () => { void shutdown(); });
  process.on("SIGINT",  () => { void shutdown(); });
}

async function main() {
  const args = process.argv.slice(2);

  if (args.includes("--help") || args.includes("-h")) {
    console.log(HELP_TEXT.trimEnd());
    return;
  }

  if (args.includes("--version") || args.includes("-v")) {
    console.log(getPackageVersion());
    return;
  }

  // Daemon mode: headless A2A server, no TTY required.
  if (args.includes("--daemon")) {
    await runDaemon(args);
    return;
  }

  // Telegram-only mode: no A2A/SSE servers, just the bot.
  if (args.includes("--telegram")) {
    await runTelegramOnly();
    return;
  }

  if (args[0] === "mcp") {
    try {
      process.exitCode = await runMcpCliCommand(args.slice(1));
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    }
    return;
  }

  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    console.error("Chorus requires an interactive TTY. Run `chorus --help` for usage.");
    process.exitCode = 1;
    return;
  }

  const syncStdout = createSynchronizedStdout(process.stdout);

  if (!hasRequiredLlmSettings()) {
    await new Promise<void>((resolve) => {
      const { unmount } = render(
        createElement(ConfigWizard, {
          onDone: () => { unmount(); resolve(); },
        }),
        { stdout: syncStdout },
      );
    });
  }

  process.stdout.write("\x1b[2J\x1b[H");

  sessionManager.createSession();

  process.on("exit", () => sessionManager.flushSync());

  render(createElement(App), { stdout: syncStdout });
}

main();
