# Chorus — The Developer's AI Agent Harness

The most flexible, sophisticated AI coding agent in the terminal. Full multi-agent orchestration, adaptive skill learning, MCP with OAuth, side-channel conversations, message queuing, and AI-assisted agent creation — all in a React-powered terminal UI.

## Quick Start

```bash
npm install && npm run dev
```

Chorus auto-detects provider keys from environment (`OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `DEEPSEEK_API_KEY`). Falls back to local Ollama if no cloud keys.

Production: `npm run build && npm start`

## Why Chorus

| | Chorus | Claude Code | Cursor | Qwen Code |
|---|---|---|---|---|
| **Esc interrupt** | ✅ AbortController, non-destructive | Broken (#36326, #49309) | Reverts work | Ctrl+C broken (#2775) |
| **Message queue** | ✅ Auto-process after turn | Queues but flushes wrong (#49373) | None | Requested (#4021) |
| **`/btw` side channel** | ✅ Full history fork, dedicated panel | Single-turn, no tools | None | None |
| **Operator input during run** | ✅ Queue + /btw + Esc stop | Blocked/broken | Blocked | Blocked |
| **Terminal TUI** | ✅ Ink/React | ✅ | GUI only | ✅ |
| **Multi-provider** | ✅ OpenAI, Anthropic, DeepSeek, Ollama, vLLM | Anthropic only | Multi-model | Qwen-optimized |
| **Multi-agent swarms** | ✅ 4 presets + DAG graphs | SDK subagents | None | Subagents |
| **Adaptive skill runtime** | ✅ Auto-synthesized patterns | Skills | Skills | Skills |
| **MCP** | ✅ Full OAuth, encrypted storage, dashboard | ✅ | ✅ | ✅ |
| **AI agent creator** | ✅ Natural language → agent | None | None | None |
| **Open source** | ✅ MIT | Proprietary | Proprietary | Apache 2.0 |

---

## Agent Interaction

### Core Loop

Chorus runs a turn-based tool-calling agent with streaming responses, reasoning display, and interactive tool cards. The agent sees filesystem, git, shell, web search, and MCP tools.

### Esc Interrupt

Press `Esc` during agent processing to **immediately abort** the current turn. The agent loop checks for abort signals between rounds and stops gracefully. Completed work (file edits, tool results) is preserved — only the in-progress round is cancelled. Beats Claude Code (Esc broken in 2026) and Cursor (reverts all changes).

### Message Queue

Send messages while the agent is working — they're **queued** and processed automatically when the current turn completes. No more staring at a blocked input box:

```
Agent is working...
> redeploy to staging         ← queued (yellow indicator appears)
> also update the readme      ← queued (2 pending)

[Agent finishes current task]
Processing queued message (1 remaining)...
[Agent processes "redeploy to staging"]
Processing queued message (0 remaining)...
[Agent processes "also update the readme"]
```

A yellow indicator shows `◈ 2 messages queued — will process after current task` above the status bar. Press `Esc` to cancel both the current task and clear the queue.

### `/btw` — Side-Channel Questions

Ask quick questions while the agent works — answers appear in a **dedicated side panel** without polluting the main conversation:

```
◈ Side Channel  2 msgs  · Esc dismiss
  /btw which port does the dev server use?
  Port 3000. Configured in vite.config.ts under server.port.

  /btw should I use React.memo here?  
  Yes, for component-level memoization. Use useMemo for computed values.
```

- **Full conversation context** — the LLM sees your entire session history
- **Multiple turns** — unlimited `/btw` messages stack in the panel
- **Collapsible** — `Space` to expand responses, `Enter` to collapse, `Esc` to dismiss
- **No context pollution** — btw responses are NOT written back to the main conversation

### Expand/Collapse Tool Cards & Thinking

- `Tab` — cycle focus through expandable items (thinking blocks, tool cards)
- `Space` — toggle expand/collapse on the focused item
- `▶ ` prefix indicates which item is focused (cyan)
- Completed turns keep their expand/collapse state

---

## Slash Commands

```
/help           Command reference
/model          Switch model/provider interactively
/build          BUILD mode (full tools)
/plan           PLAN mode (read-only)
/agents         Agent dashboard (create, edit, invoke)
/mcp            MCP server dashboard (manage connections)
/mcp-add        Add MCP server (interactive wizard)
/mcp-auth       Start OAuth browser flow for MCP server
/mcp-trust      Trust workspace .mcp.json
/mcp-reload     Reconnect MCP servers
/swarm          Run multi-agent swarm
/swarm-stop     Stop running swarm
/swarm-traces   List swarm trace files
/swarm-report   Show swarm observability report
/session        Session management
/config         Configure API keys
/advisor        Toggle advisor mode
/add            Add file to context
/btw            Ask a side question (side-channel, non-interrupting)
/exit           Exit the CLI
```

---

## Agent System

### AI-Assisted Agent Creator

Use `/agents` → `g` to describe an agent in natural language — Chorus generates the full definition:

```
"g → A security auditor that reviews code for OWASP Top 10,
       provides severity ratings, and suggests specific fixes"
```

The LLM generates name, description, and a structured system prompt. Review and accept, edit manually (`e`), or regenerate (`r`).

### Manual Agent Editor

Full 7-field editor: name, description, system prompt, model override, tool whitelist (checkbox), permission mode (full_auto/auto_edit/suggest), max rounds.

### Agent Dashboard (`/agents`)

```
◈ Agents  2 defined                    n:new  g:generate  ↑↓:nav  enter:detail
▶ security-auditor   default      user    Security auditor for OWASP Top 10
  code-reviewer      gpt-4o       user    Expert code reviewer for PRs
```

Keyboard: `n` new, `g` AI generate, `↑↓` navigate, `Enter` detail, `e` edit, `v` view, `d` delete.

### Invocation

Prefix messages with `@agent-name`:

```
@security-auditor review the auth module for vulnerabilities
```

Agents appear in `@` autocomplete alongside file mentions.

---

## MCP — Model Context Protocol

The most comprehensive MCP integration in any CLI coding agent.

### Authentication

| Method | Use Case |
|---|---|
| **Bearer token** | API key from env var |
| **Client credentials** | OAuth2 machine-to-machine |
| **Authorization code** | OAuth2 browser login (PKCE) |
| **AWS SigV4** | AWS API Gateway endpoints |

OAuth tokens are **AES-256-GCM encrypted** at `~/.chorus/mcp-auth.json`.

### Interactive UI

- **`/mcp`** — dashboard: server list, live status, auth state, tool counts. `↑↓` navigate, `Enter` detail, `a` OAuth flow, `e` toggle, `d` delete
- **`/mcp-add`** — 14-step guided wizard: transport, command, args, env vars, headers, auth type, timeout
- **`/mcp-auth <name>`** — opens browser for OAuth login
- **Health checks** — 30s ping with auto-reconnect, 3-strike circuit breaker

### CLI

```bash
chorus mcp list              # status + auth state
chorus mcp add <name> ...    # add server
chorus mcp auth <name>       # OAuth browser flow
chorus mcp trust             # trust .mcp.json
```

---

## Configuration

```json
{
  "llm": {
    "provider": "deepseek",
    "providers": {
      "deepseek": { "apiKey": "${DEEPSEEK_API_KEY}", "model": "deepseek-v4-flash" },
      "openai": { "apiKey": "${OPENAI_API_KEY}", "model": "gpt-4o" },
      "anthropic": { "apiKey": "${ANTHROPIC_API_KEY}", "model": "claude-sonnet-4-20250514" },
      "ollama": { "baseUrl": "http://localhost:11434/v1", "model": "qwen3-coder:latest" }
    },
    "modes": {
      "build": { "provider": "deepseek", "model": "deepseek-v4-flash" },
      "plan": { "provider": "deepseek", "model": "deepseek-v4-flash" }
    }
  },
  "mcp": {
    "servers": {
      "MiniMax": {
        "type": "stdio",
        "command": "uvx",
        "args": ["minimax-coding-plan-mcp", "-y"],
        "env": { "MINIMAX_API_KEY": "${MINIMAX_API_KEY}", "MINIMAX_API_HOST": "https://api.minimax.io" }
      }
    }
  }
}
```

---

## Security

- **Workspace confinement** — all tools restricted to project root
- **Secret detection** — blocks `.env`, `.pem`, `.key`, credentials
- **Encrypted MCP tokens** — AES-256-GCM
- **MCP trust system** — content-hash verified project configs
- **Permission modes** — suggest / auto_edit / full_auto

## Requirements

- Node.js >= 20
- Optional: Ollama for local-only operation

## License

MIT
