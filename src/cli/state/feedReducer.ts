// ── Types ────────────────────────────────────────────────────────────────────

export type ToolCard = {
  id: string;
  name: string;
  args: unknown;
  result?: string;
  status: "running" | "done" | "error";
  expanded: boolean;
};

export type ThinkingState = {
  text: string;
  expanded: boolean;
  durationMs?: number;
};

export type TurnEntry = {
  kind: "turn";
  id: string;
  tokens: string[];
  toolCalls: ToolCard[];
  thinking: ThinkingState;
  done: boolean;
  startedAt: number;
};

export type FeedEntry =
  | { kind: "user"; id: string; text: string }
  | TurnEntry
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
  | { type: "CLEAR_FEED" }
  | { type: "ADD_USAGE"; inputTokens: number; outputTokens: number; cost: number };

export interface FeedState {
  entries: FeedEntry[];
  processing: boolean;
  totalCost: number;
  totalInputTokens: number;
  totalOutputTokens: number;
}

export const initialFeedState: FeedState = {
  entries: [],
  processing: false,
  totalCost: 0,
  totalInputTokens: 0,
  totalOutputTokens: 0,
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function mapActiveTurn(
  entries: FeedEntry[],
  fn: (turn: TurnEntry) => TurnEntry
): FeedEntry[] {
  return entries.map((e) => (e.kind === "turn" && !e.done ? fn(e) : e));
}

// ── Reducer ───────────────────────────────────────────────────────────────────

export function feedReducer(state: FeedState, action: FeedAction): FeedState {
  switch (action.type) {
    case "APPEND_USER": {
      const userEntry: FeedEntry = { kind: "user", id: action.id, text: action.text };
      const turnEntry: TurnEntry = {
        kind: "turn",
        id: `turn-${action.id}`,
        tokens: [],
        toolCalls: [],
        thinking: { text: "", expanded: false },
        done: false,
        startedAt: Date.now(),
      };
      return {
        ...state,
        entries: [...state.entries, userEntry, turnEntry],
        processing: true,
      };
    }

    case "APPEND_USER_MSG": {
      return {
        ...state,
        entries: [...state.entries, { kind: "user", id: action.id, text: action.text }],
      };
    }

    case "APPEND_THINK_TOKEN": {
      return {
        ...state,
        entries: mapActiveTurn(state.entries, (turn) => ({
          ...turn,
          thinking: {
            ...turn.thinking,
            text: turn.thinking.text + action.text,
          },
        })),
      };
    }

    case "APPEND_RESPONSE_TOKEN": {
      return {
        ...state,
        entries: mapActiveTurn(state.entries, (turn) => ({
          ...turn,
          tokens: [...turn.tokens, action.text],
        })),
      };
    }

    case "ADD_TOOL_CALL": {
      return {
        ...state,
        entries: mapActiveTurn(state.entries, (turn) => ({
          ...turn,
          toolCalls: [...turn.toolCalls, { ...action.toolCall, expanded: false }],
        })),
      };
    }

    case "UPDATE_TOOL_CALL": {
      return {
        ...state,
        entries: mapActiveTurn(state.entries, (turn) => ({
          ...turn,
          toolCalls: turn.toolCalls.map((tc) =>
            tc.id === action.id
              ? { ...tc, result: action.result, status: action.status }
              : tc
          ),
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
          return {
            ...e,
            done: true,
            thinking: {
              ...e.thinking,
              expanded: false,
              durationMs: elapsed,
            },
          };
        }),
      };
    }

    case "TOGGLE_EXPANDED": {
      const thinkingSuffix = "-thinking";
      return {
        ...state,
        entries: state.entries.map((e) => {
          if (e.kind !== "turn") return e;
          if (action.id === `${e.id}${thinkingSuffix}`) {
            return {
              ...e,
              thinking: { ...e.thinking, expanded: !e.thinking.expanded },
            };
          }
          const idx = e.toolCalls.findIndex((tc) => tc.id === action.id);
          if (idx !== -1) {
            const updated = e.toolCalls.map((tc) =>
              tc.id === action.id ? { ...tc, expanded: !tc.expanded } : tc
            );
            return { ...e, toolCalls: updated };
          }
          return e;
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

    case "ADD_USAGE": {
      return {
        ...state,
        totalInputTokens:  state.totalInputTokens  + action.inputTokens,
        totalOutputTokens: state.totalOutputTokens + action.outputTokens,
        totalCost:         state.totalCost         + action.cost,
      };
    }

    default:
      return state;
  }
}
