import { memo } from "react";
import { Box, Text } from "ink";

interface UserMessageProps {
  text: string;
}

function UserMessageInner({ text }: UserMessageProps) {
  return (
    <Box marginBottom={1} flexDirection="row">
      <Text color="cyan" bold>{">"} </Text>
      <Text wrap="wrap">{text}</Text>
    </Box>
  );
}

export const UserMessage = memo(UserMessageInner);
