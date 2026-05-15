import { useState, useEffect } from "react";
import { Box, Text, useInput } from "ink";
import { useSpinner } from "../hooks/useSpinner.js";

export interface BtwMessage {
  id: string;
  question: string;
  response?: string;
  error?: string;
  loading: boolean;
}

interface BtwSidePanelProps {
  messages: BtwMessage[];
  onDismiss: () => void;
}

function BtwSidePanelInner({ messages, onDismiss }: BtwSidePanelProps) {
  const [expandedIndex, setExpandedIndex] = useState<number | null>(null);

  useInput((_input, key) => {
    if (key.escape) { onDismiss(); return; }
    if (key.return && expandedIndex !== null) { setExpandedIndex(null); return; }
    if (_input === " ") {
      if (expandedIndex !== null) { setExpandedIndex(null); return; }
      const lastComplete = [...messages].reverse().find((m) => m.response);
      if (lastComplete) {
        const idx = messages.indexOf(lastComplete);
        setExpandedIndex(idx);
      }
      return;
    }
  });

  const spinner = useSpinner(true);

  return (
    <Box flexDirection="column" borderStyle="single" borderColor="yellow" paddingLeft={1} paddingRight={1} marginTop={0}>
      <Box flexDirection="row" justifyContent="space-between">
        <Box flexDirection="row">
          <Text color="yellow" bold>{"◈ Side Channel  "}</Text>
          <Text color="grey" dimColor>{`${messages.length} msg${messages.length > 1 ? "s" : ""}  · Esc dismiss`}</Text>
        </Box>
      </Box>

      {messages.length === 0 && (
        <Box marginTop={0} marginBottom={1}>
          <Text color="grey" dimColor>Type /btw to ask a side question while the agent works.</Text>
        </Box>
      )}

      {messages.map((msg, i) => {
        const isLast = i === messages.length - 1;
        const isExpanded = expandedIndex === i || (isLast && msg.loading);

        return (
          <Box key={msg.id} flexDirection="column" marginBottom={0}>
            {/* Question */}
            <Box flexDirection="row">
              <Text color="yellow" bold>{"  /btw "}</Text>
              <Text color="grey">{msg.question.length > 60 ? msg.question.slice(0, 57) + "..." : msg.question}</Text>
            </Box>

            {/* Response */}
            {msg.loading && (
              <Box marginLeft={2} flexDirection="row">
                <Text color="yellow">{spinner} </Text>
                <Text color="grey" dimColor>Answering...</Text>
              </Box>
            )}

            {msg.response && !isExpanded && (
              <Box marginLeft={2} flexDirection="row">
                <Text color="white">{msg.response.slice(0, 100)}</Text>
                {msg.response.length > 100 && (
                  <Text color="grey" dimColor>  </Text>
                )}
              </Box>
            )}

            {msg.response && isExpanded && (
              <Box marginLeft={2} flexDirection="column" marginBottom={1}>
                <Box borderStyle="single" borderColor="grey" paddingX={1} flexDirection="column">
                  <Text color="white" wrap="wrap">{msg.response}</Text>
                </Box>
                <Text color="grey" dimColor>{"  Enter or Space to collapse"}</Text>
              </Box>
            )}

            {msg.response && !isExpanded && msg.response.length > 100 && (
              <Box marginLeft={2}>
                <Text color="cyan" dimColor>{"  … "}{msg.response.length - 100} more chars (Space to expand)</Text>
              </Box>
            )}

            {msg.error && (
              <Box marginLeft={2}>
                <Text color="red">{msg.error}</Text>
              </Box>
            )}
          </Box>
        );
      })}
    </Box>
  );
}

export const BtwSidePanel = BtwSidePanelInner;
