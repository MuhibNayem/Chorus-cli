/**
 * EventBroadcaster — fan-out hub for ChannelEvents.
 *
 * Swarm/agent runners call broadcast() as events flow through them.
 * SSE and WebSocket handlers subscribe to the event stream.
 */

import { EventEmitter } from "events";
import type { ChannelEvent } from "./types.js";
import type { SwarmEvent } from "../swarm/types.js";
import type { AgentEvent } from "../agent/types.js";

const HEARTBEAT_INTERVAL_MS = 15_000;

export class EventBroadcaster extends EventEmitter {
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private subscriberCount = 0;

  constructor() {
    super();
    this.setMaxListeners(500);
  }

  broadcastSwarmEvent(sessionId: string, event: SwarmEvent): void {
    const channelEvent: ChannelEvent = {
      type: "swarm-event",
      sessionId,
      event,
      ts: Date.now(),
    };
    this.emit("event", channelEvent);
  }

  broadcastAgentEvent(sessionId: string, event: AgentEvent): void {
    const channelEvent: ChannelEvent = {
      type: "agent-event",
      sessionId,
      event,
      ts: Date.now(),
    };
    this.emit("event", channelEvent);
  }

  broadcastSessionStart(sessionId: string): void {
    this.emit("event", { type: "session-start", sessionId, ts: Date.now() } satisfies ChannelEvent);
  }

  broadcastSessionEnd(sessionId: string): void {
    this.emit("event", { type: "session-end", sessionId, ts: Date.now() } satisfies ChannelEvent);
  }

  subscribe(handler: (event: ChannelEvent) => void): () => void {
    this.on("event", handler);
    this.subscriberCount++;
    this.ensureHeartbeat();

    return () => {
      this.off("event", handler);
      this.subscriberCount = Math.max(0, this.subscriberCount - 1);
      if (this.subscriberCount === 0) this.stopHeartbeat();
    };
  }

  private ensureHeartbeat(): void {
    if (this.heartbeatTimer) return;
    this.heartbeatTimer = setInterval(() => {
      this.emit("event", { type: "heartbeat", ts: Date.now() } satisfies ChannelEvent);
    }, HEARTBEAT_INTERVAL_MS);
    this.heartbeatTimer.unref?.();
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  dispose(): void {
    this.stopHeartbeat();
    this.removeAllListeners();
  }
}

/** Global broadcaster singleton — one process, one event bus */
export const globalBroadcaster = new EventBroadcaster();
