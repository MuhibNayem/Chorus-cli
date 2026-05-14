#!/usr/bin/env node
import "dotenv/config";
import { createElement } from "react";
import { render } from "ink";
import { App } from "./cli/index.js";
import { hasRequiredLlmSettings } from "./settings/storage.js";
import { ConfigWizard } from "./settings/configWizard.js";
import { sessionManager } from "./session/manager.js";

async function main() {
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
