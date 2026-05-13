import { Box, Text } from "ink";
import { useSpinner } from "../hooks/useSpinner.js";
import { formatCost, costColor } from "../../llm/pricing.js";

const MODEL_NAME = process.env.OLLAMA_MODEL ?? "batiai/gemma4-e2b:q4";
const MAX_TOKENS = 128_000;
const BAR_WIDTH = 20;

export type AgentState = "idle" | "thinking" | "tool" | "error";

interface StatusBarProps {
  tokens: number;
  agentState: AgentState;
  sessionName?: string;
  totalCost?: number;
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

export function StatusBar({ tokens, agentState, sessionName, totalCost = 0 }: StatusBarProps) {
  const isActive = agentState !== "idle" && agentState !== "error";
  const spinner  = useSpinner(isActive);

  const percent  = Math.min(Math.round((tokens / MAX_TOKENS) * 100), 100);
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
      <Text bold color="white">{MODEL_NAME}</Text>
      <Text>{"  "}</Text>
      <Text color={STATE_DOT_COLOR[agentState] as any}>{"●"}</Text>
      <Text color="grey">{`  ${stateLabel}  `}</Text>
      {sessionTag ? <Text color="cyan" dimColor>{sessionTag}</Text> : null}
      <Text color="grey">{`CTX ${percent}%  `}</Text>
      <Text color={barColor as any}>{bar}</Text>
      <Text color="grey">{`  ${tokensToDisplay(tokens)} / 128K`}</Text>
      {totalCost > 0 && (
        <>
          <Text color="grey">{"  "}</Text>
          <Text color={costColor(totalCost) as any}>{formatCost(totalCost)}</Text>
        </>
      )}
    </Box>
  );
}
