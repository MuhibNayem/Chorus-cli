<div align="center">

![Node.js](https://img.shields.io/badge/Node.js-20%2B-brightgreen?style=flat-square)
[![npm](https://img.shields.io/npm/v/chorus-agent-cli.svg?style=flat-square)](https://www.npmjs.com/package/chorus-agent-cli)
[![License](https://img.shields.io/github/license/anomalyco/chorus-cli.svg?style=flat-square)](./LICENSE)
[![Tests](https://img.shields.io/badge/tests-392%20passed-brightgreen?style=flat-square)]()

**The most powerful open-source AI coding agent for the terminal.**

Goal-driven autonomous loops · Side-channel conversations · Message queuing · Pre-flight advisor workers · Multi-agent swarms · MCP with OAuth · Full-diff file render · AI-assisted agent creator · Daemon API · Inbound webhooks · Event hooks · Telegram · Proactive push

</div>

---

## What is Chorus

Chorus is an agentic coding tool that lives in your terminal. It understands your codebase, runs commands, edits files, searches the web, and orchestrates multi-agent teams — all through natural language. MIT-licensed, provider-agnostic, optimized for real development workflows.

Unlike other tools, Chorus stays out of your way:

- **Never blocks you.** Send messages while it works — they queue. `/btw` for side questions. `Esc` to stop.
- **`/goal` autonomous loops.** Set a condition. Agent auto-continues until met.
- **Pre-flight advisor workers.** Parallel LLM analysis before execution. Configurable per-provider.
- **Full-diff file rendering.** Green/red line diffs, line numbers, no truncation.
- **Encrypted credentials.** AES-256-GCM for MCP tokens.
- **Daemon autonomy.** Inbound webhooks, event hooks, proactive Telegram push — the daemon reacts to the world and pushes results back.

## Quick Start

```bash
npm install -g chorus-agent-cli
cd your-project/
chorus
```

Auto-detects keys from environment. Falls back to Ollama if no cloud keys.

## Why Chorus

### 1. Goal-Driven Loops (`/goal`)

```
/goal all tests pass and npm test exits 0
→ ◎ /goal set — agent will auto-continue

[Turn 1] → ◎ /goal — turn 1: 3 of 8 tests pass
[Turn 2] → ◎ /goal — turn 2: 7 of 8 tests pass
[Turn 3] → ✓ Goal met after 3 turns!
```

After each turn, an evaluator checks progress. Not met → auto-continues with guidance. Safety: `or stop after N turns`.

### 2. Operator Control

| Action | Key | Behavior |
|---|---|---|
| **Stop agent** | `Esc` | Instant abort, work preserved |
| **Queue next task** | Type + `Enter` | Auto-processed after turn |
| **Side question** | `/btw <q>` | Dedicated panel, full context |

### 3. Pre-Flight Advisor Workers

`/advisor` opens an interactive config overlay. Choose ON/OFF/AUTO, pick provider from list, type model name. Workers (advisor, planner, reviewer, tester) run as parallel LLM calls before the main agent. Results appear as expandable thinking blocks.

```
⚙ Advisor Configuration
▸ Mode:  ● ON  — Advisor + workers on every non-trivial task
  Provider:  ▸ openai
  Model:     gpt-4o
```

### 4. Full-Diff File Rendering

File operations show actual content, not summaries:

```
✓ file_edit  src/auth.ts
  ✎ src/auth.ts
   -42 chars   +38 chars  (-4)
  ┌────────────────────────────┐
  │ - const token = getToken();
  │ - if (!token) throw err;
  │ ──────────────────────────
  │ + const token = extractBearerToken(req);
  │ + if (!token) return 401;
  └────────────────────────────┘
```

- `-` red = removed, `+` green = added, no truncation
- Writes show full content with line numbers
- Reads show first 8 lines + count

### 5. AI Agent Creator

`/agents` → `g` → describe in plain English. LLM generates complete definition. Review, edit, regenerate. Invoke with `@agent-name`.

### 6. MCP with OAuth

AES-256-GCM encrypted tokens. OAuth browser flow. Interactive dashboard. 14-step wizard. Health checks with auto-reconnect.

### 7. Daemon Mode — Google A2A API Server

Run Chorus as a persistent background service that exposes the full agent over HTTP. Implements the [Google A2A protocol](https://github.com/google-a2a/A2A) — any A2A-compatible client can send tasks, receive streaming responses, and poll status.

```bash
chorus --daemon                        # A2A on :3210, SSE on :3211
chorus --daemon --port 8080 --channel-port 8081
chorus --daemon --telegram             # all three at once
```

```
  A2A tasks:   http://127.0.0.1:3210/tasks
  A2A stream:  http://127.0.0.1:3210/tasks/stream   (SSE)
  Agent card:  http://127.0.0.1:3210/.well-known/agent.json
  SSE events:  http://127.0.0.1:3211/events
  Webhooks:    http://127.0.0.1:3210/webhooks/<route>
  Health:      http://127.0.0.1:3211/health
```

Send a task and stream the response:

```bash
curl -X POST http://127.0.0.1:3210/tasks/stream \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0", "id": 1, "method": "tasks/sendSubscribe",
    "params": {
      "message": { "role": "user", "content": [{ "type": "text", "text": "What is in this repo?" }] }
    }
  }'
```

**Survive reboots with launchd (macOS):**

```xml
<!-- ~/Library/LaunchAgents/com.chorus.agent.plist -->
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>com.chorus.agent</string>
  <key>ProgramArguments</key>
  <array>
    <string>/usr/local/bin/chorus</string>
    <string>--daemon</string>
    <string>--telegram</string>
  </array>
  <key>WorkingDirectory</key><string>/your/project</string>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>/tmp/chorus.log</string>
  <key>StandardErrorPath</key><string>/tmp/chorus.err</string>
</dict>
</plist>
```

```bash
launchctl load ~/Library/LaunchAgents/com.chorus.agent.plist   # start
launchctl unload ~/Library/LaunchAgents/com.chorus.agent.plist # stop
```

### 8. Telegram Gateway

Talk to your agent on Telegram. Each chat keeps its full conversation history across turns. Responses stream back as live message edits.

**Proactive push notifications:** Scheduled tasks with `metadata.telegramChatId` automatically receive ✅ completion and ❌ failure messages. You set a cron task from your phone, go to sleep, and wake up to a Telegram message with the result.

**Setup (2 minutes):**

1. Message `@BotFather` on Telegram → `/newbot` → copy the token
2. Configure in Chorus:

```
chorus → /config → API Keys
  ▶ Telegram bot token      [unset]
    Telegram allowed IDs    [unset]
```

Enter the token (displayed as `••••`). Optionally add your numeric Telegram user ID to restrict access — get it from `@userinfobot`.

3. Run:

```bash
chorus --telegram                      # bot only
chorus --daemon --telegram             # bot + A2A API + SSE
```

**Bot commands:**

| Command | Action |
|---|---|
| `/start` | Welcome message |
| `/new` | Reset conversation history |
| `/stop` | Abort the running task |
| `/status` | Show session turn count |

```
You:    fix the failing tests in src/auth.test.ts
Chorus: ⏳
        → Running test suite...
        → Found 3 failures in auth.test.ts:42, 67, 89
        → Patching token validation logic
        → All 14 tests pass ✓
```

The agent has access to all the same tools as the TUI — file read/write, shell, git, web search, MCP servers.

### 9. Inbound Webhooks

External services (GitHub, Datadog, CI/CD) POST events to the daemon and the agent responds automatically. Configure routes in `~/.chorus/webhooks.json`:

```json
{
  "routes": {
    "github-push": {
      "hmacSecret": "your-webhook-secret",
      "template": "GitHub push to {{payload.repository.full_name}}: {{payload.head_commit.message}}. Analyze the changes and run any relevant tests.",
      "description": "Triggered on git push events"
    }
  }
}
```

HMAC-SHA256 signatures are validated with constant-time comparison. The `{{payload.field}}` template renders the webhook body into a prompt, and the task is queued via the scheduler:

```bash
curl -X POST http://127.0.0.1:3210/webhooks/github-push \
  -H "Content-Type: application/json" \
  -H "X-Hub-Signature-256: sha256=..." \
  -d '{"repository": {...}, "head_commit": {...}}'
# → 201 { "taskId": "...", "status": "queued" }
```

### 10. Event Hooks

Shell subprocesses fire on lifecycle events. Configure in `~/.chorus/hooks.json`:

```json
{
  "hooks": [
    {
      "name": "notify-on-complete",
      "events": ["task:complete", "task:failed"],
      "command": "python3 ~/hooks/notify.py",
      "timeout": 30
    }
  ]
}
```

Supported events: `agent:start`, `agent:end`, `task:queued`, `task:started`, `task:complete`, `task:failed`. Each subprocess receives a JSON payload on stdin with the event data. Hooks are non-blocking — errors are logged but never crash the daemon.

---

## Slash Commands

| Command | Description |
|---|---|
| `/help` | Command reference |
| `/model` | Switch model/provider |
| `/build`, `/plan` | Toggle execution mode |
| `/approval` | Set policy |
| `/agents` | Agent dashboard |
| `/btw <q>` | Side-channel question |
| `/goal <condition>` | Autonomous goal loop |
| `/goal clear` | Stop goal mode |
| `/advisor` | Interactive advisor config |
| `/advisor on/off` | Quick toggle |
| `/mcp` | MCP server dashboard |
| `/mcp-add` | Add MCP server (wizard) |
| `/mcp-auth <name>` | OAuth browser flow |
| `/swarm <preset>` | Multi-agent swarm |
| `/session` | Session management |
| `/config` | API keys |
| `/exit` | Save and exit |

---

## Configuration

Settings live in `~/.chorus/settings.json`. All keys can be set via `/config` in the TUI — they are stored masked and never logged.

```json
{
  "llm": {
    "provider": "deepseek",
    "providers": {
      "deepseek": { "apiKey": "${DEEPSEEK_API_KEY}", "model": "deepseek-v4-flash" },
      "openai": { "apiKey": "${OPENAI_API_KEY}", "model": "gpt-4o" },
      "ollama": { "baseUrl": "http://localhost:11434/v1", "model": "qwen3-coder:latest" }
    },
    "modes": { "build": { "provider": "deepseek", "model": "deepseek-v4-flash" } },
    "advisor": { "enabled": false, "provider": "openai", "model": "gpt-4o", "autoOnComplexTasks": true }
  },
  "apiKeys": {
    "telegramBotToken": "...",
    "telegramAllowedUserIds": "123456789"
  },
  "mcp": {
    "servers": {
      "Minimax": { "type": "stdio", "command": "uvx", "args": ["minimax-coding-plan-mcp", "-y"], "env": { "MINIMAX_API_KEY": "${MINIMAX_API_KEY}" } }
    }
  }
}
```

Environment variables override stored values when both are present. Supported env vars: `TELEGRAM_BOT_TOKEN`, `TELEGRAM_ALLOWED_USER_IDS`, `SERPER_API_KEY`, `GOOGLE_CSE_API_KEY`, `WEATHER_API_KEY`.

---

## Comparison

| | Chorus | Claude Code | Cursor | Qwen Code |
|---|---|---|---|---|
| **Open source** | ✅ MIT | ❌ | ❌ | Apache 2.0 |
| **`/goal` loops** | ✅ Any provider | Haiku only | ❌ | ❌ |
| **Esc interrupt** | ✅ Non-destructive | Broken | Reverts | Broken |
| **Message queue** | ✅ Auto-process | Broken | None | None |
| **`/btw` side channel** | ✅ Full history | Single-turn | None | None |
| **Pre-flight advisors** | ✅ Interactive config | None | None | None |
| **Full-diff renders** | ✅ Red/green per-line | ✅ | IDE only | ❌ |
| **AI agent creator** | ✅ Natural language | None | None | None |
| **MCP OAuth + encrypt** | ✅ Browser + AES-256 | ✅ | ✅ | ✅ |
| **Any LLM provider** | ✅ All major | Anthropic only | Multi | Qwen |
| **Multi-agent swarms** | ✅ 4 presets + DAG | SDK only | None | Subagents |
| **Headless API server** | ✅ Google A2A / SSE | ❌ | ❌ | ❌ |
| **Inbound webhooks** | ✅ HMAC-SHA256, templates | ❌ | ❌ | ❌ |
| **Event hooks** | ✅ Shell subprocess on lifecycle | ❌ | ❌ | ❌ |
| **Telegram integration** | ✅ Streaming, multi-turn | ❌ | ❌ | ❌ |
| **Proactive push** | ✅ Task result → Telegram | ❌ | ❌ | ❌ |

## Requirements
Node.js >= 20 · Optional: Ollama

## License
MIT
