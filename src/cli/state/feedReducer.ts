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
  tokens: string[];
};

export type TurnEvent = ThinkingEvent | ToolEvent | ResponseEvent;

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

// ── Actions ──────────────────────────────────────────────────────────────────

export type FeedAction =
  | { type: "APPEND_USER"; id: string; text: string }
  | { type: "APPEND_USER_MSG"; id: string; text: string }
  | { type: "APPEND_THINK_TOKEN"; text: string }
  | { type: "APPEND_RESPONSE_TOKEN"; text: string }
  | { type: "ADD_TOOL_CALL"; toolCall: Omit<ToolCard, "expanded"> }
  | { type: "UPDATE_TOOL_CALL"; id: string; result: string; status: "done" | "error" }
  | { type: "FINALIZE_TURN" }
  | { type: "TOGGLE_EXPANDED"; id: string }
  | { type: "SET_ERROR"; id: string; message: string }
  | { type: "APPEND_SYSTEM"; id: string; text: string }
  | { type: "CLEAR_FEED" };

export interface FeedState {
  entries: FeedEntry[];
  processing: boolean;
}

export const initialFeedState: FeedState = {
  entries: [],
  processing: false,
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function mapActiveTurn(
  entries: FeedEntry[],
  fn: (turn: Extract<FeedEntry, { kind: "turn" }>) => Extract<FeedEntry, { kind: "turn" }>
): FeedEntry[] {
  return entries.map((e) => (e.kind === "turn" && !e.done ? fn(e) : e));
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
        startedAt: Date.now(),
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
            const updated: ResponseEvent = { ...last, tokens: [...last.tokens, action.text] };
            return { ...turn, events: [...turn.events.slice(0, -1), updated] };
          }
          const ev: ResponseEvent = { kind: "response", tokens: [action.text] };
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
          const elapsed = Date.now() - e.startedAt;
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

    default:
      return state;
  }
}
