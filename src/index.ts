#!/usr/bin/env node
import "dotenv/config";
import { createElement } from "react";
import { render } from "ink";
import { readFileSync } from "node:fs";
import { App } from "./cli/index.js";
import { hasRequiredLlmSettings } from "./settings/storage.js";
import { ConfigWizard } from "./settings/configWizard.js";
import { sessionManager } from "./session/manager.js";

const HELP_TEXT = `chorus-agent-cli

Usage:
  chorus
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

  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    console.error("Chorus requires an interactive TTY. Run `chorus --help` for usage.");
    process.exitCode = 1;
    return;
  }

  if (!hasRequiredLlmSettings()) {
    await new Promise<void>((resolve) => {
      const { unmount } = render(
        createElement(ConfigWizard, {
          onDone: () => { unmount(); resolve(); },
        }),
      );
    });
  }

  sessionManager.createSession();

  process.on("exit", () => sessionManager.flushSync());

  render(createElement(App));
}

main();
