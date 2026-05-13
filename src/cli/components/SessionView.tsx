import { Box, Text } from "ink";
import type { AgentSession, TurnEvent } from "../state/feedReducer.js";
import { ThinkingBlock } from "./ThinkingBlock.js";
import { ToolCard } from "./ToolCard.js";

interface SessionViewProps {
  session: AgentSession;
  onBack: () => void;
}

export function SessionView({ session, onBack }: SessionViewProps) {
  const statusIcon =
    session.status === "running" ? "⟳" :
    session.status === "done" ? "✓" :
    "✗";

  const statusColor =
    session.status === "running" ? "yellow" :
    session.status === "done" ? "green" :
    "red";

  const typeLabel = session.type === "worker" ? "Worker" : "Subagent";
  const emoji = session.type === "worker" ? "🧑‍💻" : "🤖";

  return (
    <Box flexDirection="column" height="100%" overflow="hidden">
      {/* Header */}
      <Box flexDirection="row" marginBottom={1} borderStyle="single" paddingX={1}>
        <Text color="blue" bold>{"← "}</Text>
        <Text color="grey">Press </Text>
        <Text bold>Esc</Text>
        <Text color="grey"> or </Text>
        <Text bold>q</Text>
        <Text color="grey"> to return</Text>
      </Box>

      <Box flexDirection="row" marginBottom={1}>
        <Text>{emoji} </Text>
        <Text bold>{session.name}</Text>
        <Text color="grey"> {typeLabel.toLowerCase()} session</Text>
        <Text color={statusColor}> {statusIcon}</Text>
      </Box>

      <Box flexDirection="column" flexGrow={1} overflow="hidden">
        {session.events.length === 0 && (
          <Box marginLeft={2}>
            <Text color="grey" dimColor>No events yet…</Text>
          </Box>
        )}

        {session.events.map((ev, i) => renderEvent(ev, i))}
      </Box>
    </Box>
  );
}

function renderEvent(ev: TurnEvent, index: number) {
  if (ev.kind === "thinking") {
    return (
      <ThinkingBlock
        key={ev.id}
        event={ev}
        focused={false}
        isActive={false}
      />
    );
  }

  if (ev.kind === "tool") {
    return (
      <ToolCard
        key={ev.card.id}
        card={ev.card}
        focused={false}
      />
    );
  }

  if (ev.kind === "response") {
    const text = ev.tokens.join("");
    if (!text) return null;
    return (
      <Box key={`resp-${index}`} marginLeft={2} marginBottom={1}>
        <Text wrap="wrap">{text}</Text>
      </Box>
    );
  }

  return null;
}
