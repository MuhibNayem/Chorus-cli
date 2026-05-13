# Codebase Structure

**Analysis Date:** 2026-05-13

## Directory Layout

```text
Chorus-cli/
├── package.json                 # Node package metadata, scripts, runtime/development dependencies
├── package-lock.json            # npm lockfile
├── tsconfig.json                # TypeScript compiler options for ESM + React JSX
├── docs/                        # Product specs and implementation plans
├── src/                         # Runtime TypeScript source
│   ├── index.ts                 # CLI process entry point
│   ├── cli/                     # Ink UI, local commands, hooks, reducer state
│   │   ├── App.tsx              # Main UI composition and submission flow
│   │   ├── index.ts             # App re-export
│   │   ├── commands.ts          # Slash command handling
│   │   ├── components/          # Ink presentation components
│   │   ├── hooks/               # React hooks for streaming and spinners
│   │   └── state/               # Feed reducer and feed event types
│   ├── context/                 # Token counting, compaction, and unused cache helper
│   ├── ollama/                  # Direct Ollama streaming client used by compaction
│   ├── prompts/                 # Main and subagent prompts
│   ├── session/                 # Session persistence, metadata, and picker UI
│   ├── subagents/               # deepagents subagent definitions
│   └── tools/                   # LangChain tools exposed to the agent
└── tests/                       # Vitest tests
```

## Directory Purposes

**Root:**
- Purpose: Define package metadata, TypeScript compilation, and npm workflow.
- Contains: `package.json`, `package-lock.json`, `tsconfig.json`.
- Key files: `package.json`, `tsconfig.json`.

**`src/`:**
- Purpose: All source files compiled by `tsc`.
- Contains: CLI entry point plus runtime modules for UI, session persistence, model orchestration, context, prompts, tools, and subagents.
- Key files: `src/index.ts`, `src/cli/App.tsx`, `src/cli/hooks/useAgentStream.ts`.

**`src/cli/`:**
- Purpose: Terminal UI and user interaction layer.
- Contains: `App.tsx`, command handling, components, hooks, reducer state.
- Key files: `src/cli/App.tsx`, `src/cli/commands.ts`, `src/cli/index.ts`.

**`src/cli/components/`:**
- Purpose: Pure Ink rendering components for the visible CLI.
- Contains: `Feed.tsx`, `AgentTurn.tsx`, `ThinkingBlock.tsx`, `ToolCard.tsx`, `InputBox.tsx`, `SuggestionBox.tsx`, `StatusBar.tsx`, `UserMessage.tsx`.
- Key files: `src/cli/components/Feed.tsx`, `src/cli/components/AgentTurn.tsx`, `src/cli/components/ToolCard.tsx`, `src/cli/components/StatusBar.tsx`.

**`src/cli/hooks/`:**
- Purpose: React hooks for nontrivial UI behavior and model streaming.
- Contains: `useAgentStream.ts`, `useSpinner.ts`.
- Key files: `src/cli/hooks/useAgentStream.ts`, `src/cli/hooks/useSpinner.ts`.

**`src/cli/state/`:**
- Purpose: Reducer-owned presentation state for the feed.
- Contains: `feedReducer.ts`.
- Key files: `src/cli/state/feedReducer.ts`.

**`src/context/`:**
- Purpose: Token counting and context compaction.
- Contains: `tokenizer.ts`, `compaction.ts`, `cache.ts`.
- Key files: `src/context/tokenizer.ts`, `src/context/compaction.ts`.

**`src/ollama/`:**
- Purpose: Direct low-level Ollama HTTP streaming client.
- Contains: `client.ts`.
- Key files: `src/ollama/client.ts`.

**`src/prompts/`:**
- Purpose: System prompt text for the main agent and subagents.
- Contains: `system.ts`.
- Key files: `src/prompts/system.ts`.

**`src/session/`:**
- Purpose: Persist and select workspace-scoped conversation sessions.
- Contains: `manager.ts`, `storage.ts`, `types.ts`, `picker.tsx`.
- Key files: `src/session/manager.ts`, `src/session/storage.ts`, `src/session/picker.tsx`.

**`src/subagents/`:**
- Purpose: Define the deepagents delegation roles.
- Contains: `planner.ts`, `vapt.ts`, `builder.ts`, `index.ts`.
- Key files: `src/subagents/index.ts`, `src/subagents/planner.ts`, `src/subagents/vapt.ts`, `src/subagents/builder.ts`.

**`src/tools/`:**
- Purpose: Agent-callable local and external tools.
- Contains: `filesystem.ts`, `shell.ts`, `git.ts`, `web-search.ts`, `index.ts`.
- Key files: `src/tools/index.ts`, `src/tools/filesystem.ts`, `src/tools/shell.ts`, `src/tools/git.ts`, `src/tools/web-search.ts`.

**`docs/`:**
- Purpose: Specs and implementation plans. Treat `docs/SPEC.md` and `docs/PLAN.md` as historical architecture for Blessed; treat `docs/superpowers/specs/2026-05-12-agent-harness-tui-redesign.md` as the design closest to the current Ink UI.
- Contains: `docs/SPEC.md`, `docs/PLAN.md`, `docs/superpowers/specs/2026-05-12-agent-harness-tui-redesign.md`, `docs/superpowers/plans/2026-05-12-agent-harness-tui-redesign.md`.
- Key files: `docs/superpowers/specs/2026-05-12-agent-harness-tui-redesign.md`, `docs/superpowers/plans/2026-05-12-agent-harness-tui-redesign.md`.

**`tests/`:**
- Purpose: Vitest test files.
- Contains: `tests/feedReducer.test.ts`.
- Key files: `tests/feedReducer.test.ts`.

## Key File Locations

**Entry Points:**
- `src/index.ts`: Runtime process entry point for session selection and Ink render.
- `src/cli/index.ts`: Re-exports `App`.
- `src/cli/App.tsx`: Main application component and UI composition root.

**Configuration:**
- `package.json`: Scripts and dependency graph. Use `npm run dev`, `npm run build`, `npm start`, and `npm test`.
- `tsconfig.json`: ES2022, ESNext modules, bundler resolution, strict TypeScript, `jsx: react-jsx`, `rootDir: ./src`, `outDir: ./dist`.

**Core Logic:**
- `src/cli/hooks/useAgentStream.ts`: Model/deepagents stream orchestration.
- `src/cli/state/feedReducer.ts`: Feed state transitions.
- `src/session/manager.ts`: Current session lifecycle and debounced saves.
- `src/session/storage.ts`: JSON persistence under `~/.chorus/sessions`.
- `src/tools/index.ts`: Tool registry exposed to the main deep agent.
- `src/subagents/index.ts`: Subagent registry exposed to the main deep agent.
- `src/context/compaction.ts`: Context summarization flow.
- `src/prompts/system.ts`: Main prompt, tool instructions, and subagent role prompts.

**CLI UI:**
- `src/cli/components/Feed.tsx`: Splits entries into frozen `Static` history and live dynamic entries.
- `src/cli/components/AgentTurn.tsx`: Renders ordered thinking/tool/response events for a turn.
- `src/cli/components/ThinkingBlock.tsx`: Collapsed/expanded reasoning display.
- `src/cli/components/ToolCard.tsx`: Running/done/error tool card display with special todo rendering.
- `src/cli/components/InputBox.tsx`: Text input and large paste preview.
- `src/cli/components/SuggestionBox.tsx`: Slash command and `@mention` suggestions.
- `src/cli/components/StatusBar.tsx`: Model, state, session, and context bar.

**Testing:**
- `tests/feedReducer.test.ts`: Vitest tests for `feedReducer`; current assertions target an older `turn.thinking`/`turn.tokens`/`turn.toolCalls` shape rather than the implemented ordered `events` shape in `src/cli/state/feedReducer.ts`.

## Naming Conventions

**Files:**
- Use lower camel-case or domain noun files for runtime modules: `src/cli/commands.ts`, `src/context/tokenizer.ts`, `src/session/storage.ts`.
- Use PascalCase for React component files: `src/cli/components/Feed.tsx`, `src/cli/components/AgentTurn.tsx`, `src/cli/components/StatusBar.tsx`.
- Use `use*.ts` for React hooks: `src/cli/hooks/useAgentStream.ts`, `src/cli/hooks/useSpinner.ts`.
- Use `index.ts` for capability registries or public re-exports: `src/cli/index.ts`, `src/tools/index.ts`, `src/subagents/index.ts`.
- Use `*.test.ts` under `tests/` for Vitest tests: `tests/feedReducer.test.ts`.

**Directories:**
- Group by runtime boundary, not by file type: `src/cli/`, `src/session/`, `src/tools/`, `src/subagents/`, `src/context/`.
- Keep UI subfolders below `src/cli/`: `src/cli/components/`, `src/cli/hooks/`, `src/cli/state/`.

## Where to Add New Code

**New CLI Screen or Visible UI Element:**
- Primary code: `src/cli/components/`.
- Composition point: `src/cli/App.tsx`.
- Shared feed types or state transitions: `src/cli/state/feedReducer.ts`.
- Tests: add or update `tests/*.test.ts` with reducer or pure logic tests; add component tests only after an Ink test setup exists.

**New Slash Command:**
- Primary code: `src/cli/commands.ts`.
- Suggestions: add metadata to `SLASH_COMMANDS` in `src/cli/commands.ts`.
- UI wiring: use existing `handleSlashCommand()` call in `src/cli/App.tsx`; avoid sending local commands to `useAgentStream.submit()`.

**New Agent Tool:**
- Implementation: add a focused file under `src/tools/` when the capability is new, or extend the closest existing file such as `src/tools/filesystem.ts`.
- Registry: export the tool through `src/tools/index.ts` and include it in `allTools` if the main agent should call it.
- Validation: define a `zod` schema in the tool declaration and preserve workspace confinement patterns from `src/tools/filesystem.ts` and `src/tools/shell.ts`.

**New Subagent:**
- Implementation: create `src/subagents/<role>.ts`.
- Registry: import and append it in `src/subagents/index.ts`.
- Prompt: add role prompt text and a `buildSubagentPrompt()` case in `src/prompts/system.ts`.
- Tools: pass a deliberately narrowed tool array, following `src/subagents/planner.ts`, `src/subagents/vapt.ts`, and `src/subagents/builder.ts`.

**Session Feature:**
- Data types: update `src/session/types.ts`.
- In-memory lifecycle: update `src/session/manager.ts`.
- Disk format/index behavior: update `src/session/storage.ts`.
- Startup picker UI: update `src/session/picker.tsx`.
- Runtime commands: update `src/cli/commands.ts`.

**Context or Compaction Change:**
- Token counting: update `src/context/tokenizer.ts`.
- Summarization behavior: update `src/context/compaction.ts`.
- Agent stream integration: update `src/cli/hooks/useAgentStream.ts`.
- Low-level Ollama streaming: update `src/ollama/client.ts`.

**Prompt Change:**
- Main agent instructions: update `SYSTEM_PROMPT` in `src/prompts/system.ts`.
- Subagent instructions: update `PLANNER_PROMPT`, `VAPT_PROMPT`, `BUILDER_PROMPT`, or add a new prompt in `src/prompts/system.ts`.
- Tool descriptions: keep prompt tool lists in `src/prompts/system.ts` synchronized with `src/tools/index.ts`.

**New Tests:**
- Reducer and pure logic tests: add files under `tests/`.
- Source import style: import built TypeScript modules with `.js` extension, matching `tests/feedReducer.test.ts`.
- If testing the current feed reducer, assert against `turn.events` from `src/cli/state/feedReducer.ts`, not the older `turn.tokens`/`turn.toolCalls` shape in existing tests.

## Special Directories

**`dist/`:**
- Purpose: TypeScript build output from `npm run build`.
- Generated: Yes.
- Committed: Not detected in current file listing.

**`node_modules/`:**
- Purpose: npm dependency installation.
- Generated: Yes.
- Committed: No.

**`.planning/codebase/`:**
- Purpose: GSD codebase intelligence documents consumed by later planning/execution commands.
- Generated: Yes.
- Committed: Intended to be committed by the orchestrator, not by mapper agents.

**`docs/superpowers/`:**
- Purpose: Feature-specific specifications and plans for the Ink agent harness redesign.
- Generated: No.
- Committed: Yes.

**`~/.chorus/sessions`:**
- Purpose: Runtime session storage created by `src/session/storage.ts`.
- Generated: Yes.
- Committed: No; this path is outside the repository and contains local user session history.

---

*Structure analysis: 2026-05-13*
