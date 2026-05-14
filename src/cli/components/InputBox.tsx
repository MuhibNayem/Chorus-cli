import { Box, Text } from "ink";
import { memo } from "react";
import TextInput from "ink-text-input";

interface InputBoxProps {
  value: string;
  onChange: (val: string) => void;
  onSubmit: (text: string) => void;
  disabled: boolean;
  isPastePreviewed?: boolean;
  onDismissPaste?: () => void;
  resetKey?: number;
}

const PASTE_PREVIEW_LINES = 4;
const PASTE_PREVIEW_WIDTH = 60;

function PastePreview({ text }: { text: string }) {
  const lines = text.split(/\n/);
  const lineCount = lines.length;
  const charCount = text.length;
  const previewLines = lines.slice(0, PASTE_PREVIEW_LINES);
  const truncated = lineCount > PASTE_PREVIEW_LINES;

  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor="cyan"
      paddingLeft={1}
      paddingRight={1}
      marginBottom={0}
    >
      <Text color="cyan" bold>
        {"⎘ "}
        {lineCount > 1 ? `${lineCount} lines` : `${charCount} chars`}
        {" pasted"}
        <Text color="grey" dimColor>{"  · Enter to send · Esc to clear"}</Text>
      </Text>
      {previewLines.map((line, i) => (
        <Text key={i} color="grey" dimColor>
          {line.length > PASTE_PREVIEW_WIDTH
            ? line.slice(0, PASTE_PREVIEW_WIDTH - 1) + "…"
            : line || " "}
        </Text>
      ))}
      {truncated && (
        <Text color="grey" dimColor>{`  … ${lineCount - PASTE_PREVIEW_LINES} more lines`}</Text>
      )}
    </Box>
  );
}

function InputBoxInner({
  value,
  onChange,
  onSubmit,
  disabled,
  isPastePreviewed = false,
  onDismissPaste,
  resetKey = 0,
}: InputBoxProps) {
  function handleSubmit(submitted: string) {
    const trimmed = submitted.trim();
    if (!trimmed || disabled) return;
    onSubmit(trimmed);
  }

  const showPaste = isPastePreviewed && value.length > 20;

  return (
    <Box flexDirection="column">
      {showPaste && <PastePreview text={value} />}

      <Box
        borderStyle="round"
        borderColor={disabled ? "grey" : "cyan"}
        paddingLeft={1}
        paddingRight={1}
      >
        {disabled ? (
          <Text color="grey" dimColor>{"processing…"}</Text>
        ) : (
          <Box flexDirection="row">
            <Text color="cyan" bold>{">"} </Text>
            {showPaste ? (
              <Text color="grey" dimColor>
                {`${value.length} chars  ·  Enter to send`}
              </Text>
            ) : (
              <TextInput
                key={resetKey}
                value={value}
                onChange={onChange}
                onSubmit={handleSubmit}
                placeholder={"Send a message or type / for commands…"}
                focus={!disabled}
              />
            )}
          </Box>
        )}
      </Box>
    </Box>
  );
}

export const InputBox = memo(InputBoxInner);
