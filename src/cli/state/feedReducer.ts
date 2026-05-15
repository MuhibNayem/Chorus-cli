// ── Types ────────────────────────────────────────────────────────────────────

// ── Swarm Types ───────────────────────────────────────────────────────────────

export type SwarmContextMode = "shared" | "isolated" | "filtered";

export type SwarmAgentSection = {
  sectionId: string;
  agentName: string;
  contextMode: SwarmContextMode;
  status: "running" | "done" | "error";
  text: string;
  tools: ToolCard[];
  startedAt: number;
  completedAt?: number;
  expanded: boolean;
  errorReason?: string;
};

export type SwarmHandoffRecord = {
  from: string;
  to: string;
  taskDescription: string;
  reasoning?: string;
};

export type ToolCard = {
  id: string;
  name: string;
  args: unknown;
  result?: string;
  status: "running" | "done" | "error";
  expanded: boolean;
};

/** Ordered timeline of events within a single agent turn */
export type ThinkingEvent = {
  kind: "thinking";
  id: string;
  text: string;
  expanded: boolean;
  durationMs?: number;
};

export type ToolEvent = {
  kind: "tool";
  card: ToolCard;
};

export type ResponseEvent = {
  kind: "response";
  text: string;
};

export type WorkerEvent = {
  kind: "worker";
  card: WorkerCardData;
};

export type SubagentEvent = {
  kind: "subagent";
  card: SubagentCardData;
};

export type TurnEvent = ThinkingEvent | ToolEvent | ResponseEvent | WorkerEvent | SubagentEvent;

export type FeedEntry =
  | { kind: "user"; id: string; text: string }
  | {
      kind: "turn";
      id: string;
      events: TurnEvent[];
      done: boolean;
      startedAt: number;
    }
  | { kind: "error"; id: string; message: string }
  | { kind: "system"; id: string; text: string }
  | {
      kind: "swarm-turn";
      id: string;
      swarmId: string;
      presetName: string;
      agentSections: SwarmAgentSection[];
      handoffs: SwarmHandoffRecord[];
      artifactKeys: string[];
      status: "running" | "done" | "error";
      handoffCount: number;
      totalAgentRounds: number;
      startedAt: number;
      completedAt?: number;
      circuitBreakReason?: string;
      done: boolean;
    };

// ── Worker / Subagent Card Data ──────────────────────────────────────────────

export interface WorkerCardData {
  id: string;
  role: string;
  emoji: string;
  color: string;
  status: "running" | "done" | "error";
  summary: string;
  sessionId?: string;
}

export interface SubagentCardData {
  id: string;
  name: string;
  task: string;
  status: "running" | "done" | "error";
  text: string;
  result?: string;
  sessionId?: string;
  expanded?: boolean;
}

// ── Session Types ────────────────────────────────────────────────────────────

export interface AgentSession {
  id: string;
  name: string;
  type: "worker" | "subagent";
  status: "running" | "done" | "error";
  events: TurnEvent[];
  startedAt: number;
  completedAt?: number;
  parentTurnId: string;
}

// ── Actions ──────────────────────────────────────────────────────────────────

export type FeedAction =
  | { type: "APPEND_USER"; id: string; text: string; startedAt: number }
  | { type: "APPEND_USER_MSG"; id: string; text: string }
  | { type: "APPEND_THINK_TOKEN"; text: string }
  | { type: "APPEND_RESPONSE_TOKEN"; text: string }
  | { type: "ADD_TOOL_CALL"; toolCall: Omit<ToolCard, "expanded"> }
  | { type: "UPDATE_TOOL_CALL"; id: string; result: string; status: "done" | "error" }
  | { type: "FINALIZE_TURN"; completedAt: number }
  | { type: "TOGGLE_EXPANDED"; id: string }
  | { type: "SET_ERROR"; id: string; message: string }
  | { type: "APPEND_SYSTEM"; id: string; text: string }
  | { type: "CLEAR_FEED" }
  | { type: "LOAD_HISTORY"; messages: Array<{ role: string; content: string }> }
  // Worker actions
  | { type: "ADD_WORKER"; worker: WorkerCardData }
  | { type: "UPDATE_WORKER"; id: string; status: "running" | "done" | "error"; result?: string }
  // Subagent actions
  | { type: "ADD_SUBAGENT"; subagent: SubagentCardData }
  | { type: "APPEND_SUBAGENT_TOKEN"; id: string; text: string }
  | { type: "APPEND_SESSION_THINK_TOKEN"; sessionId: string; text: string }
  | { type: "UPDATE_SUBAGENT"; id: string; status: "running" | "done" | "error"; result?: string }
  | { type: "FINALIZE_SUBAGENT"; id: string; completedAt: number }
  // Session actions
  | { type: "ADD_SESSION_EVENT"; sessionId: string; event: TurnEvent }
  | { type: "FINALIZE_SESSION"; sessionId: string; completedAt: number }
  | { type: "ADD_USAGE"; inputTokens: number; outputTokens: number; cost: number }
  // Swarm actions
  | { type: "SWARM_START"; swarmId: string; presetName: string; agents: string[]; startedAt: number }
  | { type: "SWARM_AGENT_START"; swarmId: string; agentName: string; contextMode: SwarmContextMode; startedAt: number }
  | { type: "SWARM_AGENT_TOKEN"; swarmId: string; agentName: string; text: string }
  | { type: "SWARM_TOOL_START"; swarmId: string; agentName: string; toolCall: Omit<ToolCard, "expanded"> }
  | { type: "SWARM_TOOL_DONE"; swarmId: string; agentName: string; toolId: string; result: string; status: "done" | "error" }
  | { type: "SWARM_AGENT_DONE"; swarmId: string; agentName: string; completedAt: number }
  | { type: "SWARM_HANDOFF"; swarmId: string; from: string; to: string; taskDescription: string; reasoning?: string }
  | { type: "SWARM_ARTIFACT"; swarmId: string; key: string }
  | { type: "SWARM_VALIDATION_FAIL"; swarmId: string; agentName: string; reason: string }
  | { type: "SWARM_CIRCUIT_BREAK"; swarmId: string; agent: string; reason: string }
  | { type: "SWARM_DONE"; swarmId: string; handoffCount: number; totalAgentRounds: number; completedAt: number }
  | { type: "SWARM_ERROR"; swarmId: string; message: string }
  | { type: "SWARM_TOGGLE_AGENT"; swarmId: string; sectionId: string };

export interface FeedState {
  entries: FeedEntry[];
  processing: boolean;
  sessions: Record<string, AgentSession>;
  totalCost: number;
  totalInputTokens: number;
  totalOutputTokens: number;
}

export const initialFeedState: FeedState = {
  entries: [],
  processing: false,
  sessions: {},
  totalCost: 0,
  totalInputTokens: 0,
  totalOutputTokens: 0,
};

// ── Helpers ───────────────────────────────────────────────────────────────────

type SwarmTurnEntry = Extract<FeedEntry, { kind: "swarm-turn" }>;

function mapSwarmTurn(
  entries: FeedEntry[],
  swarmId: string,
  fn: (turn: SwarmTurnEntry) => SwarmTurnEntry,
): FeedEntry[] {
  return entries.map((e) =>
    e.kind === "swarm-turn" && e.swarmId === swarmId ? fn(e) : e,
  );
}

function updateActiveAgentSection(
  sections: SwarmAgentSection[],
  agentName: string,
  fn: (s: SwarmAgentSection) => SwarmAgentSection,
): SwarmAgentSection[] {
  let lastIdx = -1;
  for (let i = sections.length - 1; i >= 0; i--) {
    if (sections[i].agentName === agentName && sections[i].status === "running") {
      lastIdx = i;
      break;
    }
  }
  if (lastIdx === -1) return sections;
  return sections.map((s, i) => (i === lastIdx ? fn(s) : s));
}

function mapActiveTurn(
  entries: FeedEntry[],
  fn: (turn: Extract<FeedEntry, { kind: "turn" }>) => Extract<FeedEntry, { kind: "turn" }>
): FeedEntry[] {
  return entries.map((e) => (e.kind === "turn" && !e.done ? fn(e) : e));
}

function mapActiveTurnEvent(
  entries: FeedEntry[],
  eventId: string,
  fn: (event: WorkerEvent | SubagentEvent) => WorkerEvent | SubagentEvent
): FeedEntry[] {
  return entries.map((e) => {
    if (e.kind !== "turn" || e.done) return e;
    const events = e.events.map((ev) => {
      if ((ev.kind === "worker" || ev.kind === "subagent") && ev.card.id === eventId) {
        return fn(ev);
      }
      return ev;
    });
    return { ...e, events };
  });
}

// ── Reducer ───────────────────────────────────────────────────────────────────

export function feedReducer(state: FeedState, action: FeedAction): FeedState {
  switch (action.type) {
    case "APPEND_USER": {
      const userEntry: FeedEntry = { kind: "user", id: action.id, text: action.text };
      const turnEntry: FeedEntry = {
        kind: "turn",
        id: `turn-${action.id}`,
        events: [],
        done: false,
        startedAt: action.startedAt,
      };
      return {
        ...state,
        entries: [...state.entries, userEntry, turnEntry],
        processing: true,
      };
    }

    // User message only — no accompanying agent turn (used for slash commands)
    case "APPEND_USER_MSG": {
      return {
        ...state,
        entries: [...state.entries, { kind: "user", id: action.id, text: action.text }],
      };
    }

    case "APPEND_THINK_TOKEN": {
      return {
        ...state,
        entries: mapActiveTurn(state.entries, (turn) => {
          const last = turn.events[turn.events.length - 1];
          if (last?.kind === "thinking") {
            // Append to the current thinking segment
            const updated: ThinkingEvent = { ...last, text: last.text + action.text, expanded: true };
            return { ...turn, events: [...turn.events.slice(0, -1), updated] };
          }
          // New thinking segment
          const ev: ThinkingEvent = {
            kind: "thinking",
            id: `${turn.id}-think-${turn.events.length}`,
            text: action.text,
            expanded: true,
          };
          return { ...turn, events: [...turn.events, ev] };
        }),
      };
    }

    case "APPEND_RESPONSE_TOKEN": {
      return {
        ...state,
        entries: mapActiveTurn(state.entries, (turn) => {
          const last = turn.events[turn.events.length - 1];
          if (last?.kind === "response") {
            const updated: ResponseEvent = { kind: "response", text: last.text + action.text };
            return { ...turn, events: [...turn.events.slice(0, -1), updated] };
          }
          const ev: ResponseEvent = { kind: "response", text: action.text };
          return { ...turn, events: [...turn.events, ev] };
        }),
      };
    }

    case "ADD_TOOL_CALL": {
      return {
        ...state,
        entries: mapActiveTurn(state.entries, (turn) => {
          const card: ToolCard = { ...action.toolCall, expanded: false };
          const ev: ToolEvent = { kind: "tool", card };
          return { ...turn, events: [...turn.events, ev] };
        }),
      };
    }

    case "UPDATE_TOOL_CALL": {
      return {
        ...state,
        entries: mapActiveTurn(state.entries, (turn) => ({
          ...turn,
          events: turn.events.map((ev) => {
            if (ev.kind !== "tool" || ev.card.id !== action.id) return ev;
            return {
              ...ev,
              card: { ...ev.card, result: action.result, status: action.status },
            };
          }),
        })),
      };
    }

    case "FINALIZE_TURN": {
      return {
        ...state,
        processing: false,
        entries: state.entries.map((e) => {
          if (e.kind !== "turn" || e.done) return e;
          const elapsed = Math.max(0, action.completedAt - e.startedAt);
          const events = e.events.map((ev): TurnEvent => {
            if (ev.kind === "thinking") {
              return { ...ev, expanded: false, durationMs: elapsed };
            }
            return ev;
          });
          return { ...e, done: true, events };
        }),
      };
    }

    case "TOGGLE_EXPANDED": {
      return {
        ...state,
        entries: state.entries.map((e) => {
          if (e.kind !== "turn") return e;
          const events = e.events.map((ev): TurnEvent => {
            if (ev.kind === "thinking" && ev.id === action.id) {
              return { ...ev, expanded: !ev.expanded };
            }
            if (ev.kind === "tool" && ev.card.id === action.id) {
              return { ...ev, card: { ...ev.card, expanded: !ev.card.expanded } };
            }
            if (ev.kind === "worker" && ev.card.id === action.id) {
              return ev;
            }
            if (ev.kind === "subagent" && ev.card.id === action.id) {
              return { ...ev, card: { ...ev.card, expanded: !ev.card.expanded } };
            }
            return ev;
          });
          return { ...e, events };
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

    case "APPEND_SYSTEM": {
      if (state.entries.some((e) => e.id === action.id)) return state;
      return {
        ...state,
        entries: [...state.entries, { kind: "system", id: action.id, text: action.text }],
      };
    }

    case "CLEAR_FEED": {
      return { ...state, entries: [] };
    }

    case "LOAD_HISTORY": {
      const historyEntries: FeedEntry[] = [];
      let msgIndex = 0;
      for (const msg of action.messages) {
        const id = `hist-${msgIndex++}`;
        if (msg.role === "user") {
          historyEntries.push({ kind: "user", id, text: msg.content });
        } else if (msg.role === "assistant") {
          const events: TurnEvent[] = [];
          // Preserve reasoning_content as a thinking block above the response.
          if ((msg as { reasoning_content?: string }).reasoning_content) {
            events.push({
              kind: "thinking",
              id: `turn-${id}-think-0`,
              text: (msg as { reasoning_content?: string }).reasoning_content!,
              expanded: false,
            });
          }
          events.push({ kind: "response", text: msg.content });
          historyEntries.push({
            kind: "turn",
            id: `turn-${id}`,
            events,
            done: true,
            startedAt: 0,
          });
        }
      }
      return { ...state, entries: historyEntries };
    }

    // ── Worker Actions ────────────────────────────────────────────────────────

    case "ADD_WORKER": {
      return {
        ...state,
        entries: mapActiveTurn(state.entries, (turn) => {
          const ev: WorkerEvent = { kind: "worker", card: action.worker };
          return { ...turn, events: [...turn.events, ev] };
        }),
      };
    }

    case "UPDATE_WORKER": {
      return {
        ...state,
        entries: mapActiveTurnEvent(state.entries, action.id, (ev) => {
          if (ev.kind !== "worker") return ev;
          return {
            ...ev,
            card: {
              ...ev.card,
              status: action.status,
              summary: action.result ?? ev.card.summary,
            },
          };
        }),
      };
    }

    // ── Subagent Actions ──────────────────────────────────────────────────────

    case "ADD_SUBAGENT": {
      const sessionId = action.subagent.sessionId;
      const session = sessionId
        ? {
            [sessionId]: {
              id: sessionId,
              name: action.subagent.name,
              type: "subagent" as const,
              status: action.subagent.status,
              events: [],
              startedAt: Date.now(),
              parentTurnId: action.subagent.id,
            },
          }
        : {};
      return {
        ...state,
        entries: mapActiveTurn(state.entries, (turn) => {
          const ev: SubagentEvent = { kind: "subagent", card: { ...action.subagent, expanded: false } };
          return { ...turn, events: [...turn.events, ev] };
        }),
        sessions: { ...state.sessions, ...session },
      };
    }

    case "APPEND_SUBAGENT_TOKEN": {
      const session = state.sessions[action.id];
      if (!session) return state;
      const lastEvent = session.events[session.events.length - 1];
      let newEvents: TurnEvent[];
      if (lastEvent?.kind === "response") {
        newEvents = [
          ...session.events.slice(0, -1),
          { kind: "response", text: lastEvent.text + action.text },
        ];
      } else {
        newEvents = [...session.events, { kind: "response", text: action.text }];
      }
      return {
        ...state,
        entries: mapActiveTurnEvent(state.entries, session.parentTurnId, (ev) => {
          if (ev.kind !== "subagent") return ev;
          return {
            ...ev,
            card: {
              ...ev.card,
              text: ev.card.text + action.text,
            },
          };
        }),
        sessions: {
          ...state.sessions,
          [action.id]: { ...session, events: newEvents },
        },
      };
    }

    case "APPEND_SESSION_THINK_TOKEN": {
      const session = state.sessions[action.sessionId];
      if (!session) return state;
      const lastEvent = session.events[session.events.length - 1];
      let newEvents: TurnEvent[];
      if (lastEvent?.kind === "thinking") {
        newEvents = [
          ...session.events.slice(0, -1),
          { ...lastEvent, text: lastEvent.text + action.text },
        ];
      } else {
        newEvents = [
          ...session.events,
          {
            kind: "thinking",
            id: `${action.sessionId}-think-${session.events.length}`,
            text: action.text,
            expanded: true,
          },
        ];
      }
      return {
        ...state,
        sessions: {
          ...state.sessions,
          [action.sessionId]: { ...session, events: newEvents },
        },
      };
    }

    case "UPDATE_SUBAGENT": {
      const sessionId = Object.values(state.sessions).find((s) => s.parentTurnId === action.id)?.id;
      const session = sessionId ? state.sessions[sessionId] : undefined;
      return {
        ...state,
        entries: mapActiveTurnEvent(state.entries, action.id, (ev) => {
          if (ev.kind !== "subagent") return ev;
          return {
            ...ev,
            card: {
              ...ev.card,
              status: action.status,
              result: action.result ?? ev.card.result,
            },
          };
        }),
        sessions: session
          ? {
              ...state.sessions,
              [session.id]: {
                ...session,
                status: action.status,
                completedAt: action.status === "running" ? undefined : session.completedAt,
              },
            }
          : state.sessions,
      };
    }

    case "FINALIZE_SUBAGENT": {
      const sessionId = Object.values(state.sessions).find((s) => s.parentTurnId === action.id)?.id;
      const session = sessionId ? state.sessions[sessionId] : undefined;
      if (!session) return state;
      return {
        ...state,
        entries: mapActiveTurnEvent(state.entries, action.id, (ev) => {
          if (ev.kind !== "subagent") return ev;
          return { ...ev, card: { ...ev.card, status: "done" } };
        }),
        sessions: {
          ...state.sessions,
          [session.id]: { ...session, status: "done", completedAt: action.completedAt },
        },
      };
    }

    // ── Session Actions ───────────────────────────────────────────────────────

    case "ADD_SESSION_EVENT": {
      const session = state.sessions[action.sessionId];
      if (!session) return state;
      return {
        ...state,
        sessions: {
          ...state.sessions,
          [action.sessionId]: {
            ...session,
            events: [...session.events, action.event],
          },
        },
      };
    }

    case "FINALIZE_SESSION": {
      const session = state.sessions[action.sessionId];
      if (!session) return state;
      return {
        ...state,
        sessions: {
          ...state.sessions,
          [action.sessionId]: {
            ...session,
            status: "done",
            completedAt: action.completedAt,
          },
        },
      };
    }

    case "ADD_USAGE": {
      return {
        ...state,
        totalInputTokens: state.totalInputTokens + action.inputTokens,
        totalOutputTokens: state.totalOutputTokens + action.outputTokens,
        totalCost: state.totalCost + action.cost,
      };
    }

    // ── Swarm Actions ─────────────────────────────────────────────────────────

    case "SWARM_START": {
      const entry: FeedEntry = {
        kind: "swarm-turn",
        id: `swarm-${action.swarmId}`,
        swarmId: action.swarmId,
        presetName: action.presetName,
        agentSections: [],
        handoffs: [],
        artifactKeys: [],
        status: "running",
        handoffCount: 0,
        totalAgentRounds: 0,
        startedAt: action.startedAt,
        done: false,
      };
      return { ...state, entries: [...state.entries, entry] };
    }

    case "SWARM_AGENT_START": {
      const section: SwarmAgentSection = {
        sectionId: `${action.swarmId}-${action.agentName}-${action.startedAt}`,
        agentName: action.agentName,
        contextMode: action.contextMode,
        status: "running",
        text: "",
        tools: [],
        startedAt: action.startedAt,
        expanded: true,
      };
      return {
        ...state,
        entries: mapSwarmTurn(state.entries, action.swarmId, (turn) => ({
          ...turn,
          agentSections: [...turn.agentSections, section],
        })),
      };
    }

    case "SWARM_AGENT_TOKEN": {
      return {
        ...state,
        entries: mapSwarmTurn(state.entries, action.swarmId, (turn) => ({
          ...turn,
          agentSections: updateActiveAgentSection(
            turn.agentSections,
            action.agentName,
            (s) => ({ ...s, text: s.text + action.text }),
          ),
        })),
      };
    }

    case "SWARM_TOOL_START": {
      const card: ToolCard = { ...action.toolCall, expanded: false };
      return {
        ...state,
        entries: mapSwarmTurn(state.entries, action.swarmId, (turn) => ({
          ...turn,
          agentSections: updateActiveAgentSection(
            turn.agentSections,
            action.agentName,
            (s) => ({ ...s, tools: [...s.tools, card] }),
          ),
        })),
      };
    }

    case "SWARM_TOOL_DONE": {
      return {
        ...state,
        entries: mapSwarmTurn(state.entries, action.swarmId, (turn) => ({
          ...turn,
          agentSections: updateActiveAgentSection(
            turn.agentSections,
            action.agentName,
            (s) => ({
              ...s,
              tools: s.tools.map((t) =>
                t.id === action.toolId
                  ? { ...t, result: action.result, status: action.status }
                  : t,
              ),
            }),
          ),
        })),
      };
    }

    case "SWARM_AGENT_DONE": {
      return {
        ...state,
        entries: mapSwarmTurn(state.entries, action.swarmId, (turn) => ({
          ...turn,
          agentSections: updateActiveAgentSection(
            turn.agentSections,
            action.agentName,
            (s) => ({ ...s, status: "done", completedAt: action.completedAt, expanded: false }),
          ),
        })),
      };
    }

    case "SWARM_HANDOFF": {
      const record: SwarmHandoffRecord = {
        from: action.from,
        to: action.to,
        taskDescription: action.taskDescription,
        reasoning: action.reasoning,
      };
      return {
        ...state,
        entries: mapSwarmTurn(state.entries, action.swarmId, (turn) => ({
          ...turn,
          handoffCount: turn.handoffCount + 1,
          handoffs: [...turn.handoffs, record],
        })),
      };
    }

    case "SWARM_ARTIFACT": {
      return {
        ...state,
        entries: mapSwarmTurn(state.entries, action.swarmId, (turn) => ({
          ...turn,
          artifactKeys: turn.artifactKeys.includes(action.key)
            ? turn.artifactKeys
            : [...turn.artifactKeys, action.key],
        })),
      };
    }

    case "SWARM_VALIDATION_FAIL": {
      return {
        ...state,
        entries: mapSwarmTurn(state.entries, action.swarmId, (turn) => ({
          ...turn,
          agentSections: updateActiveAgentSection(
            turn.agentSections,
            action.agentName,
            (s) => ({ ...s, status: "error", errorReason: action.reason }),
          ),
        })),
      };
    }

    case "SWARM_CIRCUIT_BREAK": {
      return {
        ...state,
        entries: mapSwarmTurn(state.entries, action.swarmId, (turn) => ({
          ...turn,
          status: "error",
          circuitBreakReason: action.reason,
        })),
      };
    }

    case "SWARM_DONE": {
      return {
        ...state,
        entries: mapSwarmTurn(state.entries, action.swarmId, (turn) => ({
          ...turn,
          status: "done",
          done: true,
          handoffCount: action.handoffCount,
          totalAgentRounds: action.totalAgentRounds,
          completedAt: action.completedAt,
        })),
      };
    }

    case "SWARM_ERROR": {
      return {
        ...state,
        entries: mapSwarmTurn(state.entries, action.swarmId, (turn) => ({
          ...turn,
          status: "error",
          done: true,
        })),
      };
    }

    case "SWARM_TOGGLE_AGENT": {
      return {
        ...state,
        entries: mapSwarmTurn(state.entries, action.swarmId, (turn) => ({
          ...turn,
          agentSections: turn.agentSections.map((s) =>
            s.sectionId === action.sectionId ? { ...s, expanded: !s.expanded } : s,
          ),
        })),
      };
    }

    default:
      return state;
  }
}
