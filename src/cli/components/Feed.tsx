import { Box, Static, Text } from "ink";
import type { FeedEntry } from "../state/feedReducer.js";
import { UserMessage } from "./UserMessage.js";
import { AgentTurn } from "./AgentTurn.js";

interface FeedProps {
  entries: FeedEntry[];
  processing: boolean;
  onToggle: (id: string) => void;
  focusedId?: string | null;
}

function renderStaticEntry(entry: FeedEntry, onToggle: (id: string) => void) {
  switch (entry.kind) {
    case "user":
      return <UserMessage key={entry.id} text={entry.text} />;
    case "turn":
      return <AgentTurn key={entry.id} entry={entry} onToggle={onToggle} />;
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

export function Feed({ entries, processing, onToggle, focusedId }: FeedProps) {
  // Find the last turn by index — everything BEFORE it is frozen in Static,
  // the last turn and anything after it (e.g. system messages) render live
  // in document order. Using filter() was wrong: it yanked the last turn out
  // of its position and re-appended it at the bottom, after later entries.
  let lastTurnIndex = -1;
  for (let i = entries.length - 1; i >= 0; i--) {
    if (entries[i].kind === "turn") {
      lastTurnIndex = i;
      break;
    }
  }

  const staticEntries  = lastTurnIndex > 0 ? entries.slice(0, lastTurnIndex) : [];
  const dynamicEntries = lastTurnIndex >= 0 ? entries.slice(lastTurnIndex) : entries;

  return (
    <Box flexDirection="column" flexGrow={1} overflow="hidden">
      {/* Entries before the last turn — rendered once and frozen */}
      {staticEntries.length > 0 && (
        <Static items={staticEntries}>
          {(entry) => renderStaticEntry(entry, onToggle)}
        </Static>
      )}

      {/* Last turn + any entries after it — live, in document order */}
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
        // Non-turn entries that follow the last turn (system messages, errors)
        return renderStaticEntry(entry, onToggle);
      })}
    </Box>
  );
}
