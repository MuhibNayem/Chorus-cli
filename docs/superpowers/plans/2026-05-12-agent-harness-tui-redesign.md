# Agent Harness TUI Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the blessed split-pane TUI with an Ink (React-for-CLI) scrolling conversation feed with collapsible thinking blocks, expandable tool cards, and correct Gemma4 thinking/tool-call stream extraction.

**Architecture:** `useReducer` owns a `FeedEntry[]` array; the agent stream dispatches actions into it; Ink's `<Static>` freezes completed turns so only the live turn re-renders on every token. Gemma4 thinking comes from `additional_kwargs.thinking` on AIMessage chunks, not inline tokens.

**Tech Stack:** TypeScript 5, React 18, Ink 5, ink-text-input 6, @inkjs/ui 2, deepagents 1.10, LangChain 1.4, Ollama, vitest (reducer tests)

---

## File Map

| Action | Path | Responsibility |
|--------|------|----------------|
| Create | `src/cli/state/feedReducer.ts` | FeedEntry types + reducer + actions |
| Create | `src/cli/components/StatusBar.tsx` | Bottom 1-line bar: model · state · CTX |
| Create | `src/cli/components/UserMessage.tsx` | User turn row |
| Create | `src/cli/components/ThinkingBlock.tsx` | Collapsed/expanded thinking |
| Create | `src/cli/components/ToolCard.tsx` | Compact/expanded tool call card |
| Create | `src/cli/components/AgentTurn.tsx` | Agent turn: thinking + response + tools |
| Create | `src/cli/components/Feed.tsx` | Static history + live turn |
| Create | `src/cli/components/InputBox.tsx` | ink-text-input wrapper |
| Create | `src/cli/hooks/useAgentStream.ts` | Consumes agent.stream(), dispatches actions |
| Create | `src/cli/App.tsx` | Root component: reducer + session |
| Create | `src/cli/index.ts` | Re-export App for index.ts |
| Create | `tests/feedReducer.test.ts` | Reducer unit tests |
| Modify | `src/index.ts` | Replace blessed bootstrap with render(<App />) |
| Modify | `src/context/compaction.ts` | Fix hardcoded model name |
| Modify | `package.json` | Swap blessed → ink deps; add vitest |
| Modify | `tsconfig.json` | Add jsx: react-jsx |
| Modify | `.env.example` | Update OLLAMA_MODEL |
| Delete | `src/cli/panes/ContextBar.ts` | Replaced |
| Delete | `src/cli/panes/InputPane.ts` | Replaced |
| Delete | `src/cli/panes/OutputPane.ts` | Replaced |
| Delete | `src/cli/panes/ToolLogPane.ts` | Replaced |
| Delete | `src/cli/widgets/ProgressBar.ts` | Replaced |
| Delete | `src/ollama/think-parser.ts` | Wrong delimiters; Ollama handles internally |

---

## Task 1: Package config + TypeScript JSX

**Files:**
- Modify: `package.json`
- Modify: `tsconfig.json`

- [ ] **Step 1: Update package.json**

Replace the full file with:

```json
{
  "name": "deep-agent-cli",
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "dev": "tsx src/index.ts",
    "build": "tsc",
    "start": "node dist/index.js",
    "test": "vitest run"
  },
  "dependencies": {
    "@inkjs/ui": "^2.0.0",
    "@langchain/core": "^1.1.46",
    "@langchain/langgraph": "^1.3.0",
    "@langchain/ollama": "^1.2.7",
    "deepagents": "^1.10.1",
    "dotenv": "^16.4.0",
    "glob": "^13.0.6",
    "ink": "^5.0.0",
    "ink-text-input": "^6.0.0",
    "langchain": "^1.4.0",
    "react": "^18.0.0",
    "tiktoken": "^1.0.0",
    "zod": "^3.23.0"
  },
  "devDependencies": {
    "@types/node": "^22.0.0",
    "@types/react": "^18.0.0",
    "tsx": "^4.19.0",
    "typescript": "^5.7.0",
    "vitest": "^2.0.0"
  }
}
```

- [ ] **Step 2: Update tsconfig.json**

Replace with:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "lib": ["ES2022"],
    "outDir": "./dist",
    "rootDir": "./src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "declaration": true,
    "jsx": "react-jsx"
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist"]
}
```

- [ ] **Step 3: Install dependencies**

```bash
cd /Users/a.k.mmuhibullahnayem/Developer/R\&D/deep-agent-cli && npm install
```

Expected: `added N packages` with no errors. `blessed` and `@types/blessed` are no longer listed.

- [ ] **Step 4: Verify tsc config is valid**

```bash
cd /Users/a.k.mmuhibullahnayem/Developer/R\&D/deep-agent-cli && npx tsc --noEmit 2>&1 | head -20
```

Expected: errors about missing new files (fine), but no config-level errors like "Unknown compiler option 'jsx'".

- [ ] **Step 5: Commit**

```bash
cd /Users/a.k.mmuhibullahnayem/Developer/R\&D/deep-agent-cli && git add package.json tsconfig.json package-lock.json && git commit -m "chore: swap blessed for ink, add react + vitest"
```

---

## Task 2: Feed state types

**Files:**
- Create: `src/cli/state/feedReducer.ts`

- [ ] **Step 1: Create directory and file**

```bash
mkdir -p /Users/a.k.mmuhibullahnayem/Developer/R\&D/deep-agent-cli/src/cli/state
```

Create `src/cli/state/feedReducer.ts`:

```ts
export type ThinkState = {
  text: string;
  durationMs?: number;
  expanded: boolean;
};

export type ToolCard = {
  id: string;
  name: string;
  args: unknown;
  result?: string;
  status: "running" | "done" | "error";
  expanded: boolean;
};

export type FeedEntry =
  | { kind: "user"; id: string; text: string }
  | {
      kind: "turn";
      id: string;
      thinking: ThinkState;
      tokens: string[];
      toolCalls: ToolCard[];
      done: boolean;
      startedAt: number;
    }
  | { kind: "error"; id: string; message: string };

export type FeedAction =
  | { type: "APPEND_USER"; id: string; text: string }
  | { type: "APPEND_THINK_TOKEN"; text: string }
  | { type: "APPEND_RESPONSE_TOKEN"; text: string }
  | { type: "ADD_TOOL_CALL"; toolCall: Omit<ToolCard, "expanded"> }
  | { type: "UPDATE_TOOL_CALL"; id: string; result: string; status: "done" | "error" }
  | { type: "FINALIZE_TURN" }
  | { type: "TOGGLE_EXPANDED"; id: string }
  | { type: "SET_ERROR"; id: string; message: string };

export interface FeedState {
  entries: FeedEntry[];
  processing: boolean;
}

export const initialFeedState: FeedState = {
  entries: [],
  processing: false,
};

export function feedReducer(state: FeedState, action: FeedAction): FeedState {
  switch (action.type) {
    case "APPEND_USER": {
      const userEntry: FeedEntry = { kind: "user", id: action.id, text: action.text };
      const turnEntry: FeedEntry = {
        kind: "turn",
        id: `turn-${action.id}`,
        thinking: { text: "", expanded: false },
        tokens: [],
        toolCalls: [],
        done: false,
        startedAt: Date.now(),
      };
      return {
        ...state,
        entries: [...state.entries, userEntry, turnEntry],
        processing: true,
      };
    }

    case "APPEND_THINK_TOKEN": {
      return {
        ...state,
        entries: state.entries.map((e) =>
          e.kind === "turn" && !e.done
            ? { ...e, thinking: { ...e.thinking, text: e.thinking.text + action.text } }
            : e
        ),
      };
    }

    case "APPEND_RESPONSE_TOKEN": {
      return {
        ...state,
        entries: state.entries.map((e) =>
          e.kind === "turn" && !e.done
            ? { ...e, tokens: [...e.tokens, action.text] }
            : e
        ),
      };
    }

    case "ADD_TOOL_CALL": {
      const card: ToolCard = { ...action.toolCall, expanded: false };
      return {
        ...state,
        entries: state.entries.map((e) =>
          e.kind === "turn" && !e.done
            ? { ...e, toolCalls: [...e.toolCalls, card] }
            : e
        ),
      };
    }

    case "UPDATE_TOOL_CALL": {
      return {
        ...state,
        entries: state.entries.map((e) => {
          if (e.kind !== "turn" || e.done) return e;
          return {
            ...e,
            toolCalls: e.toolCalls.map((tc) =>
              tc.id === action.id
                ? { ...tc, result: action.result, status: action.status }
                : tc
            ),
          };
        }),
      };
    }

    case "FINALIZE_TURN": {
      return {
        ...state,
        processing: false,
        entries: state.entries.map((e) => {
          if (e.kind !== "turn" || e.done) return e;
          return {
            ...e,
            done: true,
            thinking: { ...e.thinking, durationMs: Date.now() - e.startedAt },
          };
        }),
      };
    }

    case "TOGGLE_EXPANDED": {
      return {
        ...state,
        entries: state.entries.map((e) => {
          if (e.kind !== "turn") return e;
          if (`${e.id}-thinking` === action.id) {
            return { ...e, thinking: { ...e.thinking, expanded: !e.thinking.expanded } };
          }
          const hasTarget = e.toolCalls.some((tc) => tc.id === action.id);
          if (!hasTarget) return e;
          return {
            ...e,
            toolCalls: e.toolCalls.map((tc) =>
              tc.id === action.id ? { ...tc, expanded: !tc.expanded } : tc
            ),
          };
        }),
      };
    }

    case "SET_ERROR": {
      return {
        ...state,
        processing: false,
        entries: [...state.entries, { kind: "error", id: action.id, message: action.message }],
      };
    }

    default:
      return state;
  }
}
```

- [ ] **Step 2: Type-check**

```bash
cd /Users/a.k.mmuhibullahnayem/Developer/R\&D/deep-agent-cli && npx tsc --noEmit 2>&1 | grep "feedReducer"
```

Expected: no errors on `feedReducer.ts` itself.

---

## Task 3: Reducer unit tests

**Files:**
- Create: `tests/feedReducer.test.ts`

- [ ] **Step 1: Create tests directory and test file**

```bash
mkdir -p /Users/a.k.mmuhibullahnayem/Developer/R\&D/deep-agent-cli/tests
```

Create `tests/feedReducer.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  feedReducer,
  initialFeedState,
  type FeedState,
} from "../src/cli/state/feedReducer.js";

function applyActions(actions: Parameters<typeof feedReducer>[1][]): FeedState {
  return actions.reduce(feedReducer, initialFeedState);
}

describe("APPEND_USER", () => {
  it("adds a user entry and a pending turn entry", () => {
    const state = applyActions([{ type: "APPEND_USER", id: "u1", text: "hello" }]);
    expect(state.entries).toHaveLength(2);
    expect(state.entries[0]).toMatchObject({ kind: "user", id: "u1", text: "hello" });
    expect(state.entries[1]).toMatchObject({
      kind: "turn",
      id: "turn-u1",
      done: false,
      tokens: [],
      toolCalls: [],
    });
    expect(state.processing).toBe(true);
  });
});

describe("APPEND_THINK_TOKEN", () => {
  it("appends to the live turn's thinking text", () => {
    const state = applyActions([
      { type: "APPEND_USER", id: "u1", text: "hi" },
      { type: "APPEND_THINK_TOKEN", text: "reasoning step 1 " },
      { type: "APPEND_THINK_TOKEN", text: "step 2" },
    ]);
    const turn = state.entries.find((e) => e.kind === "turn");
    expect(turn).toBeDefined();
    if (turn?.kind === "turn") {
      expect(turn.thinking.text).toBe("reasoning step 1 step 2");
    }
  });
});

describe("APPEND_RESPONSE_TOKEN", () => {
  it("appends tokens to the live turn", () => {
    const state = applyActions([
      { type: "APPEND_USER", id: "u1", text: "hi" },
      { type: "APPEND_RESPONSE_TOKEN", text: "Hello" },
      { type: "APPEND_RESPONSE_TOKEN", text: " world" },
    ]);
    const turn = state.entries.find((e) => e.kind === "turn");
    if (turn?.kind === "turn") {
      expect(turn.tokens).toEqual(["Hello", " world"]);
    }
  });
});

describe("ADD_TOOL_CALL + UPDATE_TOOL_CALL", () => {
  it("adds a running tool card and updates it to done", () => {
    const state = applyActions([
      { type: "APPEND_USER", id: "u1", text: "run git" },
      {
        type: "ADD_TOOL_CALL",
        toolCall: { id: "tc1", name: "git_status", args: { cwd: "." }, status: "running" },
      },
      { type: "UPDATE_TOOL_CALL", id: "tc1", result: "nothing to commit", status: "done" },
    ]);
    const turn = state.entries.find((e) => e.kind === "turn");
    if (turn?.kind === "turn") {
      expect(turn.toolCalls).toHaveLength(1);
      expect(turn.toolCalls[0]).toMatchObject({
        id: "tc1",
        name: "git_status",
        status: "done",
        result: "nothing to commit",
        expanded: false,
      });
    }
  });
});

describe("FINALIZE_TURN", () => {
  it("marks turn done=true and sets processing=false", () => {
    const state = applyActions([
      { type: "APPEND_USER", id: "u1", text: "hi" },
      { type: "APPEND_RESPONSE_TOKEN", text: "hello" },
      { type: "FINALIZE_TURN" },
    ]);
    expect(state.processing).toBe(false);
    const turn = state.entries.find((e) => e.kind === "turn");
    if (turn?.kind === "turn") {
      expect(turn.done).toBe(true);
      expect(turn.thinking.durationMs).toBeGreaterThanOrEqual(0);
    }
  });
});

describe("TOGGLE_EXPANDED", () => {
  it("toggles thinking block expanded state", () => {
    const state = applyActions([
      { type: "APPEND_USER", id: "u1", text: "hi" },
      { type: "APPEND_THINK_TOKEN", text: "some thought" },
      { type: "TOGGLE_EXPANDED", id: "turn-u1-thinking" },
    ]);
    const turn = state.entries.find((e) => e.kind === "turn");
    if (turn?.kind === "turn") {
      expect(turn.thinking.expanded).toBe(true);
    }
  });

  it("toggles a tool card expanded state", () => {
    const state = applyActions([
      { type: "APPEND_USER", id: "u1", text: "hi" },
      { type: "ADD_TOOL_CALL", toolCall: { id: "tc1", name: "git_status", args: {}, status: "done" } },
      { type: "TOGGLE_EXPANDED", id: "tc1" },
    ]);
    const turn = state.entries.find((e) => e.kind === "turn");
    if (turn?.kind === "turn") {
      expect(turn.toolCalls[0].expanded).toBe(true);
    }
  });
});

describe("SET_ERROR", () => {
  it("adds an error entry and stops processing", () => {
    const state = applyActions([
      { type: "APPEND_USER", id: "u1", text: "hi" },
      { type: "SET_ERROR", id: "e1", message: "Connection refused" },
    ]);
    expect(state.processing).toBe(false);
    const errEntry = state.entries.find((e) => e.kind === "error");
    expect(errEntry).toMatchObject({ kind: "error", id: "e1", message: "Connection refused" });
  });
});
```

- [ ] **Step 2: Run tests — expect FAIL (reducer not fully wired yet)**

```bash
cd /Users/a.k.mmuhibullahnayem/Developer/R\&D/deep-agent-cli && npm test 2>&1 | tail -20
```

Expected: tests run (vitest finds the file). If reducer is already written from Task 2, tests should PASS here. Either outcome is fine — the important thing is vitest runs.

- [ ] **Step 3: Run all tests to confirm they pass**

```bash
cd /Users/a.k.mmuhibullahnayem/Developer/R\&D/deep-agent-cli && npm test
```

Expected: `✓ 8 tests passed`.

- [ ] **Step 4: Commit**

```bash
cd /Users/a.k.mmuhibullahnayem/Developer/R\&D/deep-agent-cli && git add src/cli/state/feedReducer.ts tests/feedReducer.test.ts && git commit -m "feat: feed state reducer with full unit test coverage"
```

---

## Task 4: StatusBar + UserMessage components

**Files:**
- Create: `src/cli/components/StatusBar.tsx`
- Create: `src/cli/components/UserMessage.tsx`

- [ ] **Step 1: Create components directory**

```bash
mkdir -p /Users/a.k.mmuhibullahnayem/Developer/R\&D/deep-agent-cli/src/cli/components
```

- [ ] **Step 2: Create StatusBar.tsx**

```tsx
import { Box, Text } from "ink";

const MODEL_NAME = process.env.OLLAMA_MODEL ?? "batiai/gemma4-e2b:q4";
const MAX_TOKENS = 128_000;
const BAR_WIDTH = 20;

export type AgentState = "idle" | "thinking" | "tool" | "error";

interface StatusBarProps {
  tokens: number;
  agentState: AgentState;
}

function tokensToDisplay(n: number): string {
  if (n < 1_000) return `${n}`;
  if (n < 1_000_000) return `${(n / 1_000).toFixed(1)}K`;
  return `${(n / 1_000_000).toFixed(1)}M`;
}

export function StatusBar({ tokens, agentState }: StatusBarProps) {
  const percent = Math.min(Math.round((tokens / MAX_TOKENS) * 100), 100);
  const filled = Math.round((percent / 100) * BAR_WIDTH);
  const bar = "█".repeat(filled) + "░".repeat(BAR_WIDTH - filled);

  const dotColor =
    agentState === "thinking" ? "cyan"
    : agentState === "tool" ? "yellow"
    : agentState === "error" ? "red"
    : "green";

  const barColor =
    percent < 50 ? "green" : percent < 80 ? "yellow" : "red";

  const stateLabel =
    agentState === "thinking" ? "Thinking…"
    : agentState === "tool" ? "Tool…"
    : agentState === "error" ? "Error"
    : "Idle";

  return (
    <Box borderStyle="single" borderColor="grey" paddingLeft={1} paddingRight={1}>
      <Text bold color="white">{MODEL_NAME}</Text>
      <Text>{"  "}</Text>
      <Text color={dotColor as any}>{"●"}</Text>
      <Text color="grey">{` ${stateLabel}   CTX ${percent}%  `}</Text>
      <Text color={barColor as any}>{bar}</Text>
      <Text color="grey">{`  ${tokensToDisplay(tokens)} / 128K`}</Text>
    </Box>
  );
}
```

- [ ] **Step 3: Create UserMessage.tsx**

```tsx
import { Box, Text } from "ink";

interface UserMessageProps {
  text: string;
}

export function UserMessage({ text }: UserMessageProps) {
  return (
    <Box marginBottom={1} flexDirection="row">
      <Text color="cyan" bold>{">"} </Text>
      <Text wrap="wrap">{text}</Text>
    </Box>
  );
}
```

- [ ] **Step 4: Type-check**

```bash
cd /Users/a.k.mmuhibullahnayem/Developer/R\&D/deep-agent-cli && npx tsc --noEmit 2>&1 | grep -E "StatusBar|UserMessage"
```

Expected: no errors on these two files.

- [ ] **Step 5: Commit**

```bash
cd /Users/a.k.mmuhibullahnayem/Developer/R\&D/deep-agent-cli && git add src/cli/components/StatusBar.tsx src/cli/components/UserMessage.tsx && git commit -m "feat: StatusBar and UserMessage leaf components"
```

---

## Task 5: ThinkingBlock component

**Files:**
- Create: `src/cli/components/ThinkingBlock.tsx`

- [ ] **Step 1: Create ThinkingBlock.tsx**

```tsx
import { Box, Text } from "ink";
import type { ThinkState } from "../state/feedReducer.js";

interface ThinkingBlockProps {
  state: ThinkState;
  turnId: string;
  focused: boolean;
}

function formatDuration(ms?: number): string {
  if (ms === undefined) return "";
  return ms < 1000 ? ` ${ms}ms` : ` ${(ms / 1000).toFixed(1)}s`;
}

export function ThinkingBlock({ state, turnId: _turnId, focused }: ThinkingBlockProps) {
  if (!state.text) return null;

  const duration = formatDuration(state.durationMs);
  const hint = focused ? " {Space}" : "";

  if (!state.expanded) {
    return (
      <Box marginLeft={2} marginBottom={0}>
        <Text color={focused ? "cyan" : "grey"}>
          {"▶ Thinking"}{duration}{hint}
        </Text>
      </Box>
    );
  }

  return (
    <Box marginLeft={2} flexDirection="column" marginBottom={1}>
      <Text color={focused ? "cyan" : "grey"} bold>
        {"▼ Thinking"}{duration}{hint}
      </Text>
      <Box marginLeft={2} flexDirection="column">
        <Text color="grey" dimColor>{state.text}</Text>
      </Box>
    </Box>
  );
}
```

- [ ] **Step 2: Type-check**

```bash
cd /Users/a.k.mmuhibullahnayem/Developer/R\&D/deep-agent-cli && npx tsc --noEmit 2>&1 | grep "ThinkingBlock"
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
cd /Users/a.k.mmuhibullahnayem/Developer/R\&D/deep-agent-cli && git add src/cli/components/ThinkingBlock.tsx && git commit -m "feat: ThinkingBlock collapsed/expanded component"
```

---

## Task 6: ToolCard component

**Files:**
- Create: `src/cli/components/ToolCard.tsx`

- [ ] **Step 1: Create ToolCard.tsx**

```tsx
import { Box, Text } from "ink";
import type { ToolCard as ToolCardType } from "../state/feedReducer.js";

interface ToolCardProps {
  card: ToolCardType;
  focused: boolean;
}

const STATUS_ICON: Record<ToolCardType["status"], string> = {
  running: "⟳",
  done:    "✓",
  error:   "✗",
};

const STATUS_COLOR: Record<ToolCardType["status"], string> = {
  running: "cyan",
  done:    "green",
  error:   "red",
};

function truncateArgs(args: unknown): string {
  const s = JSON.stringify(args) ?? "{}";
  return s.length > 60 ? s.slice(0, 57) + "…" : s;
}

export function ToolCard({ card, focused }: ToolCardProps) {
  const icon  = STATUS_ICON[card.status];
  const color = STATUS_COLOR[card.status] as any;
  const hint  = focused ? " {Space}" : "";

  if (!card.expanded) {
    return (
      <Box marginLeft={2} marginBottom={0} flexDirection="row">
        <Text color={color}>{icon} </Text>
        <Text bold>{card.name}</Text>
        <Text color="grey">{"("}{truncateArgs(card.args)}{")"}</Text>
        {card.status !== "running" && (
          <Text color={focused ? "cyan" : "grey"}>{` [expand${hint}]`}</Text>
        )}
      </Box>
    );
  }

  const resultText = card.result ?? "(no output)";
  const resultLines = resultText.split("\n").slice(0, 40);
  const truncated = resultText.split("\n").length > 40;

  return (
    <Box marginLeft={2} flexDirection="column" marginBottom={1}>
      <Box flexDirection="row">
        <Text color={color}>{icon} </Text>
        <Text bold>{card.name}</Text>
        <Text color={focused ? "cyan" : "grey"}>{` [collapse${hint}]`}</Text>
      </Box>
      <Box marginLeft={2} flexDirection="column">
        <Text color="grey" bold>Args: </Text>
        <Text color="grey">{JSON.stringify(card.args, null, 2)}</Text>
        <Text color="grey" bold>Result: </Text>
        {resultLines.map((line, i) => (
          <Text key={i} color="grey">{line}</Text>
        ))}
        {truncated && <Text color="grey">{"… (truncated)"}</Text>}
      </Box>
    </Box>
  );
}
```

- [ ] **Step 2: Type-check**

```bash
cd /Users/a.k.mmuhibullahnayem/Developer/R\&D/deep-agent-cli && npx tsc --noEmit 2>&1 | grep "ToolCard"
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
cd /Users/a.k.mmuhibullahnayem/Developer/R\&D/deep-agent-cli && git add src/cli/components/ToolCard.tsx && git commit -m "feat: ToolCard compact/expanded component"
```

---

## Task 7: AgentTurn component

**Files:**
- Create: `src/cli/components/AgentTurn.tsx`

- [ ] **Step 1: Create AgentTurn.tsx**

```tsx
import { useState } from "react";
import { Box, Text, useInput } from "ink";
import type { FeedEntry } from "../state/feedReducer.js";
import { ThinkingBlock } from "./ThinkingBlock.js";
import { ToolCard } from "./ToolCard.js";

type TurnEntry = Extract<FeedEntry, { kind: "turn" }>;

interface AgentTurnProps {
  entry: TurnEntry;
  onToggle: (id: string) => void;
  isLive?: boolean;
}

export function AgentTurn({ entry, onToggle, isLive = false }: AgentTurnProps) {
  const expandableIds: string[] = [
    ...(entry.thinking.text ? [`${entry.id}-thinking`] : []),
    ...entry.toolCalls
      .filter((tc) => tc.status !== "running")
      .map((tc) => tc.id),
  ];

  const [focusIndex, setFocusIndex] = useState(0);

  useInput(
    (_input, key) => {
      if (expandableIds.length === 0) return;
      if (key.tab) {
        setFocusIndex((i) => (i + 1) % expandableIds.length);
      }
      if (key.return || _input === " ") {
        const id = expandableIds[Math.min(focusIndex, expandableIds.length - 1)];
        if (id) onToggle(id);
      }
    },
    { isActive: isLive }
  );

  const responseText = entry.tokens.join("");

  return (
    <Box flexDirection="column" marginBottom={1}>
      <Box flexDirection="row">
        <Text color="green" bold>{"● "}</Text>
        <Text color="grey" dimColor>agent</Text>
      </Box>

      {entry.thinking.text && (
        <ThinkingBlock
          state={entry.thinking}
          turnId={entry.id}
          focused={isLive && expandableIds[focusIndex] === `${entry.id}-thinking`}
        />
      )}

      {entry.toolCalls.map((tc) => (
        <ToolCard
          key={tc.id}
          card={tc}
          focused={isLive && expandableIds[focusIndex] === tc.id}
        />
      ))}

      {responseText ? (
        <Box marginLeft={2}>
          <Text wrap="wrap">{responseText}</Text>
        </Box>
      ) : isLive && entry.toolCalls.length === 0 && !entry.thinking.text ? (
        <Box marginLeft={2}>
          <Text color="grey" dimColor>{"…"}</Text>
        </Box>
      ) : null}
    </Box>
  );
}
```

- [ ] **Step 2: Type-check**

```bash
cd /Users/a.k.mmuhibullahnayem/Developer/R\&D/deep-agent-cli && npx tsc --noEmit 2>&1 | grep "AgentTurn"
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
cd /Users/a.k.mmuhibullahnayem/Developer/R\&D/deep-agent-cli && git add src/cli/components/AgentTurn.tsx && git commit -m "feat: AgentTurn with keyboard-driven expand/collapse"
```

---

## Task 8: Feed component

**Files:**
- Create: `src/cli/components/Feed.tsx`

- [ ] **Step 1: Create Feed.tsx**

```tsx
import { Box, Static, Text } from "ink";
import type { FeedEntry } from "../state/feedReducer.js";
import { UserMessage } from "./UserMessage.js";
import { AgentTurn } from "./AgentTurn.js";

interface FeedProps {
  entries: FeedEntry[];
  processing: boolean;
  onToggle: (id: string) => void;
}

function findLiveTurn(entries: FeedEntry[]): (FeedEntry & { kind: "turn" }) | null {
  for (let i = entries.length - 1; i >= 0; i--) {
    const e = entries[i];
    if (e.kind === "turn" && !e.done) return e;
  }
  return null;
}

function renderEntry(entry: FeedEntry, onToggle: (id: string) => void) {
  if (entry.kind === "user") {
    return <UserMessage key={entry.id} text={entry.text} />;
  }
  if (entry.kind === "turn") {
    return <AgentTurn key={entry.id} entry={entry} onToggle={onToggle} />;
  }
  if (entry.kind === "error") {
    return (
      <Box key={entry.id} marginBottom={1}>
        <Text color="red">{"✗ "}{entry.message}</Text>
      </Box>
    );
  }
  return null;
}

export function Feed({ entries, processing, onToggle }: FeedProps) {
  const liveEntry = processing ? findLiveTurn(entries) : null;
  const staticEntries = liveEntry
    ? entries.filter((e) => e !== liveEntry)
    : entries;

  return (
    <Box flexDirection="column" flexGrow={1} overflow="hidden">
      <Static items={staticEntries}>
        {(entry) => renderEntry(entry, onToggle)}
      </Static>
      {liveEntry && (
        <AgentTurn entry={liveEntry} onToggle={onToggle} isLive />
      )}
    </Box>
  );
}
```

- [ ] **Step 2: Type-check**

```bash
cd /Users/a.k.mmuhibullahnayem/Developer/R\&D/deep-agent-cli && npx tsc --noEmit 2>&1 | grep "Feed"
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
cd /Users/a.k.mmuhibullahnayem/Developer/R\&D/deep-agent-cli && git add src/cli/components/Feed.tsx && git commit -m "feat: Feed with Static history + live turn rendering"
```

---

## Task 9: InputBox component

**Files:**
- Create: `src/cli/components/InputBox.tsx`

- [ ] **Step 1: Create InputBox.tsx**

```tsx
import { useState } from "react";
import { Box, Text } from "ink";
import TextInput from "ink-text-input";

interface InputBoxProps {
  onSubmit: (text: string) => void;
  disabled: boolean;
}

export function InputBox({ onSubmit, disabled }: InputBoxProps) {
  const [value, setValue] = useState("");

  function handleSubmit(submitted: string) {
    const trimmed = submitted.trim();
    if (!trimmed || disabled) return;
    setValue("");
    onSubmit(trimmed);
  }

  return (
    <Box
      borderStyle="round"
      borderColor={disabled ? "grey" : "cyan"}
      paddingLeft={1}
      paddingRight={1}
    >
      {disabled ? (
        <Text color="grey" dimColor>{"processing…"}</Text>
      ) : (
        <Box flexDirection="row">
          <Text color="cyan" bold>{">"} </Text>
          <TextInput
            value={value}
            onChange={setValue}
            onSubmit={handleSubmit}
            placeholder={"Send a message…"}
            focus={!disabled}
          />
        </Box>
      )}
    </Box>
  );
}
```

- [ ] **Step 2: Type-check**

```bash
cd /Users/a.k.mmuhibullahnayem/Developer/R\&D/deep-agent-cli && npx tsc --noEmit 2>&1 | grep "InputBox"
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
cd /Users/a.k.mmuhibullahnayem/Developer/R\&D/deep-agent-cli && git add src/cli/components/InputBox.tsx && git commit -m "feat: InputBox with ink-text-input, disabled state"
```

---

## Task 10: useAgentStream hook

**Files:**
- Create: `src/cli/hooks/useAgentStream.ts`

- [ ] **Step 1: Create hooks directory and file**

```bash
mkdir -p /Users/a.k.mmuhibullahnayem/Developer/R\&D/deep-agent-cli/src/cli/hooks
```

Create `src/cli/hooks/useAgentStream.ts`:

```ts
import { useCallback, useRef } from "react";
import type { Dispatch } from "react";
import { initChatModel } from "langchain";
import { createDeepAgent } from "deepagents";
import { allTools } from "../../tools/index.js";
import { allSubagents } from "../../subagents/index.js";
import { SYSTEM_PROMPT } from "../../prompts/system.js";
import { countMessagesTokens } from "../../context/tokenizer.js";
import { shouldCompact, compactMessages } from "../../context/compaction.js";
import type { FeedAction } from "../state/feedReducer.js";

const OLLAMA_BASE_URL = process.env.OLLAMA_BASE_URL ?? "http://localhost:11434";
const MODEL_NAME = process.env.OLLAMA_MODEL ?? "batiai/gemma4-e2b:q4";

interface Message {
  role: string;
  content: string;
}

interface UseAgentStreamOptions {
  dispatch: Dispatch<FeedAction>;
  onTokensUpdate: (tokens: number) => void;
}

export function useAgentStream({ dispatch, onTokensUpdate }: UseAgentStreamOptions) {
  const messagesRef = useRef<Message[]>([]);

  const submit = useCallback(
    async (text: string) => {
      const userId = `user-${Date.now()}`;
      dispatch({ type: "APPEND_USER", id: userId, text });

      messagesRef.current.push({ role: "user", content: text });

      // Token count + optional compaction
      const tokenCount = await countMessagesTokens(messagesRef.current, SYSTEM_PROMPT);
      onTokensUpdate(tokenCount);

      if (await shouldCompact(messagesRef.current, SYSTEM_PROMPT)) {
        const result = await compactMessages(messagesRef.current, SYSTEM_PROMPT);
        messagesRef.current = [
          { role: "system", content: `[Summary: ${result.summary}]` },
          ...messagesRef.current.slice(-20),
        ];
        onTokensUpdate(result.compressedCount);
      }

      try {
        const model = await initChatModel(`ollama:${MODEL_NAME}`, {
          baseUrl: OLLAMA_BASE_URL,
        });

        // Escape hatch: DISABLE_TODO_MIDDLEWARE=1 skips deepagents' TodoListMiddleware
        // which can suppress Gemma4 reasoning output (deepagents#2445).
        const agentOptions: Parameters<typeof createDeepAgent>[0] = {
          model,
          tools: allTools as any,
          subagents: allSubagents as any,
          systemPrompt: SYSTEM_PROMPT,
        };
        if (process.env.DISABLE_TODO_MIDDLEWARE === "1") {
          agentOptions.middleware = [];
        }

        const agent = createDeepAgent(agentOptions);

        const dispatchedToolIds = new Set<string>();
        let lastAIMsg: Record<string, unknown> | null = null;

        const stream = await agent.stream({ messages: messagesRef.current });

        for await (const chunk of stream) {
          const chunkAny = chunk as Record<string, unknown>;

          for (const nodeOutput of Object.values(chunkAny)) {
            if (!nodeOutput || typeof nodeOutput !== "object") continue;
            const msgs = (nodeOutput as any).messages;
            if (!Array.isArray(msgs)) continue;

            for (const msg of msgs) {
              const msgType: string =
                (msg as any)?.id?.[2] ?? (msg as any)?.type ?? (msg as any)?.role ?? "";
              const isAI =
                msgType === "AIMessage" ||
                msgType === "ai" ||
                msgType === "assistant";
              const isToolMsg =
                msgType === "ToolMessage" || msgType === "tool";

              if (isAI) {
                lastAIMsg = msg as Record<string, unknown>;

                // Gemma4 thinking: Ollama surfaces it in additional_kwargs.thinking
                const thinking: string | undefined =
                  (msg as any)?.kwargs?.additional_kwargs?.thinking ??
                  (msg as any)?.additional_kwargs?.thinking;
                if (thinking?.trim()) {
                  dispatch({ type: "APPEND_THINK_TOKEN", text: thinking });
                }

                // Response content
                const content: string | undefined =
                  (msg as any)?.kwargs?.content ?? (msg as any)?.content;
                if (content?.trim()) {
                  dispatch({ type: "APPEND_RESPONSE_TOKEN", text: content });
                }

                // Tool calls (streaming path — works on Ollama ≥ 0.20.7)
                const toolCalls: any[] =
                  (msg as any)?.kwargs?.tool_calls ??
                  (msg as any)?.tool_calls ?? [];
                for (const tc of toolCalls) {
                  const tcId: string = tc.id ?? tc.function?.name ?? `tc-${Date.now()}`;
                  if (dispatchedToolIds.has(tcId)) continue;
                  dispatchedToolIds.add(tcId);
                  dispatch({
                    type: "ADD_TOOL_CALL",
                    toolCall: {
                      id: tcId,
                      name: tc.name ?? tc.function?.name ?? "unknown",
                      args: tc.args ?? tc.function?.arguments ?? {},
                      status: "running",
                    },
                  });
                }
              }

              if (isToolMsg) {
                // Tool result from LangGraph's tools node
                const toolCallId: string | undefined =
                  (msg as any)?.kwargs?.tool_call_id ?? (msg as any)?.tool_call_id;
                const result: string | undefined =
                  (msg as any)?.kwargs?.content ?? (msg as any)?.content;
                if (toolCallId && result !== undefined) {
                  dispatch({
                    type: "UPDATE_TOOL_CALL",
                    id: toolCallId,
                    result: typeof result === "string" ? result : JSON.stringify(result),
                    status: "done",
                  });
                }
              }
            }
          }
        }

        // Post-stream fallback: Ollama ≤ 0.20.6 drops tool_calls during streaming.
        // Check additional_kwargs on the last AIMessage for any missed calls.
        if (lastAIMsg) {
          const fallback: any[] =
            (lastAIMsg as any)?.kwargs?.additional_kwargs?.tool_calls ??
            (lastAIMsg as any)?.additional_kwargs?.tool_calls ?? [];
          for (const tc of fallback) {
            const tcId: string = tc.id ?? `tc-fallback-${Date.now()}`;
            if (dispatchedToolIds.has(tcId)) continue;
            dispatchedToolIds.add(tcId);
            let args: unknown = {};
            try { args = JSON.parse(tc.function?.arguments ?? "{}"); } catch {}
            dispatch({
              type: "ADD_TOOL_CALL",
              toolCall: {
                id: tcId,
                name: tc.function?.name ?? "unknown",
                args,
                status: "running",
              },
            });
          }
        }

        // Capture assistant response in conversation history
        const responseText = (
          (lastAIMsg as any)?.kwargs?.content ?? (lastAIMsg as any)?.content ?? ""
        ).trim();
        if (responseText) {
          messagesRef.current.push({ role: "assistant", content: responseText });
        }

        dispatch({ type: "FINALIZE_TURN" });

      } catch (err) {
        dispatch({
          type: "SET_ERROR",
          id: `error-${Date.now()}`,
          message: err instanceof Error ? err.message : String(err),
        });
      }
    },
    [dispatch, onTokensUpdate]
  );

  return { submit };
}
```

- [ ] **Step 2: Type-check**

```bash
cd /Users/a.k.mmuhibullahnayem/Developer/R\&D/deep-agent-cli && npx tsc --noEmit 2>&1 | grep "useAgentStream"
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
cd /Users/a.k.mmuhibullahnayem/Developer/R\&D/deep-agent-cli && git add src/cli/hooks/useAgentStream.ts && git commit -m "feat: useAgentStream with Gemma4 thinking/tool-call extraction"
```

---

## Task 11: App root component

**Files:**
- Create: `src/cli/App.tsx`
- Create: `src/cli/index.ts`

- [ ] **Step 1: Create App.tsx**

```tsx
import { useReducer, useState, useCallback } from "react";
import { Box, useApp, useInput } from "ink";
import { Feed } from "./components/Feed.js";
import { InputBox } from "./components/InputBox.js";
import { StatusBar, type AgentState } from "./components/StatusBar.js";
import { feedReducer, initialFeedState } from "./state/feedReducer.js";
import { useAgentStream } from "./hooks/useAgentStream.js";

export function App() {
  const { exit } = useApp();
  const [feedState, dispatch] = useReducer(feedReducer, initialFeedState);
  const [tokens, setTokens] = useState(0);

  // Ctrl+C exits
  useInput((_input, key) => {
    if (key.ctrl && _input === "c") exit();
  });

  const { submit } = useAgentStream({
    dispatch,
    onTokensUpdate: setTokens,
  });

  const handleSubmit = useCallback(
    async (text: string) => {
      if (feedState.processing) return;
      await submit(text);
    },
    [submit, feedState.processing]
  );

  // Derive agent state for status bar
  const agentState: AgentState = (() => {
    if (!feedState.processing) return "idle";
    const liveTurn = (() => {
      for (let i = feedState.entries.length - 1; i >= 0; i--) {
        const e = feedState.entries[i];
        if (e.kind === "turn" && !e.done) return e;
      }
      return null;
    })();
    if (liveTurn?.kind === "turn" && liveTurn.toolCalls.some((tc) => tc.status === "running")) {
      return "tool";
    }
    return "thinking";
  })();

  return (
    <Box flexDirection="column" height="100%">
      <Feed
        entries={feedState.entries}
        processing={feedState.processing}
        onToggle={(id) => dispatch({ type: "TOGGLE_EXPANDED", id })}
      />
      <InputBox onSubmit={handleSubmit} disabled={feedState.processing} />
      <StatusBar tokens={tokens} agentState={agentState} />
    </Box>
  );
}
```

- [ ] **Step 2: Create src/cli/index.ts**

```ts
export { App } from "./App.js";
```

- [ ] **Step 3: Type-check**

```bash
cd /Users/a.k.mmuhibullahnayem/Developer/R\&D/deep-agent-cli && npx tsc --noEmit 2>&1 | grep -E "App\.tsx|cli/index"
```

Expected: no errors on these files.

- [ ] **Step 4: Commit**

```bash
cd /Users/a.k.mmuhibullahnayem/Developer/R\&D/deep-agent-cli && git add src/cli/App.tsx src/cli/index.ts && git commit -m "feat: App root component wiring feed, input, status bar"
```

---

## Task 12: Update entry point + Gemma4 fixes

**Files:**
- Modify: `src/index.ts`
- Modify: `src/context/compaction.ts`
- Modify: `.env.example`

- [ ] **Step 1: Replace src/index.ts**

```ts
import "dotenv/config";
import { createElement } from "react";
import { render } from "ink";
import { App } from "./cli/index.js";

render(createElement(App));
```

- [ ] **Step 2: Fix compaction.ts — hardcoded model name**

In `src/context/compaction.ts`, change line 8 from:

```ts
const SUMMARIZE_MODEL = "gemma:4:latest";
```

to:

```ts
const SUMMARIZE_MODEL = process.env.OLLAMA_MODEL ?? "batiai/gemma4-e2b:q4";
```

- [ ] **Step 3: Update .env.example**

Replace with:

```
OLLAMA_BASE_URL=http://localhost:11434
OLLAMA_MODEL=batiai/gemma4-e2b:q4
SERPER_API_KEY=your_serper_key_here
GOOGLE_CSE_API_KEY=your_google_cse_key_here
GOOGLE_CSE_ID=your_google_cse_id_here
WEATHER_API_KEY=your_weather_api_key_here
DISABLE_TODO_MIDDLEWARE=0
```

- [ ] **Step 4: Update .env with new model if Ollama has it**

```bash
cd /Users/a.k.mmuhibullahnayem/Developer/R\&D/deep-agent-cli && grep -n "OLLAMA_MODEL" .env || echo "not found"
```

If `.env` has `OLLAMA_MODEL=gemma2_tools:2b`, update it:

```
OLLAMA_MODEL=batiai/gemma4-e2b:q4
```

- [ ] **Step 5: Full type-check — must be clean**

```bash
cd /Users/a.k.mmuhibullahnayem/Developer/R\&D/deep-agent-cli && npx tsc --noEmit 2>&1
```

Expected: **zero errors**. If any errors remain, fix them before proceeding.

- [ ] **Step 6: Commit**

```bash
cd /Users/a.k.mmuhibullahnayem/Developer/R\&D/deep-agent-cli && git add src/index.ts src/context/compaction.ts .env.example && git commit -m "feat: Ink entry point, fix compaction model, update env defaults"
```

---

## Task 13: Delete old blessed files

**Files:**
- Delete: `src/cli/panes/ContextBar.ts`
- Delete: `src/cli/panes/InputPane.ts`
- Delete: `src/cli/panes/OutputPane.ts`
- Delete: `src/cli/panes/ToolLogPane.ts`
- Delete: `src/cli/widgets/ProgressBar.ts`
- Delete: `src/ollama/think-parser.ts`
- Delete: `src/cli/index.ts` (old blessed CLI index)

- [ ] **Step 1: Remove old files**

```bash
cd /Users/a.k.mmuhibullahnayem/Developer/R\&D/deep-agent-cli && rm -f \
  src/cli/panes/ContextBar.ts \
  src/cli/panes/InputPane.ts \
  src/cli/panes/OutputPane.ts \
  src/cli/panes/ToolLogPane.ts \
  src/cli/widgets/ProgressBar.ts \
  src/ollama/think-parser.ts
rmdir src/cli/panes src/cli/widgets 2>/dev/null || true
```

- [ ] **Step 2: Verify no remaining imports of deleted files**

```bash
cd /Users/a.k.mmuhibullahnayem/Developer/R\&D/deep-agent-cli && grep -r "think-parser\|ContextBar\|InputPane\|OutputPane\|ToolLogPane\|ProgressBar\|blessed" src/ 2>/dev/null
```

Expected: **no output** — all references removed.

- [ ] **Step 3: Final clean type-check**

```bash
cd /Users/a.k.mmuhibullahnayem/Developer/R\&D/deep-agent-cli && npx tsc --noEmit 2>&1
```

Expected: **zero errors**.

- [ ] **Step 4: Run tests**

```bash
cd /Users/a.k.mmuhibullahnayem/Developer/R\&D/deep-agent-cli && npm test
```

Expected: all 8 reducer tests pass.

- [ ] **Step 5: Commit**

```bash
cd /Users/a.k.mmuhibullahnayem/Developer/R\&D/deep-agent-cli && git add -A && git commit -m "chore: remove blessed panes, think-parser; TUI rewrite complete"
```

---

## Task 14: Integration smoke-test

**No file changes** — this task verifies the full system runs.

- [ ] **Step 1: Pull batiai/gemma4-e2b:q4 if not already present**

```bash
ollama pull batiai/gemma4-e2b:q4
```

Expected: model downloads or "already up to date".

- [ ] **Step 2: Launch the CLI**

```bash
cd /Users/a.k.mmuhibullahnayem/Developer/R\&D/deep-agent-cli && npm run dev
```

Expected: terminal clears, renders the Ink TUI with:
- Empty feed area
- `╭─ > ─────────────────────────╮` input box in cyan
- Bottom status bar with model name + green `● Idle`

- [ ] **Step 3: Send a plain text message**

Type `hello` and press Enter.

Expected:
- Input clears and shows `processing…`
- Feed shows `> hello` entry
- `● agent` turn appears with `… ` placeholder
- Status bar switches to cyan `● Thinking…`
- Response text streams in below the agent header
- Input re-enables when done

- [ ] **Step 4: Verify thinking block appears (if model uses thinking)**

Type `think step by step: what is 17 * 23?` and press Enter.

Expected:
- `▶ Thinking 1.2s` line appears collapsed (grey)
- Press `Space` → expands to show grey italic reasoning text
- Press `Space` again → collapses back

- [ ] **Step 5: Verify tool call card**

Type `what files are in the current directory?` and press Enter (the agent should call `git_status` or file tools).

Expected:
- `⟳ tool_name({…})` card appears while tool runs
- Becomes `✓ tool_name(…) [expand]` when done
- Press `Tab` to focus the card (turns cyan), `Space` to expand

- [ ] **Step 6: Verify error handling**

Stop Ollama (`ollama stop` or kill the process), then send a message.

Expected: `✗ Connection refused` (or similar) error entry appears in the feed, input re-enables.

- [ ] **Step 7: Final commit with version bump**

```bash
cd /Users/a.k.mmuhibullahnayem/Developer/R\&D/deep-agent-cli && npm version patch && git add package.json package-lock.json && git commit -m "chore: bump version post TUI rewrite"
```
