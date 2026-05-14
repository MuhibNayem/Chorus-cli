import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SwarmCheckpointer } from "../src/swarm/swarm-checkpointer.js";

describe("SwarmCheckpointer", () => {
  let tmpHome: string;
  let originalChorusHome: string | undefined;

  beforeEach(() => {
    tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "chorus-cp-test-"));
    originalChorusHome = process.env.CHORUS_HOME_DIR;
    process.env.CHORUS_HOME_DIR = tmpHome;
  });

  afterEach(() => {
    if (originalChorusHome === undefined) {
      delete process.env.CHORUS_HOME_DIR;
    } else {
      process.env.CHORUS_HOME_DIR = originalChorusHome;
    }
    fs.rmSync(tmpHome, { recursive: true, force: true });
  });

  describe("save and load", () => {
    it("saves a checkpoint and loads it back", () => {
      const cp = new SwarmCheckpointer();
      cp.save("swarm-1", 2, { key1: "value1", key2: "value2" });

      const loaded = cp.load("swarm-1");
      expect(loaded).not.toBeNull();
      expect(loaded!.swarmId).toBe("swarm-1");
      expect(loaded!.completedWaves).toBe(2);
      expect(loaded!.artifacts).toEqual({ key1: "value1", key2: "value2" });
      expect(typeof loaded!.createdAt).toBe("number");
      expect(typeof loaded!.updatedAt).toBe("number");
    });

    it("creates the checkpoint directory on first save", () => {
      const cp = new SwarmCheckpointer();
      const cpDir = path.join(tmpHome, "swarm-checkpoints");
      expect(fs.existsSync(cpDir)).toBe(false);

      cp.save("swarm-new", 1, {});
      expect(fs.existsSync(cpDir)).toBe(true);
    });

    it("preserves createdAt across updates", () => {
      const cp = new SwarmCheckpointer();
      cp.save("swarm-x", 1, { a: "1" });
      const first = cp.load("swarm-x")!;

      cp.save("swarm-x", 2, { a: "1", b: "2" });
      const second = cp.load("swarm-x")!;

      expect(second.createdAt).toBe(first.createdAt);
      expect(second.completedWaves).toBe(2);
      expect(second.artifacts).toEqual({ a: "1", b: "2" });
    });

    it("updates updatedAt on each save", async () => {
      const cp = new SwarmCheckpointer();
      cp.save("swarm-y", 1, {});
      const first = cp.load("swarm-y")!;

      await new Promise((r) => setTimeout(r, 5));
      cp.save("swarm-y", 2, {});
      const second = cp.load("swarm-y")!;

      expect(second.updatedAt).toBeGreaterThanOrEqual(first.updatedAt);
    });

    it("writes atomically (no partial file visible)", () => {
      const cp = new SwarmCheckpointer();
      cp.save("swarm-atomic", 1, { k: "v" });

      const cpPath = path.join(tmpHome, "swarm-checkpoints", "swarm-atomic.json");
      const tmpPath = `${cpPath}.tmp`;

      expect(fs.existsSync(cpPath)).toBe(true);
      expect(fs.existsSync(tmpPath)).toBe(false);
    });
  });

  describe("load edge cases", () => {
    it("returns null for non-existent swarm", () => {
      const cp = new SwarmCheckpointer();
      expect(cp.load("does-not-exist")).toBeNull();
    });

    it("returns null for corrupt JSON", () => {
      const cpDir = path.join(tmpHome, "swarm-checkpoints");
      fs.mkdirSync(cpDir, { recursive: true });
      fs.writeFileSync(path.join(cpDir, "corrupt.json"), "{ not valid json", "utf-8");

      const cp = new SwarmCheckpointer();
      expect(cp.load("corrupt")).toBeNull();
    });

    it("returns null for JSON missing required fields", () => {
      const cpDir = path.join(tmpHome, "swarm-checkpoints");
      fs.mkdirSync(cpDir, { recursive: true });
      fs.writeFileSync(
        path.join(cpDir, "partial.json"),
        JSON.stringify({ swarmId: "partial" }),
        "utf-8",
      );

      const cp = new SwarmCheckpointer();
      expect(cp.load("partial")).toBeNull();
    });
  });

  describe("delete", () => {
    it("deletes an existing checkpoint", () => {
      const cp = new SwarmCheckpointer();
      cp.save("swarm-del", 1, {});
      expect(cp.load("swarm-del")).not.toBeNull();

      cp.delete("swarm-del");
      expect(cp.load("swarm-del")).toBeNull();
    });

    it("is a silent no-op when checkpoint does not exist", () => {
      const cp = new SwarmCheckpointer();
      expect(() => cp.delete("nonexistent-swarm")).not.toThrow();
    });
  });

  describe("list", () => {
    it("returns empty array when no checkpoints exist", () => {
      const cp = new SwarmCheckpointer();
      expect(cp.list()).toEqual([]);
    });

    it("lists all checkpoints sorted by updatedAt descending", async () => {
      const cp = new SwarmCheckpointer();
      cp.save("swarm-a", 1, {});
      await new Promise((r) => setTimeout(r, 5));
      cp.save("swarm-b", 2, {});
      await new Promise((r) => setTimeout(r, 5));
      cp.save("swarm-c", 3, {});

      const list = cp.list();
      expect(list.map((d) => d.swarmId)).toEqual(["swarm-c", "swarm-b", "swarm-a"]);
    });

    it("skips corrupt files in listing", () => {
      const cpDir = path.join(tmpHome, "swarm-checkpoints");
      fs.mkdirSync(cpDir, { recursive: true });
      fs.writeFileSync(path.join(cpDir, "broken.json"), "{ bad", "utf-8");

      const cp = new SwarmCheckpointer();
      cp.save("good-swarm", 1, {});

      const list = cp.list();
      expect(list).toHaveLength(1);
      expect(list[0].swarmId).toBe("good-swarm");
    });
  });
});

// ─── Resume Logic Integration ─────────────────────────────────────────────────

import { computeWaves } from "../src/swarm/graph-executor.js";
import type { SwarmAgent } from "../src/swarm/types.js";

describe("runSwarmGraph resume logic (unit: computeWaves)", () => {
  it("computes correct waves for a linear chain", () => {
    const agents: SwarmAgent[] = [
      makeAgent("a"),
      makeAgent("b", ["a"]),
      makeAgent("c", ["b"]),
    ];
    const waves = computeWaves(agents);
    expect(waves).toHaveLength(3);
    expect(waves[0].map((a) => a.name)).toEqual(["a"]);
    expect(waves[1].map((a) => a.name)).toEqual(["b"]);
    expect(waves[2].map((a) => a.name)).toEqual(["c"]);
  });

  it("computes parallel wave for independent agents", () => {
    const agents: SwarmAgent[] = [
      makeAgent("a"),
      makeAgent("b"),
      makeAgent("c", ["a", "b"]),
    ];
    const waves = computeWaves(agents);
    expect(waves).toHaveLength(2);
    expect(waves[0].map((a) => a.name).sort()).toEqual(["a", "b"]);
    expect(waves[1].map((a) => a.name)).toEqual(["c"]);
  });

  it("throws on unknown dependency", () => {
    const agents: SwarmAgent[] = [makeAgent("a", ["phantom"])];
    expect(() => computeWaves(agents)).toThrow(/unknown agent "phantom"/);
  });

  it("throws on circular dependency", () => {
    const agents: SwarmAgent[] = [makeAgent("a", ["b"]), makeAgent("b", ["a"])];
    expect(() => computeWaves(agents)).toThrow(/Circular dependency/);
  });

  it("handles no-dep single agent", () => {
    const agents: SwarmAgent[] = [makeAgent("solo")];
    const waves = computeWaves(agents);
    expect(waves).toHaveLength(1);
    expect(waves[0][0].name).toBe("solo");
  });
});

function makeAgent(name: string, dependsOn: string[] = []): SwarmAgent {
  return {
    name,
    description: name,
    systemPrompt: "You are " + name,
    tools: [],
    handoffDestinations: [],
    contextMode: "filtered",
    maxRounds: 10,
    dependsOn,
  };
}
