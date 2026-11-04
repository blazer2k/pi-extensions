import { describe, expect, it } from "bun:test";
import { getDefaultConfig, validateConfig } from "../src/config/definition";
import { getConfig, loadConfig } from "../src/config/store";

describe("fetchPreviewLines config", () => {
  it("defaults to 20 and removes the obsolete verbose field", () => {
    expect(getDefaultConfig().fetchPreviewLines).toBe(20);
    expect(getDefaultConfig()).not.toHaveProperty("verbose");
    for (const verbose of [true, false, "invalid"]) {
      const value = validateConfig({ verbose, maxResults: 31 });
      expect(value).not.toHaveProperty("verbose");
      expect(value.maxResults).toBe(31);
      expect(value.fetchPreviewLines).toBe(20);
    }
  });
  for (const value of [1, 5, 6, -1, 100000]) {
    it(`preserves ${value}`, () => {
      expect(
        validateConfig({ fetchPreviewLines: value }).fetchPreviewLines,
      ).toBe(value);
    });
  }
  for (const value of [
    0,
    -2,
    1.5,
    "6",
    "-1",
    true,
    false,
    null,
    [],
    {},
    NaN,
    Infinity,
    -Infinity,
  ]) {
    it(`repairs ${String(value)} without changing valid siblings`, () => {
      const config = validateConfig({
        fetchPreviewLines: value,
        maxResults: 23,
        timeoutMs: 1000.5,
        agentCanPickCategory: true,
      });
      expect(config.fetchPreviewLines).toBe(20);
      expect(config.maxResults).toBe(23);
      expect(config.timeoutMs).toBe(1000.5);
      expect(config.agentCanPickCategory).toBe(true);
    });
  }
  it("keeps read/write safeguards and reload snapshots", () => {
    const original = getConfig();
    const errors: unknown[] = [];
    let writes = 0;
    let saved: unknown = {
      fetchPreviewLines: 3,
      verbose: true,
      maxResults: 31,
    };
    const storage = {
      prepare() {},
      exists: () => true,
      read: () => JSON.stringify(saved),
      write(_path: string, data: string) {
        writes++;
        saved = JSON.parse(data);
      },
    };
    try {
      loadConfig((error) => errors.push(error), storage);
      expect(saved).not.toHaveProperty("verbose");
      const snapshot = getConfig();
      loadConfig((error) => errors.push(error), {
        ...storage,
        read: () => '{"fetchPreviewLines":7}',
        write() {
          throw new Error("write failed");
        },
      });
      expect(snapshot.fetchPreviewLines).toBe(3);
      expect(getConfig().fetchPreviewLines).toBe(7);
      expect(errors).toHaveLength(1);
      const before = writes;
      loadConfig((error) => errors.push(error), {
        ...storage,
        read() {
          throw new Error("read failed");
        },
      });
      expect(writes).toBe(before);
      expect(getConfig().fetchPreviewLines).toBe(20);
      expect(errors).toHaveLength(2);
    } finally {
      loadConfig(undefined, {
        ...storage,
        read: () => JSON.stringify(original),
        write() {},
      });
    }
  });
});
