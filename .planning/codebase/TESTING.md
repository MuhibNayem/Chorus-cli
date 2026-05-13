# Testing

## Current coverage
- `tests/feedReducer.test.ts` covers the reducer state machine.
- The tests validate:
  - appending user messages and turn entries
  - thinking token accumulation
  - response token accumulation
  - tool-call add/update behavior
  - turn finalization
  - expand/collapse toggles
  - error entry handling

## What is not covered
- No tests for the Ink UI components.
- No tests for session persistence.
- No tests for slash command routing.
- No tests for filesystem, shell, git, or web tools.
- No tests for compaction behavior.
- No tests for Ollama streaming.
- No integration tests for `deepagents` or subagent selection.

## Build/runtime status
- `npm test` could not run in this environment because `vitest` is not installed locally.
- `npm run build` could not run in this environment because `tsc` is not installed locally.
- The project therefore needs dependency installation before the current checks are meaningful.

## Recommended test focus
- Reducer regression tests for edge cases around active turn selection and finalization.
- Session manager tests for naming, persistence, and workspace filtering.
- Slash command tests for `/resume`, `/clear`, `/compact`, and `/session rename`.
- Tool safety tests for workspace boundary enforcement.
- A stream harness test for `useAgentStream` that mocks LangChain/deepagents.
