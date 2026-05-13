import { Box, Text } from "ink";
import type { ThinkingEvent } from "../state/feedReducer.js";
import { useSpinner } from "../hooks/useSpinner.js";

interface ThinkingBlockProps {
  event: ThinkingEvent;
  focused: boolean;
  isActive?: boolean;
}

function formatDuration(ms?: number): string {
  if (ms === undefined) return "";
  return ms < 1_000 ? ` ${ms}ms` : ` ${(ms / 1_000).toFixed(1)}s`;
}

export function ThinkingBlock({ event, focused, isActive = false }: ThinkingBlockProps) {
  if (!event.text) return null;

  const spinner  = useSpinner(isActive);
  const duration = formatDuration(event.durationMs);
  const hint     = focused ? "  {Space}" : "";
  const color    = focused ? "cyan" : "grey";

  if (!event.expanded) {
    return (
      <Box marginLeft={2} marginBottom={0}>
        <Text color={color}>
          {isActive ? `${spinner} Thinking…` : `▶ Thinking${duration}${hint}`}
        </Text>
      </Box>
    );
  }

  return (
    <Box marginLeft={2} flexDirection="column" marginBottom={1}>
      <Text color={color} bold>
        {isActive ? `${spinner} Thinking…` : `▼ Thinking${duration}${hint}`}
      </Text>
      <Box marginLeft={2}>
        <Text color="grey" dimColor wrap="wrap">{event.text}</Text>
      </Box>
    </Box>
  );
}
