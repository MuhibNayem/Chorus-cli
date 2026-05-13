# Technology Stack

**Analysis Date:** 2026-05-13

## Languages

**Primary:**
- TypeScript 5.9.3 lockfile-resolved, declared as `^5.7.0` in `package.json` - application source in `src/**/*.ts` and `src/**/*.tsx`, compiled by `tsc` using `tsconfig.json`.

**Secondary:**
- JSX/TSX via React 18.3.1 lockfile-resolved, declared as `^18.0.0` - Ink terminal UI components in `src/cli/App.tsx`, `src/cli/components/*.tsx`, and `src/session/picker.tsx`.
- JavaScript/Node.js runtime APIs - filesystem, child process, OS, path, Web Fetch API, Web Crypto, and ESM runtime usage in `src/session/storage.ts`, `src/tools/shell.ts`, `src/tools/git.ts`, `src/ollama/client.ts`, and `src/session/manager.ts`.

## Runtime

**Environment:**
- Node.js v22.20.0 in the current workspace shell.
- Node package metadata uses ESM via `"type": "module"` in `package.json`.
- Source imports use emitted `.js` specifiers, for example `src/index.ts` imports `./cli/index.js`, matching TypeScript ESM output conventions.

**Package Manager:**
- npm 10.9.3 in the current workspace shell.
- Lockfile: present at `package-lock.json` with lockfileVersion 3.
- Current install state: `node_modules` is not installed. `npm ls --depth=0` reports every top-level dependency from `package.json` as unmet.

## Frameworks

**Core:**
- Ink 5.2.1 lockfile-resolved, declared as `^5.0.0` - React-based terminal UI rendering in `src/index.ts`, `src/cli/App.tsx`, and `src/cli/components/*.tsx`.
- React 18.3.1 lockfile-resolved, declared as `^18.0.0` - component model and hooks for the TUI in `src/cli/App.tsx` and `src/cli/hooks/useAgentStream.ts`.
- deepagents 1.10.1 lockfile-resolved, declared as `^1.10.1` - agent orchestration via `createDeepAgent` in `src/cli/hooks/useAgentStream.ts`, with subagents in `src/subagents/*.ts`.
- LangChain 1.4.0 lockfile-resolved, declared as `^1.4.0` - model initialization with `initChatModel("ollama:...")` in `src/cli/hooks/useAgentStream.ts`.
- `@langchain/core` 1.1.46 lockfile-resolved - `tool()` helper for filesystem, shell, git, and web tools in `src/tools/*.ts`.
- `@langchain/langgraph` 1.3.0 lockfile-resolved - declared dependency for deepagents/LangGraph integration; no direct implementation import detected in `src/`.
- `@langchain/ollama` 1.2.7 lockfile-resolved - declared dependency for Ollama model provider support; no direct implementation import detected in `src/`.

**Testing:**
- Vitest 2.1.9 lockfile-resolved, declared as `^2.0.0` - test runner for `tests/feedReducer.test.ts`.
- Assertions use Vitest `expect` in `tests/feedReducer.test.ts`.

**Build/Dev:**
- TypeScript compiler via `npm run build` (`tsc`) from `package.json`.
- tsx 4.21.0 lockfile-resolved, declared as `^4.19.0` - development runner via `npm run dev` (`tsx src/index.ts`) in `package.json`.
- No ESLint, Prettier, Jest, Vite, or bundler config detected. Build output is plain TypeScript emit to `dist/` as configured by `tsconfig.json`.

## Key Dependencies

**Critical:**
- `ink` 5.2.1 - terminal UI primitives used across `src/cli/App.tsx` and `src/cli/components/*.tsx`.
- `ink-text-input` 6.0.0 - input widget used by `src/cli/components/InputBox.tsx`.
- `react` 18.3.1 - rendering and hooks for the terminal UI in `src/cli/App.tsx`.
- `deepagents` 1.10.1 - main agent and subagent runtime in `src/cli/hooks/useAgentStream.ts` and `src/subagents/*.ts`.
- `langchain` 1.4.0 - Ollama chat model initialization in `src/cli/hooks/useAgentStream.ts`.
- `@langchain/core` 1.1.46 - tool schema wrappers in `src/tools/filesystem.ts`, `src/tools/shell.ts`, `src/tools/git.ts`, and `src/tools/web-search.ts`.
- `tiktoken` 1.0.22 - `cl100k_base` token counting in `src/context/tokenizer.ts`.
- `zod` 3.25.76 - tool input schemas in `src/tools/*.ts`.
- `dotenv` 16.6.1 - environment loading via `import "dotenv/config"` in `src/index.ts`.
- `glob` 13.0.6 - workspace file discovery and glob tool implementation in `src/cli/App.tsx` and `src/tools/filesystem.ts`.

**Infrastructure:**
- Local filesystem storage - sessions stored under `~/.chorus/sessions` by `src/session/storage.ts`.
- Node `child_process.exec` - shell and git tools in `src/tools/shell.ts` and `src/tools/git.ts`.
- Node/Web `fetch` - direct Ollama streaming in `src/ollama/client.ts` and web integrations in `src/tools/web-search.ts`.

## Configuration

**Environment:**
- Environment is loaded from dotenv at process startup in `src/index.ts`.
- Runtime model configuration is read from `OLLAMA_BASE_URL` and `OLLAMA_MODEL` in `src/cli/hooks/useAgentStream.ts`, `src/context/compaction.ts`, `src/cli/App.tsx`, and `src/cli/components/StatusBar.tsx`.
- Tool integrations read `SERPER_API_KEY`, `GOOGLE_CSE_API_KEY`, `GOOGLE_CSE_ID`, and `WEATHER_API_KEY` in `src/tools/web-search.ts`.
- Debug logging is enabled by `DEBUG=1` in `src/cli/hooks/useAgentStream.ts`, writing `debug.log` in the workspace.
- `DISABLE_TODO_MIDDLEWARE=1` disables deepagents middleware in `src/cli/hooks/useAgentStream.ts`.
- `.env.example` is present; its contents were not read because `.env*` files are treated as secret-bearing configuration.

**Build:**
- `tsconfig.json` targets ES2022, uses `module: "ESNext"`, `moduleResolution: "bundler"`, `strict: true`, `jsx: "react-jsx"`, `rootDir: "./src"`, `outDir: "./dist"`, and emits declarations.
- `package.json` scripts:
  - `npm run dev`: `tsx src/index.ts`
  - `npm run build`: `tsc`
  - `npm start`: `node dist/index.js`
  - `npm test`: `vitest run`

## Entry Points

**CLI Runtime:**
- `src/index.ts`: loads dotenv, selects/resumes a saved session with `SessionPicker`, initializes `sessionManager`, registers exit flushing, and renders Ink `App`.
- `src/cli/index.ts`: re-exports `App` from `src/cli/App.tsx`.
- `src/cli/App.tsx`: main TUI component; handles slash commands, file mention expansion, feed rendering, session actions, token display, and user submission.
- `src/cli/hooks/useAgentStream.ts`: creates the LangChain Ollama model, creates the deepagents agent, streams messages and updates, dispatches response/thinking/tool events, compacts context, and saves session messages.

**Tool Runtime:**
- `src/tools/index.ts`: registers filesystem, shell, git, Serper search, and Google CSE search tools into `allTools`.
- `src/subagents/index.ts`: registers `planner`, `vapt`, and `builder` subagents.

## Build/Test Status

**Current Local Status:**
- `npm ls --depth=0`: fails with `ELSPROBLEMS` because all declared top-level dependencies are unmet; `node_modules` is absent.
- `npm run build`: fails before compilation with `sh: 1: tsc: not found`.
- `npm test`: fails before tests run with `sh: 1: vitest: not found`.

**Implication:**
- The lockfile records the intended dependency graph, but the workspace cannot currently build or test until dependencies are installed with `npm install`.
- No TypeScript compile diagnostics or Vitest assertion results are available from the current workspace because the tool binaries are missing.

## Implementation vs Docs Mismatches

**TUI Framework:**
- `docs/SPEC.md` and `docs/PLAN.md` describe Blessed-based panes.
- Implementation uses Ink and React in `src/index.ts`, `src/cli/App.tsx`, and `src/cli/components/*.tsx`.

**Ollama Model Defaults:**
- `docs/SPEC.md` and `docs/PLAN.md` describe `gemma:2b` with `gemma:4:latest` summarization.
- Implementation defaults to `batiai/gemma4-e2b:q4` for both main model and compaction via `OLLAMA_MODEL` fallback in `src/cli/hooks/useAgentStream.ts` and `src/context/compaction.ts`.

**Ollama Streaming Path:**
- `docs/SPEC.md` describes inline `<|think|>` parsing.
- Implementation streams through `deepagents`/LangChain in `src/cli/hooks/useAgentStream.ts` and reads thinking from `additional_kwargs.reasoning_content` or `additional_kwargs.thinking`.
- `src/ollama/client.ts` still exists as a direct `/api/generate` streaming helper and is used by compaction in `src/context/compaction.ts`; it does not parse thinking despite exposing `onThink` in its options.

**Web Tools:**
- `docs/SPEC.md` lists Serper and Google CSE.
- Implementation also contains a `WeatherTool` using WeatherAPI in `src/tools/web-search.ts`, but it is not registered in `allTools` in `src/tools/index.ts`.

## Platform Requirements

**Development:**
- Node.js 18+ is implied by lockfile package engines and current usage of modern Web/Node APIs; current shell has Node.js v22.20.0.
- Run `npm install` before `npm run build`, `npm test`, `npm run dev`, or `npm start`.
- Local Ollama must be reachable at `OLLAMA_BASE_URL` or the default `http://localhost:11434` for model calls in `src/cli/hooks/useAgentStream.ts` and `src/context/compaction.ts`.
- The configured `OLLAMA_MODEL` or default `batiai/gemma4-e2b:q4` must exist in Ollama.

**Production:**
- No deployment target detected.
- Runtime is a local terminal CLI, not a hosted service.
- Session persistence writes to the user's home directory at `~/.chorus/sessions` via `src/session/storage.ts`.

---

*Stack analysis: 2026-05-13*
