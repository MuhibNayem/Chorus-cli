# Chorus-cli

**Chorus-cli** is a high-performance, local-first interactive agent harness designed for production coding tasks. It leverages modern LLMs (primarily Ollama-based) and a multi-agent orchestration layer to solve complex software engineering problems with precision and efficiency.

---

## 🚀 Key Features

- **Multi-Agent Orchestration**: Specialized workers (`planner`, `coder`, `researcher`, `reviewer`, `tester`) collaborate to execute complex tasks.
- **Local-First & Private**: Optimized for local LLM runtimes like Ollama, ensuring your code stays on your machine.
- **TUI Powered by Ink**: A responsive, scrolling terminal interface built with React (Ink), featuring collapsible thinking blocks and interactive tool cards.
- **Intelligent Context Management**: Automatic context compaction and summarization keep your token usage efficient.
- **Safety & HITL**: Built-in Human-In-The-Loop (HITL) approval flows for high-risk operations like file writes and shell commands.
- **Slash Commands & Mentions**: Intuitive CLI control with `/commands` and `@file` mentions to ground the agent in your codebase.

---

## 🛠 Architecture Overview

Chorus-cli follows a sophisticated "Harness" model that separates task routing from execution.

```mermaid
flowchart TD
    U[User Request] --> O[Orchestrator]
    O --> R[Task Router]
    R --> C[Context Assembler]
    C --> T[Tool Runtime]
    C --> W[Worker Pool]
    W --> P[Planner]
    W --> D[Coder]
    W --> RS[Researcher]
    W --> RV[Reviewer]
    W --> TS[Tester]
    T --> M[Result Merger]
    W --> M
    M --> V[Verifier]
    V --> O
    O --> F[Final Response]
```

For more details, see the [Architecture Documentation](.planning/codebase/ARCHITECTURE.md).

---

## 📦 Getting Started

### Prerequisites
- **Node.js**: v18 or later.
- **Ollama**: Installed and running locally.
- **Model**: `batiai/gemma4-e2b:q4` (default) or any compatible model pulled in Ollama.

### Installation
1. Clone the repository.
2. Install dependencies:
   ```bash
   npm install
   ```
3. (Optional) Configure environment variables in a `.env` file (see `.env.example`).

### Running the CLI
Start the CLI in development mode:
```bash
npm run dev
```

Or build and start:
```bash
npm run build
npm start
```

---

## 📖 Documentation

- **[User Handbook](HANDBOOK.md)**: A detailed guide on every feature and how to use the CLI.
- **[Harness Implementation Guide](docs/LLM-HARNESS-IMPLEMENTATION-GUIDE.md)**: Deep dive into the orchestration logic.
- **[Technology Stack](.planning/codebase/STACK.md)**: Detailed breakdown of the tools and libraries used.

---

## 🛡 Security & Safety

Chorus-cli is designed with safety in mind:
- **Workspace Confinement**: Filesystem and shell tools are restricted to the current working directory.
- **Secret Protection**: Automatic blocking of sensitive files (e.g., `.env`, `.pem`, SSH keys) during mention expansion.
- **Approval Policies**: Configure the agent to ask for permission before performing mutating actions.

### MCP Servers

Chorus can connect to Model Context Protocol servers from project `.mcp.json` or user `~/.chorus/settings.json`.

Project `.mcp.json` files are treated as executable workspace configuration because they can launch commands. Review the file, then run `/mcp-trust` in the TUI or `chorus mcp trust` in a shell. If the file changes, Chorus requires trust again.

Project example:

```json
{
  "mcpServers": {
    "filesystem": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "${PWD}"],
      "env": {}
    },
    "sentry": {
      "type": "http",
      "url": "https://mcp.sentry.dev/mcp",
      "auth": {
        "type": "bearer",
        "tokenEnv": "SENTRY_MCP_TOKEN"
      },
      "maxOutputTokens": 25000
    },
    "oauth-service": {
      "type": "http",
      "url": "https://mcp.example.com/mcp",
      "auth": {
        "type": "client_credentials",
        "clientIdEnv": "MCP_CLIENT_ID",
        "clientSecretEnv": "MCP_CLIENT_SECRET",
        "scope": "read:tools"
      }
    }
  }
}
```

Supported transports: `stdio`, `http` (Streamable HTTP), and legacy `sse`. Secrets should be passed through environment variables in `env`, `headers`, `bearerTokenEnv`, or `auth`; Chorus expands `${VAR}` and `${VAR:-default}` without printing secret values. Remote servers can also use `headersHelper` to run a local command that prints a JSON object of headers. MCP tool output is capped by `maxOutputTokens` or `CHORUS_MCP_MAX_OUTPUT_TOKENS` to protect context.

Useful commands:

```bash
chorus mcp list
chorus mcp trust
chorus mcp add filesystem --type stdio --command npx --arg -y --arg @modelcontextprotocol/server-filesystem --arg "$PWD"
chorus mcp add sentry --type http --url https://mcp.sentry.dev/mcp --bearer-token-env SENTRY_MCP_TOKEN
```

Use `/mcp` to inspect connected servers, `/mcp-trust` to trust the workspace config, and `/mcp-reload` after changing config.

---

## 📄 License

Chorus-cli is released under the [MIT License](LICENSE).
