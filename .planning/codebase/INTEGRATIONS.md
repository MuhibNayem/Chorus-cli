# External Integrations

**Analysis Date:** 2026-05-13

## APIs & External Services

**Local LLM Runtime:**
- Ollama - main chat model provider for the coding agent in `src/cli/hooks/useAgentStream.ts`.
  - SDK/Client: LangChain `initChatModel("ollama:${MODEL_NAME}")` from `langchain`.
  - Auth: none detected.
  - Configuration: `OLLAMA_BASE_URL`, `OLLAMA_MODEL`.
  - Default base URL: `http://localhost:11434` in `src/cli/hooks/useAgentStream.ts` and `src/context/compaction.ts`.
  - Default model: `batiai/gemma4-e2b:q4` in `src/cli/hooks/useAgentStream.ts`, `src/context/compaction.ts`, `src/cli/App.tsx`, and `src/cli/components/StatusBar.tsx`.

**Direct Ollama HTTP:**
- Ollama `/api/generate` - direct streaming helper used for conversation compaction in `src/context/compaction.ts` through `src/ollama/client.ts`.
  - SDK/Client: Node/Web `fetch`.
  - Auth: none detected.
  - Endpoint: `${OLLAMA_BASE_URL}/api/generate`.
  - Request shape: `{ model, prompt, stream: true }` in `src/ollama/client.ts`.

**Search:**
- Serper - internet search tool in `src/tools/web-search.ts`.
  - SDK/Client: Node/Web `fetch`.
  - Auth: `SERPER_API_KEY`.
  - Endpoint: `https://google.serper.dev/search`.
  - Registered tool: `internet_search` through `src/tools/index.ts`.
- Google Custom Search Engine - web search tool in `src/tools/web-search.ts`.
  - SDK/Client: Node/Web `fetch`.
  - Auth: `GOOGLE_CSE_API_KEY`, `GOOGLE_CSE_ID`.
  - Endpoint: `https://www.googleapis.com/customsearch/v1`.
  - Registered tool: `web_search` through `src/tools/index.ts`.

**Weather:**
- WeatherAPI - current weather lookup implementation in `src/tools/web-search.ts`.
  - SDK/Client: Node/Web `fetch`.
  - Auth: `WEATHER_API_KEY`.
  - Endpoint: `https://api.weatherapi.com/v1/current.json`.
  - Registration status: not registered in `allTools` or `webSearchTools` in `src/tools/index.ts`, so it is implemented but not available to the agent runtime.

**Agent Orchestration:**
- deepagents - local agent orchestration wrapper used in `src/cli/hooks/useAgentStream.ts`.
  - SDK/Client: `createDeepAgent` from `deepagents`.
  - Auth: none detected.
  - Uses local tool registry from `src/tools/index.ts` and subagent registry from `src/subagents/index.ts`.
- LangChain Ollama provider - model abstraction used in `src/cli/hooks/useAgentStream.ts`.
  - SDK/Client: `initChatModel` from `langchain`.
  - Auth: none detected.

## Data Storage

**Databases:**
- Not detected. No database driver, ORM, migration tooling, or database connection string usage found in `package.json` or `src/`.

**File Storage:**
- Local workspace filesystem - agent file tools read, write, edit, list, glob, and search within `process.cwd()` in `src/tools/filesystem.ts`.
- Local session storage - sessions and an index are stored as JSON under `~/.chorus/sessions` in `src/session/storage.ts`.
- Workspace debug log - `DEBUG=1` writes `debug.log` through `appendFileSync` in `src/cli/hooks/useAgentStream.ts`.

**Caching:**
- In-memory token encoder cache in `src/context/tokenizer.ts`.
- In-memory conversation state in `src/cli/hooks/useAgentStream.ts`.
- Session persistence to local JSON files through `src/session/manager.ts` and `src/session/storage.ts`.
- No Redis, Memcached, database cache, or browser/localStorage cache detected.

## Authentication & Identity

**Auth Provider:**
- Not detected.
  - Implementation: local CLI with no user login, authorization layer, OAuth, or API session management in `src/`.
  - External API authentication is key-based through environment variables in `src/tools/web-search.ts`.

## Monitoring & Observability

**Error Tracking:**
- None detected. No Sentry, OpenTelemetry, Datadog, or hosted error tracker integration found.

**Logs:**
- TUI-facing errors are dispatched to the feed by `SET_ERROR` in `src/cli/hooks/useAgentStream.ts`.
- Optional debug file logging writes JSON lines to `debug.log` when `DEBUG=1` in `src/cli/hooks/useAgentStream.ts`.
- Tool errors are returned as strings by `src/tools/filesystem.ts`, `src/tools/shell.ts`, `src/tools/git.ts`, and `src/tools/web-search.ts`.

## CI/CD & Deployment

**Hosting:**
- Not detected. The implementation is a local terminal CLI.

**CI Pipeline:**
- None detected. No GitHub Actions, GitLab CI, CircleCI, Dockerfile, or deployment config found in the scanned project files.

## Environment Configuration

**Required env vars:**
- `OLLAMA_BASE_URL`: optional; defaults to `http://localhost:11434` in `src/cli/hooks/useAgentStream.ts` and `src/context/compaction.ts`.
- `OLLAMA_MODEL`: optional; defaults to `batiai/gemma4-e2b:q4` in `src/cli/hooks/useAgentStream.ts`, `src/context/compaction.ts`, `src/cli/App.tsx`, and `src/cli/components/StatusBar.tsx`.
- `SERPER_API_KEY`: required for the registered `internet_search` tool in `src/tools/web-search.ts`.
- `GOOGLE_CSE_API_KEY`: required for the registered `web_search` tool in `src/tools/web-search.ts`.
- `GOOGLE_CSE_ID`: required for the registered `web_search` tool in `src/tools/web-search.ts`.
- `WEATHER_API_KEY`: required by `WeatherTool` in `src/tools/web-search.ts`, but the tool is not registered in `src/tools/index.ts`.
- `DEBUG`: optional; `DEBUG=1` enables `debug.log` writes in `src/cli/hooks/useAgentStream.ts`.
- `DISABLE_TODO_MIDDLEWARE`: optional; `DISABLE_TODO_MIDDLEWARE=1` clears deepagents middleware in `src/cli/hooks/useAgentStream.ts`.

**Secrets location:**
- `.env.example` exists but was not read because `.env*` files are treated as secret-bearing configuration.
- `src/index.ts` loads environment variables through `dotenv/config`; runtime secrets are expected in environment variables or a dotenv file.

## Webhooks & Callbacks

**Incoming:**
- None detected. There is no HTTP server or webhook route implementation in `src/`.

**Outgoing:**
- Ollama local HTTP calls to `${OLLAMA_BASE_URL}/api/generate` in `src/ollama/client.ts`.
- Serper search HTTP POST to `https://google.serper.dev/search` in `src/tools/web-search.ts`.
- Google CSE HTTP GET to `https://www.googleapis.com/customsearch/v1` in `src/tools/web-search.ts`.
- WeatherAPI HTTP GET to `https://api.weatherapi.com/v1/current.json` in `src/tools/web-search.ts`, but this path is not registered into the active tool registry.

## External Command Integrations

**Git:**
- `src/tools/git.ts` shells out to `git status`, `git diff`, `git log`, `git branch`, and `git commit`.
- Registered tools: `git_status`, `git_diff`, `git_log`, `git_branch`, `git_commit` in `src/tools/index.ts`.

**Shell:**
- `src/tools/shell.ts` shells out through `child_process.exec` with an allowlist of base commands and workspace path validation.
- Registered tool: `run_command` in `src/tools/index.ts`.
- Commands inherit process environment with `FORCE_COLOR=0`.

## Implementation vs Docs Mismatches

**Search Integrations:**
- `docs/SPEC.md` and `docs/PLAN.md` list Serper and Google CSE search.
- Implementation matches those two registered tools in `src/tools/web-search.ts` and `src/tools/index.ts`.
- Implementation also includes WeatherAPI in `src/tools/web-search.ts`, but it is not in the active tool registry.

**Ollama Integration:**
- `docs/SPEC.md` and `docs/PLAN.md` describe direct Ollama streaming with inline `<|think|>` parsing and `gemma:2b`.
- Runtime agent path uses LangChain + deepagents with `initChatModel("ollama:${MODEL_NAME}")` in `src/cli/hooks/useAgentStream.ts`.
- Runtime extracts thinking from `additional_kwargs.reasoning_content` or `additional_kwargs.thinking`, not inline `<|think|>` tokens.
- Direct `/api/generate` streaming remains only for compaction in `src/context/compaction.ts`.

**TUI Integration:**
- `docs/SPEC.md` and `docs/PLAN.md` describe Blessed.
- Implementation uses Ink/React and has no `blessed` dependency in `package.json`.

---

*Integration audit: 2026-05-13*
