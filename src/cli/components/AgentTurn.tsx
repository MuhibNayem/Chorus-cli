import { Box, Text } from "ink";
import type { FeedEntry } from "../state/feedReducer.js";
import { ThinkingBlock } from "./ThinkingBlock.js";
import { ToolCard } from "./ToolCard.js";
import { WorkerCard } from "./WorkerCard.js";
import { SubagentCard } from "./SubagentCard.js";
import { useCursor } from "../hooks/useSpinner.js";

type TurnEntry = Extract<FeedEntry, { kind: "turn" }>;
const MAX_RESPONSE_DISPLAY_CHARS = 8000;

interface AgentTurnProps {
  entry: TurnEntry;
  onToggle: (id: string) => void;
  isLive?: boolean;
  focusedId?: string | null;
}

export function AgentTurn({ entry, onToggle, isLive = false, focusedId = null }: AgentTurnProps) {
  // Collect expandable item ids in stream order
  const expandableIds: string[] = [];
  for (const ev of entry.events) {
    if (ev.kind === "tool" && ev.card.status !== "running") expandableIds.push(ev.card.id);
  }
  for (const ev of entry.events) {
    if (ev.kind === "thinking" && ev.text) expandableIds.push(ev.id);
  }
  for (const ev of entry.events) {
    if (ev.kind === "worker" && ev.card.status !== "running") expandableIds.push(ev.card.id);
  }
  for (const ev of entry.events) {
    if (ev.kind === "subagent" && ev.card.sessionId) expandableIds.push(ev.card.id);
  }

  // Determine which event is currently "active" (being streamed right now)
  const lastEvent = entry.events[entry.events.length - 1];
  const isLastThinkingActive = !entry.done && lastEvent?.kind === "thinking";
  const isStreamingResponse = !entry.done && lastEvent?.kind === "response";

  const cursor = useCursor(isStreamingResponse);

  return (
    <Box flexDirection="column" marginBottom={1}>
      {/* Turn header */}
      <Box flexDirection="row">
        <Text color="green" bold>{"● "}</Text>
        <Text color="grey" dimColor>{"agent"}</Text>
        {expandableIds.length > 0 && (
          <Text color="grey" dimColor>{"  [Tab] cycle  [Space] expand  [Enter] view session"}</Text>
        )}
      </Box>

      {/* Events in stream order */}
      {entry.events.map((ev, i) => {
        if (ev.kind === "thinking") {
          const isActive = isLastThinkingActive && i === entry.events.length - 1;
          return (
            <ThinkingBlock
              key={ev.id}
              event={ev}
              focused={focusedId === ev.id}
              isActive={isActive}
            />
          );
        }

        if (ev.kind === "tool") {
          return (
            <ToolCard
              key={ev.card.id}
              card={ev.card}
              focused={focusedId === ev.card.id}
            />
          );
        }

        if (ev.kind === "worker") {
          return (
            <WorkerCard
              key={ev.card.id}
              card={ev.card}
              focused={focusedId === ev.card.id}
            />
          );
        }

        if (ev.kind === "subagent") {
          return (
            <SubagentCard
              key={ev.card.id}
              card={ev.card}
              focused={focusedId === ev.card.id}
            />
          );
        }

        if (ev.kind === "response") {
          const text = ev.text;
          const isLastEvent = i === entry.events.length - 1;
          const omittedChars = Math.max(0, text.length - MAX_RESPONSE_DISPLAY_CHARS);
          const displayText = omittedChars > 0
            ? `... ${omittedChars.toLocaleString()} earlier chars hidden while rendering; full text remains in session history ...\n${text.slice(-MAX_RESPONSE_DISPLAY_CHARS)}`
            : text;
          if (!text) return null;
          return (
            <Box key={`resp-${i}`} marginLeft={2}>
              <Text wrap="wrap">
                {displayText}
                {isStreamingResponse && isLastEvent ? cursor : ""}
              </Text>
            </Box>
          );
        }

        return null;
      })}

      {/* Initial waiting indicator — nothing has streamed yet */}
      {isLive && entry.events.length === 0 && (
        <WaitingIndicator />
      )}
    </Box>
  );
}

function WaitingIndicator() {
  const cursor = useCursor(true, 1);
  return (
    <Box marginLeft={2}>
      <Text color="grey" dimColor>{cursor}</Text>
    </Box>
  );
}
