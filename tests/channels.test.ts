import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { EventBroadcaster } from "../src/channels/broadcaster.js";
import { ChannelServer } from "../src/channels/server.js";
import type { ChannelEvent } from "../src/channels/types.js";

describe("EventBroadcaster", () => {
  it("broadcasts swarm events to subscribers", () => {
    const b = new EventBroadcaster();
    const received: ChannelEvent[] = [];
    const unsub = b.subscribe((e) => received.push(e));

    b.broadcastSwarmEvent("s1", { type: "swarm-start", swarmId: "s1", agents: ["a"] });
    b.broadcastSessionStart("s1");
    b.broadcastSessionEnd("s1");

    expect(received).toHaveLength(3);
    expect(received[0].type).toBe("swarm-event");
    expect(received[1].type).toBe("session-start");
    expect(received[2].type).toBe("session-end");

    unsub();
    b.dispose();
  });

  it("unsubscribe stops receiving events", () => {
    const b = new EventBroadcaster();
    const received: ChannelEvent[] = [];
    const unsub = b.subscribe((e) => received.push(e));

    b.broadcastSessionStart("s1");
    unsub();
    b.broadcastSessionStart("s2");

    expect(received).toHaveLength(1);
    b.dispose();
  });

  it("supports multiple subscribers", () => {
    const b = new EventBroadcaster();
    const a: ChannelEvent[] = [];
    const c: ChannelEvent[] = [];
    const ua = b.subscribe((e) => a.push(e));
    const uc = b.subscribe((e) => c.push(e));

    b.broadcastSessionStart("x");
    expect(a).toHaveLength(1);
    expect(c).toHaveLength(1);

    ua();
    uc();
    b.dispose();
  });
});

describe("ChannelServer", () => {
  let broadcaster: EventBroadcaster;
  let server: ChannelServer;
  const PORT = 13226;

  beforeEach(async () => {
    broadcaster = new EventBroadcaster();
    server = new ChannelServer({ port: PORT, host: "127.0.0.1", broadcaster });
    await server.start();
  });

  afterEach(async () => {
    await server.stop();
    broadcaster.dispose();
  });

  it("serves health check", async () => {
    const res = await fetch(`http://127.0.0.1:${PORT}/health`);
    expect(res.ok).toBe(true);
    const body = await res.json() as { status: string };
    expect(body.status).toBe("ok");
  });

  it("returns 404 for unknown routes", async () => {
    const res = await fetch(`http://127.0.0.1:${PORT}/unknown`);
    expect(res.status).toBe(404);
  });

  it("delivers SSE events to connected client", async () => {
    const receivedTexts: string[] = [];
    const controller = new AbortController();

    const ssePromise = fetch(`http://127.0.0.1:${PORT}/events`, {
      signal: controller.signal,
    }).then(async (res) => {
      const reader = res.body!.getReader();
      const dec = new TextDecoder();
      let buf = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop() ?? "";
        for (const line of lines) {
          if (line.startsWith("data: ")) receivedTexts.push(line.slice(6));
        }
        if (receivedTexts.length >= 2) {
          controller.abort();
          break;
        }
      }
    }).catch(() => {/* aborted */});

    // Wait for connection to establish
    await new Promise((r) => setTimeout(r, 50));
    broadcaster.broadcastSessionStart("my-session");
    await ssePromise;

    expect(receivedTexts.length).toBeGreaterThanOrEqual(1);
    // First event is always a heartbeat
    const heartbeat = JSON.parse(receivedTexts[0]) as ChannelEvent;
    expect(heartbeat.type).toBe("heartbeat");
  });
});
