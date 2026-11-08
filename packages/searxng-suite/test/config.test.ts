import { describe, expect, it } from "bun:test";
import {
  getDefaultConfig,
  validateConfig,
  type Config,
} from "../src/config/definition";
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

describe("strict field repair", () => {
  it("removes obsolete names without turning them into permissions", () => {
    expect(
      validateConfig({
        limit: 1,
        llmCanOverrideLimit: true,
        llmCanPickCategory: true,
        verbose: true,
      }),
    ).toEqual(getDefaultConfig());
  });
  it("keeps the complete defaults stable and independent", () => {
    expect(getDefaultConfig()).toEqual({
      maxResults: 10,
      agentCanLimitResults: false,
      timeoutMs: 180000,
      pdfProcessingTimeoutMs: 300000,
      maxContentBytes: 104857600,
      maxSessionStorageBytes: 1073741824,
      safesearch: 0,
      agentCanPickCategory: false,
      allowPrivateUrls: false,
      fetchPreviewLines: 20,
    });
    const defaults = getDefaultConfig();
    defaults.maxResults = 1;
    expect(getDefaultConfig().maxResults).toBe(10);
  });
  for (const raw of [null, [], "{}", 7, false, undefined]) {
    it(`repairs root ${String(raw)}`, () =>
      expect(validateConfig(raw)).toEqual(getDefaultConfig()));
  }
  it("drops prototype-shaped unknown keys without granting permissions", () => {
    const raw = JSON.parse(
      '{"__proto__":{"allowPrivateUrls":true},"constructor":{"prototype":{"agentCanPickCategory":true}}}',
    );
    expect(validateConfig(raw)).toEqual(getDefaultConfig());
    expect({}).not.toHaveProperty("allowPrivateUrls");
    expect({}).not.toHaveProperty("agentCanPickCategory");
  });
  const siblings: Config = {
    ...getDefaultConfig(),
    maxResults: 37,
    timeoutMs: 1000.5,
    safesearch: 2,
    agentCanPickCategory: true,
    agentCanLimitResults: true,
    allowPrivateUrls: true,
    fetchPreviewLines: 5,
  };
  const ranges = {
    maxResults: { good: [1, 51, 100000], bad: [0, -1, 1.1] },
    timeoutMs: { good: [1000, 1000.5, 2147483647], bad: [999, 2147483648] },
    pdfProcessingTimeoutMs: {
      good: [1, 2147483647],
      bad: [0, 1.5, 2147483648],
    },
    maxContentBytes: {
      good: [1, Number.MAX_SAFE_INTEGER],
      bad: [0, 1.5, Number.MAX_SAFE_INTEGER + 1],
    },
    maxSessionStorageBytes: {
      good: [1, Number.MAX_SAFE_INTEGER],
      bad: [0, 1.5, Number.MAX_SAFE_INTEGER + 1],
    },
    safesearch: { good: [0, 1, 2], bad: [-1, 3, 0.5] },
    agentCanLimitResults: { good: [false, true], bad: [0, 1] },
    agentCanPickCategory: { good: [false, true], bad: [0, 1] },
    allowPrivateUrls: { good: [false, true], bad: [0, 1] },
  };
  for (const [key, { good, bad }] of Object.entries(ranges)) {
    it(`preserves valid ${key} values`, () => {
      for (const value of good)
        expect(
          validateConfig({ [key]: value })[key as keyof typeof ranges],
        ).toBe(value);
    });
    it(`repairs invalid ${key} without coercion or changing valid siblings`, () => {
      for (const value of [
        ...bad,
        "1",
        "true",
        null,
        [],
        {},
        NaN,
        Infinity,
        -Infinity,
        ...(typeof good[0] === "number" ? [true, false] : []),
      ]) {
        const raw: Record<string, unknown> = { ...siblings, [key]: value };
        expect(validateConfig(raw)).toEqual({
          ...siblings,
          [key]: getDefaultConfig()[key as keyof typeof ranges],
        });
        expect(raw[key]).toBe(value);
      }
    });
  }
});
