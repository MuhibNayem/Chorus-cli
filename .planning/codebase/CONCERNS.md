# Codebase Concerns

**Analysis Date:** 2026-05-13

## Tech Debt

**Spec and implementation are materially divergent:**
- Issue: `docs/SPEC.md` describes a Blessed split-pane TUI, `Ctrl+D` submission, `Esc` interruption, separate tool log pane, `gemma:2b`, and a separate summarization model. The implementation uses Ink, Enter-driven submission through `src/cli/App.tsx`, immediate `Ctrl+C` exit, no agent interruption path, and the same configurable model for agent and compaction.
- Files: `docs/SPEC.md:5`, `docs/SPEC.md:11`, `docs/SPEC.md:82`, `docs/SPEC.md:129`, `docs/SPEC.md:159`, `src/cli/App.tsx:2`, `src/cli/App.tsx:132`, `src/cli/App.tsx:223`, `src/context/compaction.ts:7`
- Impact: Future work planned from the spec can implement against the wrong UI framework and expected behavior. Reliable use is also affected because documented interrupt and mid-stream quit confirmation behavior is not present.
- Fix approach: Treat current Ink behavior as the source of truth or update the implementation to match the spec. In either case, align keybindings, model names, compaction behavior, and TUI layout in `docs/SPEC.md` before planning new CLI features.

**Subagent tool capabilities do not match prompts/spec:**
- Issue: The planner and builder subagents only receive `gitTools`, while their prompts/spec say they can use file and restricted shell tools. The VAPT subagent only receives web search tools, while its prompt/spec says it can run security shell tools.
- Files: `src/subagents/planner.ts:5`, `src/subagents/builder.ts:5`, `src/subagents/vapt.ts:5`, `src/prompts/system.ts:119`, `src/prompts/system.ts:137`, `docs/SPEC.md:40`, `docs/SPEC.md:46`, `docs/SPEC.md:52`
- Impact: Delegated tasks can fail or underperform because subagents are instructed to use capabilities they do not actually have. Builder cannot edit files, planner cannot inspect files, and VAPT cannot scan locally despite the interface promising these behaviors.
- Fix approach: Decide the intended privilege model per subagent, then make `src/subagents/*.ts`, `src/prompts/system.ts`, and `docs/SPEC.md` consistent. Prefer explicit narrow tool sets over broad prompt promises.

**Compaction constants are misleading and partly unused:**
- Issue: `KEEP_RECENT_TOKENS` is exported but not used; compaction keeps the last 20 messages regardless of token size. The spec says compaction keeps the most recent 28K tokens and uses a separate summarization model.
- Files: `src/context/compaction.ts:5`, `src/context/compaction.ts:27`, `src/context/compaction.ts:51`, `docs/SPEC.md:82`
- Impact: Long high-token messages can leave the context too large after compaction, while many short messages may discard more history than necessary. Operators cannot rely on the documented 28K-token retention behavior.
- Fix approach: Implement token-budgeted recent-message selection using `KEEP_RECENT_TOKENS`, persist whether a compaction occurred, and document the actual summarization model behavior.

## Known Bugs

**Assistant response history can be lost after streaming:**
- Symptoms: During streaming, response tokens are rendered from `AIMessageChunk` content, but only `lastAIMsg.content` from update messages is persisted to `messagesRef`. If update messages do not contain the final text in the expected shape, the visible assistant response is not saved into session history.
- Files: `src/cli/hooks/useAgentStream.ts:110`, `src/cli/hooks/useAgentStream.ts:143`, `src/cli/hooks/useAgentStream.ts:197`, `src/session/manager.ts:45`
- Trigger: Any provider/deepagents stream where the final update message omits content or only streams content through message chunks.
- Workaround: None in code. Accumulate streamed response text locally and save that fallback when `lastAIMsg.content` is empty.

**Tool-call fallback for streamed Ollama tool calls is incomplete:**
- Symptoms: The project note in `docs/superpowers/specs/2026-05-12-agent-harness-tui-redesign.md` states Ollama can drop `tool_calls` while streaming and requires a post-stream fallback. The implementation records `lastAIMsg` but only reads `msg.tool_calls`; it does not inspect `additional_kwargs.tool_calls` after the stream before finalizing the turn.
- Files: `docs/superpowers/specs/2026-05-12-agent-harness-tui-redesign.md:150`, `src/cli/hooks/useAgentStream.ts:93`, `src/cli/hooks/useAgentStream.ts:162`, `src/cli/hooks/useAgentStream.ts:195`
- Trigger: Ollama versions or LangChain adapters that place tool calls in `additional_kwargs.tool_calls` after streaming.
- Workaround: Set `DISABLE_TODO_MIDDLEWARE=1` only avoids one middleware path; it does not restore missing streamed tool calls.

**Test suite is stale against the reducer state shape:**
- Symptoms: `tests/feedReducer.test.ts` expects `turn.tokens`, `turn.toolCalls`, and `turn.thinking`, but `src/cli/state/feedReducer.ts` now stores ordered `events`. These tests are no longer meaningful for the current reducer and will fail once dependencies are installed.
- Files: `tests/feedReducer.test.ts:18`, `tests/feedReducer.test.ts:38`, `tests/feedReducer.test.ts:65`, `tests/feedReducer.test.ts:82`, `src/cli/state/feedReducer.ts:20`, `src/cli/state/feedReducer.ts:34`
- Trigger: Running `npm test` in a dependency-installed checkout.
- Workaround: None. Rewrite the tests to assert `events` entries and current thinking/tool/response behavior.

**Current checkout cannot run verification without installing dependencies:**
- Symptoms: `npm test` fails with `vitest: not found`; `npm run build` fails with `tsc: not found`.
- Files: `package.json:6`, `package.json:8`, `package.json:25`
- Trigger: Running verification in the current workspace before `npm install`.
- Workaround: Run `npm install` from `package-lock.json` before local verification.

## Security Considerations

**Shell allowlist is bypassable because commands execute through a shell string:**
- Risk: `run_command` checks only the first whitespace token, then passes the full command string to `exec`. Shell metacharacters, command chaining, command substitution, language runtimes (`node`, `python`, `tsx`), package managers, `curl`, and `wget` can execute behavior outside the intended narrow command allowlist.
- Files: `src/tools/shell.ts:11`, `src/tools/shell.ts:58`, `src/tools/shell.ts:75`, `src/tools/shell.ts:138`, `src/tools/shell.ts:149`
- Current mitigation: Base command allowlist, path token checks, workspace `cwd`, 60-second timeout, and selected absolute-path blocking.
- Recommendations: Replace `exec(command)` with `spawn`/`execFile` over parsed argv and reject shell control operators. Consider per-command argument schemas instead of a generic command string. Remove or isolate general-purpose runtimes and package managers from agent-exposed commands unless explicit user approval exists.

**Git commit message is shell-interpolated:**
- Risk: `git_commit` interpolates user/model-controlled text into `git commit -m "${message}"`. A quote or shell substitution in the message can alter the shell command executed by `exec`.
- Files: `src/tools/git.ts:8`, `src/tools/git.ts:66`
- Current mitigation: Zod validates the value is a string only.
- Recommendations: Use `execFile("git", ["commit", "-m", message])` or reuse a non-shell command runner. Apply the same pattern to any future git command with user-provided arguments.

**Workspace confinement does not resolve symlinks:**
- Risk: File tools validate lexical paths with `path.resolve`, but reads and writes follow symlinks. A symlink inside the workspace pointing outside the workspace can let `file_read`, `file_write`, `file_edit`, and `search_files` access external files.
- Files: `src/tools/filesystem.ts:12`, `src/tools/filesystem.ts:23`, `src/tools/filesystem.ts:41`, `src/tools/filesystem.ts:62`, `src/tools/filesystem.ts:148`
- Current mitigation: Prefix check against the resolved path string.
- Recommendations: Use `fs.realpathSync` on existing paths and parent directories, reject symlinks for write/edit/search unless explicitly allowed, and add tests for symlink escapes.

**Secret-bearing workspace files can be exposed to the model:**
- Risk: `@mention` indexing includes dotfiles and excludes only `node_modules`, `.git`, and lockfiles. File tools and grep also do not filter `.env`, `.npmrc`, credentials, private keys, or ignored files. The repo currently has `.env.example` only, but the code would include real `.env` files when present.
- Files: `src/cli/App.tsx:18`, `src/cli/App.tsx:21`, `src/cli/App.tsx:24`, `src/cli/App.tsx:46`, `src/tools/filesystem.ts:23`, `src/tools/filesystem.ts:124`, `src/tools/filesystem.ts:148`
- Current mitigation: `.git` and `node_modules` are skipped in some paths. No secret denylist is enforced.
- Recommendations: Add a centralized denylist for `.env*`, `.npmrc`, keys, certificates, credential files, and gitignored secret patterns. Apply it consistently to file tools, grep, glob, and mention expansion.

**Session files persist full conversations outside the workspace without redaction:**
- Risk: Full prompts, `@mention` file contents, tool outputs, and potentially secrets are written to `~/.chorus/sessions`. The storage layer does not redact sensitive content or set restrictive file permissions.
- Files: `src/session/storage.ts:6`, `src/session/storage.ts:20`, `src/session/storage.ts:47`, `src/session/manager.ts:45`, `src/cli/hooks/useAgentStream.ts:202`
- Current mitigation: Atomic temp-file rename prevents partial writes, and sessions are scoped by workspace metadata.
- Recommendations: Store sessions with `0600` file permissions, redact known secret patterns before persistence, provide a session purge command, and document that session history may contain source and tool output.

**Debug logging can leak prompts and errors into `debug.log`:**
- Risk: `DEBUG=1` writes submitted prompt previews and error stacks to a workspace `debug.log` file. This file is not ignored by code and could be committed accidentally.
- Files: `src/cli/hooks/useAgentStream.ts:17`, `src/cli/hooks/useAgentStream.ts:41`, `src/cli/hooks/useAgentStream.ts:212`
- Current mitigation: Logging is gated behind `DEBUG=1`.
- Recommendations: Add `debug.log` to `.gitignore`, redact prompt content and stack traces, or route debug logs to the session directory with restrictive permissions.

## Performance Bottlenecks

**Workspace file index is eagerly loaded and includes many dotfiles:**
- Problem: `globSync("**/*")` runs on mount across the entire workspace and includes dotfiles. Large repos can delay initial render and produce noisy mention suggestions.
- Files: `src/cli/App.tsx:18`, `src/cli/App.tsx:21`, `src/cli/App.tsx:69`, `src/cli/App.tsx:112`
- Cause: Synchronous whole-repo globbing in the React component lifecycle.
- Improvement path: Build the index lazily or asynchronously, cap indexed file count, respect `.gitignore`, skip hidden/secret paths by default, and refresh incrementally.

**Search tool recursively reads every matching file synchronously:**
- Problem: `search_files` walks directories recursively and `readFileSync`s every regular file except `node_modules` and `.git`, then builds regexes inside the file loop.
- Files: `src/tools/filesystem.ts:148`, `src/tools/filesystem.ts:154`, `src/tools/filesystem.ts:163`, `src/tools/filesystem.ts:179`
- Cause: In-process synchronous traversal and file reads with no file-size cap, binary detection, timeout, or cancellation.
- Improvement path: Use `ripgrep` or an async bounded traversal, skip ignored and binary/large files, add a result and time budget, and compile the regex once.

**Agent object is recreated for every submitted message:**
- Problem: `initChatModel` and `createDeepAgent` are called inside every `submit`.
- Files: `src/cli/hooks/useAgentStream.ts:59`, `src/cli/hooks/useAgentStream.ts:72`, `src/cli/hooks/useAgentStream.ts:82`
- Cause: The hook does not memoize model/agent construction across turns.
- Improvement path: Memoize model and agent per model/base URL/session configuration, while keeping messages in `messagesRef`.

## Fragile Areas

**Streaming event parsing depends on provider-specific message shapes:**
- Files: `src/cli/hooks/useAgentStream.ts:97`, `src/cli/hooks/useAgentStream.ts:103`, `src/cli/hooks/useAgentStream.ts:127`, `src/cli/hooks/useAgentStream.ts:143`, `src/cli/hooks/useAgentStream.ts:152`
- Why fragile: The parser manually checks several `type`/`role` strings and selected fields. LangChain/deepagents/Ollama shape changes can silently drop tokens, thinking text, or tool results.
- Safe modification: Add fixture-based tests around representative `agent.stream` chunks before changing stream handling. Centralize chunk normalization into a pure function.
- Test coverage: No tests cover `useAgentStream`, provider chunk normalization, tool-call fallback, thinking extraction, or session persistence.

**Reducer and UI event model changed without matching tests:**
- Files: `src/cli/state/feedReducer.ts:20`, `src/cli/components/AgentTurn.tsx:1`, `tests/feedReducer.test.ts:18`
- Why fragile: The ordered `events` model is central to rendering thinking, tool calls, and responses, but the test suite still describes the old parallel-field model.
- Safe modification: Update tests first to cover event ordering, finalization, expansion, and tool result updates.
- Test coverage: Existing tests are stale and there are no component tests for `Feed`, `AgentTurn`, or `ToolCard`.

**Slash command and submit behavior is concentrated in one large component:**
- Files: `src/cli/App.tsx:57`, `src/cli/App.tsx:103`, `src/cli/App.tsx:112`, `src/cli/App.tsx:132`, `src/cli/App.tsx:223`
- Why fragile: Input handling, suggestions, session resume/new, mention expansion, slash commands, and submit orchestration all live in `App`. Small keybinding changes can affect unrelated behavior.
- Safe modification: Extract pure helpers for suggestions, mention expansion, and key handling. Add tests for slash-command interception and mention expansion before changing input behavior.
- Test coverage: No tests cover `App` input routing, suggestions, session resume flow, or paste preview behavior.

## Scaling Limits

**Context compaction threshold assumes a 128K context window:**
- Current capacity: Compaction starts at 100,000 tokens.
- Limit: The default model is `batiai/gemma4-e2b:q4`, while `docs/SPEC.md` describes `gemma:2b` with 128K context. The code does not query the actual model context length, so models with smaller windows can fail before compaction.
- Scaling path: Make context window configurable per model, compute a safe threshold from that value, and show the configured limit in `StatusBar`.
- Files: `src/context/compaction.ts:4`, `src/cli/components/StatusBar.tsx:4`, `docs/SPEC.md:12`, `docs/SPEC.md:76`

**Session index is a single JSON file with last-write-wins updates:**
- Current capacity: All session metadata is stored in one `index.json` file.
- Limit: Concurrent CLI instances can overwrite each other's session metadata because `saveSession` loads and rewrites the whole index without locking.
- Scaling path: Add file locking or append-only session metadata updates, and handle corrupt index recovery explicitly.
- Files: `src/session/storage.ts:12`, `src/session/storage.ts:26`, `src/session/storage.ts:47`, `src/session/storage.ts:60`

## Dependencies at Risk

**Deepagents and LangChain stream/tool APIs are used through `any` casts:**
- Risk: Type mismatches between `deepagents`, `langchain`, and `@langchain/core` can compile while breaking at runtime.
- Impact: Tool calls, subagent wiring, and stream chunk parsing are core CLI paths; a dependency update can break them without TypeScript catching it.
- Migration plan: Remove `as any` around `allTools`, `allSubagents`, and stream options where possible. Add integration tests with a mocked stream and pin compatible package versions.
- Files: `src/cli/hooks/useAgentStream.ts:72`, `src/cli/hooks/useAgentStream.ts:84`, `src/subagents/planner.ts:5`, `src/subagents/vapt.ts:5`, `src/subagents/builder.ts:5`, `package.json:14`

**No Node engine or package manager version is declared:**
- Risk: The code assumes modern Node globals and ESM behavior, including global `fetch` and `crypto.randomUUID`.
- Impact: Running under older Node versions can fail at startup or during web/Ollama calls.
- Migration plan: Add an `engines.node` requirement in `package.json`, document the package manager, and keep `package-lock.json` as the authoritative install source.
- Files: `package.json:1`, `src/session/manager.ts:11`, `src/tools/web-search.ts:14`, `src/ollama/client.ts:18`

## Missing Critical Features

**No real interrupt/cancel path for long-running agent turns:**
- Problem: The spec promises `Esc` interruption, but the implementation only dismisses suggestions on `Esc`; while processing, input is disabled and no abort signal is passed to the model stream or tool execution.
- Blocks: Users cannot reliably stop long model streams or tool calls without exiting the CLI.
- Files: `docs/SPEC.md:167`, `src/cli/App.tsx:132`, `src/cli/App.tsx:294`, `src/cli/hooks/useAgentStream.ts:84`, `src/tools/shell.ts:149`

**No permission boundary for write, shell, git, or network tools:**
- Problem: The main agent receives all filesystem, shell, git, and web tools by default; there is no user confirmation for writes, commits, package installs, network calls, or command execution.
- Blocks: Reliable use in sensitive repositories because model mistakes can modify files, commit staged changes, send network requests, or run package manager scripts without an approval step.
- Files: `src/tools/index.ts:5`, `src/tools/index.ts:12`, `src/tools/filesystem.ts:41`, `src/tools/shell.ts:138`, `src/tools/git.ts:66`, `src/tools/web-search.ts:14`

**No `.gitignore` is present for generated local artifacts:**
- Problem: The repo has no `.gitignore`, while runtime can create `dist/`, `node_modules/`, `debug.log`, and local session-adjacent artifacts.
- Blocks: Clean development workflows and raises accidental commit risk for generated files.
- Files: `package.json:6`, `src/cli/hooks/useAgentStream.ts:22`

## Test Coverage Gaps

**Tool security boundaries are untested:**
- What's not tested: Shell metacharacter rejection, symlink escapes, secret-file denylist, workspace traversal, git message injection, and command timeout behavior.
- Files: `src/tools/shell.ts`, `src/tools/filesystem.ts`, `src/tools/git.ts`
- Risk: The highest-risk local execution paths can regress without failing tests.
- Priority: High

**Streaming and session persistence are untested:**
- What's not tested: Response accumulation, thinking extraction, tool-call dispatch/update, fallback tool calls, compaction, autosave, resume, and clear/new session behavior.
- Files: `src/cli/hooks/useAgentStream.ts`, `src/context/compaction.ts`, `src/session/manager.ts`, `src/session/storage.ts`
- Risk: Users can lose conversation history, lose tool execution visibility, or hit context failures without detection.
- Priority: High

**CLI input and rendering are untested:**
- What's not tested: Slash command routing, `@mention` expansion, suggestion selection, paste preview, focused expansion, `Ctrl+C`, and `Esc` behavior.
- Files: `src/cli/App.tsx`, `src/cli/commands.ts`, `src/cli/components/InputBox.tsx`, `src/cli/components/Feed.tsx`
- Risk: User-facing workflows can break while reducer-only tests remain green.
- Priority: Medium

**External integrations are untested:**
- What's not tested: Ollama streaming errors, missing API keys, Google CSE/Serper response shapes, weather response errors, and timeout behavior.
- Files: `src/ollama/client.ts`, `src/tools/web-search.ts`
- Risk: Integration failures surface only during manual use.
- Priority: Medium

---

*Concerns audit: 2026-05-13*
