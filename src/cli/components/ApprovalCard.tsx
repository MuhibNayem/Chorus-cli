import { Box, Text } from "ink";

export interface HitlActionRequest {
  name: string;
  args: Record<string, unknown>;
  description?: string;
}

export interface PendingApproval {
  interrupt: {
    actionRequests: HitlActionRequest[];
  };
}

interface ApprovalCardProps {
  approval: PendingApproval;
}

export function ApprovalCard({ approval }: ApprovalCardProps) {
  const { actionRequests } = approval.interrupt;
  const primary = actionRequests[0];

  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor="yellow"
      paddingLeft={1}
      paddingRight={1}
    >
      <Text bold color="yellow">⚠ Approval required</Text>
      {primary && (
        <Box flexDirection="column" marginTop={0}>
          <Text color="white" bold>{primary.name}</Text>
          <Text color="grey" dimColor wrap="truncate">
            {JSON.stringify(primary.args).slice(0, 120)}
          </Text>
          {primary.description && (
            <Text color="grey" dimColor>{primary.description}</Text>
          )}
        </Box>
      )}
      {actionRequests.length > 1 && (
        <Text color="grey" dimColor>  +{actionRequests.length - 1} more action{actionRequests.length > 2 ? "s" : ""}</Text>
      )}
      <Box marginTop={0}>
        <Text color="green" bold>A</Text>
        <Text color="grey"> approve  </Text>
        <Text color="cyan" bold>S</Text>
        <Text color="grey"> approve for session  </Text>
        <Text color="red" bold>D</Text>
        <Text color="grey"> deny</Text>
      </Box>
    </Box>
  );
}
