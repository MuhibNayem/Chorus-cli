# Deep Agent CLI — Specification

## Overview

An interactive coding agent CLI with a split-pane TUI that streams `<|think|>` reasoning alongside final responses. Built on `deepagents` (LangGraph SDK), Ollama gemma:2b, with prompt caching, compaction, context visualization, and three specialized subagents.

## Stack

- **TypeScript** + **Node.js** (ES modules)
- **deepagents** (`@langchain/langgraph` under the hood)
- **Blessed** — TUI framework
- **Ollama** — gemma:2b (128K context) + gemma:4:latest for summarization
- **tiktoken** — token counting

---

## Architecture

### Agent Hierarchy

```
┌─────────────────────────────────────────────────────────────┐
│                     Main Deep Agent                          │
│  - Receives user messages                                   │
│  - Orchestrates workflow                                     │
│  - Delegates to subagents via `task()`                      │
│  - Executes tools (file, shell, git, web search)             │
└─────────────────────────────────────────────────────────────┘
         │                    │                    │
         ▼                    ▼                    ▼
┌─────────────┐      ┌─────────────┐       ┌─────────────┐
│   Planner   │      │    VAPT     │       │   Builder   │
│  (system    │      │  (offensive │       │  (senior    │
│  architect) │      │   security) │       │   dev)      │
└─────────────┘      └─────────────┘       └─────────────┘
```

### Subagent System

#### Planner
- **Role:** Expert system architect
- **System Prompt:** Deep system design thinking, scalability, trade-offs
- **Tools:** file (read only), git, restricted shell (git, npm, yarn, pnpm, cargo, go)
- **Delegated Tasks:** Architectural decisions, tech stack planning, system decomposition

#### VAPT Specialist
- **Role:** Offensive security researcher, penetration tester
- **System Prompt:** Think like an attacker, find vulns, misconfigs, CVE analysis
- **Tools:** shell (nmap, nikto, sqlmap, ffuf, etc.), web-search (Serper, Google CSE)
- **Delegated Tasks:** Security audits, vulnerability scanning, CVE research

#### Builder
- **Role:** Senior software engineer, clean code advocate
- **System Prompt:** Production-quality code with tests, docs, best practices
- **Tools:** file (read/write/edit), shell (git, npm, yarn, pnpm, cargo, go, python)
- **Delegated Tasks:** Code implementation, refactoring, code review

### Delegation Flow

```typescript
// Main agent decides to delegate
const result = await subagent.invoke({
  messages: [{ role: "user", content: taskDescription }]
});
// Result returned to main agent, subagent context isolated
```

---

## Context Management

### Token Counting
- **Library:** tiktoken with `cl100k_base` encoding
- **Counted:** All messages + system prompt tokens

### Context Visualization (Top Bar)
```
Context: 48% [████████████░░░░░░░░░░░░] 61K / 128K
         └─ color: green (<50%) → yellow (50-80%) → red (>80%)
```

### Compaction Trigger
- **Threshold:** 100K tokens
- **Model:** gemma:4:latest (separate from main gemma:2b)
- **Process:**
  1. Keep: system prompt + most recent 28K tokens
  2. Summarize older messages via gemma:4:latest
     - Prompt: "Summarize the conversation, preserving key facts, decisions, architecture choices..."
  3. Replace old messages with summary
  4. Context reduced to ~30K tokens, resume

---

## Tool System

### File Tools
| Tool | Description |
|------|-------------|
| `read_file` | Read file(s) with path glob support |
| `write_file` | Write content to file (create/overwrite) |
| `edit_file` | Edit using search/replace patterns |
| `ls` | List directory contents |
| `glob` | Find files matching pattern |
| `grep` | Search file contents |

### Shell Tool
- **Command:** `execute`
- **Safe list:** git, npm, yarn, pnpm, cargo, go, python, pip, curl, wget
- **Blocked:** rm -rf /, fork bombs, interactive commands
- **Returns:** stdout, stderr, exit code, duration

### Git Tool
| Tool | Description |
|------|-------------|
| `git_status` | Current repo status |
| `git_diff` | Staged/unstaged changes |
| `git_log` | Recent commits |
| `git_branch` | List/create/checkout branches |
| `git_commit` | Commit with message |

### Web Search Tools
| Tool | Backend |
|------|---------|
| `internet_search` | Serper API (serpapi.com) |
| `web_search` | Google Custom Search Engine |

---

## TUI Layout (Blessed)

```
┌──────────────────────────────────────────────────────────────────┐
│  Context: 48% [████████████░░░░░░░░░░░░] 61K / 128K           │
├──────────────────────────────────────────────────────────────────┤
│  [User Input - multiline textarea]              [Ctrl+D: send]   │
│                                                              │
├─────────────────────────────┬──────────────────────────────────┤
│  THINKING (dim/cyan)        │  RESPONSE (bright/white)        │
│  <|think|> reasoning        │  Final response                  │
│  streams here               │  streams here                    │
│  scrollable                │  scrollable                      │
├─────────────────────────────┴──────────────────────────────────┤
│  TOOL LOG (scrollable)                                        │
│  [14:32:01] execute: ls -la → completed 45ms                  │
│  [14:32:05] read_file: src/index.ts → 124 lines               │
│  [14:32:12] internet_search: "VAPT checklist" → 10 results    │
└───────────────────────────────────────────────────────────────  │
```

### Panes

1. **ContextBar** — Top bar with progress bar and token count
2. **InputPane** — Multiline textarea for user input
3. **OutputPane** — Split into:
   - **ThinkPanel** — `<|think|>` output (dimmed cyan, scrollable)
   - **ResponsePanel** — Final response (bright white, scrollable)
4. **ToolLogPane** — Tool execution log with timestamps

### Keybinds

| Key | Action |
|-----|--------|
| `Ctrl+D` | Send message |
| `Ctrl+C` | Quit (confirm if mid-stream) |
| `↑/↓` | Scroll panes |
| `Tab` | Switch focus |
| `Esc` | Interrupt agent mid-stream |

---

## Ollama Integration

### Model Configuration
- **Main Model:** `gemma:2b` with `<|think|>` enabled
- **Summarization Model:** `gemma:4:latest` (separate)

### Streaming + `<|think|>` Parsing

**Request:**
```typescript
POST /api/generate
{
  "model": "gemma:2b",
  "prompt": "<|think|>\n[system prompt with tools/subagents]\n\n[conversation]",
  "stream": true
}
```

**Response parsing (regex):**
```
<|channel>thought\n[internal reasoning]<channel|>  → ThinkPanel (dimmed)
[final response]                                  → ResponsePanel (bright)
```

**System Prompt Structure:**
```
<|think|>

You are a helpful coding assistant with access to tools.

## Tools
[tool descriptions]

## Subagents
[subagent descriptions]

## Instructions
- Use tools when needed
- Delegate complex tasks to appropriate subagents
- Think step by step before responding
```

---

## Project Structure

```
deep-agent-cli/
├── package.json
├── tsconfig.json
├── .env.example
├── src/
│   ├── index.ts                 # Entry point
│   ├── cli/
│   │   ├── index.ts             # Blessed TUI bootstrap
│   │   ├── panes/
│   │   │   ├── ContextBar.ts
│   │   │   ├── InputPane.ts
│   │   │   ├── OutputPane.ts
│   │   │   └── ToolLogPane.ts
│   │   └── widgets/
│   │       └── ProgressBar.ts
│   ├── tools/
│   │   ├── file.ts
│   │   ├── shell.ts
│   │   ├── git.ts
│   │   └── web-search.ts
│   ├── subagents/
│   │   ├── planner.ts
│   │   ├── vapt.ts
│   │   └── builder.ts
│   ├── context/
│   │   ├── tokenizer.ts
│   │   ├── compaction.ts
│   │   └── cache.ts
│   ├── ollama/
│   │   ├── client.ts
│   │   └── think-parser.ts
│   └── prompts/
│       └── system.ts
└── docs/
    └── SPEC.md
```

---

## API Keys (Environment Variables)

```bash
OLLAMA_BASE_URL=http://localhost:11434
SERPER_API_KEY=
GOOGLE_CSE_API_KEY=
GOOGLE_CSE_ID=
```

---

## Implementation Phases

### Phase 1: Project Scaffolding
- Initialize npm + TypeScript
- Install dependencies
- Set up folder structure

### Phase 2: Tool Definitions
- Implement file, shell, git, web-search tools
- Safe list enforcement for shell

### Phase 3: Subagent Configuration
- Define planner, vapt, builder prompts
- Configure subagent isolation

### Phase 4: Context Management
- Integrate tiktoken for counting
- Implement compaction with gemma:4:latest

### Phase 5: Ollama Streaming
- SSE streaming client
- `<|think|>` parser
- Token streaming to panes

### Phase 6: TUI Implementation
- Blessed layout with panes
- Context bar with color gradient
- Keybinds and scrolling

### Phase 7: Integration
- Wire deepagents + TUI + streaming
- End-to-end testing

---

## Success Criteria

1. **Streaming:** Every token renders immediately, `<|think|>` reasoning appears in real-time
2. **Context:** Token count accurate, compaction at 100K keeps context manageable
3. **Subagents:** Planner, VAPT, Builder delegate and return results correctly
4. **Tools:** File ops, shell (restricted), git, web search all functional
5. **TUI:** Split panes scroll, context bar updates live, keybinds work