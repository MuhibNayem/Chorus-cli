import { useState } from "react";
import { Box, Text, useInput } from "ink";
import TextInput from "ink-text-input";
import { loadSettings, saveSettings } from "../../settings/storage.js";
import { ALL_PROVIDERS } from "../../settings/providers.js";

interface AdvisorConfigProps {
  onDone: (msg: string) => void;
  onCancel: () => void;
}

type Panel = "toggle" | "provider" | "model";

export function AdvisorConfig({ onDone, onCancel }: AdvisorConfigProps) {
  const settings = loadSettings().llm?.advisor ?? { enabled: false };
  const [enabled, setEnabled] = useState(settings.enabled ?? false);
  const [autoMode, setAutoMode] = useState(settings.autoOnComplexTasks ?? false);
  const [selectedProvider, setSelectedProvider] = useState<string | null>(settings.provider ?? null);
  const [selectedModel, setSelectedModel] = useState(settings.model ?? "");
  const [panel, setPanel] = useState<Panel>("toggle");
  const [focusIndex, setFocusIndex] = useState(0);

  useInput((_input, key) => {
    if (key.escape) { onCancel(); return; }

    if (panel === "toggle") {
      const items = ["off", "on", "auto"];
      if (key.upArrow) { setFocusIndex((i) => (i <= 0 ? items.length - 1 : i - 1)); return; }
      if (key.downArrow) { setFocusIndex((i) => (i + 1) % items.length); return; }
      if (key.return) {
        const choice = items[focusIndex];
        if (choice === "off") { setEnabled(false); setAutoMode(false); }
        else if (choice === "on") { setEnabled(true); setAutoMode(false); }
        else { setEnabled(true); setAutoMode(true); }
        return;
      }
      if (key.tab) { setPanel("provider"); setFocusIndex(0); return; }
      return;
    }

    if (panel === "provider") {
      const providers = ["default (main session)", ...ALL_PROVIDERS.map((p) => p.label)];
      if (key.upArrow) { setFocusIndex((i) => (i <= 0 ? providers.length - 1 : i - 1)); return; }
      if (key.downArrow) { setFocusIndex((i) => (i + 1) % providers.length); return; }
      if (key.return) {
        if (focusIndex === 0) { setSelectedProvider(null); }
        else { setSelectedProvider(ALL_PROVIDERS[focusIndex - 1].id); }
        return;
      }
      if (key.tab) { setPanel("model"); return; }
      if (key.shift && key.tab) { setPanel("toggle"); setFocusIndex(0); return; }
      return;
    }
  });

  function saveAndDone() {
    const s = loadSettings();
    saveSettings({
      ...s,
      llm: {
        ...s.llm,
        advisor: {
          enabled,
          provider: selectedProvider ?? undefined,
          model: selectedModel.trim() || undefined,
          autoOnComplexTasks: autoMode,
        },
      },
    });
    const status = !enabled ? "OFF" : autoMode ? "AUTO" : "ON";
    const detail = [selectedProvider, selectedModel || null].filter(Boolean).join(":");
    onDone(`Advisor: ${status}${detail ? ` (${detail})` : ""}`);
  }

  const modeItems = ["off", "on", "auto"];
  const modeLabels: Record<string, string> = {
    off: "No advisor, no workers",
    on: "Advisor + workers on every non-trivial task",
    auto: "Auto-enable on complex tasks only",
  };
  const providerItems = ["default (main session)", ...ALL_PROVIDERS.map((p) => p.label)];
  const currentProviderLabel = selectedProvider
    ? ALL_PROVIDERS.find((p) => p.id === selectedProvider)?.label ?? selectedProvider
    : "default (main session)";

  return (
    <Box flexDirection="column" paddingLeft={2} paddingRight={2} paddingTop={1}>
      <Box marginBottom={1} flexDirection="row" justifyContent="space-between">
        <Text color="cyan" bold>{"⚙ Advisor Configuration  "}</Text>
        <Text color="grey" dimColor>Tab panel · ↑↓ select · Enter confirm · Esc cancel</Text>
      </Box>

      <Box flexDirection="column" marginBottom={1}>
        <Text color={panel === "toggle" ? "cyan" : "grey"} bold>
          {panel === "toggle" ? "▸ " : "  "}Mode
        </Text>
        {panel === "toggle" ? (
          <Box flexDirection="column" marginLeft={2}>
            {modeItems.map((item, i) => (
              <Box key={item} flexDirection="row">
                <Text color={i === focusIndex ? "cyan" : "grey"} bold={i === focusIndex}>
                  {i === focusIndex ? "▶ " : "  "}
                  {item === "off" ? "○ " : item === "on" ? "● " : "◎ "}
                  {item.toUpperCase()}
                </Text>
                <Text color="grey" dimColor>{`  — ${modeLabels[item]}`}</Text>
              </Box>
            ))}
            <Text color={!enabled ? "red" : autoMode ? "yellow" : "green"} dimColor>
              {`  Current: ${!enabled ? "○ OFF" : autoMode ? "◎ AUTO" : "● ON"}`}
            </Text>
          </Box>
        ) : (
          <Box marginLeft={2}>
            <Text color={!enabled ? "red" : autoMode ? "yellow" : "green"}>
              {!enabled ? "○ OFF" : autoMode ? "◎ AUTO" : "● ON"}
            </Text>
          </Box>
        )}
      </Box>

      <Box flexDirection="column" marginBottom={1}>
        <Text color={panel === "provider" ? "cyan" : "grey"} bold>
          {panel === "provider" ? "▸ " : "  "}Provider
        </Text>
        {panel === "provider" ? (
          <Box flexDirection="column" marginLeft={2}>
            {providerItems.map((item, i) => (
              <Box key={item} flexDirection="row">
                <Text color={i === focusIndex ? "cyan" : "grey"} bold={i === focusIndex}>
                  {i === focusIndex ? "▶ " : "  "}{item}
                </Text>
              </Box>
            ))}
          </Box>
        ) : (
          <Box marginLeft={2}>
            <Text color="grey">{currentProviderLabel}</Text>
          </Box>
        )}
      </Box>

      <Box flexDirection="column" marginBottom={1}>
        <Text color={panel === "model" ? "cyan" : "grey"} bold>
          {panel === "model" ? "▸ " : "  "}Model
        </Text>
        {panel === "model" ? (
          <Box marginLeft={2} flexDirection="row">
            <Box borderStyle="round" borderColor="cyan" paddingLeft={1} paddingRight={1}>
              <TextInput
                value={selectedModel}
                onChange={setSelectedModel}
                onSubmit={() => saveAndDone()}
                placeholder="model name or leave empty for default"
                focus
              />
            </Box>
          </Box>
        ) : (
          <Box marginLeft={2}>
            <Text color="grey">{selectedModel || "default (same as main session)"}</Text>
          </Box>
        )}
      </Box>

      <Box marginTop={1} flexDirection="row">
        <Text color="green" bold>{"Enter to save  "}</Text>
        <Text color="grey" dimColor>Esc to cancel</Text>
      </Box>
    </Box>
  );
}

