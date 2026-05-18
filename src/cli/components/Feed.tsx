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

export function Feed({
  entries,
  processing,
  onToggle,
  onToggleSwarmAgent,
  focusedId,
  focusedSwarmSectionId,
}: FeedProps) {
  // Find the last active (not-done) turn so AgentTurn knows it's live.
  let lastActiveTurnIndex = -1;
  for (let i = entries.length - 1; i >= 0; i--) {
    const e = entries[i];
    if ((e.kind === "turn" && !e.done) || (e.kind === "swarm-turn" && !e.done)) {
      lastActiveTurnIndex = i;
      break;
    }
  }

  // All entries rendered in a single flex column pushed to the bottom.
  // Removing <Static> eliminates the "out-of-flow" height problem: with Static
  // having 0 flex height, any spacer or justifyContent="flex-end" always fills
  // the full container, creating a giant gap. Without Static, justifyContent
  // pushes the growing list to the bottom naturally and Ink's redraw only
  // touches the lines that actually changed.
  return (
    <Box flexDirection="column" flexGrow={1} overflow="hidden" justifyContent="flex-end">
      {entries.map((entry, i) => {
        const isLive = lastActiveTurnIndex >= 0 && i >= lastActiveTurnIndex;

        switch (entry.kind) {
          case "user":
            return <UserMessage key={entry.id} text={entry.text} />;

          case "turn":
            return (
              <AgentTurn
                key={entry.id}
                entry={entry}
                onToggle={onToggle}
                isLive={isLive && !entry.done}
                focusedId={isLive ? (focusedId ?? null) : null}
              />
            );

          case "swarm-turn":
            return (
              <SwarmTurnCard
                key={entry.id}
                entry={entry}
                onToggleAgent={onToggleSwarmAgent}
                focusedSectionId={isLive ? (focusedSwarmSectionId ?? null) : null}
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
      })}
    </Box>
  );
}
