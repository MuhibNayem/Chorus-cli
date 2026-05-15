import { useState, useEffect } from "react";
import { Box, Text, useInput } from "ink";
import { loadAgents } from "../../agents/loader.js";
import { deleteAgent } from "../../agents/storage.js";
import type { AgentDef } from "../../agents/types.js";

interface AgentDashboardProps {
  onDone: (msg: string) => void;
  onCancel: () => void;
  onCreateNew: (mode: "ai" | "manual") => void;
  onEdit: (agent: AgentDef) => void;
  onView: (agent: AgentDef) => void;
  onUse: (agent: AgentDef) => void;
}

type Panel = "list" | "detail" | "confirm-delete";

export function AgentDashboard({ onDone, onCancel, onCreateNew, onEdit, onView, onUse }: AgentDashboardProps) {
  const [panel, setPanel] = useState<Panel>("list");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [agents, setAgents] = useState<AgentDef[]>([]);
  const [message, setMessage] = useState("");

  useEffect(() => {
    refresh();
  }, []);

  function refresh() {
    setAgents(loadAgents());
  }

  const selected = agents[selectedIndex];

  useInput((_input, key) => {
    if (key.escape) {
      if (panel === "detail" || panel === "confirm-delete") {
        setPanel("list");
        return;
      }
      onCancel();
      return;
    }

    if (panel === "confirm-delete") {
      if (_input === "y" && selected) {
        try {
          deleteAgent(selected.filePath);
          setMessage(`Deleted "${selected.name}".`);
          refresh();
          setPanel("list");
        } catch (e) {
          setMessage(`Error: ${e instanceof Error ? e.message : String(e)}`);
        }
        return;
      }
      if (_input === "n") { setPanel("detail"); return; }
      return;
    }

    if (panel === "list") {
      if (key.upArrow) {
        setSelectedIndex((i) => (i > 0 ? i - 1 : Math.max(agents.length - 1, 0)));
        return;
      }
      if (key.downArrow) {
        setSelectedIndex((i) => (i + 1) % Math.max(agents.length, 1));
        return;
      }
      if (_input === "n") { onCreateNew("manual"); onDone("Agent creator opened."); return; }
      if (_input === "g") { onCreateNew("ai"); onDone("AI agent generator opened."); return; }
      if (key.return && selected) { setPanel("detail"); return; }
      return;
    }

    if (panel === "detail" && selected) {
      if (_input === "e") { onEdit(selected); onDone("Editing agent."); return; }
      if (_input === "v") { onView(selected); return; }
      if (_input === "u") { onUse(selected); onDone(`Use @${selected.name} to invoke.`); return; }
      if (_input === "d") { setPanel("confirm-delete"); return; }
      return;
    }
  });

  if (panel === "confirm-delete" && selected) {
    return (
      <Box flexDirection="column" paddingLeft={2} paddingRight={2} paddingTop={1}>
        <Box marginBottom={1}>
          <Text color="red" bold>Delete "{selected.name}"?</Text>
        </Box>
        <Text>This cannot be undone. The file will be removed from disk.</Text>
        <Box marginTop={1} flexDirection="row">
          <Text color="cyan" bold>y </Text><Text>Delete  </Text>
          <Text color="grey" bold>n </Text><Text>Cancel</Text>
        </Box>
      </Box>
    );
  }

  if (panel === "detail" && selected) {
    return (
      <Box flexDirection="column" paddingLeft={2} paddingRight={2} paddingTop={1}>
        <Box marginBottom={1}>
          <Text color="cyan" bold>{selected.name} </Text>
          <Text color="grey">· Esc back</Text>
        </Box>
        <Box borderStyle="single" borderColor="grey" paddingX={2} paddingY={1} flexDirection="column" marginY={1}>
          <Detail label="Source" value={selected.source} />
          <Detail label="Model" value={selected.model || "default"} />
          <Detail label="Perms" value={selected.permissionMode || "full_auto"} />
          <Detail label="Rounds" value={String(selected.maxRounds ?? 30)} />
          <Detail label="Tools" value={selected.tools?.length ? selected.tools.join(", ") : "default (filesystem + git)"} />
          <Detail label="Path" value={selected.filePath} />
          <Box marginTop={1} flexDirection="column">
            <Text color="grey">Description:</Text>
            <Text>{selected.description || "(none)"}</Text>
          </Box>
          <Box marginTop={1} flexDirection="column">
            <Text color="grey">System prompt (preview):</Text>
            <Text dimColor>{selected.systemPrompt.slice(0, 200)}{selected.systemPrompt.length > 200 ? "..." : ""}</Text>
          </Box>
        </Box>
        <Box flexDirection="column" marginTop={1}>
          <Text bold color="white">Actions</Text>
          <Box flexDirection="row"><Text color="cyan">  e  </Text><Text>Edit</Text></Box>
          <Box flexDirection="row"><Text color="cyan">  v  </Text><Text>View full details</Text></Box>
          <Box flexDirection="row"><Text color="cyan">  u  </Text><Text>Show invocation (@{selected.name})</Text></Box>
          <Box flexDirection="row"><Text color="red">  d  </Text><Text>Delete</Text></Box>
        </Box>
        {message ? <Box marginTop={1}><Text color="yellow">{message}</Text></Box> : null}
      </Box>
    );
  }

  return (
    <Box flexDirection="column" paddingLeft={2} paddingRight={2} paddingTop={1}>
      <Box marginBottom={1} flexDirection="row" justifyContent="space-between">
        <Box flexDirection="row">
          <Text color="cyan" bold>{"◈ Agents "}</Text>
          <Text color="grey">{`${agents.length} defined`}</Text>
        </Box>
        <Box flexDirection="row">
          <Text color="grey" dimColor>n:new  g:generate  ↑↓:nav  enter:detail  esc:back</Text>
        </Box>
      </Box>

      {agents.length === 0 ? (
        <Box flexDirection="column" marginTop={1}>
          <Text color="grey">No custom agents defined yet.</Text>
          <Box marginTop={1} flexDirection="column">
            <Text>Press </Text>
            <Box flexDirection="row"><Text color="cyan" bold>  n  </Text><Text>Create a new agent manually</Text></Box>
            <Box flexDirection="row"><Text color="cyan" bold>  g  </Text><Text>Generate an agent with AI (describe what you want)</Text></Box>
          </Box>
        </Box>
      ) : (
        <Box flexDirection="column">
          <Box flexDirection="row" marginBottom={1}>
            <Text color="grey" dimColor>{"  Name".padEnd(22)}</Text>
            <Text color="grey" dimColor>{"Model".padEnd(16)}</Text>
            <Text color="grey" dimColor>{"Source".padEnd(8)}</Text>
            <Text color="grey" dimColor>Description</Text>
          </Box>
          {agents.map((a, i) => (
            <Box key={a.name} flexDirection="row">
              <Text color={i === selectedIndex ? "cyan" : undefined}>
                {i === selectedIndex ? "▶" : " "}
                <Text color={i === selectedIndex ? "cyan" : a.source === "project" ? "green" : "white"} bold={i === selectedIndex}>
                  {` ${a.name.padEnd(20)}`}
                </Text>
                <Text color={i === selectedIndex ? "cyan" : "grey"}>
                  {(a.model || "default").padEnd(16)}
                </Text>
                <Text color={i === selectedIndex ? "cyan" : a.source === "project" ? "green" : "grey"}>
                  {a.source.padEnd(8)}
                </Text>
                <Text color={i === selectedIndex ? "cyan" : "grey"} dimColor={i !== selectedIndex}>
                  {a.description.slice(0, 50)}
                </Text>
              </Text>
            </Box>
          ))}
        </Box>
      )}

      <Box marginTop={1} flexDirection="row">
        <Text color="grey" dimColor>n:new  g:AI generate   esc:back</Text>
      </Box>
      {message ? <Box marginTop={1}><Text color="yellow">{message}</Text></Box> : null}
    </Box>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <Box flexDirection="row">
      <Text color="grey">{label.padEnd(12)}</Text>
      <Text>{value}</Text>
    </Box>
  );
}
