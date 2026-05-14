import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { A2AServer } from "../src/a2a/server.js";
import { A2AClient } from "../src/a2a/client.js";
import type { AgentCard } from "../src/a2a/types.js";

const BASE_CARD: Omit<AgentCard, "endpoints"> = {
  id: "urn:chorus:test-agent",
  name: "Test Agent",
  description: "A test A2A agent",
  version: "1.0.0",
  capabilities: { streaming: true, pushNotifications: false, stateTransition: true },
  inputModes: ["text/plain"],
  outputModes: ["text/plain"],
  authentication: { type: "none" },
};

describe("A2AServer + A2AClient integration", () => {
  let server: A2AServer;
  let client: A2AClient;
  // Each test in this describe gets its own port to avoid EADDRINUSE after stop()
  const PORTS = [13220, 13221, 13222, 13223, 13224];
  let portIdx = 0;
  let currentPort: number;

  beforeEach(async () => {
    currentPort = PORTS[portIdx++ % PORTS.length];
    server = new A2AServer({
      port: currentPort,
      host: "127.0.0.1",
      card: BASE_CARD,
      handleTask: async (input: string) => `Echo: ${input}`,
    });
    await server.start();
    client = new A2AClient({ baseUrl: `http://127.0.0.1:${currentPort}` });
  });

  afterEach(async () => {
    await server.stop();
  });

  it("serves the agent card at /.well-known/agent.json", async () => {
    const card = await client.getAgentCard();
    expect(card.name).toBe("Test Agent");
    expect(card.id).toBe("urn:chorus:test-agent");
    expect(card.endpoints.tasks).toContain("/tasks");
  });

  it("sends a task and retrieves it", async () => {
    const task = await client.sendTask({
      message: { role: "user", content: [{ type: "text", text: "hello" }] },
    });
    expect(task.id).toBeTruthy();
    expect(task.agentId).toBe("urn:chorus:test-agent");
    expect(["submitted", "working", "completed"]).toContain(task.state);
  });

  it("waits for a task to complete", async () => {
    const task = await client.sendTask({
      message: { role: "user", content: [{ type: "text", text: "test input" }] },
    });
    const completed = await client.waitForTask(task.id, 50);
    expect(completed.state).toBe("completed");
    const lastMsg = completed.messages.at(-1);
    expect(lastMsg?.content[0]).toMatchObject({ type: "text", text: "Echo: test input" });
  });

  it("can cancel a task", async () => {
    const task = await client.sendTask({
      message: { role: "user", content: [{ type: "text", text: "cancel me" }] },
    });
    await client.cancelTask(task.id);
    const retrieved = await client.getTask(task.id);
    // state is either canceled or completed (depending on timing)
    expect(["canceled", "completed"]).toContain(retrieved.state);
  });

  it("returns error for unknown task id", async () => {
    await expect(client.getTask("does-not-exist")).rejects.toThrow("A2A error");
  });
});

describe("A2AServer streaming", () => {
  let server: A2AServer;
  let client: A2AClient;
  const PORT = 13225;

  beforeEach(async () => {
    server = new A2AServer({
      port: PORT,
      host: "127.0.0.1",
      card: BASE_CARD,
      handleTask: async function* (input: string) {
        yield "Part1: ";
        yield input;
      },
    });
    await server.start();
    client = new A2AClient({ baseUrl: `http://127.0.0.1:${PORT}` });
  });

  afterEach(async () => {
    await server.stop();
  });

  it("streams events via SSE", async () => {
    const events = [];
    for await (const event of client.streamTask({
      message: { role: "user", content: [{ type: "text", text: "world" }] },
    })) {
      events.push(event);
    }
    expect(events.length).toBeGreaterThan(0);
    const done = events.find((e) => e.type === "task-status-update" && e.final);
    expect(done).toBeDefined();
  });
});
