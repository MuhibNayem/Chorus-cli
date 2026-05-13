import { Box, Text } from "ink";
import type { FeedEntry } from "../state/feedReducer.js";
import { ThinkingBlock } from "./ThinkingBlock.js";
import { ToolCard } from "./ToolCard.js";
import { useCursor } from "../hooks/useSpinner.js";

type TurnEntry = Extract<FeedEntry, { kind: "turn" }>;

interface AgentTurnProps {
  entry: TurnEntry;
  onToggle: (id: string) => void;
  isLive?: boolean;
  focusedId?: string | null;
}

export function AgentTurn({ entry, onToggle: _onToggle, isLive = false, focusedId = null }: AgentTurnProps) {
  const expandableIds: string[] = [];
  for (const tc of entry.toolCalls) {
    if (tc.status !== "running") expandableIds.push(tc.id);
  }
  if (entry.thinking.text) expandableIds.push(`${entry.id}-thinking`);

  const responseText = entry.tokens.join("");
  const isStreamingResponse = !entry.done && responseText.length > 0;
  const cursor = useCursor(isStreamingResponse);
  const isThinkingActive = !entry.done && !isStreamingResponse && entry.toolCalls.every((tc) => tc.status !== "running");

  return (
    <Box flexDirection="column" marginBottom={1}>
      <Box flexDirection="row">
        <Text color="green" bold>{"● "}</Text>
        <Text color="grey" dimColor>{"agent"}</Text>
        {expandableIds.length > 0 && (
          <Text color="grey" dimColor>{"  [Tab] cycle  [Space] expand"}</Text>
        )}
      </Box>

      {entry.thinking.text && (
        <ThinkingBlock
          thinking={entry.thinking}
          turnId={entry.id}
          focused={focusedId === `${entry.id}-thinking`}
          isActive={isThinkingActive}
        />
      )}

      {entry.toolCalls.map((tc) => (
        <ToolCard key={tc.id} card={tc} focused={focusedId === tc.id} />
      ))}

      {responseText && (
        <Box marginLeft={2}>
          <Text wrap="wrap">
            {responseText}
            {isStreamingResponse ? cursor : ""}
          </Text>
        </Box>
      )}

      {isLive && responseText.length === 0 && entry.toolCalls.length === 0 && !entry.thinking.text && (
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
