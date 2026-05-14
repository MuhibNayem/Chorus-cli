// ── Types ────────────────────────────────────────────────────────────────────

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
  | { kind: "system"; id: string; text: string };

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
  | { type: "UPDATE_SUBAGENT"; id: string; status: "running" | "done" | "error"; result?: string }
  | { type: "FINALIZE_SUBAGENT"; id: string; completedAt: number }
  // Session actions
  | { type: "ADD_SESSION_EVENT"; sessionId: string; event: TurnEvent }
  | { type: "FINALIZE_SESSION"; sessionId: string; completedAt: number }
  | { type: "ADD_USAGE"; inputTokens: number; outputTokens: number; cost: number };

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
              return ev;
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
          historyEntries.push({
            kind: "turn",
            id: `turn-${id}`,
            events: [{ kind: "response", text: msg.content }],
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
      return {
        ...state,
        entries: mapActiveTurn(state.entries, (turn) => {
          const ev: SubagentEvent = { kind: "subagent", card: action.subagent };
          return { ...turn, events: [...turn.events, ev] };
        }),
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
        sessions: {
          ...state.sessions,
          [action.id]: { ...session, events: newEvents },
        },
      };
    }

    case "UPDATE_SUBAGENT": {
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
      };
    }

    case "FINALIZE_SUBAGENT": {
      const session = state.sessions[action.id];
      if (!session) return state;
      return {
        ...state,
        entries: mapActiveTurnEvent(state.entries, action.id, (ev) => {
          if (ev.kind !== "subagent") return ev;
          return { ...ev, card: { ...ev.card, status: "done" } };
        }),
        sessions: {
          ...state.sessions,
          [action.id]: { ...session, status: "done", completedAt: action.completedAt },
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

    default:
      return state;
  }
}
