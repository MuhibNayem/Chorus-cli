import { Box, Text } from "ink";

interface UserMessageProps {
  text: string;
}

export function UserMessage({ text }: UserMessageProps) {
  return (
    <Box marginBottom={1} flexDirection="row">
      <Text color="cyan" bold>{">"} </Text>
      <Text wrap="wrap">{text}</Text>
    </Box>
  );
}
