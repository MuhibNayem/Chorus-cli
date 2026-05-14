/**
 * A2A Adapter — wraps a Chorus swarm as an A2A-compatible agent server.
 *
 * Usage:
 *   const server = createA2AServer({ swarmConfig, port: 3210, card: { ... } });
 *   await server.start();
 */

import { runSwarm } from "../swarm/orchestrator.js";
import { A2AServer } from "./server.js";
import type { A2AServerConfig } from "./server.js";
import type { SwarmConfig } from "../swarm/types.js";
import type { AgentCard } from "./types.js";

export interface SwarmA2AConfig {
  swarmConfig: Omit<SwarmConfig, "task">;
  card: Omit<AgentCard, "endpoints">;
  port?: number;
  host?: string;
}

export function createSwarmA2AServer(config: SwarmA2AConfig): A2AServer {
  const serverConfig: A2AServerConfig = {
    port: config.port,
    host: config.host,
    card: config.card,
    handleTask: async function* (input: string) {
      const swarmConfig: SwarmConfig = { ...config.swarmConfig, task: input };
      for await (const event of runSwarm(swarmConfig)) {
        if (event.type === "agent-done") {
          yield event.responseText;
        }
      }
    },
  };

  return new A2AServer(serverConfig);
}
