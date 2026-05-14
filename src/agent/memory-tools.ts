/**
 * Long-term agent memory tools — expose FileMemoryStore as callable agent tools.
 *
 * Agents with these tools can persist and retrieve facts across swarm runs
 * and sessions. Memory is namespaced per-agent by default.
 */

import type { AgentTool } from "./types.js";
import { FileMemoryStore } from "./memory-store.js";

const store = new FileMemoryStore();

function memoryTool(
  name: string,
  description: string,
  schema: unknown,
  invoke: (input: unknown) => Promise<unknown>,
): AgentTool {
  return { name, description, schema, invoke };
}

/**
 * Create memory tools for an agent. All operations are namespaced to
 * `namespace` (typically the agent name) to prevent key collisions.
 */
export function createMemoryTools(namespace: string): AgentTool[] {
  return [
    memoryTool(
      "memory_store",
      "Store a persistent fact or piece of information for later retrieval across sessions.",
      {
        type: "object",
        properties: {
          key: { type: "string", description: "Unique key for this memory" },
          value: { type: "string", description: "The information to store" },
        },
        required: ["key", "value"],
      },
      async (input) => {
        const { key, value } = input as { key: string; value: string };
        await store.put(namespace, key, value);
        return JSON.stringify({ stored: true, key });
      },
    ),

    memoryTool(
      "memory_retrieve",
      "Retrieve a previously stored memory by key.",
      {
        type: "object",
        properties: {
          key: { type: "string", description: "Key to retrieve" },
        },
        required: ["key"],
      },
      async (input) => {
        const { key } = input as { key: string };
        const value = await store.get(namespace, key);
        if (value === null) return JSON.stringify({ found: false, key });
        return JSON.stringify({ found: true, key, value });
      },
    ),

    memoryTool(
      "memory_search",
      "Search stored memories by keyword. Returns all entries whose key or value matches the query.",
      {
        type: "object",
        properties: {
          query: { type: "string", description: "Search query" },
        },
        required: ["query"],
      },
      async (input) => {
        const { query } = input as { query: string };
        const results = await store.search(namespace, query);
        return JSON.stringify({ results, count: results.length });
      },
    ),

    memoryTool(
      "memory_list",
      "List all stored memory keys in this agent's namespace.",
      { type: "object", properties: {}, required: [] },
      async () => {
        const keys = await store.list(namespace);
        return JSON.stringify({ keys, count: keys.length });
      },
    ),

    memoryTool(
      "memory_delete",
      "Delete a stored memory entry.",
      {
        type: "object",
        properties: {
          key: { type: "string", description: "Key to delete" },
        },
        required: ["key"],
      },
      async (input) => {
        const { key } = input as { key: string };
        await store.delete(namespace, key);
        return JSON.stringify({ deleted: true, key });
      },
    ),
  ];
}

/** Shared memory tools — all agents in a swarm share one namespace */
export function createSharedMemoryTools(swarmId: string): AgentTool[] {
  return createMemoryTools(`swarm-${swarmId}`);
}
