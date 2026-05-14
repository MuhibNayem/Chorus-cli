import { Box, Text } from "ink";
import type { FeedEntry } from "../state/feedReducer.js";
import { SwarmAgentCard } from "./SwarmAgentCard.js";
import { SwarmHandoffCard } from "./SwarmHandoffCard.js";
import { useCursor } from "../hooks/useSpinner.js";

type SwarmEntry = Extract<FeedEntry, { kind: "swarm-turn" }>;

interface SwarmTurnCardProps {
  entry: SwarmEntry;
  onToggleAgent: (swarmId: string, sectionId: string) => void;
  focusedSectionId?: string | null;
}

const SWARM_ICON: Record<string, string> = { running: "⟳", done: "✓", error: "✗" };
const SWARM_COLOR: Record<string, "cyan" | "green" | "red"> = {
  running: "cyan",
  done: "green",
  error: "red",
};

export function SwarmTurnCard({ entry, focusedSectionId = null }: SwarmTurnCardProps) {
  const icon = SWARM_ICON[entry.status] ?? "?";
  const color = SWARM_COLOR[entry.status] ?? "green";
  const isRunning = entry.status === "running";
  const spinner = useCursor(isRunning, 2);

  const elapsed =
    entry.completedAt
      ? ((entry.completedAt - entry.startedAt) / 1000).toFixed(1) + "s"
      : null;

  // Interleave agent sections and handoffs in timeline order:
  // section[0], handoff[0], section[1], handoff[1], ...
  const timeline: Array<
    | { kind: "section"; idx: number }
    | { kind: "handoff"; idx: number }
  > = [];
  for (let i = 0; i < entry.agentSections.length; i++) {
    timeline.push({ kind: "section", idx: i });
    if (i < entry.handoffs.length) {
      timeline.push({ kind: "handoff", idx: i });
    }
  }

  return (
    <Box flexDirection="column" marginBottom={1}>
      {/* Swarm header */}
      <Box flexDirection="row">
        <Text color={color} bold>
          {isRunning ? spinner + " " : icon + " "}
        </Text>
        <Text bold>{"swarm  "}</Text>
        <Text color="grey" dimColor>
          {entry.presetName}
        </Text>
        {elapsed && (
          <Text color="grey" dimColor>
            {"  "}
            {elapsed}
          </Text>
        )}
        {entry.handoffCount > 0 && (
          <Text color="grey" dimColor>
            {"  "}
            {entry.handoffCount}
            {" handoff"}
            {entry.handoffCount !== 1 ? "s" : ""}
          </Text>
        )}
        {entry.totalAgentRounds > 0 && (
          <Text color="grey" dimColor>
            {"  "}
            {entry.totalAgentRounds}
            {" rounds"}
          </Text>
        )}
        {entry.artifactKeys.length > 0 && (
          <Text color="grey" dimColor>
            {"  artifacts: "}
            {entry.artifactKeys.join(", ")}
          </Text>
        )}
      </Box>
      {entry.circuitBreakReason && (
        <Box marginLeft={2}>
          <Text color="red">{"⛔ " + entry.circuitBreakReason}</Text>
        </Box>
      )}

      {/* Timeline: agent sections interleaved with handoffs */}
      {timeline.map((item, i) => {
        if (item.kind === "handoff") {
          const h = entry.handoffs[item.idx];
          return <SwarmHandoffCard key={`handoff-${item.idx}-${i}`} handoff={h} />;
        }
        const s = entry.agentSections[item.idx];
        return (
          <SwarmAgentCard
            key={s.sectionId}
            section={s}
            focused={focusedSectionId === s.sectionId}
          />
        );
      })}
    </Box>
  );
}
