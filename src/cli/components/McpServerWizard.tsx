import { useState } from "react";
import { Box, Text, useInput } from "ink";
import TextInput from "ink-text-input";
import { loadSettings, saveSettings, type McpServerSettings } from "../../settings/storage.js";

type Step = "name" | "type" | "stdio-command" | "stdio-args" | "http-url" | "confirm" | "done";

interface McpServerWizardProps {
  onDone: (msg: string) => void;
  onCancel: () => void;
}

const TRANSPORT_TYPES = ["stdio", "http", "sse"] as const;

export function McpServerWizard({ onDone, onCancel }: McpServerWizardProps) {
  const [step, setStep] = useState<Step>("name");
  const [name, setName] = useState("");
  const [typeIndex, setTypeIndex] = useState(0);
  const [command, setCommand] = useState("");
  const [args, setArgs] = useState("");
  const [url, setUrl] = useState("");
  const [error, setError] = useState("");

  useInput((_input, key) => {
    if (key.escape) {
      onCancel();
      return;
    }

    if (step === "type") {
      if (key.upArrow) {
        setTypeIndex((i) => (i <= 0 ? TRANSPORT_TYPES.length - 1 : i - 1));
        return;
      }
      if (key.downArrow) {
        setTypeIndex((i) => (i + 1) % TRANSPORT_TYPES.length);
        return;
      }
      if (key.return) {
        const t = TRANSPORT_TYPES[typeIndex];
        setStep(t === "stdio" ? "stdio-command" : "http-url");
        return;
      }
      return;
    }

    if (step === "confirm") {
      if (key.return) {
        saveServer();
        return;
      }
      return;
    }
  });

  function saveServer() {
    const settings = loadSettings();
    const server: McpServerSettings = { type: TRANSPORT_TYPES[typeIndex] };

    if (server.type === "stdio") {
      server.command = command.trim();
      const argList = args.trim().split(/\s+/).filter(Boolean);
      if (argList.length > 0) server.args = argList;
    } else {
      server.url = url.trim();
    }

    const existing = settings.mcp?.servers ?? {};
    const merged: Record<string, McpServerSettings> = {
      ...existing,
      [name.trim()]: server,
    };

    saveSettings({
      ...settings,
      mcp: { servers: merged },
    });

    onDone(`MCP server "${name.trim()}" added (${server.type}). Run /mcp-reload to connect.`);
  }

  function handleNameSubmit(value: string) {
    const trimmed = value.trim();
    if (!trimmed) {
      setError("Name is required");
      return;
    }
    const settings = loadSettings();
    if (settings.mcp?.servers?.[trimmed]) {
      setError(`Server "${trimmed}" already exists`);
      return;
    }
    setError("");
    setName(trimmed);
    setStep("type");
  }

  function handleCommandSubmit(value: string) {
    const trimmed = value.trim();
    if (!trimmed) {
      setError("Command is required");
      return;
    }
    setError("");
    setCommand(trimmed);
    setStep("stdio-args");
  }

  function handleArgsSubmit(value: string) {
    setArgs(value);
    setStep("confirm");
  }

  function handleUrlSubmit(value: string) {
    const trimmed = value.trim();
    if (!trimmed) {
      setError("URL is required");
      return;
    }
    setError("");
    setUrl(trimmed);
    setStep("confirm");
  }

  return (
    <Box flexDirection="column" paddingLeft={2} paddingRight={2} paddingTop={1}>
      <Box marginBottom={1}>
        <Text color="cyan" bold>{"✦ "}</Text>
        <Text bold>Add MCP Server</Text>
        <Text color="grey">{"  · Esc to cancel"}</Text>
      </Box>

      {step === "name" && (
        <Box flexDirection="column">
          <Text>Server name (e.g., filesystem, github):</Text>
          <Box borderStyle="round" borderColor="cyan" paddingLeft={1} paddingRight={1}>
            <TextInput
              value={name}
              onChange={setName}
              onSubmit={handleNameSubmit}
              placeholder="my-server"
              focus
            />
          </Box>
          {error ? <Text color="red">{error}</Text> : null}
        </Box>
      )}

      {step === "type" && (
        <Box flexDirection="column">
          <Text>Select transport type:</Text>
          {TRANSPORT_TYPES.map((t, i) => (
            <Box key={t} flexDirection="row">
              <Text color={i === typeIndex ? "cyan" : "grey"} bold={i === typeIndex}>
                {i === typeIndex ? "▶ " : "  "}
                {t}
              </Text>
            </Box>
          ))}
          <Text color="grey" dimColor>↑↓ navigate · Enter select</Text>
        </Box>
      )}

      {step === "stdio-command" && (
        <Box flexDirection="column">
          <Text>Command to run (e.g., npx -y @modelcontextprotocol/server-filesystem /tmp):</Text>
          <Box borderStyle="round" borderColor="cyan" paddingLeft={1} paddingRight={1}>
            <TextInput
              value={command}
              onChange={setCommand}
              onSubmit={handleCommandSubmit}
              placeholder="command"
              focus
            />
          </Box>
          {error ? <Text color="red">{error}</Text> : null}
        </Box>
      )}

      {step === "stdio-args" && (
        <Box flexDirection="column">
          <Text>Optional arguments (space-separated, or leave empty):</Text>
          <Box borderStyle="round" borderColor="cyan" paddingLeft={1} paddingRight={1}>
            <TextInput
              value={args}
              onChange={setArgs}
              onSubmit={handleArgsSubmit}
              placeholder="--arg1 value1 --arg2 value2"
              focus
            />
          </Box>
          <Text color="grey" dimColor>Press Enter to skip</Text>
        </Box>
      )}

      {step === "http-url" && (
        <Box flexDirection="column">
          <Text>Server URL:</Text>
          <Box borderStyle="round" borderColor="cyan" paddingLeft={1} paddingRight={1}>
            <TextInput
              value={url}
              onChange={setUrl}
              onSubmit={handleUrlSubmit}
              placeholder="http://localhost:3000/sse"
              focus
            />
          </Box>
          {error ? <Text color="red">{error}</Text> : null}
        </Box>
      )}

      {step === "confirm" && (
        <Box flexDirection="column">
          <Text color="green">Ready to add:</Text>
          <Box borderStyle="single" borderColor="grey" paddingX={2} paddingY={1} flexDirection="column" marginY={1}>
            <Text><Text color="grey">name:</Text> {name}</Text>
            <Text><Text color="grey">type:</Text> {TRANSPORT_TYPES[typeIndex]}</Text>
            {TRANSPORT_TYPES[typeIndex] === "stdio" ? (
              <>
                <Text><Text color="grey">command:</Text> {command}</Text>
                {args.trim() ? <Text><Text color="grey">args:</Text> {args}</Text> : null}
              </>
            ) : (
              <Text><Text color="grey">url:</Text> {url}</Text>
            )}
          </Box>
          <Text>Press Enter to save, or Esc to cancel</Text>
        </Box>
      )}
    </Box>
  );
}
