import "dotenv/config";
import { createElement } from "react";
import { render } from "ink";
import { App } from "./cli/index.js";
import { hasRequiredLlmSettings, loadSettings, saveSettings } from "./settings/storage.js";
import { SettingsWizard } from "./settings/wizard.js";
import { sessionManager } from "./session/manager.js";

async function main() {
  if (!hasRequiredLlmSettings()) {
    await new Promise<void>((resolve) => {
      const { unmount } = render(
        createElement(SettingsWizard, {
          initialSettings: loadSettings(),
          onSubmit: (settings) => {
            saveSettings(settings);
            unmount();
            resolve();
          },
        }),
      );
    });
  }

  sessionManager.createSession();

  process.on("exit", () => sessionManager.flushSync());

  render(createElement(App));
}

main();
