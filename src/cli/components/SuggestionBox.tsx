import { Box, Text } from "ink";

export interface Suggestion {
  label: string;
  description?: string;
}

interface SuggestionBoxProps {
  suggestions: Suggestion[];
  selectedIndex: number;
}

export function SuggestionBox({ suggestions, selectedIndex }: SuggestionBoxProps) {
  if (suggestions.length === 0) return null;

  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor="grey"
      paddingLeft={1}
      paddingRight={1}
      marginLeft={0}
      marginBottom={0}
    >
      {suggestions.map((s, i) => {
        const selected = i === selectedIndex;
        return (
          <Box key={s.label} flexDirection="row" gap={1}>
            <Text color={selected ? "cyan" : "white"} bold={selected}>
              {selected ? "▶ " : "  "}
              {s.label}
            </Text>
            {s.description ? (
              <Text color="grey" dimColor={!selected}>
                {"  "}{s.description}
              </Text>
            ) : null}
          </Box>
        );
      })}
      <Box marginTop={0}>
        <Text color="grey" dimColor>{"  Tab select · Esc dismiss"}</Text>
      </Box>
    </Box>
  );
}
