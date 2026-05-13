import { useState, useCallback } from "react";
import { Box, Text, useInput } from "ink";
import TextInput from "ink-text-input";
import { saveAgent } from "../../agents/storage.js";
import type { AgentDef } from "../../agents/types.js";

interface AgentCreatorProps {
  onDone: (msg: string) => void;
  onCancel: () => void;
  initialAgent?: AgentDef;
}

type Field = "name" | "description" | "systemPrompt" | "model";

const FIELDS: Field[] = ["name", "description", "systemPrompt", "model"];
const FIELD_LABELS: Record<Field, string> = {
  name: "Agent name",
  description: "Description",
  systemPrompt: "System prompt",
  model: "Model (optional, e.g. openai:gpt-4o)",
};

export function AgentCreator({ onDone, onCancel, initialAgent }: AgentCreatorProps) {
  const [values, setValues] = useState<Record<Field, string>>({
    name: initialAgent?.name ?? "",
    description: initialAgent?.description ?? "",
    systemPrompt: initialAgent?.systemPrompt ?? "",
    model: initialAgent?.model ?? "",
  });
  const [fieldIndex, setFieldIndex] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const activeField = FIELDS[fieldIndex];

  useInput((_input, key) => {
    if (key.escape) { onCancel(); return; }
    if (key.return) {
      if (fieldIndex < FIELDS.length - 1) {
        setFieldIndex((i) => i + 1);
      } else {
        handleSave();
      }
    }
    if (key.tab) {
      setFieldIndex((i) => (i + 1) % FIELDS.length);
    }
  });

  const handleSave = useCallback(() => {
    if (!values.name.trim()) { setError("Agent name is required."); return; }
    if (!values.systemPrompt.trim()) { setError("System prompt is required."); return; }
    try {
      const filePath = saveAgent({
        name: values.name.trim(),
        description: values.description.trim(),
        systemPrompt: values.systemPrompt.trim(),
        model: values.model.trim() || undefined,
      }, "user");
      onDone(`Agent "${values.name.trim()}" saved to ${filePath}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [values, onDone]);

  return (
    <Box flexDirection="column" borderStyle="round" borderColor="cyan" paddingLeft={1} paddingRight={1}>
      <Text bold color="cyan">{initialAgent ? "Edit Agent" : "Create Agent"}</Text>
      {FIELDS.map((field, i) => {
        const active = i === fieldIndex;
        return (
          <Box key={field} flexDirection="row" marginTop={0}>
            <Text color={active ? "cyan" : "grey"} bold={active}>
              {FIELD_LABELS[field]}: {" "}
            </Text>
            {active ? (
              <TextInput
                value={values[field]}
                onChange={(val) => setValues((v) => ({ ...v, [field]: val }))}
                onSubmit={() => {
                  if (fieldIndex < FIELDS.length - 1) setFieldIndex((idx) => idx + 1);
                  else handleSave();
                }}
                placeholder={field === "model" ? "leave blank for default" : ""}
              />
            ) : (
              <Text color="white">{values[field] || <Text color="grey" dimColor>(empty)</Text>}</Text>
            )}
          </Box>
        );
      })}
      {error && <Text color="red">{error}</Text>}
      <Text color="grey" dimColor>  Tab/Enter to advance · Esc to cancel · Enter on last field to save</Text>
    </Box>
  );
}
