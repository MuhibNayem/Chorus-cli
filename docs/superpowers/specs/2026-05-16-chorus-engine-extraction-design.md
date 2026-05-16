# @chorus/engine Extraction Design

**Date:** 2026-05-16  
**Status:** Approved  
**Approach:** Option B — sibling directory, zero changes to Chorus-cli runtime behavior

---

## 1. Goal

Extract the headless engine of Chorus-cli into a standalone, publishable npm package `@chorus/engine` at `../chorus-engine/`. The CLI (`Chorus-cli`) continues to work identically. The engine becomes independently importable by any TypeScript/Node.js project.

---

## 2. Directory Structure

```
Developer/
  Chorus-cli/                    ← untouched (existing repo)
  chorus-engine/                 ← new package root
    src/
      agent/                     ← loop, middleware, HITL, checkpointer, btw, retry, memory
      swarm/                     ← orchestrator, graph-executor, supervisor, group-chat, presets
      llm/                       ← provider interface, registry, config, pricing, context windows
      tools/                     ← filesystem, shell, git, web-search, todos, safety
      evals/                     ← runner, scorer, storage, types
      harness/                   ← orchestrator, router, protocol, contextAssembler,
      │                            workerEngine (fixed), workerPool, workerPrompts,
      │                            verifier, approvalLog, observability, storage, types
      context/                   ← tokenizer, compaction
      skills/                    ← middleware, harness, loader, registry, synthesizer,
      │                            executor, budget, embedder, semanticIndex, types
      mcp/                       ← client, config, manage
      session/                   ← manager, storage, types
      channels/                  ← broadcaster, index
      a2a/                       ← adapter, client, server, types
      subagents/                 ← delegateTool (fixed), runtime (fixed), index, builder, planner, types
      prompts/                   ← system.ts
      agents/                    ← generator, loader, resolver, storage, types
      settings/                  ← storage.ts, providers.ts  (NO wizard .tsx files)
      telemetry/                 ← bridge, exporter, types, index
      index.ts                   ← single public API surface
    package.json
    tsconfig.json
    README.md
```

**Excluded from engine (stays in Chorus-cli only):**
- `src/cli/` — all React/Ink UI
- `src/assets/` — fonts, images
- `src/settings/wizard.tsx`, `apiKeysWizard.tsx`, `configWizard.tsx`

---

## 3. CLI Coupling Removal (The Three Surgery Points)

Exactly three files import from `src/cli/state/feedReducer.js`. Each is fixed identically: replace `Dispatch<FeedAction>` with a typed callback. The CLI adapter in `agentRunner.ts` (stays in Chorus-cli) translates the callback back to dispatch calls — zero behavior change.

### 3a. `harness/workerEngine.ts`

**Remove:**
```ts
import type { Dispatch } from "react";
import type { FeedAction, TurnEvent } from "../cli/state/feedReducer.js";
```

**Add:**
```ts
export type WorkerEvent =
  | { type: "worker-add";              workerId: string; role: WorkerRole; emoji: string; color: string; sessionId: string }
  | { type: "worker-thinking";         sessionId: string; id: string; text: string; expanded: boolean }
  | { type: "worker-response";         sessionId: string; text: string }
  | { type: "worker-session-complete"; sessionId: string; completedAt: number }
  | { type: "worker-update";           workerId: string; status: "done" | "error"; result: string }

export type WorkerEventCallback = (event: WorkerEvent) => void;
```

Replace all `dispatch({ type: "ADD_WORKER", ... })` calls with `onEvent({ type: "worker-add", ... })`.

**CLI adapter (stays in `agentRunner.ts`):**
```ts
const onEvent: WorkerEventCallback = (event) => {
  switch (event.type) {
    case "worker-add":
      dispatch({ type: "ADD_WORKER", worker: { id: event.workerId, role: event.role,
        emoji: event.emoji, color: event.color, status: "running",
        summary: `${event.emoji} ${event.role} analyzing…`, sessionId: event.sessionId } });
      break;
    case "worker-thinking":
      dispatch({ type: "ADD_SESSION_EVENT", sessionId: event.sessionId,
        event: { kind: "thinking", id: event.id, text: event.text, expanded: event.expanded } });
      break;
    case "worker-response":
      dispatch({ type: "ADD_SESSION_EVENT", sessionId: event.sessionId,
        event: { kind: "response", text: event.text } });
      break;
    case "worker-session-complete":
      dispatch({ type: "FINALIZE_SESSION", sessionId: event.sessionId,
        completedAt: event.completedAt });
      break;
    case "worker-update":
      dispatch({ type: "UPDATE_WORKER", id: event.workerId,
        status: event.status, result: event.result });
      break;
  }
};
```

### 3b. `subagents/delegateTool.ts`

**Remove:**
```ts
import type { Dispatch } from "react";
import type { FeedAction } from "../cli/state/feedReducer.js";
```

**Add:**
```ts
export type SubagentEvent =
  | { type: "subagent-token";    sessionId: string; text: string }
  | { type: "subagent-done";     sessionId: string; result: string; durationMs: number }
  | { type: "subagent-error";    sessionId: string; error: string }

export type SubagentEventCallback = (event: SubagentEvent) => void;
```

Replace `dispatch` parameter with `onEvent: SubagentEventCallback`.

### 3c. `subagents/runtime.ts`

Same pattern as `delegateTool.ts` — replace `Dispatch<FeedAction>` with `SubagentEventCallback`.

**Guarantee:** All three changes are additive at the call site. The CLI's `agentRunner.ts` passes adapter callbacks. Runtime behavior is identical.

---

## 4. Package Manifest

### `package.json`
```json
{
  "name": "@chorus/engine",
  "version": "0.1.0",
  "description": "Headless agent engine — streaming loop, HITL, DAG swarms, adaptive skills, MCP, A2A",
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".":        { "import": "./dist/index.js",        "types": "./dist/index.d.ts" },
    "./agent":  { "import": "./dist/agent/index.js",  "types": "./dist/agent/index.d.ts" },
    "./swarm":  { "import": "./dist/swarm/index.js",  "types": "./dist/swarm/index.d.ts" },
    "./llm":    { "import": "./dist/llm/index.js",    "types": "./dist/llm/index.d.ts" },
    "./tools":  { "import": "./dist/tools/index.js",  "types": "./dist/tools/index.d.ts" },
    "./evals":  { "import": "./dist/evals/index.js",  "types": "./dist/evals/index.d.ts" },
    "./mcp":    { "import": "./dist/mcp/index.js",    "types": "./dist/mcp/index.d.ts" },
    "./harness":{ "import": "./dist/harness/index.js","types": "./dist/harness/index.d.ts" }
  },
  "engines": { "node": ">=20.0.0" },
  "license": "MIT",
  "dependencies": {
    "@huggingface/transformers": "^4.2.0",
    "@modelcontextprotocol/sdk": "^1.29.0",
    "glob": "^13.0.6",
    "tiktoken": "^1.0.0",
    "zod": "^3.23.0"
  },
  "devDependencies": {
    "@types/node": "^22.0.0",
    "typescript": "^5.7.0",
    "vitest": "^2.0.0"
  }
}
```

**Removed from CLI deps:** `ink`, `react`, `@inkjs/ui`, `ink-text-input`, `left-pad`, `dotenv` — zero UI dependencies.

### `tsconfig.json`
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
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist"]
}
```

Note: `jsx` compiler option is **removed** — no React in engine.

---

## 5. Public API Surface (`src/index.ts`)

```ts
// ── Agent Loop ────────────────────────────────────────────────────────────────
export { runAgentLoop } from './agent/loop.js'
export type { AgentEvent, AgentTool, LoopOptions, Checkpointer, CheckpointState } from './agent/types.js'

// ── Middleware ────────────────────────────────────────────────────────────────
export type { AgentMiddleware, RoundContext, ToolResultContext } from './agent/middleware.js'
export {
  SummarizationMiddleware, ObservabilityMiddleware,
  LargeOutputOffloadMiddleware, TodoMiddleware, createDefaultMiddleware,
} from './agent/middleware.js'
export { SkillMiddleware } from './skills/middleware.js'

// ── HITL ─────────────────────────────────────────────────────────────────────
export { HitlGate } from './agent/hitl.js'
export type { HitlDecision, HitlRequest } from './agent/types.js'

// ── Checkpointing ─────────────────────────────────────────────────────────────
export { JsonFileCheckpointer } from './agent/checkpointer.js'

// ── Side-Channel ─────────────────────────────────────────────────────────────
export { BtwQueue } from './agent/btw.js'

// ── Memory ────────────────────────────────────────────────────────────────────
export { createMemoryTools, createSharedMemoryTools } from './agent/memory-tools.js'

// ── Retry ─────────────────────────────────────────────────────────────────────
export { withRetry, DEFAULT_RETRY_POLICY } from './agent/retry.js'
export type { RetryPolicy } from './agent/retry.js'

// ── Swarm ─────────────────────────────────────────────────────────────────────
export { runSwarm } from './swarm/orchestrator.js'
export { runSwarmGraph, computeWaves } from './swarm/graph-executor.js'
export { buildSupervisorSwarm } from './swarm/supervisor.js'
export { runGroupChat } from './swarm/group-chat.js'
export type {
  SwarmConfig, SwarmAgent, SwarmEvent, SwarmSession, HandoffRequest,
  CostBudget, CostRoutingPolicy,
} from './swarm/types.js'
export type { GroupChatConfig, GroupChatEvent } from './swarm/group-chat.js'

// ── Swarm Presets ─────────────────────────────────────────────────────────────
export { buildPresetSwarm, SWARM_PRESETS } from './swarm/presets/index.js'
export { createPlanBuildReviewSwarm } from './swarm/presets/plan-build-review.js'
export { createResearchSynthesizeSwarm } from './swarm/presets/research-synthesize.js'
export { createParallelResearchSwarm } from './swarm/presets/research-parallel.js'
export { createVaptReportSwarm } from './swarm/presets/vapt-report.js'

// ── LLM Providers ────────────────────────────────────────────────────────────
export { createProvider, getDefaultProvider } from './llm/registry.js'
export type { LLMProvider, ChatMessage, ModelResponse } from './llm/provider.js'

// ── Tools ─────────────────────────────────────────────────────────────────────
export { createFilesystemTools, filesystemTools } from './tools/filesystem.js'
export { shellTools } from './tools/shell.js'
export { gitTools } from './tools/git.js'
export { assessCommandSafety, auditCommand } from './tools/safety.js'

// ── Evals ─────────────────────────────────────────────────────────────────────
export { runEvalSuite, formatEvalRun } from './evals/runner.js'
export type { EvalSuite, EvalRun, EvalCaseResult } from './evals/types.js'

// ── Harness (pre-flight workers) ──────────────────────────────────────────────
export { executeWorkers, type WorkerEvent, type WorkerEventCallback } from './harness/workerEngine.js'
export { prepareTaskExecution } from './harness/orchestrator.js'

// ── MCP ───────────────────────────────────────────────────────────────────────
export { getMcpTools } from './mcp/client.js'

// ── A2A ───────────────────────────────────────────────────────────────────────
export { createA2AServer } from './a2a/adapter.js'
export type { A2ACard } from './a2a/types.js'
```

---

## 6. Execution Order

1. Create `chorus-engine/` directory with `package.json`, `tsconfig.json`
2. Copy all engine source directories verbatim
3. Fix `harness/workerEngine.ts` — remove React/FeedAction imports, introduce `WorkerEventCallback`
4. Fix `subagents/delegateTool.ts` — same pattern, `SubagentEventCallback`
5. Fix `subagents/runtime.ts` — same pattern
6. Write `src/index.ts` public surface
7. Write per-module `index.ts` barrel files for deep imports (`./agent`, `./swarm`, etc.)
8. Run `tsc --noEmit` — verify zero type errors
9. Run `npm run build` — verify clean dist output
10. Update `Chorus-cli/src/cli/hooks/agent/agentRunner.ts` — inject adapter callbacks at call sites
11. Verify Chorus-cli still builds (`tsc --noEmit` from Chorus-cli root)

---

## 7. Success Criteria

- `chorus-engine/` builds with `tsc --noEmit` — zero errors
- `chorus-engine/dist/` contains valid `.js` + `.d.ts` for every exported symbol
- `Chorus-cli/` builds and passes all existing tests unchanged
- The following minimal consumer works:
  ```ts
  import { runAgentLoop, HitlGate, BtwQueue, JsonFileCheckpointer,
           createProvider } from '@chorus/engine'
  // ... runs a full agent loop with no CLI dependency
  ```
- No `react`, `ink`, `@inkjs/ui` in `chorus-engine/` dependency tree
