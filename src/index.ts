import "dotenv/config";
import { createElement } from "react";
import { render } from "ink";
import { App } from "./cli/index.js";
import { SessionPicker } from "./session/picker.js";
import { sessionManager } from "./session/manager.js";
import type { SessionMetadata } from "./session/types.js";

async function main() {
  const sessions = sessionManager.listForWorkspace();

  if (sessions.length > 0) {
    const selected = await new Promise<SessionMetadata | null>((resolve) => {
      const { unmount } = render(
        createElement(SessionPicker, {
          sessions,
          onSelect: (s) => {
            unmount();
            resolve(s);
          },
        }),
      );
    });

    if (selected) {
      sessionManager.resumeSession(selected.id);
    } else {
      sessionManager.createSession();
    }
  } else {
    sessionManager.createSession();
  }

  process.on("exit", () => sessionManager.flushSync());

  render(createElement(App));
}

main();
