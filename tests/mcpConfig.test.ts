import { describe, expect, it, afterEach } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { getProjectMcpTrust, loadMcpServers, trustProjectMcpConfig } from "../src/mcp/config.js";
import { clearSettingsCache } from "../src/settings/storage.js";

function tmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "chorus-mcp-"));
}

function cleanup(dir: string): void {
  fs.rmSync(dir, { recursive: true, force: true });
}

describe("MCP config loading", () => {
  const oldHome = process.env.CHORUS_HOME_DIR;
  const oldToken = process.env.TEST_MCP_TOKEN;

  afterEach(() => {
    if (oldHome === undefined) delete process.env.CHORUS_HOME_DIR;
    else process.env.CHORUS_HOME_DIR = oldHome;
    if (oldToken === undefined) delete process.env.TEST_MCP_TOKEN;
    else process.env.TEST_MCP_TOKEN = oldToken;
    clearSettingsCache();
  });

  it("loads user and project MCP servers with project overriding by name", () => {
    const home = tmpDir();
    const project = tmpDir();
    process.env.CHORUS_HOME_DIR = home;
    clearSettingsCache();

    fs.mkdirSync(path.join(home, ".chorus"), { recursive: true });
    fs.writeFileSync(path.join(home, ".chorus", "settings.json"), JSON.stringify({
      mcp: {
        servers: {
          docs: { type: "stdio", command: "user-docs" },
          userOnly: { type: "stdio", command: "node", args: ["server.js"] },
        },
      },
    }), "utf-8");
    fs.writeFileSync(path.join(project, ".mcp.json"), JSON.stringify({
      mcpServers: {
        docs: { type: "stdio", command: "project-docs" },
      },
    }), "utf-8");
    trustProjectMcpConfig(project);

    const servers = loadMcpServers(project);

    expect(servers.map((s) => [s.name, s.command, s.source])).toEqual([
      ["docs", "project-docs", "project"],
      ["userOnly", "node", "user"],
    ]);

    cleanup(home);
    cleanup(project);
  });

  it("expands environment variables in remote auth headers", () => {
    const home = tmpDir();
    const project = tmpDir();
    process.env.CHORUS_HOME_DIR = home;
    process.env.TEST_MCP_TOKEN = "secret-token";
    clearSettingsCache();

    fs.writeFileSync(path.join(project, ".mcp.json"), JSON.stringify({
      mcpServers: {
        sentry: {
          type: "http",
          url: "https://mcp.example.test/mcp",
          headers: {
            Authorization: "Bearer ${TEST_MCP_TOKEN}",
            "X-Team": "${MISSING_TEAM:-platform}",
          },
        },
      },
    }), "utf-8");
    trustProjectMcpConfig(project);

    const [server] = loadMcpServers(project);

    expect(server.type).toBe("http");
    expect(server.url).toBe("https://mcp.example.test/mcp");
    expect(server.headers).toEqual({
      Authorization: "Bearer secret-token",
      "X-Team": "platform",
    });

    cleanup(home);
    cleanup(project);
  });

  it("skips configs with unresolved secret references", () => {
    const home = tmpDir();
    const project = tmpDir();
    process.env.CHORUS_HOME_DIR = home;
    clearSettingsCache();

    fs.writeFileSync(path.join(project, ".mcp.json"), JSON.stringify({
      mcpServers: {
        broken: {
          type: "http",
          url: "https://mcp.example.test/mcp",
          headers: { Authorization: "Bearer ${DOES_NOT_EXIST}" },
        },
      },
    }), "utf-8");
    trustProjectMcpConfig(project);

    expect(loadMcpServers(project)).toEqual([]);

    cleanup(home);
    cleanup(project);
  });

  it("does not load project MCP servers until the current file hash is trusted", () => {
    const home = tmpDir();
    const project = tmpDir();
    process.env.CHORUS_HOME_DIR = home;
    clearSettingsCache();

    fs.writeFileSync(path.join(project, ".mcp.json"), JSON.stringify({
      mcpServers: {
        local: { type: "stdio", command: "node", args: ["server.js"] },
      },
    }), "utf-8");

    expect(getProjectMcpTrust(project).trusted).toBe(false);
    expect(loadMcpServers(project)).toEqual([]);

    trustProjectMcpConfig(project);
    expect(loadMcpServers(project)).toHaveLength(1);

    fs.writeFileSync(path.join(project, ".mcp.json"), JSON.stringify({
      mcpServers: {
        local: { type: "stdio", command: "node", args: ["changed.js"] },
      },
    }), "utf-8");

    expect(getProjectMcpTrust(project).trusted).toBe(false);
    expect(loadMcpServers(project)).toEqual([]);

    cleanup(home);
    cleanup(project);
  });
});
