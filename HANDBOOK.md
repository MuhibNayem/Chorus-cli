# Chorus-cli: The Comprehensive User Handbook

Welcome to the definitive guide for **Chorus-cli**, the high-performance, local-first interactive agent harness. This handbook provides an exhaustive look into every feature, command, tool, and configuration option available.

---

## 📑 Table of Contents

1.  [Interface & TUI Experience](#1-interface--tui-experience)
    *   [Navigation & Keybindings](#navigation--keybindings)
    *   [Thinking Blocks](#thinking-blocks)
    *   [Tool Cards](#tool-cards)
    *   [Status Bar](#status-bar)
2.  [Input & Grounding](#2-input--grounding)
    *   [Standard Input](#standard-input)
    *   [Autocomplete & Suggestions](#autocomplete--suggestions)
    *   [@Mentions & File Context](#mentions--file-context)
    *   [Paste Preview Mode](#paste-preview-mode)
    *   [Input History](#input-history)
3.  [Slash Commands Reference](#3-slash-commands-reference)
    *   [System & Help](#system--help)
    *   [Execution & Policies](#execution--policies)
    *   [Session & History](#session--history)
    *   [LLM & Provider Configuration](#llm--provider-configuration)
    *   [Agents & Workspaces](#agents--workspaces)
4.  [Agent Tools Encyclopedia](#4-agent-tools-encyclopedia)
    *   [Filesystem Tools](#filesystem-tools)
    *   [Shell Execution Tool](#shell-execution-tool)
    *   [Git Integration Tools](#git-integration-tools)
    *   [Web & Information Tools](#web--information-tools)
5.  [Multi-Agent Orchestration (The Harness)](#5-multi-agent-orchestration-the-harness)
    *   [Task Routing Logic](#task-routing-logic)
    *   [Worker Roles](#worker-roles)
    *   [Execution Lanes](#execution-lanes)
6.  [Modes & Policies](#6-modes--policies)
    *   [Execution Modes (Build vs. Plan)](#execution-modes-build-vs-plan)
    *   [Approval Policies](#approval-policies)
7.  [Session Lifecycle & Persistence](#7-session-lifecycle--persistence)
    *   [Persistence Layer](#persistence-layer)
    *   [Context Compaction](#context-compaction)
8.  [Custom Agents](#8-custom-agents)
    *   [Creation & Storage](#creation--storage)
    *   [Usage](#usage)
9.  [Configuration & Environment](#9-configuration--environment)
    *   [Environment Variables](#environment-variables)
    *   [Secret Protection Denylist](#secret-protection-denylist)

---

## 1. Interface & TUI Experience

Chorus-cli uses **Ink** to provide a rich, React-driven terminal experience.

### Navigation & Keybindings
*   **`Enter`**: Submit your message or command.
*   **`Tab`**: Cycle focus through expandable items in the current agent turn (Thinking Blocks and Tool Cards).
*   **`Space`**: Toggle (Expand/Collapse) the currently focused item.
*   **`Up/Down Arrow`**: Cycle through input history (when input is empty) OR cycle through autocomplete suggestions.
*   **`Esc`**: Clear current input or dismiss suggestion box.
*   **`Ctrl+C`**: Exit the application immediately.

### Thinking Blocks
Thinking blocks display the agent's internal reasoning process.
*   **Collapsed**: Shows a grey `▶ Thinking…` indicator with the duration (e.g., `1.2s`).
*   **Expanded**: Shows the full reasoning text in italicized grey.
*   **Behavior**: In-progress reasoning streams live. Once a turn is finalized, thinking blocks collapse by default to save screen real estate.

### Tool Cards
Tool cards represent actions the agent takes in your workspace.
*   **Visual Indicators**:
    *   `○` / Spinner: Tool is currently running.
    *   `✓`: Tool completed successfully.
    *   `✗`: Tool failed or returned an error.
*   **Colors**: Cyan (Running), Green (Success), Red (Error).
*   **Special Rendering**:
    *   **`write_todos`**: Displays a structured checklist with `○` (pending), `◎` (in-progress), and `✓` (completed) icons.
*   **Expansion**: Expanding a card shows the exact JSON arguments passed to the tool and the first 40 lines of the result output.

### Status Bar
The persistent bottom bar displays:
*   **Model**: Current model name (e.g., `batiai/gemma4-e2b:q4`).
*   **Execution Mode**: `BUILD` (Green) or `PLAN` (Yellow).
*   **Policy**: Active approval policy (e.g., `/auto-edit`).
*   **State**: Current agent status (Idle, Thinking, Tool, Error).
*   **Session**: Current session name (truncated if long).
*   **Context Bar**: Visual representation of context window usage.
    *   `Green`: < 50%
    *   `Yellow`: 50% - 80%
    *   `Red`: > 80%
*   **Token Count**: `Current / Limit` (e.g., `12.4K / 128K`).

---

## 2. Input & Grounding

### Standard Input
The bottom input box is where you send messages. It is locked while the agent is processing a turn to prevent race conditions.

### Autocomplete & Suggestions
Chorus-cli provides a context-aware suggestion box:
*   **Slash Commands**: Triggered by typing `/`.
*   **@Mentions**: Triggered by typing `@`. Suggestions are pulled from the workspace file list.

### @Mentions & File Context
Using `@filename` (e.g., `@src/index.ts`) injects the full content of that file into your prompt.
*   **Expansion**: Mentions are expanded into Markdown code blocks:
    ```markdown
    [File: src/index.ts]
    ```ts
    // content...
    ```
*   **Fuzzy Matching**: You don't need the full path. `@App` might resolve to `src/cli/App.tsx`.

### Paste Preview Mode
If you paste a large amount of text (> 20 chars with newlines), the input switches to **Paste Preview**.
*   Shows a summary: `⎘ 45 lines pasted`.
*   Displays a 4-line preview of the content.
*   Allows you to review before hitting `Enter` to submit or `Esc` to clear.

### Input History
The CLI maintains a history of up to 500 commands, stored at `~/.chorus/input-history.json` with `0600` permissions for privacy.

---

## 3. Slash Commands Reference

### System & Help
*   **`/help`**: Displays the command reference.
*   **`/exit`**: Saves the current session and exits.
*   **`/cwd`**: Prints the current working directory.
*   **`/tokens`**: Prints the exact context token count.

### Execution & Policies
*   **`/mode`**: Displays the current execution mode and a description of the active approval policy.
*   **`/plan`**: Switches to **Plan Mode**. The agent will suggest changes but cannot modify files or run commands.
*   **`/build`**: Switches to **Build Mode**. The agent has full write access (subject to approval policies).
*   **`/approval <policy>`**: Sets the approval policy. Options: `suggest`, `auto-edit`, `full-auto`.

### Session & History
*   **`/clear`**: Clears the UI feed and resets the agent's message history.
*   **`/compact`**: Informs the system to compact history on the next submission.
*   **`/sessions`**: Lists all saved sessions for the current workspace with metadata (name, message count, last updated).
*   **`/session`**: Displays details about the active session.
*   **`/resume`**: Opens an interactive picker to select and load a past session.
*   **`/session-new`**: Immediately starts a fresh session.

### LLM & Provider Configuration
*   **`/model`**: Interactive picker to switch models for the current session.
*   **`/provider`**: Interactive picker to switch LLM providers (e.g., Ollama, vLLM).
*   **`/default-model`**: Interactive wizard to set your permanent default provider and model.
*   **`/new-provider`**: Interactive wizard to configure a new LLM provider (Base URL, API Key, etc.).

### Agents & Workspaces
*   **`/agents`**: Opens the Agent Management interface to list, edit, view, or create custom agents.

---

## 4. Agent Tools Encyclopedia

### Filesystem Tools
All filesystem actions are workspace-confined and resolve relative paths against the root.
*   **`file_read`**: Reads the entire content of a file.
*   **`file_write`**: Writes full content to a file. Creates parent directories automatically.
*   **`file_edit`**: Performs a targeted "find and replace" on a file. Requires an exact match of the `old_string`.
*   **`list_dir`**: Lists files and folders in a directory.
*   **`find_files`**: Finds files using glob patterns (e.g., `src/**/*.ts`).
*   **`search_files`**: Recursively searches file contents for a regex pattern (grep-style).

### Shell Execution Tool
*   **`run_command`**: Executes a command via `execFile`.
    *   **Allowlist**: Only specific commands are allowed (e.g., `git`, `npm`, `node`, `tsx`, `tsc`, `python`, `cargo`, `curl`, `grep`, `ls`, etc.).
    *   **Safety**: Blocks shell operators (`;`, `&&`, `|`, `>`), absolute paths outside the workspace, and home-directory shortcuts (`~`, `$HOME`).
    *   **Timeout**: Commands are automatically killed after 60 seconds.

### Git Integration Tools
*   **`git_status`**: Runs `git status`.
*   **`git_diff`**: Runs `git diff`.
*   **`git_log`**: Runs `git log --oneline`.
*   **`git_branch`**: Lists all branches.
*   **`git_commit`**: Commits changes with the provided message.

### Web & Information Tools
*   **`internet_search`**: Uses the Serper API to search Google.
*   **`web_search`**: Uses the Google Custom Search Engine.
*   **`weather`**: Fetches current weather for a specified city (WeatherAPI).

---

## 5. Multi-Agent Orchestration (The Harness)

The **Harness** is an advanced orchestration layer that determines how to solve a task based on its complexity.

### Task Routing Logic
The **Router** analyzes your request and the context to choose a path:
*   **`direct_agent_path`**: Used for trivial questions or simple analysis.
*   **`tool_or_single_worker_path`**: Used for straightforward file edits or single-command tasks.
*   **`parallel_multi_worker_path`**: Used when the task spans multiple files or requires separate phases (e.g., implement + review).
*   **`research_then_plan_path`**: Used for vague requests or those requiring external documentation.

### Worker Roles
If a multi-agent path is chosen, the Orchestrator spawns:
*   **Researcher**: Scans docs and web for info.
*   **Planner**: Architect's the change and assigns file ownership.
*   **Coder**: Executes the actual implementation.
*   **Reviewer**: Audits the coder's output for quality.
*   **Tester**: Verifies the fix with live tests.

### Execution Lanes
*   **`foreground_sync`**: Standard interactive turns.
*   **`background_async`**: For long-running repo scans or complex migrations.
*   **`cheap_triage`**: For fast classification or routing decisions using smaller models.

---

## 6. Modes & Policies

### Execution Modes (Build vs. Plan)
*   **Build Mode**: The default state for active development. The agent can use all tools, including those that modify files or the system state.
*   **Plan Mode**: A "Safe" state. The agent is strictly read-only. It will use `list_dir`, `file_read`, and `search_files` to understand the code, but it will only *propose* changes in text rather than executing them.

### Approval Policies
Policies govern when the CLI asks for your permission before a tool runs.
*   **`suggest`**: The most restrictive. The agent will ask for approval for almost every tool call.
*   **`auto_edit`**: The balanced default. File reads, searches, and git status are automatic. File writes, edits, shell commands, and commits require your approval (`a` to approve, `d` to deny).
*   **`full_auto`**: No restrictions. The agent works autonomously. Recommended only for trusted environments or small, low-risk tasks.

---

## 7. Session Lifecycle & Persistence

### Persistence Layer
All sessions are stored in `~/.chorus/sessions/`.
*   **`index.json`**: Metadata for all sessions in the workspace.
*   **`<uuid>.json`**: The full message history for a specific session.
*   **Flushing**: The system uses debounced saves (500ms) and a synchronous flush on process exit to ensure no data is lost.

### Context Compaction
When the conversation exceeds the **Compaction Threshold** (default: 75% of the context window):
1.  Older messages are sent to a summarization model.
2.  A single "System Summary" message is generated.
3.  The history is replaced with the Summary + the 20 most recent messages.
4.  This keeps the model fast and focused while retaining critical project knowledge.

---

## 8. Custom Agents

Custom agents are specialized personas you can define for repetitive tasks.

### Creation & Storage
Use `/agents` to open the creator. You define:
*   **Name**: Kebab-case identifier (e.g., `doc-expert`).
*   **Description**: A short summary of the role.
*   **System Prompt**: The instructions that define the agent's behavior.
*   **Model**: (Optional) Override the default model for this agent.

Agents are stored in:
*   **User Scope**: `~/.chorus/agents/` (available in all projects).
*   **Project Scope**: `.chorus/agents/` (committed to the repo).

### Usage
Invoke an agent by prefixing your message with `@name`:
> `@doc-expert Document the authentication flow in src/auth.ts`

---

## 9. Configuration & Environment

### Environment Variables
*   `OLLAMA_BASE_URL`: API endpoint for Ollama (default: `http://localhost:11434`).
*   `OLLAMA_MODEL`: Default model name (default: `batiai/gemma4-e2b:q4`).
*   `DEBUG=1`: Log detailed events to `debug.log`.
*   `SERPER_API_KEY`: Required for `internet_search`.
*   `GOOGLE_CSE_API_KEY` & `GOOGLE_CSE_ID`: Required for `web_search`.
*   `WEATHER_API_KEY`: Required for `weather`.
*   `DISABLE_TODO_MIDDLEWARE=1`: Disables default deepagents middleware.

### Secret Protection Denylist
Chorus-cli automatically blocks the following patterns in `@mentions`:
*   `.env` files
*   `credentials` (case-insensitive)
*   `secret` (case-insensitive)
*   `.pem`, `.key`, `.pfx`, `.p12` (certificates/keys)
*   `id_rsa`, `id_ed25519` (SSH keys)

---

*End of Handbook*
