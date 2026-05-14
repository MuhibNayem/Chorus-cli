import { Box, Text } from "ink";
import type { SwarmHandoffRecord } from "../state/feedReducer.js";

interface SwarmHandoffCardProps {
  handoff: SwarmHandoffRecord;
}

export function SwarmHandoffCard({ handoff }: SwarmHandoffCardProps) {
  const task =
    handoff.taskDescription.length > 72
      ? handoff.taskDescription.slice(0, 69) + "..."
      : handoff.taskDescription;
  return (
    <Box marginLeft={2} flexDirection="row">
      <Text color="yellow">{"↷ "}</Text>
      <Text color="yellow" bold>
        {handoff.from}
      </Text>
      <Text color="yellow">{" → "}</Text>
      <Text color="yellow" bold>
        {handoff.to}
      </Text>
      <Text color="grey" dimColor>
        {"  "}
        {task.replace(/\n/g, " ")}
      </Text>
    </Box>
  );
}
