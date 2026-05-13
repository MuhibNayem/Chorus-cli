import { Box, Text } from "ink";
import type { AgentDef } from "../../agents/types.js";

interface AgentViewerProps {
  agent: AgentDef;
  onBack: () => void;
}

export function AgentViewer({ agent }: AgentViewerProps) {
  const lines = agent.systemPrompt.split("\n").slice(0, 20);
  const truncated = agent.systemPrompt.split("\n").length > 20;

  return (
    <Box flexDirection="column" borderStyle="round" borderColor="cyan" paddingLeft={1} paddingRight={1}>
      <Text bold color="cyan">Agent: {agent.name}</Text>
      <Text color="grey" dimColor>{agent.source} · {agent.filePath}</Text>
      {agent.description && <Text color="white">{agent.description}</Text>}
      {agent.model && <Text color="grey" dimColor>Model: {agent.model}</Text>}
      <Box marginTop={0} flexDirection="column">
        <Text color="grey" dimColor>System prompt:</Text>
        {lines.map((line, i) => (
          <Text key={i} color="white">{line}</Text>
        ))}
        {truncated && <Text color="grey" dimColor>  … (truncated)</Text>}
      </Box>
      <Text color="grey" dimColor>  Esc or q to go back</Text>
    </Box>
  );
}
