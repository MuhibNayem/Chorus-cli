import { Box, Static, Text } from "ink";
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
  processing,
  onToggle,
  onToggleSwarmAgent,
  focusedId,
  focusedSwarmSectionId,
}: FeedProps) {
  // Find the last live entry — either an incomplete agent turn or a running
  // swarm-turn. Everything BEFORE it is frozen in Static; from it onwards
  // entries render live in document order.
  let lastTurnIndex = -1;
  for (let i = entries.length - 1; i >= 0; i--) {
    const e = entries[i];
    if (e.kind === "turn" || (e.kind === "swarm-turn" && !e.done)) {
      lastTurnIndex = i;
      break;
    }
  }

  const staticEntries  = lastTurnIndex > 0 ? entries.slice(0, lastTurnIndex) : [];
  const dynamicEntries = lastTurnIndex >= 0 ? entries.slice(lastTurnIndex) : entries;

  return (
    <Box flexDirection="column" flexGrow={1} overflow="hidden">
      {/* Entries before the last live entry — rendered once and frozen */}
      {staticEntries.length > 0 && (
        <Static items={staticEntries}>
          {(entry) => renderStaticEntry(entry, onToggle, onToggleSwarmAgent)}
        </Static>
      )}

      {/* Last live entry + anything after it — rendered dynamically */}
      {dynamicEntries.map((entry) => {
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
