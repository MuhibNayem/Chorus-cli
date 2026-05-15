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

const HELP_TEXT = `Chorus

Usage:
  chorus
  chorus mcp list
  chorus mcp trust
  chorus mcp add <name> --type stdio --command <cmd> [--arg value]
  chorus mcp add-json <name> '<json>'
  chorus --help
  chorus --version

Launches the interactive Chorus agent CLI in the current workspace.
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
