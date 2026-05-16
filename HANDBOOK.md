# Chorus — User Handbook

The comprehensive guide to every feature, command, and configuration option.

---

## Agent Interaction

### Core Loop

Chorus runs a turn-based tool-calling agent with streaming responses, reasoning display, and interactive tool cards. The agent sees filesystem, git, shell, web search, and MCP tools.

### Esc Interrupt

Press `Esc` during agent processing to immediately abort the current turn. Completed work (file edits, tool results) is preserved — only the in-progress round is cancelled.

### Message Queue

Send messages while the agent is working — they're queued and auto-processed when the turn completes. A yellow indicator shows `◈ 2 messages queued` above the status bar. `Esc` during processing clears both the current task and the queue.

### `/btw` — Side-Channel Questions

Ask quick questions without polluting the main conversation. Answers appear in a dedicated yellow-bordered panel:

```
◈ Side Channel  · Esc dismiss
  /btw which port does the dev server use?
  Port 3000. Configured in vite.config.ts.
```

- Full conversation context sent to LLM
- Multiple `/btw` messages stack
- `Space` to expand, `Esc` to dismiss
- Responses are NOT written back to the main conversation

### Expand/Collapse Thinking & Tool Cards

- `Tab` — cycle focus through expandable items
- `Space` — toggle expand/collapse on focused item
- `▶ ` prefix indicates focused item (cyan)

---

## `/goal` — Autonomous Goal-Driven Loops

Set a completion condition and the agent auto-continues until met.

### Usage

```
/goal all tests pass and npm test exits 0
/goal migrate all legacy API calls to new API, npm typecheck exits 0, or stop after 20 turns
/goal                    ← check current goal status
/goal clear              ← stop goal mode (also: stop, off, cancel)
```

### How It Works

1. After each turn, a small model evaluates whether the goal is met
2. If not met → agent auto-submits next turn with guidance
3. If met → goal auto-clears with success message
4. Turn limit from condition (`stop after N turns`) or default 50

### Status Bar

```
deepseek:deepseek-v4-flash  BUILD/auto-edit  ●  Idle  ◎ goal: 3t 45s  CTX 12%  ...
```

### Good Goal Examples

```
/goal all auth tests pass and npm run lint exits 0
/goal CHANGELOG.md has entries for every PR merged this week
/goal split src/megafile.ts into modules under src/parts/ where each is <300 lines
/goal close all GitHub issues labeled "needs-triage"
```

---

## Advisor & Pre-Flight Workers

When enabled, workers (advisor, planner, coder, reviewer, tester) run as parallel LLM calls before the main agent loop. The advisor uses its own provider/model if configured.

### Configuration

```json
{
  "llm": {
    "advisor": {
      "enabled": true,
      "provider": "openai",
      "model": "gpt-4o",
      "autoOnComplexTasks": true
    }
  }
}
```

- `enabled`: manual toggle via `/advisor on/off`
- `autoOnComplexTasks`: auto-activates for complex tasks (multi-file, refactors)
- Worker results appear as expandable thinking blocks in the feed

### Commands

```
/advisor on         ← enable advisor + workers
/advisor off        ← disable
/advisor status     ← show current config
```

---

## Slash Commands

| Command | Description |
|---|---|
| `/help` | Command reference |
| `/model` | Switch model/provider |
| `/build`, `/plan` | Toggle execution mode |
| `/approval <policy>` | Set `suggest` / `auto_edit` / `full_auto` |
| `/agents` | Agent management dashboard |
| `/btw <question>` | Side-channel question |
| `/goal <condition>` | Autonomous goal-driven loop |
| `/goal clear` | Stop goal mode |
| `/advisor on/off/status` | Toggle advisors |
| `/mcp` | MCP server dashboard |
| `/mcp-add` | Add MCP server (wizard) |
| `/mcp-auth <name>` | OAuth browser flow |
| `/mcp-trust` | Trust workspace `.mcp.json` |
| `/mcp-reload` | Reconnect MCP servers |
| `/swarm <preset> [task]` | Multi-agent swarm |
| `/swarm-stop` | Stop swarm |
| `/session` | Session management |
| `/resume` | Resume session |
| `/clear` | Clear history |
| `/compact` | Compact context |
| `/config` | Configure API keys |
| `/add <file>` | Add file to context |
| `/exit` | Save and exit |

---

## Agent System

### AI-Assisted Creation

`/agents` → `g` → describe what you want. The LLM generates name, description, and structured system prompt.

### Manual Editor

Full form: name, description, system prompt, model override, tool whitelist, permission mode, max rounds.

### Dashboard

`↑↓` navigate, `Enter` detail, `n` new, `g` AI generate, `e` edit, `v` view, `d` delete.

### Invocation

```
@security-auditor review src/auth for vulnerabilities
```

Agents appear in `@` autocomplete.

---

## MCP

### Authentication Methods

| Method | Config |
|---|---|
| Bearer token | `auth: { type: "bearer", tokenEnv: "VAR" }` |
| Client credentials | `auth: { type: "client_credentials", clientIdEnv: "VAR", clientSecretEnv: "VAR" }` |
| Authorization code | `auth: { type: "authorization_code", clientIdEnv: "VAR" }` → browser login |
| Headers | `headers: { "Key": "value" }` |
| envFile | `envFile: ".env.mcp"` for stdio servers |

### Encrypted Storage

AES-256-GCM at `~/.chorus/mcp-auth.json`. Key at `~/.chorus/.mcp-key` (0600).

### Trust System

Project `.mcp.json` is content-hash verified. `/mcp-trust` after review. Auto-revoked on changes.

---

## Configuration

**Main config**: `~/.chorus/settings.json`

```json
{
  "llm": {
    "provider": "deepseek",
    "providers": {
      "deepseek": { "apiKey": "${DEEPSEEK_API_KEY}", "model": "deepseek-v4-flash" },
      "openai": { "apiKey": "${OPENAI_API_KEY}", "model": "gpt-4o" },
      "ollama": { "baseUrl": "http://localhost:11434/v1", "model": "qwen3-coder:latest" }
    },
    "modes": {
      "build": { "provider": "deepseek", "model": "deepseek-v4-flash" }
    },
    "advisor": { "enabled": false, "autoOnComplexTasks": true }
  }
}
```

---

## Security

- Workspace confinement (all tools restricted to project root)
- Secret detection (`.env`, `.pem`, `.key`, credentials)
- MCP encrypted credentials (AES-256-GCM)
- Approval gates (per-tool, per-mode)
- Shell allowlist (only approved commands)

## Requirements
- Node.js >= 20
- Optional: Ollama for local-only

## License
MIT
