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

// ─── File Operation Rendering ──────────────────────────────────────────────────

type FileOp = "edit" | "write" | "read" | "list" | "search" | "glob" | "other";

function detectFileOp(name: string): FileOp {
  if (name === "file_edit") return "edit";
  if (name === "file_write") return "write";
  if (name === "file_read") return "read";
  if (name === "list_dir") return "list";
  if (name === "search_files") return "search";
  if (name === "find_files") return "glob";
  return "other";
}

function parseFileOpResult(
  name: string,
  args: Record<string, unknown>,
  result: string,
): { summary: string; stats?: string[]; content?: string; filePath?: string } {
  const filePath = (args.path ?? args.file_path ?? "") as string;
  const op = detectFileOp(name);

  switch (op) {
    case "edit": {
      const editMatch = result.match(/^Edited (.+?): replaced (\d+) chars with (\d+) chars$/);
      if (editMatch) {
        return {
          summary: result,
          stats: [`${editMatch[2]} chars removed`, `${editMatch[3]} chars added`],
          filePath: editMatch[1],
        };
      }
      return { summary: result, filePath, stats: ["edited"] };
    }
    case "write": {
      const writeMatch = result.match(/^Written (\d+) chars? to (.+)$/);
      if (writeMatch) {
        const lines = result.split("\n").length;
        return {
          summary: result,
          stats: [`${writeMatch[1]} chars`, `~${Math.ceil(Number(writeMatch[1]) / 60)} lines`],
          filePath: writeMatch[2],
        };
      }
      return { summary: result, filePath, stats: ["written"] };
    }
    case "read": {
      const readMatch = result.match(/^\[Content of (.+?)\]/);
      const lineCount = result.split("\n").length;
      if (readMatch || filePath) {
        return {
          summary: readMatch ? `Read ${filePath || readMatch[1]}` : `Read ${filePath}`,
          stats: [`${lineCount} lines`, `${result.length} chars`],
          filePath: filePath || (readMatch ? readMatch[1] : ""),
          content: result,
        };
      }
      return { summary: `Read ${filePath}`, stats: [`${result.length} chars`], filePath };
    }
    case "list": {
      const entries = result.split("\n").filter(Boolean).length;
      return { summary: `Listed ${filePath || "."}`, stats: [`${entries} entries`], filePath };
    }
    case "search": {
      const matchCount = (result.match(/\n/g) || []).length;
      return { summary: `Searched ${filePath || "."}`, stats: [`${matchCount} matches`], filePath };
    }
    case "glob": {
      const matchCount = result === "(no matches)" ? 0 : result.split("\n").length;
      return { summary: `Found ${matchCount} file${matchCount !== 1 ? "s" : ""}`, stats: matchCount > 0 ? [`${matchCount} matching`] : ["0 matches"], filePath };
    }
    default:
      return { summary: result };
  }
}

function FileOpResultView({ name, args, result }: { name: string; args: Record<string, unknown>; result: string }) {
  const op = detectFileOp(name);
  const parsed = parseFileOpResult(name, args, result);
  const filePath = parsed.filePath || (args.path ?? args.file_path ?? "") as string;
  const opLabel = op === "edit" ? "✎" : op === "write" ? "✚" : op === "read" ? "☰" : op === "list" ? "☷" : op === "search" ? "⌕" : op === "glob" ? "⭫" : "";

  return (
    <Box marginLeft={2} flexDirection="column">
      {filePath && (
        <Box flexDirection="row" marginBottom={0}>
          <Text color="grey">{opLabel} </Text>
          <Text color="white">{filePath}</Text>
        </Box>
      )}
      {op === "edit" && renderDiff(args)}
      {op === "write" && renderWritePreview(args)}
      {op === "read" && renderReadPreview(result)}
      {op === "list" && renderListPreview(result)}
      {op === "search" && renderSearchPreview(result)}
      {(op !== "edit" && op !== "write" && op !== "read" && op !== "list" && op !== "search") && (
        <Box marginTop={0}>
          <Text color="grey" dimColor>{parsed.summary.slice(0, 150)}</Text>
        </Box>
      )}
    </Box>
  );
}

function renderDiff(args: Record<string, unknown>) {
  const oldString = (args.old_string ?? "") as string;
  const newString = (args.new_string ?? "") as string;

  // Show full old/new content as diff
  const oldLines = oldString.split("\n");
  const newLines = newString.split("\n");

  // Compute the diff summary
  const removedChars = oldString.length;
  const addedChars = newString.length;
  const diff = addedChars - removedChars;

  return (
    <Box marginLeft={0} marginTop={0} flexDirection="column">
      {/* Diff stat bar */}
      <Box flexDirection="row" marginBottom={0}>
        <Text color="red">{` -${removedChars} chars`}</Text>
        <Text color="grey" dimColor>{"  "}</Text>
        <Text color="green">{` +${addedChars} chars`}</Text>
        {diff !== 0 && (
          <Text color={diff > 0 ? "green" : "red"} dimColor>{`  (${diff > 0 ? "+" : ""}${diff})`}</Text>
        )}
      </Box>

      {/* Diff content */}
      <Box borderStyle="single" borderColor="grey" paddingX={1} flexDirection="column" marginTop={0}>
        {oldLines.map((line, i) => (
          <Box key={`old-${i}`} flexDirection="row">
            <Text color="red" dimColor>{"- "}</Text>
            <Text color="red">{line || " "}</Text>
          </Box>
        ))}
        {newLines.length > 0 && oldLines.length > 0 && (
          <Box key="separator"><Text color="grey" dimColor>{"─".repeat(40)}</Text></Box>
        )}
        {newLines.map((line, i) => (
          <Box key={`new-${i}`} flexDirection="row">
            <Text color="green" dimColor>{"+ "}</Text>
            <Text color="green">{line || " "}</Text>
          </Box>
        ))}
      </Box>
    </Box>
  );
}

function renderWritePreview(args: Record<string, unknown>) {
  const content = (args.content ?? "") as string;
  const lines = content.split("\n");

  return (
    <Box marginLeft={0} marginTop={0} flexDirection="column">
      <Box flexDirection="row" marginBottom={0}>
        <Text color="green">{` +${content.length} chars`}</Text>
        <Text color="grey" dimColor>{`  ${lines.length} lines`}</Text>
      </Box>
      <Box borderStyle="single" borderColor="grey" paddingX={1} flexDirection="column" marginTop={0}>
        {lines.map((line, i) => (
          <Box key={i} flexDirection="row">
            <Text color="grey" dimColor>{String(i + 1).padStart(4, " ")} </Text>
            <Text color="green">{line || " "}</Text>
          </Box>
        ))}
      </Box>
    </Box>
  );
}

function renderReadPreview(content: string) {
  const lines = content.split("\n");
  const preview = lines.slice(0, 8);
  const hasMore = lines.length > 8;
  return (
    <Box marginLeft={0} marginTop={0} flexDirection="column">
      <Box borderStyle="single" borderColor="grey" paddingX={1} flexDirection="column">
        {preview.map((line, i) => (
          <Box key={i} flexDirection="row">
            <Text color="grey" dimColor>{String(i + 1).padStart(4, " ")} </Text>
            <Text color="grey">{line || " "}</Text>
          </Box>
        ))}
        {hasMore && (
          <Text color="grey" dimColor>{`  … ${lines.length - 8} more lines`}</Text>
        )}
      </Box>
    </Box>
  );
}

function renderListPreview(result: string) {
  const entries = result.split("\n").filter(Boolean);
  const preview = entries.slice(0, 20);
  const hasMore = entries.length > 20;
  return (
    <Box marginLeft={0} marginTop={0} flexDirection="column">
      {preview.map((e, i) => (
        <Box key={i} flexDirection="row">
          <Text color={e.endsWith("/") ? "cyan" : "grey"}>{`  ${e}`}</Text>
        </Box>
      ))}
      {hasMore && (
        <Text color="grey" dimColor>{`  … ${entries.length - 20} more entries`}</Text>
      )}
    </Box>
  );
}

function renderSearchPreview(result: string) {
  const lines = result.split("\n").filter(Boolean);
  if (lines.length === 0) return null;
  return (
    <Box marginLeft={0} marginTop={0} flexDirection="column">
      {lines.map((line, i) => (
        <Box key={i} flexDirection="row">
          <Text color="grey">{`  ${line.slice(0, 120)}${line.length > 120 ? "…" : ""}`}</Text>
        </Box>
      ))}
    </Box>
  );
}

// ─── Main ToolCard ─────────────────────────────────────────────────────────────

export function ToolCard({ card, focused }: ToolCardProps) {
  const spinner  = useSpinner(card.status === "running");
  const color    = STATUS_COLOR[card.status] as any;
  const isRunning = card.status === "running";
  const hint      = focused ? "  {Space}" : "  Space";
  const focus     = focused ? "▶ " : "  ";

  const icon = isRunning ? spinner : card.status === "done" ? "✓" : "✗";
  const isTodo = card.name === "write_todos";
  const isFileOp = card.status !== "running" && ["file_edit", "file_write", "file_read", "list_dir", "search_files", "find_files"].includes(card.name);

  if (!card.expanded) {
    return (
      <Box marginLeft={2} marginBottom={0} flexDirection="column">
        <Box flexDirection="row">
          <Text color={color}>{focus}</Text>
          <Text color={color}>{icon} </Text>
          <Text bold>{card.name}</Text>
          {!isTodo && !isFileOp && <Text color="grey">{"("}{truncateArgs(card.args)}{")"}</Text>}
          {isFileOp && !isRunning && (
            <Text color="grey">{`  ${parseFileOpArgs(card.name, card.args as Record<string, unknown>)}`}</Text>
          )}
          {!isRunning && (
            <Text color={focused ? "cyan" : "grey"}>{`  [expand${hint}]`}</Text>
          )}
        </Box>
        {isTodo && !isRunning && <TodoList args={card.args} />}
      </Box>
    );
  }

  return (
    <Box marginLeft={2} flexDirection="column" marginBottom={1}>
      <Box flexDirection="row">
        <Text color={color}>{focus}</Text>
        <Text color={color}>{icon} </Text>
        <Text bold>{card.name}</Text>
        {!isTodo && (
          <Text color="grey">{`(${JSON.stringify(card.args)})`}</Text>
        )}
        <Text color={focused ? "cyan" : "grey"}>{`  [collapse${hint}]`}</Text>
      </Box>
      {isTodo ? (
        <TodoList args={card.args} />
      ) : isFileOp && card.result ? (
        <FileOpResultView
          name={card.name}
          args={card.args as Record<string, unknown>}
          result={card.result}
        />
      ) : (
        <Box marginLeft={2} flexDirection="column">
          <Text color="grey">{card.result || "(no output)"}</Text>
        </Box>
      )}
    </Box>
  );
}

function parseFileOpArgs(name: string, args: Record<string, unknown>): string {
  const fp = (args.path ?? args.file_path ?? "") as string;
  if (name === "search_files") {
    const pattern = (args.pattern ?? "") as string;
    return pattern ? `${fp}: /${pattern}/` : fp;
  }
  return fp;
}
