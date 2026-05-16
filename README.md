<div align="center">

![Node.js](https://img.shields.io/badge/Node.js-20%2B-brightgreen?style=flat-square)
[![npm](https://img.shields.io/npm/v/chorus-agent-cli.svg?style=flat-square)](https://www.npmjs.com/package/chorus-agent-cli)
[![License](https://img.shields.io/github/license/anomalyco/chorus-cli.svg?style=flat-square)](./LICENSE)
[![Tests](https://img.shields.io/badge/tests-392%20passed-brightgreen?style=flat-square)]()

**The most powerful open-source AI coding agent for the terminal.**

Goal-driven autonomous loops · Side-channel conversations · Message queuing · Pre-flight advisor workers · Multi-agent swarms · MCP with OAuth · Full-diff file render · AI-assisted agent creator

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
  "mcp": {
    "servers": {
      "Minimax": { "type": "stdio", "command": "uvx", "args": ["minimax-coding-plan-mcp", "-y"], "env": { "MINIMAX_API_KEY": "${MINIMAX_API_KEY}" } }
    }
  }
}
```

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

## Requirements
Node.js >= 20 · Optional: Ollama

## License
MIT
