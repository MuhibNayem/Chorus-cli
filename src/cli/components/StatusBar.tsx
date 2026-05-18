import { memo } from "react";
import { Box, Text } from "ink";
import { useSpinner } from "../hooks/useSpinner.js";
import type { ApprovalPolicy, ExecutionMode } from "../../harness/types.js";

const DEFAULT_MAX_TOKENS = 128_000;
const BAR_WIDTH = 12;
const MAX_MODEL_LABEL = 28;
const MAX_SESSION_LABEL = 16;

export type AgentState = "idle" | "thinking" | "tool" | "error";

interface StatusBarProps {
  modelLabel: string;
  tokens: number;
  agentState: AgentState;
  sessionName?: string;
  maxTokens?: number;
  executionMode?: ExecutionMode;
  approvalPolicy?: ApprovalPolicy;
  goalStatus?: string;
}

function tokensToDisplay(n: number): string {
  if (n < 1_000) return `${n}`;
  if (n < 1_000_000) return `${(n / 1_000).toFixed(1)}K`;
  return `${(n / 1_000_000).toFixed(1)}M`;
}

function truncate(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, Math.max(0, max - 1))}…` : value;
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
  maxTokens = DEFAULT_MAX_TOKENS,
  executionMode = "build",
  approvalPolicy = "auto_edit",
  goalStatus,
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

  const safeModelLabel = truncate(modelLabel, MAX_MODEL_LABEL);
  const sessionTag = sessionName
    ? `[${truncate(sessionName, MAX_SESSION_LABEL)}]  `
    : "";

  return (
    <Box flexShrink={0} borderStyle="single" borderColor="grey" paddingLeft={1} paddingRight={1}>
      <Text bold color="white">{safeModelLabel}</Text>
      <Text>{"  "}</Text>
      <Text color={executionMode === "plan" ? "yellow" : "green"}>{executionMode.toUpperCase()}</Text>
      <Text color="grey">{`/${approvalPolicy.replace("_", "-")}  `}</Text>
      <Text color={STATE_DOT_COLOR[agentState] as any}>{"●"}</Text>
      <Text color="grey">{`  ${stateLabel}  `}</Text>
      {goalStatus ? <Text color="yellow" dimColor>{goalStatus}  </Text> : null}
      {sessionTag ? <Text color="cyan" dimColor>{sessionTag}</Text> : null}
      <Text color="grey">{`CTX ${percent}%  `}</Text>
      <Text color={barColor as any}>{bar}</Text>
      <Text color="grey">{`  ${tokensToDisplay(tokens)} / ${tokensToDisplay(limit)}`}</Text>
    </Box>
  );
}

export const StatusBar = memo(StatusBarInner);
