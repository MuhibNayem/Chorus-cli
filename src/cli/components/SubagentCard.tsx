import { Box, Text } from "ink";
import { useCursor } from "../hooks/useSpinner.js";

export interface SubagentCardData {
  id: string;
  name: string;
  task: string;
  status: "running" | "done" | "error";
  tokens: string[];
  result?: string;
  sessionId?: string;
  expanded?: boolean;
}

interface SubagentCardProps {
  card: SubagentCardData;
  focused?: boolean;
}

export function SubagentCard({ card, focused = false }: SubagentCardProps) {
  const isRunning = card.status === "running";
  const cursor = useCursor(isRunning, 1);

  const statusIcon =
    card.status === "running" ? "⟳" :
    card.status === "done" ? "✓" :
    "✗";

  const statusColor =
    card.status === "running" ? "yellow" :
    card.status === "done" ? "green" :
    "red";

  const displayText = card.tokens.join("").trim() || card.result || "";

  return (
    <Box flexDirection="column" marginLeft={2} marginBottom={1}>
      <Box flexDirection="row">
        <Text color={statusColor}>{statusIcon} </Text>
        <Text bold color="cyan">{card.name}</Text>
        <Text color="grey"> subagent</Text>
        {isRunning && <Text color="yellow"> {cursor}</Text>}
        {focused && (
          <Text color="blue">  [Enter] view session</Text>
        )}
      </Box>
      <Box marginLeft={2}>
        <Text color="grey" dimColor>Task: {card.task}</Text>
      </Box>
      {card.expanded && displayText && (
        <Box marginLeft={2} marginTop={1}>
          <Text wrap="wrap">{displayText}</Text>
        </Box>
      )}
    </Box>
  );
}
