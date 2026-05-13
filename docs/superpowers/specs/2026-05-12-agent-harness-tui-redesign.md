# Agent Harness TUI Redesign + Gemma4 Integration

**Date:** 2026-05-12  
**Status:** Approved  
**Scope:** Replace blessed-based split-pane TUI with Ink (React for CLI) scrolling-feed design; integrate `batiai/gemma4-e2b:q4` with correct thinking-token extraction and reliable tool-call streaming.

---

## 1. Problem Statement

The current TUI has two independent problems:

1. **Broken UX** — four static blessed boxes (THINKING, RESPONSE, TOOL LOG, context bar) feel like a log viewer, not an agent harness. Thinking content never renders (wrong token delimiters). Response and tool log have no turn separation, no status feedback, no expand/collapse.

2. **Broken stream extraction** — the think-parser looks for `<|channel>thought\n` delimiters that Gemma4/Ollama never emit. Thinking is surfaced by Ollama via `additional_kwargs.thinking`, not inline tokens. The chunk extractor only checks `chunk.messages` (top-level) but LangGraph streams `{ node_name: state_delta }`, so messages sit under a dynamic key.

---

## 2. Goals

- Scrolling conversation feed (Claude Code / Hermes Agent style)
- Thinking blocks: collapsed by default (`▶ Thinking… 1.2s`), expandable with `Space`/`Enter`
- Tool call cards: compact one-liner by default, expandable to full args + result
- Single bottom status bar: model · agent state dot · context token bar
- Correct extraction of Gemma4 thinking (`additional_kwargs.thinking`) and response (`AIMessage.content`)
- Reliable tool-call handling across Ollama versions (post-stream fallback for streaming parse bugs)

---

## 3. Architecture

### 3.1 Framework swap

| Before | After |
|--------|-------|
| `blessed` | `ink` + `ink-text-input` + `@inkjs/ui` |
| Imperative `box.setContent()` + `screen.render()` | React `useState` / `useReducer` → automatic re-render |
| Manual scroll management | Ink `<Static>` for history + live box for current turn |

`src/index.ts` shrinks to ~10 lines:
```ts
import { render } from "ink";
import React from "react";
import { App } from "./cli/App.js";
render(<App />);
```

### 3.2 State model

```ts
type FeedEntry =
  | { kind: "user";   id: string; text: string }
  | { kind: "turn";   id: string; thinking: ThinkState; tokens: string[]; toolCalls: ToolCard[]; done: boolean }
  | { kind: "error";  id: string; message: string }

type ThinkState = { text: string; durationMs?: number; expanded: boolean }
type ToolCard   = { id: string; name: string; args: unknown; result?: string; status: "running"|"done"|"error"; expanded: boolean }
```

### 3.3 Reducer actions

```
APPEND_USER          — push UserMessage entry, start AgentTurn
APPEND_THINK_TOKEN   — append to current turn's thinking.text
APPEND_RESPONSE_TOKEN — append to current turn's tokens[]
ADD_TOOL_CALL        — push ToolCard to current turn
UPDATE_TOOL_CALL     — set result/status on a ToolCard by id
FINALIZE_TURN        — mark turn done=true, set thinking.durationMs
TOGGLE_EXPANDED      — flip expanded on a ThinkState or ToolCard by id
SET_ERROR            — push ErrorEntry
```

---

## 4. Component Tree

```
<App>                        owns feed state (useReducer) + agent session
  <Feed>                     scrollable area, flex:1
    <Static items={doneTurns}>
      <UserMessage />
      <AgentTurn done />
    </Static>
    <AgentTurn live />        current in-progress turn only
      <ThinkingBlock />       collapsed header or expanded stream text
      <ResponseText />        token stream, appended in place
      <ToolCard />            one per tool call
  <InputBox />                ink-text-input, locked while processing
  <StatusBar />               1 line: model · state dot · CTX bar
```

**`<Static>` usage is the key performance decision.** Completed turns are frozen — Ink never re-renders them. Only the live `AgentTurn` updates on every token. Without this, long sessions would slow exponentially.

### 4.1 ThinkingBlock

- Collapsed state: `{grey}▶ Thinking… (1.2s){/grey}` — single line
- Expanded state: full thinking text in `{italic}{grey}` with `▼ Thinking (1.2s)` header
- Toggle: `Tab` moves focus between expandable items; `Space` or `Enter` toggles

### 4.2 ToolCard

- Default: `⚙ {bold}tool_name{/bold}({truncatedArgs})  {grey}✓ 34ms{/grey}  {cyan}[expand]{/cyan}`
- Expanded: adds indented block showing full args JSON + result (truncated to 40 lines)
- Status colors: cyan=running (spinner), green=done, red=error

### 4.3 StatusBar (1 line, bottom)

```
 batiai/gemma4-e2b:q4  ● Thinking…   CTX 12%  ████░░░░░░░░░░░░░░░░  12.4K / 128K
```

- State dot: cyan=thinking, yellow=tool running, green=idle, red=error
- CTX bar: green < 50%, yellow < 80%, red ≥ 80%

---

## 5. Gemma4 Stream Integration

### 5.1 Model config

`.env.example` default: `OLLAMA_MODEL=batiai/gemma4-e2b:q4`  
`initChatModel(`ollama:${MODEL_NAME}`, { baseUrl })` — no other change needed at the LangChain layer.

### 5.2 Thinking extraction

Ollama intercepts `<|think|>` in the system prompt and surfaces reasoning via `additional_kwargs.thinking` on the AIMessage — it is **not** emitted as inline content tokens. The `think-parser.ts` file is deleted.

New extraction in `useAgentStream.ts`:
```ts
for (const nodeOutput of Object.values(chunk)) {
  const msgs = (nodeOutput as any)?.messages ?? [];
  for (const msg of msgs) {
    const msgType = msg?.id?.[2] ?? msg?.type ?? msg?.role ?? "";
    if (msgType !== "AIMessage" && msgType !== "ai" && msgType !== "assistant") continue;

    // Thinking (Ollama surfaces this separately from content)
    const thinking: string | undefined =
      msg?.kwargs?.additional_kwargs?.thinking ?? msg?.additional_kwargs?.thinking;
    if (thinking?.trim()) dispatch({ type: "APPEND_THINK_TOKEN", text: thinking });

    // Response content
    const content: string | undefined = msg?.kwargs?.content ?? msg?.content;
    if (content?.trim()) dispatch({ type: "APPEND_RESPONSE_TOKEN", text: content });
  }
}
```

### 5.3 Tool call streaming fallback

Ollama ≤ 0.20.6 drops `tool_calls` when streaming. Mitigation: after the stream `for await` loop ends, check if the last AIMessage's `additional_kwargs.tool_calls` contains calls that were not already dispatched. If so, process them synchronously before finalizing the turn. This makes tool execution reliable across Ollama versions.

### 5.4 Reasoning suppression escape hatch

DeepAgents GitHub issue #2445 documents that `TodoListMiddleware` + large system prompt suppresses reasoning for gemma4:26b. The e2b variant is unaffected in current testing, but add env flag support:

```ts
// In createDeepAgent call — skip todoListMiddleware if flag set
const middleware = process.env.DISABLE_TODO_MIDDLEWARE === "1"
  ? customMiddleware
  : undefined; // deepagents default includes it
```

### 5.5 Compaction fix

`src/context/compaction.ts` hardcodes `SUMMARIZE_MODEL = "gemma:4:latest"`. Change to read `process.env.OLLAMA_MODEL ?? "batiai/gemma4-e2b:q4"` so compaction uses the same model as the agent.

---

## 6. File Changes

### Remove
```
src/cli/panes/ContextBar.ts
src/cli/panes/InputPane.ts
src/cli/panes/OutputPane.ts
src/cli/panes/ToolLogPane.ts
src/cli/widgets/ProgressBar.ts
src/ollama/think-parser.ts
```

### Create
```
src/cli/App.tsx
src/cli/components/Feed.tsx
src/cli/components/UserMessage.tsx
src/cli/components/AgentTurn.tsx
src/cli/components/ThinkingBlock.tsx
src/cli/components/ToolCard.tsx
src/cli/components/InputBox.tsx
src/cli/components/StatusBar.tsx
src/cli/state/feedReducer.ts
src/cli/hooks/useAgentStream.ts
```

### Modify
```
src/index.ts              — render(<App />) only
src/context/compaction.ts — fix hardcoded model
package.json              — swap blessed for ink deps
tsconfig.json             — add "jsx": "react-jsx"
.env.example              — OLLAMA_MODEL=batiai/gemma4-e2b:q4
```

### Unchanged
```
src/tools/
src/subagents/
src/prompts/system.ts
src/context/tokenizer.ts
src/ollama/client.ts
```

---

## 7. Package Changes

**Remove:** `blessed`, `@types/blessed`

**Add:**
```json
"ink": "^5.0.0",
"ink-text-input": "^6.0.0",
"@inkjs/ui": "^2.0.0",
"@types/react": "^18.0.0",
"react": "^18.0.0"
```

**`tsconfig.json` additions:**
```json
{
  "compilerOptions": {
    "jsx": "react-jsx",
    "moduleResolution": "bundler"
  }
}
```

---

## 8. Out of Scope

- Subagent visual delegation (nested turn rendering) — future work
- Mouse-click expand/collapse — keyboard only for now
- Conversation persistence / session reload
- Image/multimodal input (Gemma4 supports it; TUI does not)
