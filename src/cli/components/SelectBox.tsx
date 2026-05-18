import { Box, Text } from "ink";

export interface SelectItem {
  value: string;
  label: string;
}

interface SelectBoxProps {
  title: string;
  items: SelectItem[];
  selectedIndex: number;
  searchQuery?: string;
  pageSize?: number;
}

export function SelectBox({ title, items, selectedIndex, searchQuery = "", pageSize = 12 }: SelectBoxProps) {
  const scrollOffset = selectedIndex < 0
    ? 0
    : Math.max(0, Math.min(selectedIndex - Math.floor(pageSize / 2), Math.max(0, items.length - pageSize)));

  const visibleItems = items.slice(scrollOffset, scrollOffset + pageSize);
  const hasAbove = scrollOffset > 0;
  const hasBelow = scrollOffset + pageSize < items.length;

  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor="cyan"
      paddingLeft={1}
      paddingRight={1}
    >
      <Text bold color="cyan">{title}</Text>

      <Box flexDirection="row" marginTop={0}>
        <Text color="grey">{"  / "}</Text>
        <Text color="white">{searchQuery}</Text>
        <Text color="cyan">{"█"}</Text>
        {searchQuery && items.length > 0 && (
          <Text color="grey" dimColor>{`  (${items.length} match${items.length === 1 ? "" : "es"})`}</Text>
        )}
      </Box>

      <Box flexDirection="column">
        {items.length === 0 && searchQuery ? (
          <Text color="grey" dimColor>{"  No matches — keep typing or press Esc"}</Text>
        ) : items.length === 0 ? (
          <Text color="grey" dimColor>{"  Loading…"}</Text>
        ) : (
          <>
            {hasAbove && (
              <Text color="grey" dimColor>{`  ↑ ${scrollOffset} more`}</Text>
            )}
            {visibleItems.map((item, vi) => {
              const i = scrollOffset + vi;
              const selected = i === selectedIndex;
              return (
                <Box key={item.value} flexDirection="row">
                  <Text color={selected ? "cyan" : "white"} bold={selected}>
                    {selected ? "▶ " : "  "}{item.label}
                  </Text>
                </Box>
              );
            })}
            {hasBelow && (
              <Text color="grey" dimColor>{`  ↓ ${items.length - scrollOffset - pageSize} more`}</Text>
            )}
          </>
        )}
      </Box>

      <Box marginTop={0}>
        <Text color="grey" dimColor>{"  type to search · ↑↓ navigate · Enter select · Esc cancel"}</Text>
      </Box>
    </Box>
  );
}
