<div align="center">

![Node.js](https://img.shields.io/badge/Node.js-20%2B-brightgreen?style=flat-square)
[![npm](https://img.shields.io/npm/v/chorus-agent-cli.svg?style=flat-square)](https://www.npmjs.com/package/chorus-agent-cli)
[![License](https://img.shields.io/github/license/anomalyco/chorus-cli.svg?style=flat-square)](./LICENSE)
[![Tests](https://img.shields.io/badge/tests-392%20passed-brightgreen?style=flat-square)]()

**The most powerful open-source AI coding agent for the terminal.**

Multi-agent swarms · Adaptive skill learning · MCP with OAuth · Side-channel conversations · Message queuing · AI-assisted agent creation

</div>

---

## What is Chorus

Chorus is an agentic coding tool that lives in your terminal. It understands your codebase, runs commands, edits files, searches the web, and orchestrates multi-agent teams — all through natural language. It's MIT-licensed, provider-agnostic, and optimized for real development workflows.

Unlike other tools, Chorus stays out of your way:

- **The agent never blocks you.** Send messages while it works — they queue and process in order. Ask side questions with `/btw` without interrupting the main task. Press `Esc` to stop anything, anytime.
- **Your credentials stay encrypted.** MCP OAuth tokens use AES-256-GCM. No plaintext secrets in config files.
- **You can run it on any LLM.** OpenAI, Anthropic, DeepSeek, Ollama, vLLM — switch providers with `/model`.

## Quick Start

```bash
# Requirements: Node.js >= 20 (optional: Ollama for local-only)
npm install -g chorus-agent-cli
cd your-project/
chorus
```

Chorus auto-detects API keys from your environment. Falls back to local Ollama if no cloud keys are set.

```
OPENAI_API_KEY=sk-...         # OpenAI
ANTHROPIC_API_KEY=sk-ant-...  # Anthropic
DEEPSEEK_API_KEY=sk-...       # DeepSeek
```

On first run, configure a provider: `chorus` → `/new-provider` (interactive wizard).

## Why Chorus

### 1. Operator stays in control — always

Other tools block your input or cancel your task when you type during agent execution. Chorus gives you three ways to interact mid-task:

| Action | Key | Behavior |
|---|---|---|
| **Stop agent** | `Esc` | Immediate, non-destructive abort. Work done so far is preserved. |
| **Send next task** | Type + `Enter` | Message queues. Auto-processed after current turn. |
| **Ask side question** | `/btw <q>` | Answered in a dedicated panel without polluting the main conversation. |

No other tool offers all three. Claude Code's Esc is broken ([#49309](https://github.com/anthropics/claude-code/issues/49309)), its message queue flushes at the wrong time ([#49373](https://github.com/anthropics/claude-code/issues/49373)), and its `/btw` is single-turn with no tools. Cursor reverts all changes on interrupt. Qwen Code has no queue or side channel at all.

### 2. AI-assisted agent creation

Describe an agent in plain English — Chorus generates the complete definition using your configured LLM. Review, edit, or regenerate. Then invoke with `@agent-name`.

```
/agents → g → "A security auditor for OWASP Top 10, with severity ratings and fix suggestions"

Result:
  Name:        security-auditor
  Description: Security auditor for OWASP Top 10 vulnerability review
  System Prompt:
    ## Role
    You are a security auditor...
    ## Responsibilities
    - Review code for OWASP Top 10 vulnerabilities...
    ## Workflow
    1. Inspect the codebase...
  [y] accept  [e] edit manually  [r] regenerate
```

Full agent editor with tool whitelist, permission modes, model override, and interactive dashboard (`/agents`).

### 3. MCP done right

Chorus has the most complete MCP integration of any CLI coding tool:

- **All transport types**: stdio, Streamable HTTP, SSE (legacy)
- **All auth methods**: bearer tokens, OAuth2 client credentials, OAuth2 authorization code (browser login with PKCE)
- **Encrypted storage**: AES-256-GCM at `~/.chorus/mcp-auth.json`
- **Health monitoring**: 30-second pings with auto-reconnect and 3-strike circuit breaker
- **Interactive management**: `/mcp` dashboard, `/mcp-add` 14-step wizard, `/mcp-auth` OAuth flow
- **Trust system**: project `.mcp.json` files are content-hash verified

```bash
# Add a server from CLI
chorus mcp add MiniMax --type stdio --command uvx --arg minimax-coding-plan-mcp --arg -y \
  --env MINIMAX_API_KEY=sk-xxx --env MINIMAX_API_HOST=https://api.minimax.io

# Start OAuth browser flow
chorus mcp auth linear-server

# Or use the TUI wizard
/mcp-add
```

### 4. Multi-agent swarms

Orchestrate teams of specialized agents that collaborate on complex tasks:

```bash
/swarm plan-build-review "Implement OAuth2 login with refresh tokens"
/swarm research-parallel "Compare React Server Components vs traditional SSR"
/swarm vapt-report "Scan the authentication module for vulnerabilities"
```

Four built-in presets with DAG parallel execution, handoff-based sequential flows, shared artifact storage, worktree isolation, and cost management with circuit breakers.

### 5. Adaptive skill runtime

Chorus learns from your workflows. When you repeat similar tool patterns across sessions, the synthesizer auto-creates reusable skills. The router selects relevant skills per-turn using semantic matching. Underperforming skills are automatically annealed.

---

## Features

### Core Agent Loop
- Turn-based tool-calling with streaming responses and reasoning display
- Expandable thinking blocks and tool cards (`Tab` cycle, `Space` toggle)
- Context window tracking with visual usage bar
- Auto-compaction at 85% token threshold
- Large tool output offload (>8KB → disk)

### Tools
| Category | Tools |
|---|---|
| **Filesystem** | `file_read`, `file_write`, `file_edit`, `list_dir`, `find_files`, `search_files` |
| **Shell** | `run_command` (allowlisted: git, npm, node, python, cargo, etc.) |
| **Git** | `git_status`, `git_diff`, `git_log`, `git_branch`, `git_commit` |
| **Web** | `internet_search` (Serper), `web_search` (Google CSE), `web_fetch` |
| **MCP** | All tools from connected MCP servers (namespaced: `mcp__<server>__<tool>`) |
| **Sub-agents** | `delegate_to_subagent` (planner, builder, vapt) |

### Execution Modes & Policies
| Mode | Behavior |
|---|---|
| `BUILD / auto_edit` | Auto-approve edits, ask for shell/commit |
| `BUILD / suggest` | Ask before every tool call |
| `BUILD / full_auto` | Zero-interruption, all tools auto-approved |
| `PLAN / read-only` | Filesystem + git reads only, no mutations |

Toggle with `Shift+Tab` or `/build` `/plan`.

### Multi-Provider LLM
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
  }
}
```

Switch interactively: `/model`, `/provider`, `/default-model`.

### Workspace Intelligence
- `@` mention autocomplete for files AND custom agents
- File watching with `.gitignore` awareness
- Automatic secret detection (`.env`, `.pem`, keys, credentials)
- Workspace confinement (all tools restricted to project root)

### Sessions
- Create, switch, resume, delete sessions
- Auto-persisted to `~/.chorus/sessions/`
- Token and cost tracking per session
- Context compaction with history snapshots

---

## Slash Commands

| Command | Description |
|---|---|
| `/help` | Command reference |
| `/model` | Switch model/provider interactively |
| `/build`, `/plan` | Toggle execution mode |
| `/approval` | Set approval policy (`suggest`/`auto_edit`/`full_auto`) |
| `/agents` | Agent management dashboard |
| `/mcp` | MCP server status dashboard |
| `/mcp-add` | Add MCP server (interactive wizard) |
| `/mcp-auth <name>` | OAuth browser flow for MCP server |
| `/mcp-trust` | Trust workspace `.mcp.json` |
| `/mcp-reload` | Reconnect all MCP servers |
| `/swarm <preset> [task]` | Run multi-agent swarm |
| `/swarm-stop` | Stop running swarm |
| `/swarm-traces` | List swarm trace files |
| `/swarm-report <id>` | Show swarm observability report |
| `/btw <question>` | Ask a side question (non-interrupting) |
| `/session` | Session management |
| `/resume` | Resume a previous session |
| `/clear` | Clear conversation history |
| `/compact` | Compact context on next turn |
| `/config` | Configure API keys (Serper, Google CSE, Weather) |
| `/advisor` | Toggle advisor mode |
| `/add <file>` | Add file to context |
| `/tokens` | Show current token count |
| `/exit` | Save session and exit |

### CLI Commands

```bash
chorus mcp list|trust|untrust|add|add-json|remove|auth|unauth
chorus eval run|report
chorus --help
chorus --version
```

---

## MCP (Model Context Protocol)

### Configuration

Project-level (`<workspace>/.mcp.json`) or user-level (`~/.chorus/settings.json` under `mcp.servers`):

```json
{
  "mcpServers": {
    "Minimax": {
      "type": "stdio",
      "command": "uvx",
      "args": ["minimax-coding-plan-mcp", "-y"],
      "env": {
        "MINIMAX_API_KEY": "${MINIMAX_API_KEY}",
        "MINIMAX_API_HOST": "https://api.minimax.io"
      }
    },
    "linear": {
      "type": "http",
      "url": "https://mcp.linear.app/mcp",
      "auth": {
        "type": "authorization_code",
        "clientIdEnv": "LINEAR_CLIENT_ID",
        "authorizationUrl": "https://linear.app/oauth/authorize",
        "scope": "read write"
      }
    },
    "sentry": {
      "type": "http",
      "url": "https://mcp.sentry.dev/mcp",
      "auth": { "type": "bearer", "tokenEnv": "SENTRY_MCP_TOKEN" },
      "maxOutputTokens": 25000
    }
  }
}
```

### Supported Auth Methods

| Method | Config | UX |
|---|---|---|
| **Bearer token** | `auth: { type: "bearer", tokenEnv: "VAR" }` | Reads from env |
| **Client credentials** | `auth: { type: "client_credentials", clientIdEnv: "VAR", clientSecretEnv: "VAR" }` | Auto-refresh, encrypted |
| **Authorization code** | `auth: { type: "authorization_code", clientIdEnv: "VAR" }` | Browser login + PKCE |
| **Headers** | `headers: { "Key": "value" }` | Static headers |
| **Headers helper** | `headersHelper: "./get-headers.sh"` | Dynamic from command |
| **envFile** | `envFile: ".env.mcp"` | Load `.env` for stdio servers |

### Encrypted Storage
All OAuth tokens stored AES-256-GCM encrypted at `~/.chorus/mcp-auth.json`. Encryption key at `~/.chorus/.mcp-key` (0600 perms). Auto-migrates from legacy unencrypted stores.

### Trust System
Project `.mcp.json` files are content-hash verified. Run `/mcp-trust` after reviewing. Auto-revoked on changes. Bypass with `CHORUS_TRUST_PROJECT_MCP=1`.

---

## Agent System

### AI-Assisted Creation

```
/agents → g → "A code reviewer that checks for security issues and performance problems"
```

The LLM generates name, description, and a structured system prompt with Role, Responsibilities, Workflow, Output Format, Quality Bar, and Constraints sections. Accept (`y`), edit manually (`e`), or regenerate (`r`).

### Manual Editor

Full form with: name, description, system prompt, model override (`provider:model`), tool whitelist (checkbox selection), permission mode, max rounds.

### Dashboard (`/agents`)

Interactive list with `↑↓` navigation, `Enter` for detail panel, `n` for new manual, `g` for AI generate, `e` to edit, `v` to view, `d` to delete, `u` for usage hint.

### Invocation

Prefix messages with `@agent-name`:
```
@security-auditor review src/auth for vulnerabilities
```

Agents appear in `@` autocomplete alongside file mentions. They can also be spawned as sub-agents via `delegate_to_subagent`.

### Storage

User scope: `~/.chorus/agents/<name>.json`  
Project scope: `<workspace>/.chorus/agents/<name>.json`

---

## Multi-Agent Swarms

### Built-in Presets

| Preset | Agents | Flow | Use Case |
|---|---|---|---|
| `plan-build-review` | coordinator → planner → builder → reviewer | Sequential handoff | Full feature implementation |
| `research-synthesize` | coordinator → researcher → synthesizer | Handoff-based | Research + findings |
| `vapt-report` | coordinator → scanner → analyst → reporter | Handoff cascade | Security testing |
| `research-parallel` | researcher-a ∥ researcher-b → synthesizer | DAG parallel | Concurrent research |

### Features

- **Handoff-based** and **DAG parallel** execution models
- **Artifact system**: `set_artifact` / `get_artifact` / `list_artifacts` for cross-agent data sharing
- **Context modes**: `shared`, `isolated`, `filtered`
- **Worktree isolation**: agents can run in isolated git worktrees
- **Cost management**: per-swarm and per-agent USD budgets with model downgrade
- **Circuit breaker**: auto-stop on budget exhaustion, loop detection, or validation failure

### Launching

```bash
/swarm plan-build-review "Implement OAuth2 login"
/swarm research-parallel "Compare RSC vs traditional SSR"
/swarm vapt-report "Scan auth module"
```

---

## Adaptive Skill Runtime

Chorus learns from repeated workflows:

1. **Observes** tool call patterns during agent runs
2. **Synthesizes** patterns when ≥3 similar trajectories repeat
3. **Registers** patterns as callable tools with extracted parameters
4. **Routes** relevant skills per-turn via semantic matching
5. **Anneal**s underperforming patterns automatically

Skills are defined as Markdown (`SKILL.md`) files with optional `when:` conditions and token budgets.

```
.chorus/skills/
├── deploy/
│   └── SKILL.md      ← "Deploy to staging. Use when deploying..."
├── pr-review/
│   └── SKILL.md      ← "Review a PR for quality and security..."
```

---

## Sub-Agents

Three built-in sub-agents the main agent can spawn autonomously:

| Sub-agent | Role | Tools |
|---|---|---|
| **planner** | System architect for architectural decisions | git |
| **builder** | Senior engineer for production code | git |
| **vapt** | Offensive security researcher | web search |

The `delegate_to_subagent` tool dynamically lists available sub-agents. Custom agents are also available.

---

## Security

- **Workspace confinement**: filesystem + shell tools restricted to project root
- **Secret detection**: blocks `.env`, `.pem`, `.key`, `credentials`, SSH keys
- **MCP trust system**: content-hash verified project configs, auto-revoked on changes
- **Encrypted credentials**: AES-256-GCM for MCP tokens
- **Approval gates**: per-tool and per-mode human-in-the-loop (`suggest`/`auto_edit`/`full_auto`)
- **Shell allowlist**: only approved commands, blocks shell operators and path traversal

---

## Architecture

```
User Input
  │
  ▼
┌──────────────┐    ┌──────────────────┐
│  Agent Loop  │───▶│  LLM Provider    │  (OpenAI / Anthropic / DeepSeek / Ollama)
│              │◀───│  (stream w/tools) │
│  Middleware  │    └──────────────────┘
│  · Summarize │
│  · Offload   │    ┌──────────────────┐
│  · Skills    │───▶│  Tool Runtime    │
│  · Todos     │    │  · Filesystem    │
│  · Observe   │    │  · Git           │
│              │    │  · Shell         │
│  HITL Gate   │    │  · Web Search    │
│              │    │  · MCP Tools     │
└──────┬───────┘    │  · Sub-agents    │
       │            └──────────────────┘
       ▼
┌──────────────┐
│  TUI (Ink)   │
│  · Feed      │
│  · Input Box │
│  · StatusBar │
│  · Side Panel│
└──────────────┘
```

---

## Evals & Benchmarks

Built-in SWE-bench style evaluation framework:

```bash
chorus eval run ./tests/evals/auth-security.json
chorus eval report
```

---

## Configuration

**User config**: `~/.chorus/settings.json`  
**Project MCP config**: `<workspace>/.mcp.json`  
**Project agents**: `<workspace>/.chorus/agents/*.json`

### Environment Variables

| Variable | Purpose |
|---|---|
| `OPENAI_API_KEY` | OpenAI API key |
| `ANTHROPIC_API_KEY` | Anthropic API key |
| `DEEPSEEK_API_KEY` | DeepSeek API key |
| `CHORUS_HOME_DIR` | Override `~/.chorus/` path |
| `CHORUS_TRUST_PROJECT_MCP` | Skip MCP trust requirement |
| `MCP_TIMEOUT` | Connection timeout (ms) |
| `CHORUS_MCP_MAX_OUTPUT_TOKENS` | MCP output cap (default 25000) |
| `SERPER_API_KEY` | Serper web search |
| `GOOGLE_CSE_API_KEY` | Google Custom Search |
| `WEATHER_API_KEY` | Weather API |
| `DEBUG` | Enable debug logging |

---

## Comparison

| | Chorus | Claude Code | Cursor | Qwen Code |
|---|---|---|---|---|
| **Open source** | ✅ MIT | ❌ | ❌ | Apache 2.0 |
| **Terminal TUI** | ✅ Ink/React | ✅ | GUI only | ✅ |
| **Any LLM provider** | ✅ All major | Anthropic only | Multi-model | Qwen-optimized |
| **Esc interrupt** | ✅ Non-destructive abort | Broken (#49309) | Reverts all work | Broken (#2775) |
| **Message queue** | ✅ Auto-process after turn | Flushes at wrong time (#49373) | None | Requested (#4021) |
| **`/btw` side channel** | ✅ Full history, multi-turn | Single-turn, no tools | None | None |
| **Multi-agent swarms** | ✅ 4 presets + DAG graphs | SDK only | None | Subagents |
| **AI agent creator** | ✅ Natural language → agent | None | None | None |
| **Adaptive skills** | ✅ Auto-synthesized | Skills | Skills | Skills |
| **MCP OAuth + encrypt** | ✅ Browser flow + AES-256 | ✅ | ✅ | ✅ |
| **SWE-bench evals** | ✅ Built-in | ❌ | ❌ | ❌ |
| **Local-first / offline** | ✅ Ollama native | ❌ | ❌ | ✅ |

---

## Requirements

- **Node.js** >= 20
- **npm** >= 9
- Optional: **Ollama** for local-only operation

## License

MIT © AnomalyCo
