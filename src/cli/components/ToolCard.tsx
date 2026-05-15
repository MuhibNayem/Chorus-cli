import { Box, Text } from "ink";
import type { ToolCard as ToolCardType } from "../state/feedReducer.js";
import { useSpinner } from "../hooks/useSpinner.js";

interface ToolCardProps {
  card: ToolCardType;
  focused: boolean;
}

const STATUS_COLOR: Record<ToolCardType["status"], string> = {
  running: "cyan",
  done:    "green",
  error:   "red",
};

function truncateArgs(args: unknown): string {
  const s = JSON.stringify(args) ?? "{}";
  return s.length > 60 ? s.slice(0, 57) + "…" : s;
}

type TodoItem = { content: string; status: "pending" | "in_progress" | "completed" };

const TODO_ICON: Record<TodoItem["status"], string> = {
  pending:     "○",
  in_progress: "◎",
  completed:   "✓",
};
const TODO_COLOR: Record<TodoItem["status"], string> = {
  pending:     "grey",
  in_progress: "cyan",
  completed:   "green",
};

function TodoList({ args }: { args: unknown }) {
  const todos: TodoItem[] = (args as any)?.todos ?? [];
  const done   = todos.filter((t) => t.status === "completed").length;
  const active = todos.filter((t) => t.status === "in_progress").length;
  return (
    <Box flexDirection="column" marginLeft={2}>
      <Text color="grey">{`${done}/${todos.length} done · ${active} in progress`}</Text>
      {todos.map((t, i) => (
        <Box key={i} flexDirection="row" gap={1}>
          <Text color={TODO_COLOR[t.status] as any}>{TODO_ICON[t.status]}</Text>
          <Text color={t.status === "completed" ? "grey" : "white"} dimColor={t.status === "completed"}>
            {t.content}
          </Text>
        </Box>
      ))}
    </Box>
  );
}

export function ToolCard({ card, focused }: ToolCardProps) {
  const spinner  = useSpinner(card.status === "running");
  const color    = STATUS_COLOR[card.status] as any;
  const isRunning = card.status === "running";
  const hint      = focused ? "  {Space}" : "  Space";
  const focus     = focused ? "▶ " : "  ";

  const icon = isRunning ? spinner : card.status === "done" ? "✓" : "✗";

  const isTodo = card.name === "write_todos";

  if (!card.expanded) {
    return (
      <Box marginLeft={2} marginBottom={0} flexDirection="column">
        <Box flexDirection="row">
          <Text color={color}>{focus}</Text>
          <Text color={color}>{icon} </Text>
          <Text bold>{card.name}</Text>
          {!isTodo && <Text color="grey">{"("}{truncateArgs(card.args)}{")"}</Text>}
          {!isRunning && (
            <Text color={focused ? "cyan" : "grey"}>{`  [expand${hint}]`}</Text>
          )}
        </Box>
        {isTodo && !isRunning && <TodoList args={card.args} />}
      </Box>
    );
  }

  const resultText  = card.result ?? "(no output)";
  const resultLines = resultText.split("\n");

  return (
    <Box marginLeft={2} flexDirection="column" marginBottom={1}>
      <Box flexDirection="row">
        <Text color={color}>{focus}</Text>
        <Text color={color}>{icon} </Text>
        <Text bold>{card.name}</Text>
        <Text color={focused ? "cyan" : "grey"}>{`  [collapse${hint}]`}</Text>
      </Box>
      {isTodo ? (
        <TodoList args={card.args} />
      ) : (
        <Box marginLeft={2} flexDirection="column">
          <Text color="grey" bold>{"Args:"}</Text>
          <Text color="grey">{JSON.stringify(card.args, null, 2)}</Text>
          <Text color="grey" bold>{"Result:"}</Text>
          {resultLines.map((line, i) => (
            <Text key={i} color="grey">{line}</Text>
          ))}
        </Box>
      )}
    </Box>
  );
}
