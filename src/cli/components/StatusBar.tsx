import { memo } from "react";
import { Box, Text } from "ink";
import { useSpinner } from "../hooks/useSpinner.js";
import type { ApprovalPolicy, ExecutionMode } from "../../harness/types.js";

const DEFAULT_MAX_TOKENS = 128_000;
const BAR_WIDTH = 20;

export type AgentState = "idle" | "thinking" | "tool" | "error";

interface StatusBarProps {
  modelLabel: string;
  tokens: number;
  agentState: AgentState;
  sessionName?: string;
  maxTokens?: number;
  executionMode?: ExecutionMode;
  approvalPolicy?: ApprovalPolicy;
}

function tokensToDisplay(n: number): string {
  if (n < 1_000) return `${n}`;
  if (n < 1_000_000) return `${(n / 1_000).toFixed(1)}K`;
  return `${(n / 1_000_000).toFixed(1)}M`;
}

const STATE_DOT_COLOR: Record<AgentState, string> = {
  idle:     "green",
  thinking: "cyan",
  tool:     "yellow",
  error:    "red",
};

const STATE_LABEL: Record<AgentState, string> = {
  idle:     "Idle",
  thinking: "Thinking",
  tool:     "Tool",
  error:    "Error",
};

function StatusBarInner({
  modelLabel,
  tokens,
  agentState,
  sessionName,
  maxTokens,
  executionMode = "build",
  approvalPolicy = "auto_edit",
}: StatusBarProps) {
  const isActive = agentState !== "idle" && agentState !== "error";
  const spinner  = useSpinner(isActive);

  const limit    = maxTokens ?? DEFAULT_MAX_TOKENS;
  const percent  = Math.min(Math.round((tokens / limit) * 100), 100);
  const filled   = Math.round((percent / 100) * BAR_WIDTH);
  const bar      = "█".repeat(filled) + "░".repeat(BAR_WIDTH - filled);
  const barColor = percent < 50 ? "green" : percent < 80 ? "yellow" : "red";

  const stateLabel = isActive
    ? `${spinner} ${STATE_LABEL[agentState]}…`
    : STATE_LABEL[agentState];

  const sessionTag = sessionName
    ? `[${sessionName.length > 20 ? sessionName.slice(0, 19) + "…" : sessionName}]  `
    : "";

  return (
    <Box borderStyle="single" borderColor="grey" paddingLeft={1} paddingRight={1}>
      <Text bold color="white">{modelLabel}</Text>
      <Text>{"  "}</Text>
      <Text color={executionMode === "plan" ? "yellow" : "green"}>{executionMode.toUpperCase()}</Text>
      <Text color="grey">{`/${approvalPolicy.replace("_", "-")}  `}</Text>
      <Text color={STATE_DOT_COLOR[agentState] as any}>{"●"}</Text>
      <Text color="grey">{`  ${stateLabel}  `}</Text>
      {sessionTag ? <Text color="cyan" dimColor>{sessionTag}</Text> : null}
      <Text color="grey">{`CTX ${percent}%  `}</Text>
      <Text color={barColor as any}>{bar}</Text>
      <Text color="grey">{`  ${tokensToDisplay(tokens)} / ${tokensToDisplay(limit)}`}</Text>
    </Box>
  );
}

export const StatusBar = memo(StatusBarInner);
