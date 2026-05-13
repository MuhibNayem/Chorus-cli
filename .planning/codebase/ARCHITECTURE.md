# Architecture

**Analysis Date:** 2026-05-13

## Pattern Overview

**Overall:** Local interactive agent CLI with an Ink/React presentation layer, a reducer-backed conversation feed, LangChain/deepagents orchestration, workspace-confined tools, and JSON session persistence under the user's home directory.

**Key Characteristics:**
- `src/index.ts` is the process entry point. It loads `dotenv/config`, selects or creates a workspace-scoped session, registers an exit flush hook, and renders the Ink application.
- `src/cli/App.tsx` is the composition root for runtime UI state. It owns feed state, input state, suggestion state, token count, session actions, and submission flow.
- `src/cli/hooks/useAgentStream.ts` is the agent runtime bridge. It turns user input into deepagents streams, dispatches feed events, updates token counts, and triggers session persistence after completed turns.
- `src/tools/*.ts` define LangChain tools. Filesystem and shell tools constrain execution to `process.cwd()`, while git and web-search tools provide narrower integration surfaces.
- `src/session/*.ts` persist conversation messages and metadata to `~/.chorus/sessions`; only metadata for the current workspace appears in pickers and slash commands.
- `docs/SPEC.md` and `docs/PLAN.md` describe an earlier Blessed split-pane architecture. The implemented runtime is the Ink scrolling-feed architecture described in `docs/superpowers/specs/2026-05-12-agent-harness-tui-redesign.md`.

## Layers

**Process Bootstrap:**
- Purpose: Load environment, choose the current session, start the Ink UI, and flush pending session writes on process exit.
- Location: `src/index.ts`
- Contains: `main()` startup function, `SessionPicker` render/unmount flow, `sessionManager.createSession()`, `sessionManager.resumeSession()`, `process.on("exit", ...)`, and `render(createElement(App))`.
- Depends on: `dotenv/config`, `react`, `ink`, `src/cli/index.ts`, `src/session/picker.tsx`, `src/session/manager.ts`, `src/session/types.ts`.
- Used by: `package.json` scripts `dev`, `build`, and `start`.

**CLI Composition:**
- Purpose: Own UI state, keyboard behavior, slash command dispatch, file mention expansion, and agent submissions.
- Location: `src/cli/App.tsx`
- Contains: `App`, `loadWorkspaceFiles`, `expandMentions`, feed reducer wiring, suggestion generation, navigation focus, paste preview state, and session switching callbacks.
- Depends on: `src/cli/components/*.tsx`, `src/cli/state/feedReducer.ts`, `src/cli/hooks/useAgentStream.ts`, `src/cli/commands.ts`, `src/session/manager.ts`, `glob`, `fs`, `path`, `ink`.
- Used by: `src/cli/index.ts`, then `src/index.ts`.

**Agent Runtime:**
- Purpose: Create a model-backed deep agent for each submitted turn, stream messages/tool updates into the reducer, compact context when needed, and save completed message history.
- Location: `src/cli/hooks/useAgentStream.ts`
- Contains: `useAgentStream`, `messagesRef`, `submit`, `clearHistory`, `loadSession`, debug logging to `debug.log` when `DEBUG=1`, and `createDeepAgent` setup.
- Depends on: `langchain` `initChatModel`, `deepagents` `createDeepAgent`, `src/tools/index.ts`, `src/subagents/index.ts`, `src/prompts/system.ts`, `src/context/tokenizer.ts`, `src/context/compaction.ts`, `src/session/manager.ts`.
- Used by: `src/cli/App.tsx`.

**Conversation Feed State:**
- Purpose: Represent the terminal feed as immutable user/system/error entries and agent turns containing ordered thinking/tool/response events.
- Location: `src/cli/state/feedReducer.ts`
- Contains: `ToolCard`, `ThinkingEvent`, `ToolEvent`, `ResponseEvent`, `FeedEntry`, `FeedAction`, `initialFeedState`, and `feedReducer`.
- Depends on: No runtime imports.
- Used by: `src/cli/App.tsx`, `src/cli/hooks/useAgentStream.ts`, `src/cli/commands.ts`, and every feed rendering component under `src/cli/components/`.

**Ink Presentation Components:**
- Purpose: Render feed history, live turns, collapsible thinking blocks, expandable tool cards, input, suggestions, and status.
- Location: `src/cli/components/`
- Contains: `Feed.tsx`, `AgentTurn.tsx`, `ThinkingBlock.tsx`, `ToolCard.tsx`, `InputBox.tsx`, `SuggestionBox.tsx`, `StatusBar.tsx`, `UserMessage.tsx`.
- Depends on: `ink`, `ink-text-input`, local hooks in `src/cli/hooks/`, and feed state types from `src/cli/state/feedReducer.ts`.
- Used by: `src/cli/App.tsx`.

**Session Persistence:**
- Purpose: Maintain current session state in memory and save/reload JSON sessions for the active workspace.
- Location: `src/session/`
- Contains: `manager.ts`, `storage.ts`, `types.ts`, `picker.tsx`.
- Depends on: Node `fs`, `path`, `os`, `crypto.randomUUID()`, `ink`, and `react`.
- Used by: `src/index.ts`, `src/cli/App.tsx`, `src/cli/commands.ts`, and `src/cli/hooks/useAgentStream.ts`.

**Tool Boundary:**
- Purpose: Expose a constrained LangChain tool set to the deepagents runtime.
- Location: `src/tools/`
- Contains: `filesystem.ts`, `shell.ts`, `git.ts`, `web-search.ts`, and `index.ts`.
- Depends on: `@langchain/core/tools`, `zod`, Node `fs`, `path`, `child_process`, `util`, `glob`, and environment variables for external web APIs.
- Used by: `src/cli/hooks/useAgentStream.ts` through `allTools`, and by subagent definitions through `gitTools` and `webSearchTools`.

**Subagent Definitions:**
- Purpose: Define delegated roles for deepagents with role prompts and narrowed tool sets.
- Location: `src/subagents/`
- Contains: `planner.ts`, `vapt.ts`, `builder.ts`, and `index.ts`.
- Depends on: `deepagents`, `langchain` `StructuredTool`, `src/tools/index.ts`, `src/prompts/system.ts`.
- Used by: `src/cli/hooks/useAgentStream.ts`.

**Context Management:**
- Purpose: Count prompt/message tokens and summarize old conversation context when the threshold is reached.
- Location: `src/context/`
- Contains: `tokenizer.ts`, `compaction.ts`, and unused `cache.ts`.
- Depends on: `tiktoken`, `src/ollama/client.ts`, and `src/prompts/system.ts`.
- Used by: `src/cli/hooks/useAgentStream.ts`; `src/context/cache.ts` is not imported by implemented runtime files.

**Prompt Layer:**
- Purpose: Provide the main system prompt and subagent prompts.
- Location: `src/prompts/system.ts`
- Contains: `SYSTEM_PROMPT`, `PLANNER_PROMPT`, `VAPT_PROMPT`, `BUILDER_PROMPT`, and `buildSubagentPrompt`.
- Depends on: No runtime imports.
- Used by: `src/cli/hooks/useAgentStream.ts`, `src/subagents/*.ts`, and `src/context/compaction.ts`.

**Direct Ollama Client:**
- Purpose: Stream raw Ollama `/api/generate` responses for context summarization.
- Location: `src/ollama/client.ts`
- Contains: `streamOllama`, `OllamaStreamOptions`, and prompt concatenation helper `buildPrompt`.
- Depends on: global `fetch`, `TextDecoder`.
- Used by: `src/context/compaction.ts`. Main chat uses LangChain `initChatModel("ollama:...")` in `src/cli/hooks/useAgentStream.ts`.

## Data Flow

**Startup and Session Selection:**

1. `package.json` runs `tsx src/index.ts` in development or `node dist/index.js` after `tsc`.
2. `src/index.ts` calls `sessionManager.listForWorkspace()`, which reads `~/.chorus/sessions/index.json` through `src/session/storage.ts`.
3. If sessions exist, `src/index.ts` renders `SessionPicker` from `src/session/picker.tsx`; Enter resumes a selected session and `N` creates a new one.
4. `sessionManager.resumeSession(id)` loads `~/.chorus/sessions/<id>.json`; `sessionManager.createSession()` creates an in-memory session without writing until messages exist.
5. `src/index.ts` registers `process.on("exit", () => sessionManager.flushSync())` and renders `App`.

**User Submission:**

1. `InputBox` in `src/cli/components/InputBox.tsx` calls `App.handleSubmit()` with trimmed text.
2. `App.handleSubmit()` intercepts slash commands through `handleSlashCommand()` in `src/cli/commands.ts`.
3. Non-command input passes through `expandMentions()` in `src/cli/App.tsx`, which replaces `@path` tokens with fenced file-content blocks from the workspace file list.
4. `useAgentStream.submit()` in `src/cli/hooks/useAgentStream.ts` dispatches `APPEND_USER`, appends `{ role: "user", content }` to `messagesRef`, counts tokens, optionally compacts history, and creates a deep agent.
5. The deep agent streams with `streamMode: ["messages", "updates"]` and `configurable.thread_id` set to `sessionManager.getCurrent()?.id`.
6. Streaming chunks dispatch `APPEND_RESPONSE_TOKEN`, `APPEND_THINK_TOKEN`, `ADD_TOOL_CALL`, and `UPDATE_TOOL_CALL` into `feedReducer`.
7. After stream completion, the last assistant message is appended to `messagesRef`, `sessionManager.onMessageAdded()` schedules a debounced save, token count is refreshed, and `FINALIZE_TURN` collapses thinking blocks and marks processing complete.

**Tool Calling:**

1. `src/cli/hooks/useAgentStream.ts` constructs `agentOptions` with `tools: allTools` from `src/tools/index.ts`.
2. Deepagents emits AI updates with `msg.tool_calls`; `useAgentStream` converts them to running tool cards via `ADD_TOOL_CALL`.
3. Tool result messages with `tool_call_id` update matching cards through `UPDATE_TOOL_CALL`.
4. `src/tools/filesystem.ts` resolves all file paths against the startup `process.cwd()` and rejects paths outside the workspace.
5. `src/tools/shell.ts` accepts only allowlisted base commands and rejects absolute/system/home/traversal paths outside the workspace before calling `exec`.
6. `src/tools/git.ts` calls `execAsync("git ...")` without a workspace-specific `cwd`; current behavior relies on the Node process current working directory.
7. `src/tools/web-search.ts` calls Serper or Google CSE only when the relevant environment variables are present.

**Session Persistence:**

1. `SessionManager` in `src/session/manager.ts` holds the current `SessionData`.
2. `onMessageAdded(messages)` derives an unnamed session name from the first user message, updates metadata, detects compaction if the first message is a summary system message, and schedules a 500 ms debounced save.
3. `storage.saveSession()` in `src/session/storage.ts` writes `~/.chorus/sessions/<id>.json` with a temporary file and rename, then updates `~/.chorus/sessions/index.json`.
4. `flushSync()` writes immediately on process exit if the session has messages.
5. `/sessions`, `/resume`, `/session rename`, and `/session-new` in `src/cli/commands.ts` call `sessionManager` directly.

**Context Compaction:**

1. `useAgentStream.submit()` calls `shouldCompact(messagesRef.current, SYSTEM_PROMPT)`.
2. `src/context/tokenizer.ts` counts tokens with `tiktoken` `cl100k_base`.
3. At `COMPACTION_THRESHOLD = 100_000`, `compactMessages()` in `src/context/compaction.ts` sends older messages to `streamOllama()` using `buildSubagentPrompt("planner")`.
4. Runtime history becomes one synthetic system summary plus the last 20 messages.
5. `SessionManager.onMessageAdded()` later marks the session compacted when the first message starts with `[Previous conversation summary:`.

**State Management:**
- Long-lived chat history is `messagesRef` inside `src/cli/hooks/useAgentStream.ts`.
- Rendered terminal history is `feedState.entries` inside `src/cli/App.tsx`, updated only through `feedReducer`.
- Session metadata and persisted messages live in `SessionManager.current` and `~/.chorus/sessions`.
- Token count, input value, paste preview, suggestion index, and focus index are local React state in `src/cli/App.tsx`.

## Key Abstractions

**FeedEntry / TurnEvent:**
- Purpose: Separate display timeline from model message history.
- Examples: `src/cli/state/feedReducer.ts`, `src/cli/components/Feed.tsx`, `src/cli/components/AgentTurn.tsx`.
- Pattern: Reducer-managed discriminated unions. A user submission creates a `user` entry and a live `turn`; each turn contains ordered `thinking`, `tool`, and `response` events.

**SessionManager:**
- Purpose: Provide one process-global current session and hide JSON persistence details.
- Examples: `src/session/manager.ts`, `src/session/storage.ts`, `src/session/types.ts`.
- Pattern: Singleton instance exported as `sessionManager`; debounced write-through to storage plus synchronous flush on exit.

**Deep Agent Runtime Hook:**
- Purpose: Keep model orchestration outside UI components while still dispatching UI events.
- Examples: `src/cli/hooks/useAgentStream.ts`.
- Pattern: React hook with `messagesRef` for mutable history and reducer dispatch for presentation state.

**LangChain Tools:**
- Purpose: Adapt local shell/filesystem/git/web functionality to schemas the model can call.
- Examples: `src/tools/filesystem.ts`, `src/tools/shell.ts`, `src/tools/git.ts`, `src/tools/web-search.ts`, `src/tools/index.ts`.
- Pattern: `tool(async handler, { name, description, schema })` from `@langchain/core/tools`, schemas with `zod`, and arrays grouped by capability.

**SubAgent:**
- Purpose: Declare role-specific delegation targets for deepagents.
- Examples: `src/subagents/planner.ts`, `src/subagents/vapt.ts`, `src/subagents/builder.ts`.
- Pattern: Plain `SubAgent` objects with `name`, `description`, `systemPrompt`, and role-specific `tools`.

**SlashCommand:**
- Purpose: Handle local control commands without sending them to the model.
- Examples: `src/cli/commands.ts`, `src/cli/App.tsx`.
- Pattern: `SLASH_COMMANDS` metadata powers suggestions; `handleSlashCommand()` dispatches visible user/system feed entries and mutates session/history state as needed.

**Workspace File Mentions:**
- Purpose: Inline local file contents into user prompts.
- Examples: `loadWorkspaceFiles()` and `expandMentions()` in `src/cli/App.tsx`.
- Pattern: At mount, glob workspace files excluding `node_modules`, `.git`, and lockfiles; at submit time, replace matching `@...` tokens with fenced file blocks.

## Entry Points

**CLI Process:**
- Location: `src/index.ts`
- Triggers: `npm run dev`, `npm start`, or direct execution after build.
- Responsibilities: Load env, resume/create session, install exit flush, render the Ink app.

**Ink App Export:**
- Location: `src/cli/index.ts`
- Triggers: Imported by `src/index.ts`.
- Responsibilities: Re-export `App` from `src/cli/App.tsx`.

**Agent Stream Hook:**
- Location: `src/cli/hooks/useAgentStream.ts`
- Triggers: `App.handleSubmit()` calls `submit()`.
- Responsibilities: Manage model history, instantiate LangChain Ollama model, create the deep agent, consume stream chunks, dispatch feed updates, compact context, and save sessions.

**Session Picker:**
- Location: `src/session/picker.tsx`
- Triggers: `src/index.ts` renders it when `sessionManager.listForWorkspace()` returns sessions.
- Responsibilities: Provide keyboard navigation over workspace sessions and return either a selected session or `null` for a new session.

**Slash Command Handler:**
- Location: `src/cli/commands.ts`
- Triggers: `App.handleSubmit()` for input beginning with `/`.
- Responsibilities: Execute local UI/session commands and prevent those commands from reaching the agent.

## Error Handling

**Strategy:** Prefer user-visible errors for runtime/model/tool failures and non-throwing tool returns for agent-callable operations.

**Patterns:**
- `src/cli/hooks/useAgentStream.ts` wraps each submitted turn in `try/catch`, logs debug details only when `DEBUG=1`, and dispatches `SET_ERROR` to stop processing and show an error feed entry.
- `src/tools/filesystem.ts`, `src/tools/shell.ts`, `src/tools/git.ts`, and `src/tools/web-search.ts` catch operational failures and return error strings to the agent instead of throwing.
- `src/session/storage.ts` treats missing or unreadable index/session files as empty state or `null`, so startup can proceed.
- `src/context/compaction.ts` does not catch summarization errors; failures from `streamOllama()` reject into `useAgentStream.submit()` and become visible `SET_ERROR` entries.
- `src/cli/App.tsx` silently ignores unreadable files during `@mention` expansion and leaves unresolved mentions unchanged.

## Cross-Cutting Concerns

**Logging:** Debug logging is opt-in through `DEBUG=1` in `src/cli/hooks/useAgentStream.ts`; it appends JSON-ish event lines to `debug.log`. There is no central logger.

**Validation:** Tool input validation uses `zod` schemas in `src/tools/*.ts`. Workspace boundary checks exist in `src/tools/filesystem.ts` and `src/tools/shell.ts`. Slash commands use manual string parsing in `src/cli/commands.ts`.

**Authentication:** No user authentication exists. External web tools read API keys from environment variables in `src/tools/web-search.ts`. Ollama connection settings come from `OLLAMA_BASE_URL` and `OLLAMA_MODEL` in `src/cli/App.tsx`, `src/cli/hooks/useAgentStream.ts`, and `src/context/compaction.ts`.

**Intended-vs-Implemented Gaps:**
- `docs/SPEC.md` and `docs/PLAN.md` describe a Blessed split-pane UI under `src/cli/panes/` and `src/cli/widgets/`; implemented code uses Ink components under `src/cli/components/` and no Blessed dependency appears in `package.json`.
- `src/context/compaction.ts` exports `KEEP_RECENT_TOKENS = 28_000`, and `docs/SPEC.md` describes keeping recent tokens, but implemented compaction keeps `messages.slice(-20)` regardless of token count.
- `src/context/cache.ts` implements `MessageCache`, and older plan snippets reference it, but current runtime stores history in `messagesRef` inside `src/cli/hooks/useAgentStream.ts`.
- `src/prompts/system.ts` instructs the model to use `write_todos`, and `src/cli/components/ToolCard.tsx` has special rendering for `card.name === "write_todos"`, but `src/tools/index.ts` does not export a `write_todos` tool. This may depend on deepagents middleware unless `DISABLE_TODO_MIDDLEWARE=1`.
- `src/tools/web-search.ts` defines `WeatherTool`, but `src/tools/index.ts` does not include it in `allTools` or `webSearchTools`.
- `tests/feedReducer.test.ts` asserts the older feed shape with `turn.tokens`, `turn.toolCalls`, and `turn.thinking`; implemented `FeedEntry` now stores ordered `turn.events`.

---

*Architecture analysis: 2026-05-13*
