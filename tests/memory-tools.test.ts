import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createMemoryTools, createSharedMemoryTools } from "../src/agent/memory-tools.js";

describe("createMemoryTools", () => {
  let tmpHome: string;
  let origHome: string | undefined;

  beforeEach(() => {
    tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "chorus-mem-test-"));
    origHome = process.env.CHORUS_HOME_DIR;
    process.env.CHORUS_HOME_DIR = tmpHome;
  });

  afterEach(() => {
    if (origHome === undefined) delete process.env.CHORUS_HOME_DIR;
    else process.env.CHORUS_HOME_DIR = origHome;
    fs.rmSync(tmpHome, { recursive: true, force: true });
  });

  it("creates 5 tools", () => {
    const tools = createMemoryTools("test-agent");
    expect(tools).toHaveLength(5);
    const names = tools.map((t) => t.name);
    expect(names).toContain("memory_store");
    expect(names).toContain("memory_retrieve");
    expect(names).toContain("memory_search");
    expect(names).toContain("memory_list");
    expect(names).toContain("memory_delete");
  });

  it("stores and retrieves a value", async () => {
    const tools = createMemoryTools("agent1");
    const store = tools.find((t) => t.name === "memory_store")!;
    const retrieve = tools.find((t) => t.name === "memory_retrieve")!;

    await store.invoke({ key: "fact", value: "the sky is blue" });
    const result = JSON.parse(String(await retrieve.invoke({ key: "fact" }))) as { found: boolean; value: string };
    expect(result.found).toBe(true);
    expect(result.value).toBe("the sky is blue");
  });

  it("returns not found for missing key", async () => {
    const tools = createMemoryTools("agent1");
    const retrieve = tools.find((t) => t.name === "memory_retrieve")!;
    const result = JSON.parse(String(await retrieve.invoke({ key: "no-such-key" }))) as { found: boolean };
    expect(result.found).toBe(false);
  });

  it("lists stored keys", async () => {
    const tools = createMemoryTools("agent2");
    const store = tools.find((t) => t.name === "memory_store")!;
    const list = tools.find((t) => t.name === "memory_list")!;

    await store.invoke({ key: "a", value: "1" });
    await store.invoke({ key: "b", value: "2" });

    const result = JSON.parse(String(await list.invoke({}))) as { keys: string[]; count: number };
    expect(result.keys).toContain("a");
    expect(result.keys).toContain("b");
    expect(result.count).toBe(2);
  });

  it("deletes a key", async () => {
    const tools = createMemoryTools("agent3");
    const store = tools.find((t) => t.name === "memory_store")!;
    const del = tools.find((t) => t.name === "memory_delete")!;
    const retrieve = tools.find((t) => t.name === "memory_retrieve")!;

    await store.invoke({ key: "temp", value: "data" });
    await del.invoke({ key: "temp" });
    const result = JSON.parse(String(await retrieve.invoke({ key: "temp" }))) as { found: boolean };
    expect(result.found).toBe(false);
  });

  it("searches by keyword", async () => {
    const tools = createMemoryTools("agent4");
    const store = tools.find((t) => t.name === "memory_store")!;
    const search = tools.find((t) => t.name === "memory_search")!;

    await store.invoke({ key: "project-goal", value: "build a distributed system" });
    await store.invoke({ key: "unrelated", value: "shopping list" });

    const result = JSON.parse(String(await search.invoke({ query: "distributed" }))) as { results: unknown[]; count: number };
    expect(result.count).toBe(1);
  });

  it("namespaces are isolated between agents", async () => {
    const tools1 = createMemoryTools("agent-x");
    const tools2 = createMemoryTools("agent-y");

    const store1 = tools1.find((t) => t.name === "memory_store")!;
    const retrieve2 = tools2.find((t) => t.name === "memory_retrieve")!;

    await store1.invoke({ key: "secret", value: "only for x" });
    const result = JSON.parse(String(await retrieve2.invoke({ key: "secret" }))) as { found: boolean };
    expect(result.found).toBe(false);
  });

  it("createSharedMemoryTools uses swarm namespace", async () => {
    const tools = createSharedMemoryTools("swarm-abc");
    const store = tools.find((t) => t.name === "memory_store")!;
    const retrieve = tools.find((t) => t.name === "memory_retrieve")!;

    await store.invoke({ key: "shared", value: "common knowledge" });
    const result = JSON.parse(String(await retrieve.invoke({ key: "shared" }))) as { found: boolean; value: string };
    expect(result.found).toBe(true);
    expect(result.value).toBe("common knowledge");
  });
});
