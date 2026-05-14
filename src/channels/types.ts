/**
 * Event channel types — subscribable real-time event stream.
 *
 * External UIs, dashboards, and CI tooling connect via SSE or WebSocket
 * and receive structured events as a Chorus session/swarm progresses.
 */

import type { SwarmEvent } from "../swarm/types.js";
import type { AgentEvent } from "../agent/types.js";

export interface ChannelSession {
  sessionId: string;
  swarmId?: string;
  connectedAt: number;
}

export type ChannelEvent =
  | { type: "session-start"; sessionId: string; ts: number }
  | { type: "swarm-event"; sessionId: string; event: SwarmEvent; ts: number }
  | { type: "agent-event"; sessionId: string; event: AgentEvent; ts: number }
  | { type: "session-end"; sessionId: string; ts: number }
  | { type: "heartbeat"; ts: number };
