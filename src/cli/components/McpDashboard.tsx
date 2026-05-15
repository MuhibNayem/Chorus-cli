import { useState, useEffect } from "react";
import { Box, Text, useInput } from "ink";
import { loadMcpServers, getProjectMcpTrust, trustProjectMcpConfig, untrustProjectMcpConfig } from "../../mcp/config.js";
import { getMcpStatus, reloadMcpConnections, type McpServerStatus } from "../../mcp/client.js";
import { loadSettings, saveSettings } from "../../settings/storage.js";

interface McpDashboardProps {
  onDone: (msg: string) => void;
  onCancel: () => void;
  onAuth: (serverName: string) => void;
}

type Panel = "list" | "detail";

export function McpDashboard({ onDone, onCancel, onAuth }: McpDashboardProps) {
  const [panel, setPanel] = useState<Panel>("list");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [statuses, setStatuses] = useState<McpServerStatus[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");

  useEffect(() => {
    refreshStatus();
  }, []);

  function refreshStatus() {
    setLoading(true);
    getMcpStatus()
      .then((s) => { setStatuses(s); setLoading(false); })
      .catch((e) => { setMessage(`Error: ${e instanceof Error ? e.message : String(e)}`); setLoading(false); });
  }

  const selected = statuses[selectedIndex];

  useInput((_input, key) => {
    if (key.escape) {
      if (panel === "detail") { setPanel("list"); return; }
      onCancel();
      return;
    }

    if (panel === "list") {
      if (key.upArrow) { setSelectedIndex((i) => (i > 0 ? i - 1 : statuses.length - 1)); return; }
      if (key.downArrow) { setSelectedIndex((i) => (i + 1) % Math.max(statuses.length, 1)); return; }
      if (key.return && selected) { setPanel("detail"); return; }
      if (_input === "r") { refreshStatus(); }
      if (_input === "t") {
        const trust = getProjectMcpTrust();
        if (trust.exists && !trust.trusted) trustProjectMcpConfig();
        refreshStatus();
      }
      return;
    }

    if (panel === "detail") {
      if (_input === "a" && selected && selected.needsAuth) { onAuth(selected.name); onDone("OAuth flow started."); return; }
      if (_input === "c") { refreshStatus(); setPanel("list"); return; }
      if (_input === "d") {
        if (!selected) return;
        const settings = loadSettings();
        const servers = { ...(settings.mcp?.servers ?? {}) };
        if (selected.source === "user") {
          delete servers[selected.name];
          saveSettings({ ...settings, mcp: { servers } });
          setMessage(`Removed "${selected.name}".`);
          refreshStatus();
          setPanel("list");
        } else {
          setMessage("Cannot remove project servers from here. Edit .mcp.json directly.");
        }
        return;
      }
      if (_input === "e") {
        if (!selected) return;
        const settings = loadSettings();
        const servers = settings.mcp?.servers ?? {};
        const existing = servers[selected.name];
        if (existing && selected.source === "user") {
          saveSettings({
            ...settings,
            mcp: { servers: { ...servers, [selected.name]: { ...existing, enabled: !(existing.enabled !== false) } } },
          });
          setMessage(`"${selected.name}" ${existing.enabled !== false ? "disabled" : "enabled"}.`);
          refreshStatus();
        } else if (selected.source === "project") {
          setMessage("Cannot toggle project servers. Edit .mcp.json directly.");
        }
        return;
      }
    }
  });

  const trust = getProjectMcpTrust();
  const statusIcon = (s: McpServerStatus) => {
    if (s.state === "connected") return "●";
    if (s.state === "connecting" || s.state === "reconnecting") return "◐";
    if (s.needsAuth) return "○";
    return "○";
  };

  const statusColor = (s: McpServerStatus) => {
    if (s.state === "connected") return "green";
    if (s.state === "connecting" || s.state === "reconnecting") return "yellow";
    if (s.needsAuth) return "yellow";
    return "red";
  };

  if (panel === "detail" && selected) {
    return (
      <Box flexDirection="column" paddingLeft={2} paddingRight={2} paddingTop={1}>
        <Box marginBottom={1}>
          <Text color="cyan" bold>{`${selected.name} `}</Text>
          <Text color="grey">· Esc back</Text>
        </Box>

        <Box borderStyle="single" borderColor="grey" paddingX={2} paddingY={1} flexDirection="column" marginY={1}>
          <DetailRow label="Status" value={selected.state} color={statusColor(selected)} />
          <DetailRow label="Source" value={selected.source} />
          <DetailRow label="Endpoint" value={selected.command} />
          <DetailRow label="Auth" value={selected.authType} />
          {selected.connected && (
            <>
              <DetailRow label="Tools" value={String(selected.toolCount)} />
              <DetailRow label="Resources" value={String(selected.resourceCount)} />
            </>
          )}
          {selected.error && <DetailRow label="Error" value={selected.error} color="red" />}
          {selected.needsAuth && <DetailRow label="" value="" color="yellow" />}
        </Box>

        <Box flexDirection="column" marginTop={1}>
          <Text bold color="white">Actions</Text>
          {selected.needsAuth && (
            <Box flexDirection="row"><Text color="cyan">  a  </Text><Text>Start OAuth authorization flow</Text></Box>
          )}
          <Box flexDirection="row"><Text color="cyan">  c  </Text><Text>Connect / Refresh status</Text></Box>
          {selected.source === "user" && (
            <>
              <Box flexDirection="row"><Text color="cyan">  e  </Text><Text>Toggle enable/disable</Text></Box>
              <Box flexDirection="row"><Text color="red">  d  </Text><Text>Delete server</Text></Box>
            </>
          )}
        </Box>

        {message ? <Box marginTop={1}><Text color="yellow">{message}</Text></Box> : null}
      </Box>
    );
  }

  return (
    <Box flexDirection="column" paddingLeft={2} paddingRight={2} paddingTop={1}>
      <Box marginBottom={1} flexDirection="row" justifyContent="space-between">
        <Box flexDirection="row">
          <Text color="cyan" bold>{"◈ MCP Servers "}</Text>
          <Text color="grey">{`${statuses.length} configured`}</Text>
        </Box>
        <Box flexDirection="row">
          <Text color="grey" dimColor>r:refresh  t:trust  ↑↓:nav  enter:detail  esc:back</Text>
        </Box>
      </Box>

      {trust.exists && !trust.trusted && (
        <Box marginBottom={1} borderStyle="single" borderColor="yellow" paddingX={1} paddingY={0}>
          <Text color="yellow">⚠ Project .mcp.json is not trusted ({trust.filePath}). Press </Text>
          <Text color="cyan" bold>t</Text>
          <Text color="yellow"> to trust.</Text>
        </Box>
      )}

      {loading ? (
        <Box><Text color="grey">Loading...</Text></Box>
      ) : statuses.length === 0 ? (
        <Box flexDirection="column" marginTop={1}>
          <Text color="grey">No MCP servers configured.</Text>
          <Box marginTop={1}>
            <Text>Add servers via </Text>
            <Text color="cyan">/mcp-add</Text>
            <Text> or create </Text>
            <Text color="cyan">.mcp.json</Text>
            <Text> in your project.</Text>
          </Box>
        </Box>
      ) : (
        <Box flexDirection="column">
          <Box flexDirection="row" marginBottom={1}>
            <Text color="grey" dimColor>  {"Status".padEnd(8)}</Text>
            <Text color="grey" dimColor>{"Name".padEnd(20)}</Text>
            <Text color="grey" dimColor>{"Auth".padEnd(18)}</Text>
            <Text color="grey" dimColor>{"Source".padEnd(8)}</Text>
            <Text color="grey" dimColor>Details</Text>
          </Box>
          {statuses.map((s, i) => {
            const authTag = s.needsAuth ? "needs auth"
              : s.authType !== "none" ? s.authType
              : "none";
            const detail = s.connected ? `${s.toolCount} tools` : s.error ?? "—";
            return (
              <Box key={s.name} flexDirection="row">
                <Text color={i === selectedIndex ? "cyan" : undefined} bold={i === selectedIndex}>
                  {i === selectedIndex ? "▶" : " "}
                  <Text color={statusColor(s)}>{` ${statusIcon(s)} `}</Text>
                  <Text color={i === selectedIndex ? "cyan" : s.state === "connected" ? "green" : "white"}>
                    {s.state.padEnd(6)}
                  </Text>
                  <Text color={i === selectedIndex ? "cyan" : "white"} bold={i === selectedIndex}>
                    {s.name.padEnd(20)}
                  </Text>
                  <Text color={i === selectedIndex ? "cyan" : s.needsAuth ? "yellow" : "grey"}>
                    {authTag.padEnd(18)}
                  </Text>
                  <Text color={i === selectedIndex ? "cyan" : "grey"}>
                    {s.source.padEnd(8)}
                  </Text>
                  <Text color={i === selectedIndex ? "cyan" : "grey"} dimColor={i !== selectedIndex}>
                    {detail}
                  </Text>
                </Text>
              </Box>
            );
          })}
        </Box>
      )}

      {message ? <Box marginTop={1}><Text color="yellow">{message}</Text></Box> : null}
    </Box>
  );
}

function DetailRow({ label, value, color = "white" }: { label: string; value: string; color?: string }) {
  return (
    <Box flexDirection="row">
      <Text color="grey">{label.padEnd(12)}</Text>
      <Text color={color}>{value}</Text>
    </Box>
  );
}
