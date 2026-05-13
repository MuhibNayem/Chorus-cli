import { useState } from "react";
import { Box, Text, useInput } from "ink";
import type { SessionMetadata } from "./types.js";

interface SessionPickerProps {
  sessions: SessionMetadata[];
  onSelect: (session: SessionMetadata | null) => void;
}

function timeAgo(ms: number): string {
  const secs = Math.floor((Date.now() - ms) / 1000);
  if (secs < 60)   return `${secs}s ago`;
  const mins = Math.floor(secs / 60);
  if (mins < 60)   return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24)    return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 7)    return `${days}d ago`;
  return `${Math.floor(days / 7)}w ago`;
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}

export function SessionPicker({ sessions, onSelect }: SessionPickerProps) {
  const [idx, setIdx] = useState(0);
  const workspace = process.cwd();

  useInput((_input, key) => {
    if (key.upArrow)   setIdx((i) => Math.max(0, i - 1));
    if (key.downArrow) setIdx((i) => Math.min(sessions.length - 1, i + 1));
    if (key.return)    onSelect(sessions[idx] ?? null);
    if (_input === "n" || _input === "N") onSelect(null);
    if (key.ctrl && _input === "c") process.exit(0);
  });

  return (
    <Box flexDirection="column" borderStyle="round" borderColor="cyan" paddingX={1} paddingY={0}>
      {/* Header */}
      <Box marginBottom={1}>
        <Text color="cyan" bold>{"chorus"}</Text>
        <Text color="grey">{"  ·  "}</Text>
        <Text color="grey" dimColor>{truncate(workspace, 60)}</Text>
      </Box>

      {/* Session list */}
      {sessions.map((s, i) => {
        const selected = i === idx;
        const name     = truncate(s.name || "(unnamed)", 36);
        const msgs     = `${s.messageCount} msg${s.messageCount !== 1 ? "s" : ""}`;
        const ago      = timeAgo(s.updatedAt);
        const idHint   = s.id.slice(0, 8);

        return (
          <Box key={s.id} flexDirection="row" gap={1}>
            <Text color={selected ? "cyan" : "grey"} bold={selected}>
              {selected ? "▶ " : "  "}
            </Text>
            <Text color={selected ? "white" : "grey"} bold={selected}>
              {name.padEnd(36)}
            </Text>
            <Text color="grey" dimColor>{msgs.padStart(8)}</Text>
            <Text color="grey" dimColor>{"  "}{ago.padStart(10)}</Text>
            <Text color="grey" dimColor>{"  "}{idHint}</Text>
          </Box>
        );
      })}

      {/* Footer */}
      <Box marginTop={1}>
        <Text color="grey" dimColor>
          {"  [↑↓] navigate  [Enter] resume  [N] new session  [Ctrl+C] quit"}
        </Text>
      </Box>
    </Box>
  );
}
