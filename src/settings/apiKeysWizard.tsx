import { useState } from "react";
import { Box, Text, useInput } from "ink";
import TextInput from "ink-text-input";
import {
  getApiKeyStatus,
  saveApiKeys,
  clearSettingsCache,
  type ChorusApiKeys,
} from "./storage.js";

type Field = { label: string; key: keyof ChorusApiKeys; envVar: string; value: string | undefined; fromEnv: boolean };

type Phase = "menu" | "edit" | "review";

function maskKey(key: string): string {
  if (key.length <= 8) return "••••••••";
  return key.slice(0, 4) + "••••" + key.slice(-4);
}

type Props = { onDone: (saved: boolean) => void };

export function ApiKeysWizard({ onDone }: Props) {
  const fields: Field[] = getApiKeyStatus();
  const [phase, setPhase] = useState<Phase>("menu");
  const [cursor, setCursor] = useState(0);
  const [editValue, setEditValue] = useState("");
  const [draft, setDraft] = useState<ChorusApiKeys>({});

  const currentField = fields[cursor];

  useInput((input, key) => {
    if (key.ctrl && input === "c") process.exit(0);

    if (phase === "menu") {
      if (key.upArrow)   setCursor((c) => Math.max(0, c - 1));
      if (key.downArrow) setCursor((c) => Math.min(fields.length - 1, c + 1));
      if (key.return) {
        const field = fields[cursor];
        if (!field) return;
        // pre-fill with settings value (not env-shadowed) so user can edit
        const settingsVal = draft[field.key] ?? (!field.fromEnv ? field.value ?? "" : "");
        setEditValue(settingsVal);
        setPhase("edit");
      }
      if (key.escape) onDone(false);
      if (input === "s") setPhase("review");
      return;
    }

    if (phase === "edit") {
      if (key.escape) {
        setPhase("menu");
      }
      // submit handled by TextInput onSubmit
      return;
    }

    if (phase === "review") {
      if (key.return) {
        saveApiKeys(draft);
        clearSettingsCache();
        onDone(true);
      }
      if (key.escape || key.backspace) {
        setPhase("menu");
      }
      return;
    }
  });

  function handleEditSubmit(value: string) {
    if (!currentField) return;
    setDraft((d) => ({ ...d, [currentField.key]: value.trim() || undefined }));
    setPhase("menu");
  }

  const effectiveFields = fields.map((f) => ({
    ...f,
    effective: draft[f.key] !== undefined ? draft[f.key] : f.value,
    dirty: draft[f.key] !== undefined,
  }));

  return (
    <Box flexDirection="column" borderStyle="round" borderColor="cyan" paddingX={1}>
      <Box marginBottom={1}>
        <Text color="cyan" bold>{"chorus config"}</Text>
        <Text color="grey" dimColor>{"  · API keys for search & weather"}</Text>
      </Box>

      {phase === "menu" && (
        <>
          <Text color="grey" dimColor>{"[↑↓] navigate  [Enter] edit  [s] save  [Esc] cancel"}</Text>
          <Box flexDirection="column" marginTop={1}>
            {effectiveFields.map((f, i) => {
              const selected = i === cursor;
              const status = f.fromEnv
                ? { label: "env", color: "yellow" as const }
                : f.effective
                  ? { label: "set", color: "green" as const }
                  : { label: "unset", color: "red" as const };
              return (
                <Box key={f.key} flexDirection="row" gap={1}>
                  <Text color={selected ? "cyan" : "white"} bold={selected}>
                    {selected ? "▶ " : "  "}
                    {f.label.padEnd(22)}
                  </Text>
                  <Text color={status.color}>{`[${status.label}]`}</Text>
                  {f.fromEnv && (
                    <Text color="grey" dimColor>{" shadowed by env var"}</Text>
                  )}
                  {!f.fromEnv && f.effective && (
                    <Text color="grey" dimColor>{` ${maskKey(f.effective)}`}</Text>
                  )}
                  {f.dirty && !f.fromEnv && (
                    <Text color="cyan" dimColor>{" *"}</Text>
                  )}
                </Box>
              );
            })}
          </Box>
          <Box marginTop={1}>
            <Text color="grey" dimColor>{"* = unsaved change  ·  env-shadowed keys are read-only (set via .env)"}</Text>
          </Box>
        </>
      )}

      {phase === "edit" && currentField && (
        <>
          <Text>{`Edit: ${currentField.label}`}</Text>
          <Text color="grey" dimColor>{"[Enter] confirm  [Esc] back"}</Text>
          {currentField.fromEnv && (
            <Text color="yellow">{`  Note: $${currentField.envVar} is set in env and will take precedence`}</Text>
          )}
          <Box flexDirection="row" marginTop={1}>
            <Text color="cyan" bold>{"> "}</Text>
            <TextInput
              value={editValue}
              onChange={setEditValue}
              onSubmit={handleEditSubmit}
              focus
              mask="•"
            />
          </Box>
        </>
      )}

      {phase === "review" && (
        <>
          <Text>{"Review changes"}</Text>
          <Text color="grey" dimColor>{"[Enter] save to ~/.chorus/settings.json  [Esc] back"}</Text>
          <Box flexDirection="column" marginTop={1}>
            {effectiveFields.map((f) => (
              <Box key={f.key} flexDirection="row" gap={1}>
                <Text>{f.label.padEnd(22)}</Text>
                <Text color={f.effective ? "green" : "red"}>
                  {f.effective ? maskKey(f.effective) : "(not set)"}
                </Text>
                {f.fromEnv && <Text color="yellow">{" [env]"}</Text>}
              </Box>
            ))}
          </Box>
        </>
      )}
    </Box>
  );
}
