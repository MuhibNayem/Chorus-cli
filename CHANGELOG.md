# [0.4.0](https://github.com/MuhibNayem/Chorus-cli/compare/v0.3.0...v0.4.0) (2026-05-20)


### Features

* add headless daemon mode (`chorus --daemon`) exposing the agent via Google A2A JSON-RPC 2.0 over HTTP with SSE streaming on a configurable port
* add `ChannelServer` SSE broadcast endpoint (`/events`, `/health`) that mirrors all live agent events to connected clients
* add Telegram bot gateway (`chorus --telegram`) with multi-turn conversation history, streaming message edits, per-chat session isolation, and `/new`, `/stop`, `/status` commands
* add `--telegram` flag to daemon mode to start A2A server and Telegram bot together
* store Telegram bot token and allowed user IDs through the existing API keys wizard (`/config`) — masked input, env-var shadowing, saved to `~/.chorus/settings.json`
* add `history` and `abortSignal` support to headless agent runner enabling multi-turn conversations and graceful task cancellation
* add proactive Telegram push notifications — scheduled tasks with `metadata.telegramChatId` automatically receive ✅ completion and ❌ failure messages
* add inbound webhook routes (`POST /webhooks/:route`) with HMAC-SHA256 signature validation, `{{payload.field}}` dot-notation template rendering, and automatic task queuing via the scheduler
* add event hook system — shell subprocesses fired on lifecycle events (`agent:start`, `agent:end`, `task:queued`, `task:started`, `task:complete`, `task:failed`) with JSON payload piped on stdin and configurable timeouts
* configure webhook routes in `~/.chorus/webhooks.json` and event hooks in `~/.chorus/hooks.json`


# [0.3.0](https://github.com/MuhibNayem/Chorus-cli/compare/v0.2.0...v0.3.0) (2026-05-18)

### Features

* add interactive MCP server removal with support for scope-specific and all-server deletion ([9e44cf6](https://github.com/MuhibNayem/Chorus-cli/commit/9e44cf639ec98a2d07407ae69e657f59f78e7895))
* add OpenCode provider support, optimize CLI feed rendering, and enhance SelectBox with search and pagination ([a1f7070](https://github.com/MuhibNayem/Chorus-cli/commit/a1f7070b8b96431e09c8dcbeb73ded378dc64ed9))
* replace manual publish pipeline with semantic-release auto-release ([5570321](https://github.com/MuhibNayem/Chorus-cli/commit/55703214bb65159f340b0568db9a2df8b0e0959c))
* switch to @semantic-release/npm with native OIDC trusted publishing ([4e69a26](https://github.com/MuhibNayem/Chorus-cli/commit/4e69a260b09e6ad114ef86687e1497396a57e0a5))
