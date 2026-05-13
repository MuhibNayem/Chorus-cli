import { Box, Text } from "ink";

export interface Suggestion {
  label: string;
  description?: string;
}

interface SuggestionBoxProps {
  suggestions: Suggestion[];
  selectedIndex: number;
  pageSize?: number;
}

export function SuggestionBox({ suggestions, selectedIndex, pageSize = 10 }: SuggestionBoxProps) {
  if (suggestions.length === 0) return null;

  // Compute scroll offset so the selected item is always visible
  const scrollOffset = selectedIndex < 0
    ? 0
    : Math.max(0, Math.min(selectedIndex - Math.floor(pageSize / 2), suggestions.length - pageSize));

  const visibleItems = suggestions.slice(scrollOffset, scrollOffset + pageSize);
  const hasAbove = scrollOffset > 0;
  const hasBelow = scrollOffset + pageSize < suggestions.length;

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
      {hasAbove && (
        <Text color="grey" dimColor>{`  ↑ ${scrollOffset} more`}</Text>
      )}
      {visibleItems.map((s, vi) => {
        const i = scrollOffset + vi;
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
      {hasBelow && (
        <Text color="grey" dimColor>{`  ↓ ${suggestions.length - scrollOffset - pageSize} more`}</Text>
      )}
      <Box marginTop={0}>
        <Text color="grey" dimColor>{"  Tab select · Esc dismiss"}</Text>
      </Box>
    </Box>
  );
}
