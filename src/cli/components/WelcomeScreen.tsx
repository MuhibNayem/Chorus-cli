import { Box, Text } from "ink";

interface WelcomeScreenProps {
  modelLabel: string;
  workspace: string;
  executionMode: string;
  approvalPolicy: string;
}

const LOGO = [
  "   ______ __                                ",
  "  / ____// /_   ____   _____ __  __ _____ ",
  " / /    / __ \\ / __ \\ / ___// / / // ___/ ",
  "/ /___ / / / // /_/ // /   / /_/ /(__  )  ",
  "\\____//_/ /_/ \\____//_/    \\__,_//____/   ",
];

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
      <Text color="cyan">{command.padEnd(16)}</Text>
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
      <Box flexDirection="column" marginBottom={1}>
        {LOGO.map((line) => (
          <Text key={line} color="cyan" bold>
            {line}
          </Text>
        ))}
        <Text color="white" bold>
          {"Local-first agentic engineering, orchestrated from your terminal."}
        </Text>
      </Box>

      <Box borderStyle="round" borderColor="cyan" paddingX={2} paddingY={1} flexDirection="column" marginBottom={1}>
        <Box marginBottom={1}>
          <Text color="grey">{"Workspace  "}</Text>
          <Text color="white">{shortWorkspace(workspace)}</Text>
        </Box>
        <Box>
          <Text color="grey">{"Model      "}</Text>
          <Text color="white">{shortModelLabel(modelLabel)}</Text>
          <Text color="grey">{"  ·  "}</Text>
          <Text color={executionMode === "plan" ? "yellow" : "green"}>{executionMode.toUpperCase()}</Text>
          <Text color="grey">{`/${approvalPolicy.replace("_", "-")}`}</Text>
        </Box>
      </Box>

      <Box flexDirection="column" marginBottom={1}>
        <Text color="grey">{"Start with a task, or use a command:"}</Text>
        <WelcomeCommand command="/config" description="configure providers, API keys, and defaults" />
        <WelcomeCommand command="/model" description="switch the active model for this session" />
        <WelcomeCommand command="/agents" description="create, inspect, or manage specialized agents" />
        <WelcomeCommand command="/resume" description="continue a previous workspace session" />
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
