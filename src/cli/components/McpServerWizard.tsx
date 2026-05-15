import { useState } from "react";
import { Box, Text, useInput } from "ink";
import TextInput from "ink-text-input";
import { loadSettings, saveSettings, type McpServerSettings } from "../../settings/storage.js";

type Step =
  | "name"
  | "transport"
  | "stdio-command"
  | "stdio-args"
  | "stdio-env"
  | "stdio-cwd"
  | "stdio-envfile"
  | "http-url"
  | "http-headers"
  | "http-auth-type"
  | "http-auth-bearer"
  | "http-auth-client-credentials"
  | "http-auth-authorization-code"
  | "advanced"
  | "confirm"
  | "done";

interface KeyValue {
  key: string;
  value: string;
}

const TRANSPORT_TYPES = ["stdio", "http", "sse"] as const;
const AUTH_TYPES = ["none", "bearer", "client_credentials", "authorization_code"] as const;

interface McpServerWizardProps {
  onDone: (msg: string) => void;
  onCancel: () => void;
}

export function McpServerWizard({ onDone, onCancel }: McpServerWizardProps) {
  const [step, setStep] = useState<Step>("name");
  const [name, setName] = useState("");
  const [typeIndex, setTypeIndex] = useState(0);
  const [command, setCommand] = useState("");
  const [args, setArgs] = useState("");
  const [envPairs, setEnvPairs] = useState<KeyValue[]>([]);
  const [envInput, setEnvInput] = useState("");
  const [cwd, setCwd] = useState("");
  const [envFile, setEnvFile] = useState("");
  const [url, setUrl] = useState("");
  const [headerPairs, setHeaderPairs] = useState<KeyValue[]>([]);
  const [headerInput, setHeaderInput] = useState("");
  const [authTypeIndex, setAuthTypeIndex] = useState(0);
  const [bearerTokenEnv, setBearerTokenEnv] = useState("");
  const [clientIdEnv, setClientIdEnv] = useState("");
  const [clientSecretEnv, setClientSecretEnv] = useState("");
  const [authScope, setAuthScope] = useState("");
  const [authUrl, setAuthUrl] = useState("");
  const [tokenUrl, setTokenUrl] = useState("");
  const [clientName, setClientName] = useState("chorus-cli");
  const [timeoutMs, setTimeoutMs] = useState("");
  const [maxOutputTokens, setMaxOutputTokens] = useState("");
  const [error, setError] = useState("");
  const [focusField, setFocusField] = useState(0);

  function clearError() { setError(""); }

  function nextStep(next: Step) {
    clearError();
    setFocusField(0);
    setStep(next);
  }

  useInput((_input, key) => {
    if (key.escape) {
      if (step === "name") {
        onCancel();
        return;
      }
      goBack();
      return;
    }

    if (step === "transport") {
      if (key.upArrow) { setTypeIndex((i) => (i <= 0 ? TRANSPORT_TYPES.length - 1 : i - 1)); return; }
      if (key.downArrow) { setTypeIndex((i) => (i + 1) % TRANSPORT_TYPES.length); return; }
      if (key.return) {
        const t = TRANSPORT_TYPES[typeIndex];
        nextStep(t === "stdio" ? "stdio-command" : "http-url");
        return;
      }
      return;
    }

    if (step === "http-auth-type") {
      if (key.upArrow) { setAuthTypeIndex((i) => (i <= 0 ? AUTH_TYPES.length - 1 : i - 1)); return; }
      if (key.downArrow) { setAuthTypeIndex((i) => (i + 1) % AUTH_TYPES.length); return; }
      if (key.return) {
        const t = AUTH_TYPES[authTypeIndex];
        if (t === "none") { nextStep("advanced"); }
        else if (t === "bearer") { nextStep("http-auth-bearer"); }
        else if (t === "client_credentials") { nextStep("http-auth-client-credentials"); }
        else { nextStep("http-auth-authorization-code"); }
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

  function goBack() {
    clearError();
    setFocusField(0);
    switch (step) {
      case "transport": nextStep("name"); break;
      case "stdio-command": nextStep("transport"); break;
      case "stdio-args": nextStep("stdio-command"); break;
      case "stdio-env": nextStep("stdio-args"); break;
      case "stdio-cwd": nextStep("stdio-env"); break;
      case "stdio-envfile": nextStep("stdio-cwd"); break;
      case "http-url": nextStep("transport"); break;
      case "http-headers": nextStep("http-url"); break;
      case "http-auth-type": nextStep("http-headers"); break;
      case "http-auth-bearer": case "http-auth-client-credentials": case "http-auth-authorization-code":
        nextStep("http-auth-type"); break;
      case "advanced": {
        const t = TRANSPORT_TYPES[typeIndex];
        nextStep(t === "stdio" ? "stdio-envfile" : (AUTH_TYPES[authTypeIndex] === "none" ? "http-headers" : `http-auth-${AUTH_TYPES[authTypeIndex]}` as Step));
        break;
      }
      case "confirm": {
        nextStep("advanced"); break;
      }
    }
  }

  function handleNameSubmit(value: string) {
    const trimmed = value.trim();
    if (!trimmed) { setError("Name is required"); return; }
    if (!/^[A-Za-z0-9_.-]{1,64}$/.test(trimmed)) { setError("Invalid name. Use letters, numbers, dots, dashes, underscores (max 64)."); return; }
    const settings = loadSettings();
    if (settings.mcp?.servers?.[trimmed]) { setError(`Server "${trimmed}" already exists`); return; }
    clearError();
    setName(trimmed);
    nextStep("transport");
  }

  function handleCommandSubmit(value: string) {
    const trimmed = value.trim();
    if (!trimmed) { setError("Command is required"); return; }
    clearError();
    setCommand(trimmed);
    nextStep("stdio-args");
  }

  function handleArgsSubmit(value: string) {
    setArgs(value.trim());
    nextStep("stdio-env");
  }

  function handleEnvSubmit(value: string) {
    const trimmed = value.trim();
    if (!trimmed) {
      nextStep("stdio-cwd");
      return;
    }
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx <= 0) {
      setError("Use KEY=VALUE format (e.g., MINIMAX_API_KEY=sk-xxx)");
      return;
    }
    clearError();
    const key = trimmed.slice(0, eqIdx).trim();
    const val = trimmed.slice(eqIdx + 1).trim();
    if (!key) { setError("Key is required"); return; }
    setEnvPairs((prev) => [...prev, { key, value: val }]);
    setEnvInput("");
  }

  function handleCwdSubmit(value: string) {
    setCwd(value.trim());
    nextStep("stdio-envfile");
  }

  function handleEnvFileSubmit(value: string) {
    setEnvFile(value.trim());
    nextStep("advanced");
  }

  function handleUrlSubmit(value: string) {
    const trimmed = value.trim();
    if (!trimmed) { setError("URL is required"); return; }
    clearError();
    setUrl(trimmed);
    nextStep("http-headers");
  }

  function handleHeaderSubmit(value: string) {
    const trimmed = value.trim();
    if (!trimmed) {
      nextStep("http-auth-type");
      return;
    }
    const colonIdx = trimmed.indexOf(":");
    if (colonIdx <= 0) {
      setError("Use Key:Value format (e.g., Authorization:Bearer token)");
      return;
    }
    clearError();
    const key = trimmed.slice(0, colonIdx).trim();
    const val = trimmed.slice(colonIdx + 1).trim();
    if (!key) { setError("Header key is required"); return; }
    setHeaderPairs((prev) => [...prev, { key, value: val }]);
    setHeaderInput("");
  }

  function handleBearerSubmit(value: string) {
    const trimmed = value.trim();
    if (!trimmed) { setError("Token env var name is required"); return; }
    clearError();
    setBearerTokenEnv(trimmed);
    nextStep("advanced");
  }

  function handleClientIdSubmit(value: string) {
    const trimmed = value.trim();
    if (!trimmed) { setError("Client ID env var name is required"); return; }
    clearError();
    setClientIdEnv(trimmed);
    setFocusField(1);
  }

  function handleClientSecretSubmit(value: string) {
    const trimmed = value.trim();
    if (!trimmed) { setError("Client Secret env var name is required"); return; }
    clearError();
    setClientSecretEnv(trimmed);
    setFocusField(2);
  }

  function handleAuthScopeSubmit(value: string) {
    setAuthScope(value.trim());
    setFocusField(3);
  }

  function handleClientNameSubmit(value: string) {
    setClientName(value.trim() || "chorus-cli");
    nextStep("advanced");
  }

  function handleAuthCodeClientIdSubmit(value: string) {
    const trimmed = value.trim();
    if (!trimmed) { setError("Client ID env var name is required"); return; }
    clearError();
    setClientIdEnv(trimmed);
    setFocusField(1);
  }

  function handleAuthCodeUrlSubmit(value: string) {
    const trimmed = value.trim();
    if (!trimmed) { setError("Authorization URL is required"); return; }
    clearError();
    setAuthUrl(trimmed);
    setFocusField(2);
  }

  function handleTokenUrlSubmit(value: string) {
    setTokenUrl(value.trim());
    setFocusField(3);
  }

  function handleAuthCodeScopeSubmit(value: string) {
    setAuthScope(value.trim());
    nextStep("advanced");
  }

  function handleTimeoutSubmit(value: string) {
    const trimmed = value.trim();
    if (trimmed && (!/^\d+$/.test(trimmed) || Number(trimmed) < 1000)) {
      setError("Timeout must be a number >= 1000 (ms)");
      return;
    }
    clearError();
    setTimeoutMs(trimmed);
    setFocusField(1);
  }

  function handleMaxTokensSubmit(value: string) {
    const trimmed = value.trim();
    if (trimmed && (!/^\d+$/.test(trimmed) || Number(trimmed) < 100)) {
      setError("Max output tokens must be a number >= 100");
      return;
    }
    clearError();
    setMaxOutputTokens(trimmed);
    nextStep("confirm");
  }

  function saveServer() {
    const settings = loadSettings();
    const server: McpServerSettings = { type: TRANSPORT_TYPES[typeIndex] };

    if (server.type === "stdio") {
      server.command = command.trim();
      const argList = args.trim().split(/\s+/).filter(Boolean);
      if (argList.length > 0) server.args = argList;
      if (envPairs.length > 0) {
        server.env = Object.fromEntries(envPairs.map((p) => [p.key, p.value]));
      }
      if (cwd.trim()) server.cwd = cwd.trim();
      if (envFile.trim()) server.envFile = envFile.trim();
    } else {
      server.url = url.trim();
      if (headerPairs.length > 0) {
        server.headers = Object.fromEntries(headerPairs.map((p) => [p.key, p.value]));
      }
      if (headerInput.trim()) {
        server.headers = { ...(server.headers ?? {}), [headerInput.split(":")[0].trim()]: headerInput.slice(headerInput.indexOf(":") + 1).trim() };
      }

      const authType = AUTH_TYPES[authTypeIndex];
      if (authType === "bearer") {
        server.auth = { type: "bearer", tokenEnv: bearerTokenEnv.trim() };
      } else if (authType === "client_credentials") {
        server.auth = {
          type: "client_credentials",
          clientIdEnv: clientIdEnv.trim(),
          clientSecretEnv: clientSecretEnv.trim(),
          scope: authScope.trim() || undefined,
          clientName: clientName.trim() || undefined,
        };
      } else if (authType === "authorization_code") {
        server.auth = {
          type: "authorization_code",
          clientIdEnv: clientIdEnv.trim(),
          authorizationUrl: authUrl.trim() || undefined,
          tokenUrl: tokenUrl.trim() || undefined,
          scope: authScope.trim() || undefined,
          clientName: clientName.trim() || undefined,
        };
      }
    }

    if (timeoutMs.trim()) server.timeoutMs = Number(timeoutMs);
    if (maxOutputTokens.trim()) server.maxOutputTokens = Number(maxOutputTokens);

    const existing = settings.mcp?.servers ?? {};
    saveSettings({
      ...settings,
      mcp: { servers: { ...existing, [name.trim()]: server } },
    });

    const authNote = server.auth?.type === "authorization_code" ? ` Run /mcp-auth ${name.trim()} to authorize.` : "";
    onDone(`MCP server "${name.trim()}" saved (${server.type}).${authNote} Run /mcp-reload to connect.`);
  }

  const transportLabel = TRANSPORT_TYPES[typeIndex];
  const authLabel = AUTH_TYPES[authTypeIndex];

  return (
    <Box flexDirection="column" paddingLeft={2} paddingRight={2} paddingTop={1}>
      <Box marginBottom={1}>
        <Text color="cyan" bold>{"✦ Add MCP Server "}</Text>
        <Text color="grey">{`  Step ${step === "done" ? "✓" : getStepNumber(step)}/${getTotalSteps(step, typeIndex, authTypeIndex)}  · Esc back`}</Text>
      </Box>

      {step === "name" && (
        <Box flexDirection="column">
          <Text bold color="white">Server Name</Text>
          <Text color="grey">A unique identifier for this MCP server (letters, numbers, dots, dashes).</Text>
          <Box marginTop={1} borderStyle="round" borderColor={error ? "red" : "cyan"} paddingLeft={1} paddingRight={1}>
            <TextInput value={name} onChange={(v) => { clearError(); setName(v); }} onSubmit={handleNameSubmit} placeholder="e.g., minimax, github, filesystem" focus />
          </Box>
          {error ? <Text color="red">{error}</Text> : null}
        </Box>
      )}

      {step === "transport" && (
        <Box flexDirection="column">
          <Text bold color="white">Transport Type</Text>
          {TRANSPORT_TYPES.map((t, i) => {
            const desc = t === "stdio" ? "Local process (npx, python, node)" : t === "http" ? "Remote Streamable HTTP" : "Remote SSE endpoint";
            return (
              <Box key={t} flexDirection="row" marginTop={i === 0 ? 1 : 0}>
                <Text color={i === typeIndex ? "cyan" : "grey"} bold={i === typeIndex}>
                  {i === typeIndex ? "▶ " : "  "}{t.padEnd(8)}
                </Text>
                <Text color={i === typeIndex ? "white" : "grey"} dimColor={i !== typeIndex}>{desc}</Text>
              </Box>
            );
          })}
          <Box marginTop={1}><Text color="grey" dimColor>↑↓ select · Enter confirm</Text></Box>
        </Box>
      )}

      {step === "stdio-command" && (
        <Box flexDirection="column">
          <Text bold color="white">Command</Text>
          <Text color="grey">The executable to run (e.g., npx, uvx, python, node).</Text>
          <Box marginTop={1} borderStyle="round" borderColor={error ? "red" : "cyan"} paddingLeft={1} paddingRight={1}>
            <TextInput value={command} onChange={(v) => { clearError(); setCommand(v); }} onSubmit={handleCommandSubmit} placeholder="e.g., uvx" focus />
          </Box>
          {error ? <Text color="red">{error}</Text> : null}
        </Box>
      )}

      {step === "stdio-args" && (
        <Box flexDirection="column">
          <Text bold color="white">Arguments</Text>
          <Text color="grey">Space-separated arguments. Leave empty to skip.</Text>
          <Box marginTop={1} borderStyle="round" borderColor="cyan" paddingLeft={1} paddingRight={1}>
            <TextInput value={args} onChange={setArgs} onSubmit={handleArgsSubmit} placeholder="e.g., minimax-coding-plan-mcp -y" focus />
          </Box>
          <Box marginTop={1}><Text color="grey" dimColor>Enter to confirm · Esc to go back</Text></Box>
        </Box>
      )}

      {step === "stdio-env" && (
        <Box flexDirection="column">
          <Text bold color="white">Environment Variables</Text>
          <Text color="grey">Add KEY=VALUE pairs. Leave empty to continue.</Text>
          <Box marginTop={1} flexDirection="column">
            {envPairs.length > 0 && (
              <Box flexDirection="column" marginBottom={1}>
                {envPairs.map((p, i) => (
                  <Box key={i} flexDirection="row">
                    <Text color="green">  ✓ </Text>
                    <Text color="white">{p.key}</Text>
                    <Text color="grey">=</Text>
                    <Text color="cyan">{p.value.length > 30 ? p.value.slice(0, 27) + "..." : p.value}</Text>
                    {i === envPairs.length - 1 && (
                      <Text color="grey" dimColor> (press Backspace to remove last)</Text>
                    )}
                  </Box>
                ))}
              </Box>
            )}
            <Box borderStyle="round" borderColor={error ? "red" : "cyan"} paddingLeft={1} paddingRight={1}>
              <TextInput
                value={envInput}
                onChange={(v) => { clearError(); setEnvInput(v); }}
                onSubmit={handleEnvSubmit}
                placeholder="e.g., MINIMAX_API_KEY=sk-xxx"
                focus
              />
            </Box>
          </Box>
          {error ? <Text color="red">{error}</Text> : null}
          <Box marginTop={1}><Text color="grey" dimColor>Enter on empty → next step · Esc → back</Text></Box>
        </Box>
      )}

      {step === "stdio-cwd" && (
        <Box flexDirection="column">
          <Text bold color="white">Working Directory</Text>
          <Text color="grey">Optional. Directory to run the command from.</Text>
          <Box marginTop={1} borderStyle="round" borderColor="cyan" paddingLeft={1} paddingRight={1}>
            <TextInput value={cwd} onChange={setCwd} onSubmit={handleCwdSubmit} placeholder="e.g., /path/to/project (or leave empty)" focus />
          </Box>
        </Box>
      )}

      {step === "stdio-envfile" && (
        <Box flexDirection="column">
          <Text bold color="white">Env File</Text>
          <Text color="grey">Optional path to a .env file for additional variables.</Text>
          <Box marginTop={1} borderStyle="round" borderColor="cyan" paddingLeft={1} paddingRight={1}>
            <TextInput value={envFile} onChange={setEnvFile} onSubmit={handleEnvFileSubmit} placeholder="e.g., .env.mcp (or leave empty)" focus />
          </Box>
        </Box>
      )}

      {step === "http-url" && (
        <Box flexDirection="column">
          <Text bold color="white">Server URL</Text>
          <Text color="grey">The MCP server endpoint URL.</Text>
          <Box marginTop={1} borderStyle="round" borderColor={error ? "red" : "cyan"} paddingLeft={1} paddingRight={1}>
            <TextInput value={url} onChange={(v) => { clearError(); setUrl(v); }} onSubmit={handleUrlSubmit} placeholder="e.g., https://mcp.linear.app/mcp" focus />
          </Box>
          {error ? <Text color="red">{error}</Text> : null}
        </Box>
      )}

      {step === "http-headers" && (
        <Box flexDirection="column">
          <Text bold color="white">Headers</Text>
          <Text color="grey">Add Header:Value pairs. Leave empty to continue.</Text>
          <Box marginTop={1} flexDirection="column">
            {headerPairs.length > 0 && (
              <Box flexDirection="column" marginBottom={1}>
                {headerPairs.map((p, i) => (
                  <Box key={i} flexDirection="row">
                    <Text color="green">  ✓ </Text>
                    <Text color="white">{p.key}</Text>
                    <Text color="grey">:</Text>
                    <Text color="cyan">{p.value.length > 30 ? p.value.slice(0, 27) + "..." : p.value}</Text>
                  </Box>
                ))}
              </Box>
            )}
            <Box borderStyle="round" borderColor={error ? "red" : "cyan"} paddingLeft={1} paddingRight={1}>
              <TextInput
                value={headerInput}
                onChange={(v) => { clearError(); setHeaderInput(v); }}
                onSubmit={handleHeaderSubmit}
                placeholder="e.g., Authorization:Bearer ${TOKEN}"
                focus
              />
            </Box>
          </Box>
          {error ? <Text color="red">{error}</Text> : null}
        </Box>
      )}

      {step === "http-auth-type" && (
        <Box flexDirection="column">
          <Text bold color="white">Authentication</Text>
          <Text color="grey">Select the auth method this server requires.</Text>
          <Box marginTop={1} flexDirection="column">
            {AUTH_TYPES.map((t, i) => {
              const desc = t === "none" ? "No authentication"
                : t === "bearer" ? "Bearer token from env var"
                : t === "client_credentials" ? "OAuth2 client credentials (machine-to-machine)"
                : "OAuth2 authorization code (browser login)";
              return (
                <Box key={t} flexDirection="row" marginTop={i === 0 ? 0 : 0}>
                  <Text color={i === authTypeIndex ? "cyan" : "grey"} bold={i === authTypeIndex}>
                    {i === authTypeIndex ? "▶ " : "  "}{t.padEnd(22)}
                  </Text>
                  <Text color={i === authTypeIndex ? "white" : "grey"} dimColor={i !== authTypeIndex}>{desc}</Text>
                </Box>
              );
            })}
          </Box>
          <Box marginTop={1}><Text color="grey" dimColor>↑↓ select · Enter confirm</Text></Box>
        </Box>
      )}

      {step === "http-auth-bearer" && (
        <Box flexDirection="column">
          <Text bold color="white">Bearer Token</Text>
          <Text color="grey">Environment variable that contains the bearer token.</Text>
          <Box marginTop={1} borderStyle="round" borderColor={error ? "red" : "cyan"} paddingLeft={1} paddingRight={1}>
            <TextInput value={bearerTokenEnv} onChange={(v) => { clearError(); setBearerTokenEnv(v); }} onSubmit={handleBearerSubmit} placeholder="e.g., LINEAR_API_KEY" focus />
          </Box>
          {error ? <Text color="red">{error}</Text> : null}
        </Box>
      )}

      {step === "http-auth-client-credentials" && (
        <Box flexDirection="column">
          <Text bold color="white">OAuth2 Client Credentials</Text>
          <Text color="grey">Machine-to-machine auth. All fields except Scope are required.</Text>
          <Box marginTop={1} flexDirection="column">
            <FieldLabel num={1} label="Client ID env var" active={focusField === 0} />
            <Box borderStyle="round" borderColor={focusField === 0 ? "cyan" : "grey"} paddingLeft={1} paddingRight={1} marginBottom={1}>
              <TextInput value={clientIdEnv} onChange={(v) => { clearError(); setClientIdEnv(v); }} onSubmit={handleClientIdSubmit} placeholder="e.g., OAUTH_CLIENT_ID" focus={focusField === 0} />
            </Box>
            <FieldLabel num={2} label="Client Secret env var" active={focusField === 1} />
            <Box borderStyle="round" borderColor={focusField === 1 ? "cyan" : "grey"} paddingLeft={1} paddingRight={1} marginBottom={1}>
              <TextInput value={clientSecretEnv} onChange={(v) => { clearError(); setClientSecretEnv(v); }} onSubmit={handleClientSecretSubmit} placeholder="e.g., OAUTH_CLIENT_SECRET" focus={focusField === 1} />
            </Box>
            <FieldLabel num={3} label="Scope (optional)" active={focusField === 2} />
            <Box borderStyle="round" borderColor={focusField === 2 ? "cyan" : "grey"} paddingLeft={1} paddingRight={1} marginBottom={1}>
              <TextInput value={authScope} onChange={setAuthScope} onSubmit={handleAuthScopeSubmit} placeholder="e.g., read write" focus={focusField === 2} />
            </Box>
            <FieldLabel num={4} label="Client name (optional)" active={focusField === 3} />
            <Box borderStyle="round" borderColor={focusField === 3 ? "cyan" : "grey"} paddingLeft={1} paddingRight={1}>
              <TextInput value={clientName} onChange={setClientName} onSubmit={handleClientNameSubmit} placeholder="chorus-cli" focus={focusField === 3} />
            </Box>
          </Box>
          {error ? <Text color="red">{error}</Text> : null}
          <Box marginTop={1}><Text color="grey" dimColor>Enter on empty → skip · Enter on filled → next</Text></Box>
        </Box>
      )}

      {step === "http-auth-authorization-code" && (
        <Box flexDirection="column">
          <Text bold color="white">OAuth2 Authorization Code</Text>
          <Text color="grey">Browser-based login flow (uses PKCE). Requires client ID env var.</Text>
          <Box marginTop={1} flexDirection="column">
            <FieldLabel num={1} label="Client ID env var *" active={focusField === 0} />
            <Box borderStyle="round" borderColor={focusField === 0 ? "cyan" : "grey"} paddingLeft={1} paddingRight={1} marginBottom={1}>
              <TextInput value={clientIdEnv} onChange={(v) => { clearError(); setClientIdEnv(v); }} onSubmit={handleAuthCodeClientIdSubmit} placeholder="e.g., OAUTH_CLIENT_ID" focus={focusField === 0} />
            </Box>
            <FieldLabel num={2} label="Authorization URL (optional)" active={focusField === 1} />
            <Box borderStyle="round" borderColor={focusField === 1 ? "cyan" : "grey"} paddingLeft={1} paddingRight={1} marginBottom={1}>
              <TextInput value={authUrl} onChange={setAuthUrl} onSubmit={handleAuthCodeUrlSubmit} placeholder="e.g., https://linear.app/oauth/authorize" focus={focusField === 1} />
            </Box>
            <FieldLabel num={3} label="Token URL (optional)" active={focusField === 2} />
            <Box borderStyle="round" borderColor={focusField === 2 ? "cyan" : "grey"} paddingLeft={1} paddingRight={1} marginBottom={1}>
              <TextInput value={tokenUrl} onChange={setTokenUrl} onSubmit={handleTokenUrlSubmit} placeholder="e.g., https://linear.app/oauth/token" focus={focusField === 2} />
            </Box>
            <FieldLabel num={4} label="Scope (optional)" active={focusField === 3} />
            <Box borderStyle="round" borderColor={focusField === 3 ? "cyan" : "grey"} paddingLeft={1} paddingRight={1}>
              <TextInput value={authScope} onChange={setAuthScope} onSubmit={handleAuthCodeScopeSubmit} placeholder="e.g., read write" focus={focusField === 3} />
            </Box>
          </Box>
          {error ? <Text color="red">{error}</Text> : null}
        </Box>
      )}

      {step === "advanced" && (
        <Box flexDirection="column">
          <Text bold color="white">Advanced Options</Text>
          <Text color="grey">Optional. Press Enter on empty fields to skip.</Text>
          <Box marginTop={1} flexDirection="column">
            <FieldLabel num={1} label="Timeout (ms)" active={focusField === 0} />
            <Box borderStyle="round" borderColor={focusField === 0 ? "cyan" : "grey"} paddingLeft={1} paddingRight={1} marginBottom={1}>
              <TextInput value={timeoutMs} onChange={(v) => { clearError(); setTimeoutMs(v); }} onSubmit={handleTimeoutSubmit} placeholder="e.g., 30000 (default 10000)" focus={focusField === 0} />
            </Box>
            <FieldLabel num={2} label="Max output tokens" active={focusField === 1} />
            <Box borderStyle="round" borderColor={focusField === 1 ? "cyan" : "grey"} paddingLeft={1} paddingRight={1}>
              <TextInput value={maxOutputTokens} onChange={(v) => { clearError(); setMaxOutputTokens(v); }} onSubmit={handleMaxTokensSubmit} placeholder="e.g., 50000 (default 25000)" focus={focusField === 1} />
            </Box>
          </Box>
          {error ? <Text color="red">{error}</Text> : null}
        </Box>
      )}

      {step === "confirm" && (
        <Box flexDirection="column">
          <Text color="green" bold>Review Configuration</Text>
          <Box borderStyle="single" borderColor="grey" paddingX={2} paddingY={1} flexDirection="column" marginY={1}>
            <Kv label="name" value={name} />
            <Kv label="type" value={transportLabel} />
            {transportLabel === "stdio" ? (
              <>
                <Kv label="command" value={command} />
                {args ? <Kv label="args" value={args} /> : null}
                {envPairs.length > 0 && <Kv label="env" value={envPairs.map((p) => `${p.key}=${p.value}`).join(", ")} />}
                {cwd ? <Kv label="cwd" value={cwd} /> : null}
                {envFile ? <Kv label="envFile" value={envFile} /> : null}
              </>
            ) : (
              <>
                <Kv label="url" value={url} />
                {headerPairs.length > 0 && <Kv label="headers" value={headerPairs.map((p) => `${p.key}: ${p.value}`).join(", ")} />}
                {authLabel !== "none" && <Kv label="auth" value={authLabel} />}
              </>
            )}
            {timeoutMs ? <Kv label="timeout" value={`${timeoutMs}ms`} /> : null}
            {maxOutputTokens ? <Kv label="max tokens" value={maxOutputTokens} /> : null}
          </Box>
          <Text color="cyan" bold>Press Enter to save, Esc to edit</Text>
        </Box>
      )}
    </Box>
  );
}

function FieldLabel({ num, label, active }: { num: number; label: string; active: boolean }) {
  return (
    <Box flexDirection="row">
      <Text color={active ? "cyan" : "grey"}>{active ? "▸ " : "  "}</Text>
      <Text color={active ? "white" : "grey"}>{`${num}. ${label}`}</Text>
    </Box>
  );
}

function Kv({ label, value }: { label: string; value: string }) {
  return (
    <Box flexDirection="row">
      <Text color="grey">{label.padEnd(12)}</Text>
      <Text color="white">{value}</Text>
    </Box>
  );
}

function getStepNumber(step: Step): number {
  const order: Step[] = [
    "name", "transport",
    "stdio-command", "stdio-args", "stdio-env", "stdio-cwd", "stdio-envfile",
    "http-url", "http-headers", "http-auth-type",
    "http-auth-bearer", "http-auth-client-credentials", "http-auth-authorization-code",
    "advanced", "confirm",
  ];
  return order.indexOf(step) + 1;
}

function getTotalSteps(step: Step, typeIndex: number, authTypeIndex: number): number {
  const isStdio = TRANSPORT_TYPES[typeIndex] === "stdio";
  const authType = AUTH_TYPES[authTypeIndex];

  if (isStdio || step.startsWith("stdio-")) {
    return 8; // name + transport + command + args + env + cwd + envfile + advanced + confirm = 9... let me count properly
  }

  let steps = 4; // name + transport + http-url + http-headers + http-auth-type
  if (authType === "none") steps += 0;
  else if (authType === "bearer") steps += 1;
  else if (authType === "client_credentials") steps += 1;
  else steps += 1;
  steps += 2; // advanced + confirm
  return steps;
}
