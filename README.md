# Chorus

**The most flexible, sophisticated AI coding agent harness in the terminal.**

Chorus is a high-performance, local-first interactive coding agent for production software engineering. It runs as a terminal UI with a React-powered interface (Ink), supports any LLM provider, and packs a full multi-agent orchestration layer, adaptive skill runtime, MCP integration, and enterprise-grade security.

---

## Why Chorus

| Capability | Chorus | Claude Code | Cursor | Qwen Code |
|---|---|---|---|---|
| **Terminal TUI** | ✅ Ink/React | ✅ | ❌ | ✅ |
| **Multi-provider LLM** | ✅ OpenAI, Anthropic, DeepSeek, Ollama, vLLM | Anthropic only | Multi-model | Qwen-optimized |
| **Local-first / offline** | ✅ Ollama native | ❌ | ❌ | ❌ |
| **Multi-agent swarms** | ✅ 4 presets + DAG graphs | SDK subagents | ❌ | Subagents |
| **Adaptive skill runtime** | ✅ Auto-synthesized patterns | Skills | Skills | Skills |
| **MCP (Model Context Protocol)** | ✅ Full OAuth, encrypted storage | ✅ | ✅ | ✅ |
| **AI-assisted agent creator** | ✅ Natural language → agent | ❌ | ❌ | ❌ |
| **SWE-bench evals** | ✅ Built-in scorer | ❌ | ❌ | ❌ |
| **Open source** | ✅ MIT | ❌ | ❌ | Apache 2.0 |

---

## Quick Start

```bash
# Requires Node.js >= 20
npm install
npm run dev
```

Chorus auto-detects provider keys from environment variables (`OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `DEEPSEEK_API_KEY`). Falls back to local Ollama if no cloud keys are set.

For production use:
```bash
npm run build && npm start
```

---

## Core Features

### AI Coding Agent

The main agent loop runs a turn-based tool-calling cycle with streaming responses, reasoning display, and interactive tool cards:

- **Tool arsenal**: filesystem (read/write/edit/list), git (status/diff/log/branch/commit), shell commands, web search (Serper/Google CSE), web fetch, todo management
- **Streaming UI**: real-time thinking blocks (expandable with `Space`), tool cards with args/results (collapsible), Tab navigation to cycle focus
- **Context window tracking**: live token counter, percentage bar, model-aware context limits
- **Auto-compaction**: summarization middleware offloads history when tokens exceed 85% of window
- **Tool output offload**: large tool results (>8KB) moved to disk instead of clogging context

### Execution Modes & Approval Policies

```
BUILD / auto-edit  ← default: auto-approve edits, ask for shell/commit
BUILD / suggest     ← ask before every tool call
PLAN  / read-only   ← filesystem + git reads only, no mutations
FULL_AUTO           ← zero-interruption mode
```

Toggle with `Shift+Tab` or `/build` / `/plan` slash commands.

### Multi-Provider LLM

Switch models on the fly. Configuration stored in `~/.chorus/settings.json`:

```json
{
  "llm": {
    "provider": "deepseek",
    "providers": {
      "deepseek": { "apiKey": "${DEEPSEEK_API_KEY}", "model": "deepseek-v4-flash" },
      "openai": { "apiKey": "${OPENAI_API_KEY}", "model": "gpt-4o" },
      "anthropic": { "apiKey": "${ANTHROPIC_API_KEY}", "model": "claude-sonnet-4-20250514" },
      "ollama": { "baseUrl": "http://localhost:11434/v1", "model": "qwen3-coder:latest" }
    }
  }
}
```

- **Per-mode model selection**: different models for `build` vs `plan` modes
- **Per-agent model override**: custom agents can pin specific models (e.g., `openai:gpt-4o`)
- **Interactive provider/model picker**: `/model` slash command with arrow-key navigation
- **Session-level overrides**: temporary model switches that don't touch saved config

### Workspace Intelligence

- **File watching**: glob-based file discovery with `.gitignore` awareness
- **`@` mentions**: type `@` to autocomplete files or custom agents in chat
- **Secret protection**: automatic blocking of `.env`, `.pem`, SSH keys, credentials during file read/copy
- **Workspace confinement**: all filesystem and shell tools restricted to project root

---

## Agent System — Create & Invoke Custom Agents

Chorus lets you create, edit, and invoke custom AI agents with specialized system prompts, tool sets, and permission modes.

### AI-Assisted Agent Creator

Describe what you want in plain English — Chorus generates a complete agent definition:

```
/g → "A security auditor that reviews code for OWASP Top 10 vulnerabilities,
       provides severity ratings, and suggests specific fixes with line references"
```

The LLM generates name, description, and a structured system prompt with Role, Responsibilities, Workflow, and Quality Bar sections. Review and accept, edit manually, or regenerate.

### Manual Agent Creator

Full 7-field editor with:
- **Name**: kebab-case identifier
- **Description**: one-line summary
- **System Prompt**: Markdown editor with sections
- **Model override**: pin `openai:gpt-4o` or any provider:model
- **Tool whitelist**: checkbox selection from available tools
- **Permission mode**: `full_auto` / `auto_edit` / `suggest`
- **Max rounds**: per-turn tool-use limit (default 30)

### Agent Dashboard

```
◈ Agents  2 defined                    n:new  g:generate  ↑↓:nav  enter:detail  esc:back
  Name               Model        Source  Description
▶ security-auditor   default      user    Security auditor for vulnerability review
  code-reviewer      gpt-4o       user    Expert code reviewer for PRs
```

- **Keyboard shortcuts**: `n` new manual, `g` AI generate, `↑↓` navigate, `Enter` detail
- **Detail panel**: view full system prompt, metadata, actions (edit/view/use/delete)
- **Storage**: agents saved as JSON in `~/.chorus/agents/` (user) or `.chorus/agents/` (project)

### Agent Invocation

Invoke agents directly from chat with `@agent-name` prefix:

```
@security-auditor review the auth module for vulnerabilities
```

- Agents appear in `@` autocomplete alongside file mentions
- The agent's system prompt replaces the default Chorus prompt for that turn
- Agents can also be spawned as subagents via `delegate_to_subagent` tool

---

## Multi-Agent Swarms

Orchestrate teams of specialized agents that collaborate on complex tasks.

### Four Built-in Presets

| Preset | Agents | Flow | Use case |
|---|---|---|---|
| `plan-build-review` | coordinator → planner → builder → reviewer | Sequential handoff | Full feature implementation |
| `research-synthesize` | coordinator → researcher → synthesizer | Handoff-based | Research a topic and produce findings |
| `vapt-report` | coordinator → scanner → analyst → reporter | Handoff cascade | Security penetration testing |
| `research-parallel` | researcher-a ∥ researcher-b → synthesizer | DAG parallel | Concurrent research → synthesis |

### How Swarms Work

- **Handoff-based**: coordinator delegates to specialists, each runs independently with its own system prompt and tools
- **DAG parallel execution**: graph-based swarms run agents in parallel waves, merging results
- **Artifact system**: agents share data through named key-value artifacts (`set_artifact` / `get_artifact`)
- **Context modes**: `shared` (full history), `isolated` (own messages only), `filtered` (handoff task only)
- **Worktree isolation**: agents can run in isolated git worktrees (`isolation: "worktree"`)
- **Cost management**: per-swarm and per-agent USD budgets with model downgrade under pressure
- **Circuit breaker**: auto-stop on budget exhaustion, loop detection, or output validation failure

### Launching Swarms

```bash
/swarm plan-build-review Implement OAuth2 login with refresh tokens
/swarm research-parallel Compare React Server Components vs traditional SSR
/swarm vapt-report Scan the authentication module for vulnerabilities
```

Live progress with agent status cards, handoff transitions, and artifact tracking in the TUI.

---

## MCP — Model Context Protocol

Chorus has the most comprehensive MCP integration of any CLI coding agent.

### Transport Support

- **stdio**: local process servers (npx, uvx, python, node)
- **Streamable HTTP**: remote MCP servers
- **SSE**: legacy Server-Sent Events

### Authentication Methods

| Method | Use Case | UX |
|---|---|---|
| **Bearer token** | API key from env var | `auth: { type: "bearer", tokenEnv: "MY_TOKEN" }` |
| **Client credentials** | OAuth2 machine-to-machine | Auto token refresh, encrypted storage |
| **Authorization code** | OAuth2 browser login | `chorus mcp auth <name>` opens browser, PKCE flow |
| **AWS SigV4** | AWS API Gateway endpoints | Inherits AWS credentials/profile |

### Encrypted Credential Storage

All MCP tokens are stored AES-256-GCM encrypted at `~/.chorus/mcp-auth.json` with a per-machine key (`~/.chorus/.mcp-key`, 0600 permissions). Supports migration from unencrypted legacy stores.

### Interactive MCP UI

- **MCP Dashboard** (`/mcp`): server list with live status, auth state, tool counts. `↑↓` to navigate, `Enter` for detail panel, `a` to start OAuth flow, `e` to toggle enable, `d` to delete.
- **Server Wizard** (`/mcp-add`): 14-step guided setup covering transport, command/args, env vars (KEY=VALUE pairs), headers, all auth methods, timeout, and max output tokens.
- **Trust system**: project `.mcp.json` files are content-hash verified before loading. Auto-revoked on changes.
- **Health monitoring**: 30-second ping-based health checks with auto-reconnection and 3-strike circuit breaker.
- **Lazy connections**: servers connect on first tool use, not at startup.

### OAuth Browser Flow

```
chorus mcp auth linear-server
# → Opens browser to Linear OAuth page
# → You log in and authorize
# → Browser redirects to localhost callback
# → Tokens exchanged via PKCE, stored encrypted
# → Server connects automatically
```

In-chat: `/mcp-auth linear-server` works from within the TUI.

### CLI Management

```bash
chorus mcp list              # All servers, status, auth state
chorus mcp add <name> ...    # Add server with full options
chorus mcp auth <name>       # Start OAuth flow
chorus mcp unauth <name>     # Clear stored tokens
chorus mcp trust             # Trust workspace .mcp.json
chorus mcp remove <name>     # Remove user-level server
```

---

## Adaptive Skill Runtime (ASR)

Chorus learns from your workflows. The ASR observes tool call patterns during agent runs and automatically synthesizes reusable skills.

### Three-Layer Architecture

| Layer | What | Example |
|---|---|---|
| **L1: Skills** | Human-authored `SKILL.md` files | `.chorus/skills/deploy/SKILL.md` |
| **L2: Patterns** | Auto-synthesized from repeated trajectories | "run-tests-before-commit-pattern" |
| **L3: Metaskills** | Skills that manage other skills | Skill curation, annealing, evaluation |

### How It Works

1. Agent runs a task with multiple tool calls (read → edit → test → commit)
2. After each round, the synthesizer observes the tool trajectory
3. When ≥3 similar trajectories repeat, a pattern is synthesized
4. Parameters are extracted from varying fields across trajectories
5. Patterns are registered and exposed as callable tools
6. The router selects relevant patterns per-turn based on conversation context
7. Underperforming patterns are automatically annealed (removed after repeated failures)

### Skill Files

Create `.chorus/skills/<name>/SKILL.md`:

```markdown
---
description: Deploy to staging
tags: [deploy, ci]
when: "package.json exists"
---

# Deploy to Staging

1. Run `npm run build` and confirm success
2. Run `npm test` and confirm all pass
3. Run `npm run deploy:staging`
4. Report the deployment URL
```

Skills support `when:` conditions (file existence, language detection), token budgets, and declarative workflows.

---

## Sub-Agents & Delegation

Three built-in sub-agents the main agent can spawn autonomously:

| Sub-agent | Role | Tools |
|---|---|---|
| **planner** | System architect for deep architectural decisions | git tools |
| **builder** | Senior engineer for production-quality code | git tools |
| **vapt** | Offensive security researcher | web search |

The main agent sees a `delegate_to_subagent` tool that lists available sub-agents and their capabilities. When the LLM decides a task needs specialized expertise, it spawns a sub-agent with its own system prompt, tools, and context — running as an independent agent loop.

Custom agents defined via `/agents` are also available as sub-agents.

---

## Sessions & History

- **Session management**: create, switch, resume, and delete sessions
- **History persistence**: sessions saved to `~/.chorus/sessions/`
- **Token tracking**: cumulative input/output token counts per session
- **Cost estimation**: per-model pricing with running session cost display
- **Compaction snapshots**: history dumps on compaction to `~/.chorus/history/`
- **Observability logs**: JSONL run logs in `~/.chorus/runs/`

---

## Evals & Benchmarking

Built-in SWE-bench style evaluation framework:

- **Eval runner**: execute test suites against agent outputs
- **Scorer**: pass/fail scoring with detailed reports
- **Storage**: eval results persisted as JSON

```bash
chorus eval run ./tests/evals/auth-security.json
chorus eval report
```

---

## Debugger (GSD)

Integrated scientific debugging system:

- **Session-based debugging**: hypothesis formulation, evidence collection, root cause analysis
- **Checkpoint/resume**: save and restore debug state
- **Structured reports**: findings with severity, location, and fix recommendations

---

## Security

- **Workspace confinement**: filesystem + shell tools restricted to project root
- **Secret detection**: blocks `.env`, `.pem`, `.key`, credentials during reading/copying
- **Approval gates**: per-tool and per-mode human-in-the-loop approval
- **MCP trust system**: content-hash verified project configs
- **Encrypted credential storage**: AES-256-GCM for MCP tokens
- **Safe defaults**: destructive operations require explicit approval

---

## Slash Commands

```
/help           Show all commands
/model          Switch model/provider interactively
/build          Switch to BUILD mode
/plan           Switch to PLAN mode (read-only)
/agents         Agent management dashboard
/mcp            MCP server status dashboard
/mcp-add        Add MCP server (interactive wizard)
/mcp-auth       Start OAuth flow for MCP server
/mcp-trust      Trust workspace .mcp.json
/mcp-reload     Reconnect MCP servers
/swarm          Run multi-agent swarm
/swarm-stop     Stop running swarm
/swarm-traces   List swarm trace files
/swarm-report   Show swarm observability report
/session        Session management (list/new/switch)
/config         Configure API keys (Serper, Google CSE, Weather)
/advisor        Toggle advisor mode
/add            Add file to context
/btw            Send mid-task message to running agent
/memory         View/manage agent memory
/exit           Exit the CLI
```

---

## CLI Commands

```bash
chorus mcp list|trust|untrust|add|add-json|remove|auth|unauth
chorus eval run|report
chorus --help
chorus --version
```

---

## Project Structure

```
src/
├── agent/          # Core agent loop, middleware, HITL, checkpointer
├── agents/         # Agent definitions, storage, loader, generator
├── cli/            # Terminal UI (Ink/React), components, hooks
├── context/        # Tokenizer, compaction, context cache
├── evals/          # SWE-bench evaluation framework
├── harness/        # Orchestrator, verifier, worker engine, protocol
├── llm/            # Multi-provider abstraction, pricing, context windows
├── mcp/            # MCP client, auth, config, CLI management
├── session/        # Session persistence, picker
├── skills/         # Adaptive skill runtime (ASR)
├── subagents/      # Built-in sub-agents (planner, builder, vapt)
├── swarm/          # Multi-agent swarm orchestration
├── tools/          # Filesystem, git, shell, web search, todos
├── prompts/        # System prompts
├── security/       # Secret detection, workspace confinement
└── settings/       # Configuration persistence, providers
```

---

## Requirements

- **Node.js** >= 20
- **npm** >= 9
- Optional: **Ollama** for local-only operation

## License

MIT
