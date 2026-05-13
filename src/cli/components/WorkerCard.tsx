import { Box, Text } from "ink";

export interface WorkerCardData {
  id: string;
  role: string;
  emoji: string;
  color: string;
  status: "running" | "done" | "error";
  summary: string;
  sessionId?: string;
  expanded?: boolean;
}

interface WorkerCardProps {
  card: WorkerCardData;
  focused?: boolean;
}

export function WorkerCard({ card, focused = false }: WorkerCardProps) {
  const statusIcon =
    card.status === "running" ? "⟳" :
    card.status === "done" ? "✓" :
    "✗";

  const statusColor =
    card.status === "running" ? "yellow" :
    card.status === "done" ? "green" :
    "red";

  return (
    <Box flexDirection="column" marginLeft={2} marginBottom={focused ? 1 : 0}>
      <Box flexDirection="row">
        <Text color={statusColor}>{statusIcon} </Text>
        <Text>{card.emoji} </Text>
        <Text bold>{card.role}</Text>
        <Text color="grey"> — {card.summary}</Text>
        {focused && (
          <Text color="blue">  [Enter] view session</Text>
        )}
      </Box>
      {card.expanded && (
        <Box marginLeft={4} marginTop={1}>
          <Text color="grey" wrap="wrap">{card.summary}</Text>
        </Box>
      )}
    </Box>
  );
}
