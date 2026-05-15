import { useState } from "react";
import { Box, Text, useInput } from "ink";
import type { AgentDef } from "../../agents/types.js";

interface AgentViewerProps {
  agent: AgentDef;
  onBack: () => void;
}

export function AgentViewer({ agent, onBack }: AgentViewerProps) {
  const [scroll, setScroll] = useState(0);
  const lines = agent.systemPrompt.split("\n");
  const VISIBLE = Math.min(30, process.stdout.rows - 10 || 20);

  useInput((_input, key) => {
    if (key.escape || _input === "q") { onBack(); return; }
    if (key.upArrow) { setScroll((s) => Math.max(0, s - 1)); return; }
    if (key.downArrow) { setScroll((s) => Math.min(lines.length - VISIBLE, s + 1)); return; }
    if (key.pageDown || (_input === " ")) { setScroll((s) => Math.min(lines.length - VISIBLE, s + VISIBLE - 2)); return; }
    if (key.pageUp) { setScroll((s) => Math.max(0, s - VISIBLE + 2)); return; }
    if (_input === "g") { setScroll(0); return; }
    if (_input === "G") { setScroll(Math.max(0, lines.length - VISIBLE)); return; }
  });

  const visible = lines.slice(scroll, scroll + VISIBLE);
  const hasAbove = scroll > 0;
  const hasBelow = scroll + VISIBLE < lines.length;

  return (
    <Box flexDirection="column" paddingLeft={2} paddingRight={2} paddingTop={1}>
      <Box marginBottom={1} flexDirection="row" justifyContent="space-between">
        <Box flexDirection="row">
          <Text color="cyan" bold>{agent.name} </Text>
          <Text color="grey">{agent.source}</Text>
        </Box>
        <Text color="grey" dimColor>↑↓ pgup/pgdn scroll · g/G top/bottom · Esc/q back</Text>
      </Box>

      <Box flexDirection="row" marginBottom={1}>
        <Text color="grey" dimColor>{agent.filePath}</Text>
        {agent.model ? <Text color="grey" dimColor>  ·  model: {agent.model}</Text> : null}
        {agent.permissionMode ? <Text color="grey" dimColor>  ·  perms: {agent.permissionMode}</Text> : null}
      </Box>

      {agent.description && (
        <Box marginBottom={1}>
          <Text color="yellow">{agent.description}</Text>
        </Box>
      )}

      {agent.tools && agent.tools.length > 0 && (
        <Box marginBottom={1}>
          <Text color="grey" dimColor>Tools: {agent.tools.join(", ")}</Text>
        </Box>
      )}

      <Box borderStyle="single" borderColor="grey" flexDirection="column" paddingX={1} paddingY={0}>
        {hasAbove && (
          <Text color="grey" dimColor>{`  ↑ ${scroll} more lines`}</Text>
        )}
        {visible.map((line, i) => (
          <Text key={scroll + i} color="white">{line || " "}</Text>
        ))}
        {hasBelow && (
          <Text color="grey" dimColor>{`  ↓ ${lines.length - scroll - VISIBLE} more lines`}</Text>
        )}
      </Box>

      <Box marginTop={1} flexDirection="row">
        <Text color="grey" dimColor>
          Line {scroll + 1}-{Math.min(scroll + VISIBLE, lines.length)} of {lines.length}  ·  Esc or q to go back
        </Text>
      </Box>
    </Box>
  );
}
