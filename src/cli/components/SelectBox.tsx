import { Box, Text } from "ink";

export interface SelectItem {
  value: string;
  label: string;
}

interface SelectBoxProps {
  title: string;
  items: SelectItem[];
  selectedIndex: number;
}

export function SelectBox({ title, items, selectedIndex }: SelectBoxProps) {
  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor="cyan"
      paddingLeft={1}
      paddingRight={1}
    >
      <Text bold color="cyan">{title}</Text>
      <Box marginTop={0} flexDirection="column">
        {items.length === 0 ? (
          <Text color="grey" dimColor>  Loading…</Text>
        ) : (
          items.map((item, i) => {
            const selected = i === selectedIndex;
            return (
              <Box key={item.value} flexDirection="row">
                <Text color={selected ? "cyan" : "white"} bold={selected}>
                  {selected ? "▶ " : "  "}{item.label}
                </Text>
              </Box>
            );
          })
        )}
      </Box>
      <Box marginTop={0}>
        <Text color="grey" dimColor>  ↑↓ navigate · Enter select · Esc cancel</Text>
      </Box>
    </Box>
  );
}
