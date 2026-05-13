# Conventions

## Naming
- React components use PascalCase filenames and exports.
- Hooks use `use*` names and live under `src/cli/hooks/`.
- Reducer actions are all-caps with underscore names.
- Tools end in `Tool`.
- Session-related types live in `src/session/types.ts`.

## State management
- `feedReducer.ts` is the canonical source of truth for transcript rendering state.
- Active turns are the only turns that accept streamed updates.
- Finalization marks the turn done and collapses thinking by default.
- `CLEAR_FEED` only clears the rendered transcript, not the persisted session unless the caller also clears history.

## UI conventions
- User messages are prefixed with `>`.
- Agent turns use a dot indicator and show tool calls before thinking blocks.
- `Tab` cycles either suggestions or focused expandable items.
- `Space` toggles the focused expandable item when the input is empty.
- Slash commands are surfaced through inline suggestions.
- Large pastes switch the input into a preview mode before submission.

## Safety conventions
- Filesystem tools are workspace-confined.
- Shell tools allow only a fixed command set and reject common path escapes.
- Session data is stored under the user home directory in `.chorus/sessions`.
- Model prompts remind the agent to stay inside the workspace.

## Type and implementation style
- The codebase uses explicit object shapes and local type aliases rather than deep abstraction.
- `any` casts are used where deepagents/LangChain types are awkward.
- Most file operations are synchronous in the session and filesystem layers.
- The implementation favors direct composition over framework-level wrappers.

## Known stylistic mismatch
- The docs/spec talk about a split-pane Blessed UI and richer context widgets, but the actual implementation is an Ink chat interface.
