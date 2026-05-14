import { Box, Text } from "ink";
import type { SwarmAgentSection } from "../state/feedReducer.js";
import { ToolCard as ToolCardComponent } from "./ToolCard.js";
import { useCursor } from "../hooks/useSpinner.js";

interface SwarmAgentCardProps {
  section: SwarmAgentSection;
  focused?: boolean;
}

const STATUS_ICON: Record<string, string> = { running: "▶", done: "✓", error: "✗" };
const STATUS_COLOR: Record<string, "cyan" | "green" | "red"> = {
  running: "cyan",
  done: "green",
  error: "red",
};

export function SwarmAgentCard({ section, focused = false }: SwarmAgentCardProps) {
  const icon = STATUS_ICON[section.status] ?? "?";
  const color = STATUS_COLOR[section.status] ?? "green";
  const isRunning = section.status === "running";
  const cursor = useCursor(isRunning && section.expanded);

  const elapsedStr =
    section.completedAt && section.startedAt
      ? ((section.completedAt - section.startedAt) / 1000).toFixed(1) + "s"
      : null;

  const previewText =
    !section.expanded && section.text
      ? section.text.slice(0, 60).replace(/\n/g, " ")
      : null;

  return (
    <Box flexDirection="column" marginLeft={2}>
      {/* Section header */}
      <Box flexDirection="row">
        <Text color={color}>{icon + " "}</Text>
        <Text bold color={focused ? "cyan" : "white"}>
          {section.agentName}
        </Text>
        <Text color="grey" dimColor>
          {"  ["}
          {section.contextMode}
          {"]"}
        </Text>
        {elapsedStr && (
          <Text color="grey" dimColor>
            {"  "}
            {elapsedStr}
          </Text>
        )}
        {section.errorReason && (
          <Text color="red">{"  " + section.errorReason.slice(0, 60)}</Text>
        )}
        {previewText && (
          <Text color="grey" dimColor>
            {"  " + previewText}
          </Text>
        )}
      </Box>

      {/* Expanded body: tools then streamed text */}
      {section.expanded && (
        <Box flexDirection="column" marginLeft={2}>
          {section.tools.map((card) => (
            <ToolCardComponent key={card.id} card={card} focused={false} />
          ))}
          {(section.text || isRunning) && (
            <Box marginTop={0}>
              <Text wrap="wrap">
                {section.text.slice(-4000)}
                {isRunning ? cursor : ""}
              </Text>
            </Box>
          )}
        </Box>
      )}
    </Box>
  );
}
