# Chorus-cli User Handbook

Welcome to **Chorus-cli**! This handbook is your comprehensive guide to mastering the CLI. Whether you are a new user or looking to leverage advanced orchestration features, this document covers everything you need to know.

---

## 📖 Table of Contents
1. [Interface Overview](#interface-overview)
2. [Basic Interaction](#basic-interaction)
3. [Grounding with @Mentions](#grounding-with-mentions)
4. [Slash Commands](#slash-commands)
5. [Execution Modes & Approval Policies](#execution-modes--approval-policies)
6. [Multi-Agent Orchestration (Workers)](#multi-agent-orchestration-workers)
7. [Session Management](#session-management)
8. [Custom Agents](#custom-agents)
9. [Advanced Configuration](#advanced-configuration)

---

## 🖥 Interface Overview

The Chorus-cli interface is designed to be informative yet clean.

- **Conversation Feed**: A scrolling history of your interaction. User messages start with `>`.
- **Thinking Blocks**: Collapsed by default (`▶ Thinking…`). Expand them to see the agent's reasoning process.
- **Tool Cards**: Real-time feedback on tool execution. They show the tool name, arguments, and result.
- **Status Bar**: Located at the bottom, showing the active model, agent state (thinking, running tool, idle), token usage, and active policies.

---

## ⌨️ Basic Interaction

Simply type your request in the input box and press **Enter**.

- **Navigation**: Use `Tab` to cycle focus between expandable thinking blocks and tool cards. Use `Space` to toggle (expand/collapse) the focused item.
- **History**: Use `Up Arrow` and `Down Arrow` when the input is empty to cycle through your command history.

---

## 📎 Grounding with @Mentions

To provide the agent with specific file context, use the `@` symbol followed by the file path.

### How to use:
Type `@` and start typing a filename. An autocomplete box will suggest files from your workspace.
- `@src/index.ts`: The agent will read the full content of `src/index.ts`.
- `@components`: The agent will search for files ending in or containing `components`.

> **Note**: Chorus-cli automatically blocks files that appear to be secrets (e.g., `.env`, `.pem`) to prevent them from being sent to the LLM.

---

## ⚡ Slash Commands

Slash commands allow you to control the CLI without sending messages to the LLM.

| Command | Description |
| --- | --- |
| `/help` | Show all available commands. |
| `/clear` | Clears the current conversation feed and history. |
| `/compact` | Manually triggers context compaction. |
| `/cwd` | Show the current workspace directory. |
| `/mode` | Show current execution mode (Build or Plan). |
| `/plan` | Switch to **Plan Mode** (read-only planning). |
| `/build` | Switch to **Build Mode** (edit, test, review). |
| `/approval` | Set or show approval policy (`suggest`, `auto-edit`, `full-auto`). |
| `/tokens` | Show current context token count. |
| `/sessions` | List sessions for this workspace. |
| `/session` | Show current session info. |
| `/resume` | Resume a past session (interactive). |
| `/session-new` | Start a fresh session. |
| `/settings` | Open the settings wizard. |
| `/model` | Switch model for this session. |
| `/provider` | Switch provider for this session. |
| `/default-model`| Set a permanent default model. |
| `/new-provider` | Configure a new provider. |
| `/exit` | Exit the CLI. |

---

## 🛡 Execution Modes & Approval Policies

Chorus-cli gives you control over how the agent operates via the `/mode` and `/approval` commands.

### Execution Modes:
- **Build Mode (`/build`)**: The agent can read and write files, run commands, and perform git actions.
- **Plan Mode (`/plan`)**: The agent is restricted to read-only actions. It will propose plans but won't execute changes.

### Approval Policies (`/approval <policy>`):
- **Auto-Edit (`auto-edit`)**: (Default) The agent executes most tools automatically but asks for approval on high-risk actions (like shell commands or large file writes).
- **Full-Auto (`full_auto`)**: The agent executes all tools without asking for permission. Use with extreme caution!
- **Suggest (`suggest`)**: The agent will suggest actions but wait for your explicit approval for almost everything.


---

## 🤖 Multi-Agent Orchestration (Workers)

For complex tasks, Chorus-cli uses a "Harness" to spawn specialized workers.

| Worker | Role |
| --- | --- |
| **Researcher** | Searches for information, documentation, or version details. |
| **Planner** | Decomposes a large task into smaller, actionable steps. |
| **Coder** | Implements specific code changes. |
| **Reviewer** | Audits changes for bugs, security risks, or style violations. |
| **Tester** | Generates and runs tests to verify the implementation. |

The **Orchestrator** manages these workers, ensuring they collaborate effectively to solve your task.

---

## 💾 Session Management

Your conversations are automatically saved as "Sessions".

- **Resuming**: When you start Chorus-cli, you can pick from your recent sessions.
- **Persistence**: Sessions are stored as JSON files in `~/.chorus/sessions`.
- **Auto-Save**: The system saves your progress after every turn.

---

## 🎨 Custom Agents

You can create specialized agents for specific roles (e.g., "Code Reviewer", "Documentation Expert").

- **Create**: Use the `/agents` command to open the Agent Creator.
- **Use**: Once created, you can invoke a custom agent by prefixing your message with `@agent-name`.
  - Example: `@reviewer Check this PR for security leaks.`

---

## ⚙️ Advanced Configuration

### Environment Variables
Configure your environment in a `.env` file:
- `OLLAMA_BASE_URL`: The URL of your local Ollama server (default: `http://localhost:11434`).
- `OLLAMA_MODEL`: The model to use (default: `batiai/gemma4-e2b:q4`).
- `DEBUG=1`: Enables detailed logging to `debug.log`.

### Context Compaction
When your conversation grows too large, Chorus-cli will automatically "compact" it. It summarizes the old parts of the thread into a single message, keeping the most recent history intact to save tokens and maintain performance.

---

## 🎓 Pro Tips
- **Pasting Code**: When you paste a large block of code into the input, Chorus-cli will switch to a "Paste Preview" mode, allowing you to review the text before submitting.
- **Cancellation**: Press `Esc` to clear your input or dismiss suggestions.
- **Interruption**: If an agent is performing a tool call that requires approval, you will see an **Approval Card**. Press `a` to approve, `s` to approve for the whole session, or `d` to deny.

---

*Thank you for using Chorus-cli! Happy coding!*
