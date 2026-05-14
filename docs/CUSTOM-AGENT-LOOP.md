# Chorus Custom Agent Runtime — Complete Implementation Plan

## Why Replace deepagents + LangGraph

Chorus-cli uses `deepagents` (which wraps LangGraph) as its agent runtime. This creates
three compounding problems:

| Problem | Root Cause | Current Workaround |
|---|---|---|
| `ERR_PACKAGE_PATH_NOT_EXPORTED` on startup | `deepagents` imports `langsmith/experimental/sandbox` (renamed in 0.7.0) | `patch-package` auto-patch on every `npm install` |
| Agent dies at ~12 tool-call rounds | LangGraph default `recursionLimit = 25` | Override to 2000 in `agentStreamConfig()`, `LANGGRAPH_RECURSION_LIMIT` env |
| Stream format complexity | LangGraph emits `["messages",...]` + `["updates",...]` multiplex tuples | ~375-line `streamProcessor.ts` parsing both modes |
| `/btw` mid-task injection impossible | LangGraph graph execution is opaque; no hook between tool rounds | Not implemented |
| No control over tool-call serialization | LangChain `ChatOpenAI` strips `reasoning_content` fields | Intercept `globalThis.fetch` in `vllmProvider.ts` |
| `DISABLE_TODO_MIDDLEWARE` env needed | deepagents injects a `TodoListMiddleware` that confuses Gemma4 | Opt-out env var |

### What LangGraph Actually Does in This Codebase

```
createDeepAgent(options)
  └── creates StateGraph { agent_node → tools_node → agent_node → ... }
  └── compiles with optional MemorySaver + interruptOn config

agent.stream(input, { streamMode: ["messages","updates"], recursionLimit })
  └── while model returns tool_calls:
        execute tools
        yield ["messages", [AIMessageChunk...]]
        yield ["updates", { agent: { messages: [...] } }]
  └── yield ["updates", { __interrupt__: [...] }] when HITL fires
```

That is a while loop. Everything else (StateGraph, checkpointer, MemorySaver, Command,
node wiring) is infrastructure for this one loop.

---

## Full Capability Inventory

### LangGraph Core Capabilities

| Capability | Description |
|---|---|
| **Checkpointing** | Saves the full graph state as a snapshot at every superstep |
| **Thread management** | `thread_id` groups checkpoints into a single conversation run |
| **Short-term memory** | In-thread conversation state persisted and restored via checkpointer |
| **Cross-thread memory** | `MemoryStore` — facts/files that persist across different threads |
| **Time travel** | Rewind to any past checkpoint; replay or fork from that point |
| **HITL** | Interrupt execution on specific tool calls, wait for human decision, resume |
| **Fault tolerance** | After a crash or exception, resume from last successful checkpoint |
| **Retry policies** | Per-node retry logic with configurable backoff and error filters |
| **Parallel fan-out/fan-in** | Nodes without edges execute concurrently; results merged downstream |
| **Subgraphs** | Compose full graphs as nodes within a parent graph |
| **Durable execution** | State survives process restarts; resume without re-running succeeded nodes |
| **Streaming** | Multiplexed `["messages",...]` + `["updates",...]` event stream |

### deepagents Capabilities (on top of LangGraph)

| Capability | Description |
|---|---|
| **TodoListMiddleware** | Auto-prompts agent to maintain a running TODO list via `write_todos` tool |
| **SummarizationMiddleware** | Auto-compacts context when token usage > threshold; offloads history to file |
| **SummarizationToolMiddleware** | Exposes `compact_conversation` tool for on-demand compaction |
| **FilesystemMiddleware** | Provides read/write/edit/ls/glob/grep tools out of the box |
| **SubAgentMiddleware** | Spawns child agents with isolated context windows |
| **`interruptOn` config** | Declare which tool names trigger HITL interrupts |
| **MemorySaver** | In-memory checkpointer (sufficient for same-process HITL) |
| **CompositeBackend** | Pluggable storage: LangGraph state + LangGraph store backends |
| **Cross-thread memory files** | Files under `/memories/` prefix survive thread changes |
| **Large-output offloading** | Auto-truncates large tool results in older messages; saves to filesystem |

### What Chorus-cli Currently Uses

| Feature | Used? | Notes |
|---|---|---|
| MemorySaver checkpointer | YES | For HITL resume only — no cross-restart persistence |
| `interruptOn` + HITL | YES | Approval gating before file/shell/git tools |
| Thread_id session continuity | YES | Within a single turn; messages array is the real state |
| recursionLimit (2000) | YES | Workaround for default limit of 25 |
| Streaming messages + updates | YES | Parsed in `streamProcessor.ts` |
| TodoListMiddleware | NO | Actively disabled via `DISABLE_TODO_MIDDLEWARE=1` |
| SummarizationMiddleware | NO | Chorus-cli has its own compaction in `context/compaction.ts` |
| FilesystemMiddleware | NO | Has its own tools in `src/tools/` |
| SubAgentMiddleware | NO | Has its own `delegateTool` + `subagents/runtime.ts` |
| Cross-thread MemoryStore | NO | Uses `harness/projectMemory.ts` |
| Time travel / fork | NO | Not exposed in the CLI |
| Fault tolerance (cross-restart) | NO | No persistent checkpointer configured |
| Retry policies | NO | Not configured |
| Parallel fan-out | NO | Workers run sequentially in `workerEngine.ts` |
| Subgraphs | NO | Flat single-agent structure |
| CompositeBackend | NO | MemorySaver only |

The custom runtime must replicate everything in the YES rows and add proper implementations
for the NO rows that are worth having.

---

## Three-Part Architecture

```
src/
  agent/          ← Part A: custom loop — replaces deepagents + LangGraph
  swarm/          ← Part B: swarm orchestrator — replaces langgraph-swarm
  llm/            ← Part C: provider extension — native streamWithTools()
```

---

# Part A — Custom Agent Loop

## File Layout

```
src/agent/
  types.ts         ← AgentEvent, LoopOptions, ChatMessage, ToolDef, ToolCall, ModelResponse
  loop.ts          ← core while-loop AsyncGenerator (~280 lines)
  checkpointer.ts  ← JsonFileCheckpointer + Checkpointer interface
  memory-store.ts  ← FileMemoryStore: cross-thread persistent key/value + file memory
  middleware.ts    ← AgentMiddleware interface + SummarizationMiddleware + TodoMiddleware
                      + ObservabilityMiddleware + LargeOutputOffloadMiddleware
  hitl.ts          ← HitlGate: Promise-based pause/resume (replaces MemorySaver+Command)
  btw.ts           ← BtwQueue: drain queue between tool rounds
  retry.ts         ← RetryPolicy with exponential backoff, per-tool override
```

## 1. Core Loop (`loop.ts`)

The loop is an `AsyncGenerator` so callers receive typed events without callbacks.

```typescript
export type AgentEvent =
  | { type: "token";       text: string }
  | { type: "thinking";    text: string }
  | { type: "tool-start";  id: string; name: string; args: unknown }
  | { type: "tool-done";   id: string; result: string; durationMs: number }
  | { type: "tool-error";  id: string; error: string; willRetry: boolean }
  | { type: "hitl";        requests: HitlRequest[]; resumeKey: string }
  | { type: "btw";         text: string }
  | { type: "compacted";   removedMessages: number; savedTokens: number }
  | { type: "checkpoint";  round: number; threadId: string }
  | { type: "done";        response: string; reasoning: string; toolCount: number }
  | { type: "error";       message: string; fatal: boolean };

export interface LoopOptions {
  model: LLMProvider;
  tools: ToolDef[];
  messages: ChatMessage[];
  systemPrompt: string;
  threadId: string;
  hitlGate: HitlGate;
  btwQueue: BtwQueue;
  policy: ApprovalPolicy;
  checkpointer: Checkpointer;
  middleware: AgentMiddleware[];
  maxRounds?: number; // default 500
}

export async function* runAgentLoop(options: LoopOptions): AsyncGenerator<AgentEvent> {
  const { model, tools, messages, systemPrompt, threadId, hitlGate,
          btwQueue, policy, checkpointer, middleware, maxRounds = 500 } = options;

  // Restore from checkpoint if a prior interrupted run exists for this thread
  const saved = await checkpointer.load(threadId);
  const history: ChatMessage[] = saved?.messages ?? [...messages];
  let round = saved?.round ?? 0;

  for (; round < maxRounds; round++) {
    // Drain /btw injections before each LLM call
    for (const text of btwQueue.drain()) {
      history.push({ role: "user", content: `[/btw]: ${text}` });
      yield { type: "btw", text };
    }

    await middleware.beforeRound({ round, history });

    // Auto-summarize if context is too long
    const compacted = await middleware.maybeCompact(history, model);
    if (compacted) yield { type: "compacted", ...compacted };

    // LLM call
    let responseText = "";
    for await (const event of model.streamWithTools({ messages: history, tools, systemPrompt })) {
      if (event.type === "token")    { responseText += event.text; yield event; }
      if (event.type === "thinking") { yield event; }
    }

    const response = model.lastResponse();
    if (!response.tool_calls?.length) break; // Model is done

    history.push({ role: "assistant", content: response.content, tool_calls: response.tool_calls });

    // HITL gate — pause before executing tools if policy requires it
    if (hitlGate.shouldPause(response.tool_calls, policy)) {
      await checkpointer.save(threadId, { messages: history, round });
      yield { type: "checkpoint", round, threadId };
      const resumeKey = `hitl-${threadId}-${round}`;
      yield { type: "hitl", requests: response.tool_calls.map(toHitlRequest), resumeKey };
      const decision = await hitlGate.wait(resumeKey);
      if (decision.type === "reject") {
        history.push({ role: "user", content: "Tool execution denied by user." });
        break;
      }
    }

    // Execute tools (parallel when independent)
    // Note: yields emitted after executeToolsParallel returns — cannot yield inside async callbacks
    const toolResults = await executeToolsParallel(response.tool_calls, tools, retryPolicy);
    for (const r of toolResults) {
      yield r.event; // tool-start / tool-done / tool-error
      history.push({ role: "tool", tool_call_id: r.id, content: r.result });
    }

    // Checkpoint after each tool round
    await checkpointer.save(threadId, { messages: history, round });
    yield { type: "checkpoint", round, threadId };
  }

  yield { type: "done", response: responseText,
          reasoning: response.reasoning_content ?? "", toolCount: totalTools };
}
```

## 2. Checkpointer (`checkpointer.ts`)

Replaces LangGraph `MemorySaver` and all pluggable backends.

```typescript
export interface Checkpoint {
  threadId: string;
  round: number;
  messages: ChatMessage[];
  createdAt: number;
  metadata?: Record<string, unknown>;
}

export interface Checkpointer {
  save(threadId: string, state: { messages: ChatMessage[]; round: number }): Promise<void>;
  load(threadId: string): Promise<Checkpoint | null>;              // latest
  loadAt(threadId: string, round: number): Promise<Checkpoint | null>;  // time travel
  list(threadId: string): Promise<Checkpoint[]>;
  fork(threadId: string, round: number, newThreadId: string): Promise<void>;
  delete(threadId: string): Promise<void>;
}
```

**`JsonFileCheckpointer`** — saves `~/.chorus/checkpoints/<threadId>/<round>.json`.
Zero dependencies. Default. Used for HITL resume and fault recovery.

**`SqliteCheckpointer`** — saves to `~/.chorus/checkpoints.db` via `better-sqlite3`.
Optional. Better for time-travel queries and large histories.

**Fault tolerance:** On startup, `agentRunner.ts` calls `checkpointer.load(threadId)`.
If a checkpoint exists from a prior crashed run, the loop resumes from that round.

**Time travel (`/rewind <round>`):**
```typescript
case "/rewind": {
  const round = parseInt(args, 10);
  const checkpoint = await checkpointer.loadAt(currentThreadId, round);
  if (!checkpoint) { dispatch(SYSTEM_MSG("No checkpoint at that round.")); break; }
  const forkId = `${currentThreadId}-fork-${round}-${Date.now()}`;
  await checkpointer.fork(currentThreadId, round, forkId);
  sessionManager.switchThread(forkId);
  dispatch(SYSTEM_MSG(`Rewound to round ${round}. Fork thread: ${forkId}.`));
  break;
}
```

## 3. Memory Store (`memory-store.ts`)

Replaces LangGraph `MemoryStore` and deepagents `/memories/` cross-thread persistence.

```typescript
export interface MemoryStore {
  get(namespace: string, key: string): Promise<string | null>;
  put(namespace: string, key: string, value: string): Promise<void>;
  list(namespace: string): Promise<string[]>;
  delete(namespace: string, key: string): Promise<void>;
  search(namespace: string, query: string): Promise<Array<{ key: string; value: string }>>;
}
```

**`FileMemoryStore`** — stores `~/.chorus/memory/<namespace>/<key>.md`.
Namespace = git repo root path (project-scoped). Text files are human-readable.
The existing `harness/projectMemory.ts` logic merges into this.

**Auto-inject at loop start:** Before the first LLM call, loads all entries under the
current namespace and prepends to the system prompt:

```
## Persistent Memory
- preferences/model: deepseek-r1
- project/goal: Build a Rust CLI tool for file deduplication
```

## 4. Middleware Pipeline (`middleware.ts`)

Replaces deepagents' built-in middleware suite.

```typescript
export interface AgentMiddleware {
  name: string;
  beforeRound?(ctx: RoundContext): Promise<void>;
  afterRound?(ctx: RoundContext): Promise<void>;
  maybeCompact?(history: ChatMessage[], model: LLMProvider): Promise<CompactResult | null>;
  extraTools?(): ToolDef[];
  extraSystemPrompt?(): string;
}
```

| Middleware | Behaviour | Default |
|---|---|---|
| `SummarizationMiddleware` | Triggers compaction at 85% context window; offloads full history to `~/.chorus/history/<threadId>.md` | **ON** |
| `TodoMiddleware` | Injects `write_todos` tool + TODO tracking instructions | **OFF** (breaks Gemma4) |
| `ObservabilityMiddleware` | Structured JSON logs → `~/.chorus/runs/<runId>.jsonl` | **ON** |
| `LargeOutputOffloadMiddleware` | Truncates tool outputs > 8KB; saves full output to `~/.chorus/tool-outputs/<id>.txt` | **ON** |

## 5. HITL Gate (`hitl.ts`)

Replaces `MemorySaver` + `Command(resume: {...})` + `interruptOn` from LangGraph.
No serialization needed — loop is in-process, pauses on a `Promise`.

```typescript
export class HitlGate {
  private gates = new Map<string, (d: HitlDecision) => void>();
  private sessionApproved = new Set<string>();

  shouldPause(toolCalls: ToolCall[], policy: ApprovalPolicy): boolean {
    if (policy === "full_auto" || policy === "suggest") return false;
    return toolCalls.some(tc =>
      HITL_TOOL_NAMES.has(tc.name) && !this.sessionApproved.has(tc.name)
    );
  }

  wait(resumeKey: string): Promise<HitlDecision> {
    return new Promise(resolve => { this.gates.set(resumeKey, resolve); });
  }

  resolve(resumeKey: string, decision: HitlDecision): void {
    if (decision.type === "approve_session") {
      for (const name of decision.toolNames ?? []) this.sessionApproved.add(name);
      this.gates.get(resumeKey)?.({ type: "approve" });
    } else {
      this.gates.get(resumeKey)?.(decision);
    }
    this.gates.delete(resumeKey);
  }
}
```

`useAgentStream.ts` calls `hitlGate.resolve(resumeKey, decision)` from the UI event
handler — identical contract to current code but without LangGraph's serialization.

**Cross-restart HITL:** Checkpointer saves state before yielding `hitl` event.
If the process crashes while waiting for user input, the next startup finds the checkpoint
and re-issues the HITL prompt.

## 6. Retry Policies (`retry.ts`)

```typescript
export interface RetryPolicy {
  maxAttempts: number;
  shouldRetry(error: Error, attempt: number): boolean;
  delayMs(attempt: number): number;
}

export const DEFAULT_RETRY: RetryPolicy = {
  maxAttempts: 3,
  shouldRetry: (err) => err.message.includes("429") || err.message.includes("503"),
  delayMs: (attempt) => Math.min(1000 * 2 ** attempt, 30_000),
};
```

Pass `retryPolicies: { run_command: { maxAttempts: 1 } }` in `LoopOptions` to disable
retries on destructive tools.

## 7. Parallel Tool Execution

When the model returns multiple tool calls, independent ones (no shared file paths) run
in parallel via `Promise.all`. Calls sharing a resource are partitioned into sequential
dependency groups.

```typescript
async function executeToolsParallel(
  toolCalls: ToolCall[],
  tools: ToolDef[],
  policy: RetryPolicy,
): Promise<ToolResult[]> {
  const groups = partitionByDependency(toolCalls); // group by shared file paths
  const results: ToolResult[] = [];
  for (const group of groups) {
    const groupResults = await Promise.all(
      group.map(tc => executeWithRetry(tc, tools, policy))
    );
    results.push(...groupResults);
  }
  return results;
}
```

## 8. Agent Loop Feature Parity Table

| LangGraph / deepagents Feature | Custom Implementation | File |
|---|---|---|
| MemorySaver checkpointer | `JsonFileCheckpointer` | `agent/checkpointer.ts` |
| Persistent checkpointer | `SqliteCheckpointer` (optional) | `agent/checkpointer.ts` |
| Thread management | `threadId` in `LoopOptions` | `agent/loop.ts` |
| Short-term in-thread memory | `history: ChatMessage[]` in checkpoint | `agent/loop.ts` |
| Cross-thread MemoryStore | `FileMemoryStore` → `~/.chorus/memory/` | `agent/memory-store.ts` |
| Time travel + fork | `checkpointer.loadAt()` + `/rewind` | `agent/checkpointer.ts` |
| HITL interrupt + resume | `HitlGate` Promise gate | `agent/hitl.ts` |
| Fault tolerance / crash recovery | Load checkpoint on startup, resume round | `agent/loop.ts` |
| Retry policies | `RetryPolicy` per tool | `agent/retry.ts` |
| Parallel fan-out | `executeToolsParallel` with dependency groups | `agent/loop.ts` |
| TodoListMiddleware | `TodoMiddleware` (off by default) | `agent/middleware.ts` |
| SummarizationMiddleware | `SummarizationMiddleware` | `agent/middleware.ts` |
| SummarizationToolMiddleware | `compact_conversation` tool in middleware | `agent/middleware.ts` |
| Large-output offloading | `LargeOutputOffloadMiddleware` | `agent/middleware.ts` |
| FilesystemMiddleware | existing `src/tools/filesystem.ts` (unchanged) | (existing) |
| SubAgentMiddleware | existing `src/subagents/delegateTool.ts` (unchanged) | (existing) |
| `interruptOn` config | `HitlGate.shouldPause()` + `HITL_TOOL_NAMES` | `agent/hitl.ts` |
| Streaming | `AsyncGenerator<AgentEvent>` | `agent/loop.ts` |
| `/btw` mid-task injection | `BtwQueue` drained at top of each round | `agent/btw.ts` |
| Observability logs | `ObservabilityMiddleware` | `agent/middleware.ts` |

---

# Part B — Sophisticated Swarm Orchestrator

## Failure Mode Mitigations

The primary reason naive swarm systems produce garbage output is unmitigated cascading:
Agent A's error enters Agent B as ground truth, which enters Agent C, each hop amplifying
the original fault. Every design decision below targets a specific failure mode.

| Failure Mode | Root Cause | Mitigation |
|---|---|---|
| Garbage output cascading | Agent A error enters Agent B as ground truth | Output validation before broadcasting; structured handoff schema |
| Context contamination | Full message history passed uncritically | Three context modes: `full` / `isolated` / `filtered` |
| Role drift | Agents assume others' responsibilities | `handoffDestinations` whitelist; per-agent tool filtering; `outputValidator` |
| Lost context in handoffs | Lossy summarization ("Goldilocks dilemma") | Structured `taskDescription` field + explicit `artifacts[]` keys |
| Endless loops | No termination criteria | Per-agent `maxRounds`; per-swarm `maxHandoffs`; same-agent-3× circuit breaker |
| Token budget explosions | Uncoordinated parallel agents | Per-agent token budget cap; hard circuit breaker |
| No observability | Non-deterministic parallel execution | Correlation IDs; structured JSONL trace per run |

## Two Orchestration Patterns

**Swarm** — agents hand off directly to each other (peer-to-peer).
- Active agent tracked in `SwarmSession.activeAgent`
- No intermediary; fewer LLM calls; ~40% latency reduction vs supervisor
- Best for: well-defined specialist domains, conversation continuity

**Supervisor** — a coordinator agent routes work to specialists.
- Builds on and enhances existing `workerEngine.ts`
- Best for: complex tasks, blurry domain boundaries, centralized control
- Easier to debug — all routing decisions go through one node

## File Layout

```
src/swarm/
  types.ts           ← SwarmAgent, SwarmSession, HandoffRequest, SwarmEvent, SwarmConfig
  orchestrator.ts    ← main swarm loop: active-agent routing, handoff dispatch (~300 lines)
  handoff.ts         ← createHandoffTools(), buildAgentContext(), context filter logic
  session.ts         ← SwarmSession lifecycle: create, update, artifact store
  circuit-breaker.ts ← loop detection, per-agent budget, role-drift guard
  validator.ts       ← output validation before broadcasting to shared state
  registry.ts        ← SwarmRegistry: extends AgentDef with swarm config
  supervisor.ts      ← Supervisor pattern: coordinator routes to specialists
  trace.ts           ← SwarmTracer: correlation IDs, JSONL event log per run
```

## Core Types

```typescript
export interface SwarmAgent {
  name: string;
  description: string;           // used in handoff tool descriptions
  systemPrompt: string;
  tools: ToolDef[];
  handoffDestinations: string[]; // WHITELIST — can only hand off to these agents
  contextMode: "shared"          // full shared message history
              | "isolated"       // only messages where this agent was active
              | "filtered";      // spec + task_description only (zero history pollution)
  maxRounds: number;             // per-agent circuit breaker (default 5 for specialists)
  model?: string;                // optional per-agent model override
  outputValidator?: (output: string) => { ok: boolean; reason?: string };
}

export interface SwarmSession {
  sessionId: string;
  swarmId: string;
  messages: ChatMessage[];           // shared message history
  activeAgent: string | null;        // currently executing agent
  artifacts: Record<string, string>; // named artifacts: spec, plan, code, test_cases
  agentHistory: string[];            // sequence of active agents (for loop detection)
  spec: string;                      // invariant intent anchor — always injected in position 0
  handoffCount: number;
  tokenBudget: TokenBudget;
  traceId: string;
}

export interface HandoffRequest {
  targetAgent: string;
  taskDescription: string;       // precise: what the NEXT agent must do, not what this one did
  contextMode?: "full" | "isolated" | "filtered"; // override agent default
  artifacts: string[];           // artifact keys to carry through
  reasoning?: string;            // why this handoff (for trace)
}

export type SwarmEvent =
  | { type: "swarm-start";     swarmId: string; agents: string[] }
  | { type: "agent-start";     agent: string; traceId: string }
  | { type: "agent-done";      agent: string; responseText: string }
  | { type: "handoff";         from: string; to: string; taskDescription: string }
  | { type: "artifact-set";    key: string; agentSource: string }
  | { type: "validation-fail"; agent: string; reason: string }
  | { type: "circuit-break";   reason: string; agent: string }
  | AgentEvent;  // re-emits inner loop events tagged with agent name
```

## Swarm Orchestrator Loop

```typescript
// src/swarm/orchestrator.ts
export async function* runSwarm(config: SwarmConfig): AsyncGenerator<SwarmEvent> {
  const session = createSession(config);
  yield { type: "swarm-start", swarmId: session.swarmId, agents: config.agents.map(a => a.name) };

  while (session.activeAgent !== null) {
    const agent = registry.get(session.activeAgent);

    // Circuit breaker check FIRST — before burning any tokens
    const cb = circuitBreaker.check(session, agent);
    if (cb.tripped) { yield { type: "circuit-break", ...cb }; break; }

    // Build context for this agent (apply contextMode)
    const context = buildAgentContext(session, agent);

    // Generate handoff tools for this agent's allowed destinations
    const handoffTools = createHandoffTools(agent.handoffDestinations, config.agents);

    yield { type: "agent-start", agent: agent.name, traceId: session.traceId };

    let handoffRequest: HandoffRequest | null = null;
    const outputChunks: string[] = [];

    for await (const event of runAgentLoop({
      messages: context,
      tools: [...agent.tools, ...handoffTools, ...artifactTools],
      systemPrompt: buildSystemPrompt(agent, session.spec, session.artifacts),
      maxRounds: agent.maxRounds,
      // checkpointer, hitlGate, btwQueue passed through
    })) {
      yield { ...event, agent: agent.name } as SwarmEvent;
      if (event.type === "token") outputChunks.push(event.text);
      if (event.type === "tool-done" && isHandoffTool(event.name)) {
        handoffRequest = parseHandoffResult(event.result);
      }
    }

    // Validate BEFORE broadcasting to shared state
    const agentOutput = outputChunks.join("");
    const validation = agent.outputValidator?.(agentOutput);
    if (validation && !validation.ok) {
      yield { type: "validation-fail", agent: agent.name, reason: validation.reason! };
      injectValidationError(session, agent.name, validation.reason!);
      // Do NOT update session.messages — contamination blocked
    } else {
      broadcastToSharedState(session, agentOutput, agent.name);
    }

    yield { type: "agent-done", agent: agent.name, responseText: agentOutput };

    if (handoffRequest) {
      yield { type: "handoff", from: agent.name, to: handoffRequest.targetAgent,
               taskDescription: handoffRequest.taskDescription };
      applyHandoff(session, handoffRequest);
      session.activeAgent = handoffRequest.targetAgent;
      session.agentHistory.push(handoffRequest.targetAgent);
      session.handoffCount++;
    } else {
      session.activeAgent = null;
    }
  }
}
```

## Context Filtering — Key to Preventing Garbage Output

```typescript
// src/swarm/handoff.ts
function buildAgentContext(session: SwarmSession, agent: SwarmAgent): ChatMessage[] {
  switch (agent.contextMode) {
    case "shared":
      // Full history — use for orchestrators / coordinators / reviewers
      return session.messages;

    case "isolated":
      // Only messages from this agent's own turns + user messages
      return session.messages.filter(m =>
        m.agentSource === agent.name || m.role === "user"
      );

    case "filtered":
      // ONLY: spec + handoff task_description — zero history pollution
      // Best for coding specialists — they need the task, not the conversation
      return [{
        role: "system",
        content: buildFilteredContext(session.spec, session.artifacts,
                   getLastHandoffDescription(session, agent.name)),
      }];
  }
}
```

## Handoff Tools (Generated Per Agent)

```typescript
// src/swarm/handoff.ts
function createHandoffTools(destinations: string[], agents: SwarmAgent[]): ToolDef[] {
  return destinations.map(targetName => {
    const target = agents.find(a => a.name === targetName)!;
    return {
      name: `handoff_to_${targetName.toLowerCase()}`,
      description: `Transfer control to ${target.description}. ` +
                   `Use when you need ${targetName}'s expertise to continue.`,
      parameters: {
        type: "object",
        properties: {
          taskDescription: {
            type: "string",
            description: "Precise description of what the next agent must accomplish. " +
                         "Describe what THEY should do — not what you did.",
          },
          artifacts: {
            type: "array", items: { type: "string" },
            description: "Named artifact keys the next agent needs. E.g. ['spec', 'plan'].",
          },
          reasoning: { type: "string", description: "Brief reason for the handoff." },
        },
        required: ["taskDescription"],
      },
    };
  });
}
```

## Circuit Breaker

```typescript
// src/swarm/circuit-breaker.ts
export function check(session: SwarmSession, agent: SwarmAgent): CircuitBreakerResult {
  // 1. Same agent 3× in a row → infinite loop
  const last3 = session.agentHistory.slice(-3);
  if (last3.length === 3 && last3.every(a => a === agent.name))
    return { tripped: true, reason: `${agent.name} looping — same agent 3× in a row` };

  // 2. Total handoffs exceeded
  if (session.handoffCount >= MAX_HANDOFFS)
    return { tripped: true, reason: `Max handoffs (${MAX_HANDOFFS}) reached` };

  // 3. Per-agent token budget exhausted
  const agentTokens = session.tokenBudget.perAgent[agent.name] ?? 0;
  if (agentTokens >= MAX_TOKENS_PER_AGENT)
    return { tripped: true, reason: `${agent.name} token budget exhausted` };

  return { tripped: false };
}
```

## Artifact Store

Shared, named outputs that survive handoffs and are never summarized away.
Injected into every agent's system prompt as `## Shared Artifacts`.

```typescript
// Tools available to all swarm agents:
set_artifact(key: string, value: string)  // store spec, plan, pseudocode, test_cases, etc.
get_artifact(key: string)                 // retrieve an artifact by key
```

## Swarm Trace (Full Observability)

Every run writes `~/.chorus/swarm-traces/<swarmId>.jsonl`:
```jsonl
{"ts":1234,"type":"swarm-start","agents":["planner","builder","reviewer"]}
{"ts":1235,"type":"agent-start","agent":"planner","traceId":"abc"}
{"ts":1280,"type":"handoff","from":"planner","to":"builder","task":"Implement X"}
{"ts":1350,"type":"validation-fail","agent":"builder","reason":"Missing error handling"}
{"ts":1351,"type":"agent-start","agent":"builder","traceId":"abc"}
{"ts":1420,"type":"agent-done","agent":"builder"}
{"ts":1421,"type":"swarm-done","handoffCount":2,"totalTokens":12400}
```

## Agent Registry (Extends Existing AgentDef)

```typescript
// src/swarm/registry.ts — extends src/agents/types.ts
export interface SwarmAgentDef extends AgentDef {
  handoffDestinations?: string[];
  contextMode?: "shared" | "isolated" | "filtered";
  maxRounds?: number;
  swarmRole?: "coordinator" | "specialist" | "verifier";
  outputSchema?: Record<string, unknown>; // JSON Schema for output validation
}
// Loaded from ~/.chorus/agents/*.json and ./.chorus/agents/*.json (same loader, extended)
```

## Built-in Swarm Presets

**`plan-build-review`** — for coding tasks:
- Planner: `filtered`, max 5 rounds → hands off to Builder
- Builder: `filtered`, max 20 rounds → hands off to Reviewer
- Reviewer: `full`, max 5 rounds → can hand back to Builder

**`research-synthesize`**:
- Researcher: `isolated`, max 10 rounds → hands off to Synthesizer
- Synthesizer: `shared`, max 5 rounds — terminal

**`vapt-report`**:
- Recon: `isolated`, max 10 rounds → Exploiter
- Exploiter: `isolated`, max 10 rounds → Reporter
- Reporter: `filtered`, max 5 rounds — terminal

## CLI Integration

```
/swarm <agent1> <agent2> ...  — spawn a swarm with named agents
/swarm <preset-name>          — use a built-in preset
/swarm-status                 — show active swarm session state
/swarm-abort                  — kill current swarm
/swarm-trace                  — open last swarm trace in pager
/rewind <round>               — rewind agent loop to checkpoint at round N
/btw <text>                   — inject context between tool rounds
```

UI feed additions:
- `SwarmHandoffCard` — shows `from → to` + taskDescription; styled distinctly from tool calls
- Per-agent collapsible sections in feed
- Circuit breaker fire → red system message with explanation

---

# Part C — Provider Extension

## `streamWithTools()` on VllmProvider and OllamaProvider

Extends existing native SSE parsing in `vllmProvider.ts`. Tool calls arrive as
index-keyed delta chunks per OpenAI spec and must be accumulated across chunks:

```
chunk 1: [{index:0, id:"tc_1", function:{name:"file_write", arguments:""}}]
chunk 2: [{index:0, function:{arguments:'{"path":'}}]
chunk 3: [{index:0, function:{arguments:'"foo.ts","content":"hello"}'}}]
→ parse accumulated arguments JSON at stream end
```

```typescript
// Added to LLMProvider interface:
streamWithTools(input: {
  messages: ChatMessage[];
  tools: ToolDef[];
  systemPrompt?: string;
}): AsyncGenerator<ToolStreamEvent>;

// ToolStreamEvent:
type ToolStreamEvent =
  | { type: "token";    text: string }
  | { type: "thinking"; text: string }         // DeepSeek reasoning_content
  | { type: "done";     response: ModelResponse };

// ModelResponse:
type ModelResponse = {
  content: string;
  reasoning_content?: string;
  tool_calls?: ToolCall[];
};
```

DeepSeek `reasoning_content` fetch intercept in `vllmProvider.ts` stays unchanged.
`OllamaProvider.streamWithTools()` uses Ollama `/api/chat` with `tools:` field
(same OpenAI-compatible format, Ollama 0.4+).

---

# Implementation Phases

### Phase 1 — Provider layer (Day 1) [DONE]
1. Add `ToolDef`, `ToolCall`, `ModelResponse`, `ToolStreamEvent` to `src/llm/provider.ts`
2. Implement `VllmProvider.streamWithTools()` — extend SSE loop, accumulate `delta.tool_calls`
3. Implement `OllamaProvider.streamWithTools()` — Ollama `/api/chat` with `tools:`
4. Write fixture unit tests for tool-call accumulation before proceeding

### Phase 2 — Core loop + HITL + checkpoint (Day 2) [DONE]
> Bug fix: checkpoint restore now only activates when `waitingForHitl` is set — prevents completed-turn checkpoints from silently dropping the next user message on multi-turn runs.
1. Create `src/agent/types.ts`, `hitl.ts`, `btw.ts`, `retry.ts`
2. Create `src/agent/checkpointer.ts` with `JsonFileCheckpointer`
3. Create `src/agent/loop.ts` — full while loop
4. Update `src/cli/hooks/agent/agentRunner.ts` — replace `createDeepAgent` +
   `runAgentStream` + `resumeAgentStream`; keep `prepareHarness()` + `finalizeTurn()`
5. Update `src/cli/hooks/useAgentStream.ts` — `hitlGate.resolve()`, wire `/btw`
6. Simplify `src/cli/agent/streamProcessor.ts` — consume `AgentEvent` directly

### Phase 3 — Memory + middleware (Day 3) [DONE]
1. Create `src/agent/memory-store.ts` with `FileMemoryStore`
2. Create `src/agent/middleware.ts` with all four built-in middleware
3. Merge `harness/projectMemory.ts` into `FileMemoryStore`
4. Move auto-compaction from `context/compaction.ts` into `SummarizationMiddleware`
5. Wire summarization threshold to `contextWindows.ts`
> Implementation note: `projectMemory.ts` retained its JSON-blob format to avoid breaking existing saved state; `FileMemoryStore` is the general-purpose key-value layer for new features. Pre-loop compaction in `useAgentStream.ts` removed — `SummarizationMiddleware` now handles it at 85% of model context window each round. `CompactionResult` extended with `messages` field so the middleware can use the compacted array directly. 15 new unit/integration tests in `tests/middleware.test.ts`.

### Phase 4 — Cleanup (Day 4) [DONE]
1. Delete `patches/deepagents+1.10.1.patch`
2. Remove `deepagents`, `@langchain/langgraph` from `package.json`
3. Run `tsc --noEmit` + fix type errors
4. Full smoke test: long tool chain, HITL approve/deny, `/btw` injection, crash recovery
> `patches/` was already empty (patch had been manually removed earlier). `deepagents` and `@langchain/langgraph` removed from `package.json`. All five `deepagents`-importing files migrated: `subagents/planner|vapt|builder.ts` now use local `SubAgentDef` type; `subagents/index.ts` re-exports it; `subagents/runtime.ts` replaces `createDeepAgent` + LangGraph stream parser with a clean `runAgentLoop` call; `subagents/delegateTool.ts` accepts `{ provider, modelName }` instead of `BaseChatModel`; `agentRunner.ts` + `useAgentStream.ts` drop `delegateModel` throughout. `tsc --noEmit` clean, 118/118 tests pass. `langchain`, `@langchain/core`, `@langchain/ollama`, `@langchain/openai` retained (Phase 8 scope).

### Phase 5 — Swarm core (Days 5–6) [DONE]
1. Create `src/swarm/types.ts`, `session.ts`, `circuit-breaker.ts`, `validator.ts`, `trace.ts`
2. Create `src/swarm/handoff.ts` — `createHandoffTools()`, `buildAgentContext()` with context modes
3. Create `src/swarm/orchestrator.ts` — swarm loop as `AsyncGenerator<SwarmEvent>`
4. Create `src/swarm/registry.ts` — extend `AgentDef` loader with swarm fields
5. Add `set_artifact` / `get_artifact` artifact store tools

### Phase 6 — Supervisor + presets (Day 7) [DONE]
1. Create `src/swarm/supervisor.ts` — coordinator routes to specialists, validates results
2. Ship 3 built-in presets: `plan-build-review`, `research-synthesize`, `vapt-report`
3. Wire presets to `/swarm <preset>` shortcut

### Phase 7 — UI integration (Day 8) [DONE] ✅
1. Added `SwarmAgentSection`, `SwarmHandoffRecord`, `swarm-turn` FeedEntry to `feedReducer.ts`
2. Added 13 swarm FeedActions (SWARM_START → SWARM_TOGGLE_AGENT) with full reducer coverage
3. Created `SwarmHandoffCard.tsx` — directional arrow (from→to) with task excerpt
4. Created `SwarmAgentCard.tsx` — per-agent collapsible section with status, stream, tools
5. Created `SwarmTurnCard.tsx` — wraps full swarm run; interleaves sections and handoffs
6. Updated `Feed.tsx` — fixed lastTurnIndex scan to include running swarm-turns; renders SwarmTurnCard
7. Updated `App.tsx` — runSwarmPreset dispatches typed swarm actions; AbortController ref; stopSwarm/listSwarmTraces callbacks
8. Updated `commands.ts` — added /swarm-stop, /swarm-traces slash commands
9. 26 new reducer tests; total 175/175 passing

### Phase 8 — Drop all LangChain (Day 9, optional) [DONE] ✅
Remove `@langchain/core`, `@langchain/openai`, `@langchain/ollama`, `langchain`, `langsmith`.
Delete `createChatModel()` from `LLMProvider` (only called by deepagents — unused after Phase 2).
Remove `AIMessage`, `HumanMessage`, `SystemMessage` from `agentRunner.ts`.
> Native `tool()` helper created in `src/tools/tool.ts` — full Zod validation, zero dependencies.
> `OllamaProvider.generate()` and `.stream()` rewritten to native fetch against `/api/chat`.
> `agents/generator.ts` migrated to `provider.generate()`.
> `deepAgentToolMiddleware.ts` deleted (deepagents compatibility layer, no longer referenced).
> 50 packages removed from node_modules; 173/173 tests pass; `tsc --noEmit` clean.

---

## Dependency Delta

### After Phase 4 (minimum — patches + main framework gone)
```
removed: deepagents, @langchain/langgraph
kept:    @langchain/core, @langchain/openai, @langchain/ollama, langchain
new:     (none)
```

### After Phase 8 (full — all LangChain gone)
```
removed: deepagents, @langchain/langgraph, @langchain/core,
         @langchain/openai, @langchain/ollama, langchain, langsmith
new:     better-sqlite3 (optional, for SqliteCheckpointer only)
savings: ~45 MB node_modules
```

---

## Modified Files Reference

| File | Change |
|---|---|
| `src/llm/provider.ts` | Add `ToolDef`, `ToolCall`, `ModelResponse`, `ToolStreamEvent`; add `streamWithTools()` |
| `src/llm/vllmProvider.ts` | Implement `streamWithTools()`; existing DeepSeek fetch intercept unchanged |
| `src/llm/ollamaProvider.ts` | Implement `streamWithTools()` |
| `src/cli/hooks/agent/agentRunner.ts` | Replace deepagents calls; keep `prepareHarness()` + `finalizeTurn()` |
| `src/cli/hooks/useAgentStream.ts` | Replace `resumeAgentStream` with `hitlGate.resolve()`; wire `/btw` |
| `src/cli/agent/streamProcessor.ts` | Simplify or delete; consume `AgentEvent` |
| `src/harness/projectMemory.ts` | Merge into `FileMemoryStore` |
| `src/context/compaction.ts` | Move logic into `SummarizationMiddleware` |
| `src/cli/state/feedReducer.ts` | Add `SwarmHandoffEvent`, `SwarmAgentEvent` |
| `src/agents/loader.ts` + `types.ts` | Extend `AgentDef` with swarm fields |
| `src/harness/workerEngine.ts` | Supervisor pattern builds on this |
| `src/subagents/runtime.ts` | `executeSubagent()` → calls `runAgentLoop()` |
| `src/cli/commands.ts` | Add `/btw`, `/rewind`, `/swarm`, `/swarm-*` |
| `package.json` | Remove dependencies per phase |
| `patches/deepagents+1.10.1.patch` | Delete |

---

## Risk Checklist

- [ ] Verify `delta.tool_calls` accumulation format against deployed vLLM model
- [ ] Verify Ollama `/api/chat` tool_call response format (requires Ollama 0.4+)
- [ ] Decide checkpoint storage: JSON files (zero deps) vs SQLite (faster queries)
- [ ] `maxRounds` default: 500 (≈ 2000 LangGraph supersteps ÷ 2 rounds per superstep)
- [ ] `TodoMiddleware` off by default — enable per-project in settings
- [ ] `FileMemoryStore` namespace = git repo root path (project-scoped, not global)
- [ ] `MAX_HANDOFFS` default for swarm: 10 (override per preset)
- [ ] `MAX_TOKENS_PER_AGENT` default: 50K tokens per specialist agent

---

## Verification

1. **Unit tests** — `src/agent/__tests__/`: tool-call accumulation fixtures for vLLM + Ollama;
   `HitlGate` pause/resume; `JsonFileCheckpointer` save/load/fork; `CircuitBreaker` fires
2. **Integration smoke test** — long tool chain (>50 rounds), no recursion limit error
3. **HITL test** — approve, deny, approve-session flows; verify checkpoint saves before yield
4. **Crash recovery test** — kill process mid-run, restart, verify loop resumes from checkpoint
5. **Swarm test** — run `plan-build-review` preset on a real task; verify:
   - No context contamination (builder receives only spec + task_description, not planner history)
   - Handoff `taskDescription` is precise and actionable
   - Circuit breaker fires after 3× same-agent loop
   - `~/.chorus/swarm-traces/<swarmId>.jsonl` written with full event log
6. **`tsc --noEmit`** — zero type errors after `@langchain/langgraph` removal

---

## Industry Reference

| Framework | Approach | What We Learn |
|---|---|---|
| **smolagents** (HuggingFace) | ~1,000 lines, pure while loop, no LangGraph | Minimal loop is production-viable |
| **Claude Code** (Anthropic) | Custom async generator loop, HITL via interrupt signals | Same architecture as this plan |
| **OpenAI Agents SDK** | Thin wrapper over a while loop, handoffs as first-class primitive | Validates dropping complex orchestration |
| **LangGraph** | Best for multi-agent branching, durable cross-process persistence, visual debugger | None of these features are used in Chorus-cli |

The consensus: **a while loop is the right primitive for a CLI agent harness**.
Frameworks add value for parallel branches, durable queues, or graph visualizers.
For Chorus-cli, they add cost with no return.
