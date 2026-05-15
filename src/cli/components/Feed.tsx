import { Box, Text } from "ink";
import type { FeedEntry } from "../state/feedReducer.js";
import { UserMessage } from "./UserMessage.js";
import { AgentTurn } from "./AgentTurn.js";
import { SwarmTurnCard } from "./SwarmTurnCard.js";

interface FeedProps {
  entries: FeedEntry[];
  processing: boolean;
  onToggle: (id: string) => void;
  onToggleSwarmAgent: (swarmId: string, sectionId: string) => void;
  focusedId?: string | null;
  focusedSwarmSectionId?: string | null;
}

function renderStaticEntry(
  entry: FeedEntry,
  onToggle: (id: string) => void,
  onToggleSwarmAgent: (swarmId: string, sectionId: string) => void,
) {
  switch (entry.kind) {
    case "user":
      return <UserMessage key={entry.id} text={entry.text} />;
    case "turn":
      return <AgentTurn key={entry.id} entry={entry} onToggle={onToggle} />;
    case "swarm-turn":
      return (
        <SwarmTurnCard
          key={entry.id}
          entry={entry}
          onToggleAgent={onToggleSwarmAgent}
        />
      );
    case "error":
      return (
        <Box key={entry.id} marginBottom={1}>
          <Text color="red">{"✗ "}{entry.message}</Text>
        </Box>
      );
    case "system":
      return (
        <Box key={entry.id} marginBottom={1} marginLeft={2}>
          <Text color="cyan">{entry.text}</Text>
        </Box>
      );
    default:
      return null;
  }
}

export function Feed({
  entries,
  processing: _processing,
  onToggle,
  onToggleSwarmAgent,
  focusedId,
  focusedSwarmSectionId,
}: FeedProps) {
  return (
    <Box flexDirection="column" flexGrow={1}>
      {entries.map((entry) => {
        if (entry.kind === "turn") {
          return (
            <AgentTurn
              key={entry.id}
              entry={entry}
              onToggle={onToggle}
              isLive={!entry.done}
              focusedId={focusedId ?? null}
            />
          );
        }
        if (entry.kind === "swarm-turn") {
          return (
            <SwarmTurnCard
              key={entry.id}
              entry={entry}
              onToggleAgent={onToggleSwarmAgent}
              focusedSectionId={focusedSwarmSectionId ?? null}
            />
          );
        }
        // Non-live entries that follow (system messages, errors)
        return renderStaticEntry(entry, onToggle, onToggleSwarmAgent);
      })}
    </Box>
  );
}
