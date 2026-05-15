import { memo, useCallback } from "react";
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

function isStaticEntry(entry: FeedEntry): boolean {
  if (entry.kind === "user") return true;
  if (entry.kind === "system") return true;
  if (entry.kind === "error") return true;
  if (entry.kind === "turn" && entry.done) return true;
  if (entry.kind === "swarm-turn" && entry.status !== "running") return true;
  return false;
}

function StaticItem({ entry, onToggle, onToggleSwarmAgent }: {
  entry: FeedEntry;
  onToggle: (id: string) => void;
  onToggleSwarmAgent: (swarmId: string, sectionId: string) => void;
}) {
  switch (entry.kind) {
    case "user":
      return <UserMessage text={entry.text} />;
    case "turn":
      return <AgentTurn entry={entry} onToggle={onToggle} />;
    case "swarm-turn":
      return <SwarmTurnCard entry={entry} onToggleAgent={onToggleSwarmAgent} />;
    case "error":
      return (
        <Box marginBottom={1}>
          <Text color="red">{"✗ "}{entry.message}</Text>
        </Box>
      );
    case "system":
      return (
        <Box marginBottom={1} marginLeft={2}>
          <Text color="cyan">{entry.text}</Text>
        </Box>
      );
    default:
      return null;
  }
}

const MemoStaticItem = memo(StaticItem);

export function Feed({
  entries,
  processing: _processing,
  onToggle,
  onToggleSwarmAgent,
  focusedId,
  focusedSwarmSectionId,
}: FeedProps) {
  const staticEntries = entries.filter(isStaticEntry);
  const dynamicEntries = entries.filter((e) => !isStaticEntry(e));

  const renderStatic = useCallback(
    (entry: FeedEntry) => (
      <MemoStaticItem
        key={entry.id}
        entry={entry}
        onToggle={onToggle}
        onToggleSwarmAgent={onToggleSwarmAgent}
      />
    ),
    [onToggle, onToggleSwarmAgent],
  );

  return (
    <Box flexDirection="column" flexGrow={1}>
      <Static items={staticEntries}>
        {(entry) => renderStatic(entry)}
      </Static>
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
        return null;
      })}
    </Box>
  );
}
