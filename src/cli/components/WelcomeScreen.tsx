import { Box, Text } from "ink";

interface WelcomeScreenProps {
  modelLabel: string;
  workspace: string;
  executionMode: string;
  approvalPolicy: string;
}

function shortModelLabel(label: string): string {
  return label.length > 34 ? `${label.slice(0, 31)}...` : label;
}

function shortWorkspace(workspace: string): string {
  const parts = workspace.split("/").filter(Boolean);
  const tail = parts.slice(-2).join("/");
  return tail ? `/${tail}` : workspace;
}

function WelcomeCommand({ command, description }: { command: string; description: string }) {
  return (
    <Box>
      <Text color="cyan" bold>{command.padEnd(16)}</Text>
      <Text color="grey">{description}</Text>
    </Box>
  );
}

export function WelcomeScreen({
  modelLabel,
  workspace,
  executionMode,
  approvalPolicy,
}: WelcomeScreenProps) {
  return (
    <Box flexDirection="column" flexGrow={1} paddingTop={1} paddingLeft={2} paddingRight={2}>
      <Box marginBottom={1}>
        <Text color="cyan" bold>{"✦ "}</Text>
        <Text color="white" bold>{"Chorus"}</Text>
        <Text color="grey">{"  agentic engineering CLI"}</Text>
      </Box>

      <Box
        borderStyle="round"
        borderColor="cyan"
        paddingX={2}
        paddingY={1}
        flexDirection="column"
        marginBottom={1}
      >
        <Text color="white" bold>
          {"What do you want to build today?"}
        </Text>
        <Text color="grey">
          {"Ask for a change, inspect a codebase, run a swarm, or connect MCP tools."}
        </Text>
      </Box>

      <Box borderStyle="single" borderColor="grey" paddingX={2} paddingY={1} flexDirection="column" marginBottom={1}>
        <Box>
          <Text color="grey">{"cwd       "}</Text>
          <Text color="white">{shortWorkspace(workspace)}</Text>
        </Box>
        <Box>
          <Text color="grey">{"model     "}</Text>
          <Text color="white">{shortModelLabel(modelLabel)}</Text>
        </Box>
        <Box>
          <Text color="grey">{"mode      "}</Text>
          <Text color={executionMode === "plan" ? "yellow" : "green"}>{executionMode.toUpperCase()}</Text>
          <Text color="grey">{`  ${approvalPolicy.replace("_", "-")}`}</Text>
        </Box>
      </Box>

      <Box flexDirection="column" marginBottom={1}>
        <Text color="grey">{"Try one of these:"}</Text>
        <WelcomeCommand command="fix tests" description="find failures, patch code, and verify" />
        <WelcomeCommand command="/plan" description="switch to read-only planning mode" />
        <WelcomeCommand command="/swarm" description="run a coordinated multi-agent workflow" />
        <WelcomeCommand command="/config" description="configure providers, API keys, and defaults" />
      </Box>

      <Box borderStyle="single" borderColor="grey" paddingX={1}>
        <Text color="grey">
          {"Tip: mention files with "}
        </Text>
        <Text color="cyan">{"@path"}</Text>
        <Text color="grey">
          {" · press "}
        </Text>
        <Text color="cyan">{"Tab"}</Text>
        <Text color="grey">
          {" for suggestions · "}
        </Text>
        <Text color="cyan">{"Shift+Tab"}</Text>
        <Text color="grey">
          {" toggles plan/build"}
        </Text>
      </Box>
    </Box>
  );
}
