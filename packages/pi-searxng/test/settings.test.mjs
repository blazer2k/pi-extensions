import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { mkdir, readFile, writeFile, readdir, rm } from "node:fs/promises";
import { join, dirname } from "node:path";
import { getConfig, loadConfig } from "../src/config/store.ts";
import { getDefaultConfig } from "../src/config/definition.ts";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { state } from "./no-network.mjs";
import { tools } from "./helpers.mjs";

const env = { ...process.env };
afterEach(() => {
  process.env.PI_SEARXNG_CONFIG_PATH = env.PI_SEARXNG_CONFIG_PATH;
  process.env.NODE_ENV = env.NODE_ENV;
  process.env.PI_CODING_AGENT_DIR = env.PI_CODING_AGENT_DIR;
  state.fetch = undefined;
});
test("explicit config path wins over test/agent paths, repairs only this file", async () => {
  const path = join(process.env.TMPDIR, "config", "override.json");
  process.env.PI_SEARXNG_CONFIG_PATH = path;
  await mkdir(dirname(path), { recursive: true });
  await writeFile(
    path,
    JSON.stringify({ maxResults: 71, verbose: false, unknown: true }),
  );
  const before = await readdir(process.env.PI_CODING_AGENT_DIR);
  loadConfig();
  assert.equal(getConfig().maxResults, 71);
  const saved = JSON.parse(await readFile(path, "utf8"));
  assert.deepEqual(saved, getConfig());
  assert.equal(saved.verbose, undefined);
  assert.equal(saved.unknown, undefined);
  assert.deepEqual(await readdir(process.env.PI_CODING_AGENT_DIR), before);
});
test("test path is isolated under TMPDIR and normal path honors agent override", async () => {
  delete process.env.PI_SEARXNG_CONFIG_PATH;
  loadConfig();
  assert.deepEqual(
    JSON.parse(
      await readFile(
        join(process.env.TMPDIR, "pi-searxng-test", "pi-searxng.json"),
        "utf8",
      ),
    ),
    getDefaultConfig(),
  );
  process.env.NODE_ENV = "production";
  loadConfig();
  assert.deepEqual(
    JSON.parse(
      await readFile(
        join(process.env.PI_CODING_AGENT_DIR, "pi-searxng.json"),
        "utf8",
      ),
    ),
    getDefaultConfig(),
  );
});
for (const phase of ["prepare", "exists", "read", "parse", "write"])
  test(`config ${phase} failure preserves read/write safeguards`, () => {
    const error = new Error(phase);
    const reported = [];
    let writes = 0;
    const storage = {
      prepare() {},
      exists: () => true,
      read: () => (phase === "parse" ? "{" : '{"maxResults":37}'),
      write() {
        writes++;
      },
    };
    if (phase !== "parse")
      storage[phase] = () => {
        throw error;
      };
    loadConfig((value) => reported.push(value), storage);
    assert.equal(reported.length, 1);
    if (phase !== "parse") assert.equal(reported[0], error);
    assert.equal(writes, 0);
    assert.equal(getConfig().maxResults, phase === "write" ? 37 : 10);
  });
test("without agent override the selected file stays inside isolated HOME", async () => {
  delete process.env.PI_SEARXNG_CONFIG_PATH;
  delete process.env.PI_CODING_AGENT_DIR;
  process.env.NODE_ENV = "production";
  assert(getAgentDir().startsWith(process.env.HOME + "/"));
  loadConfig();
  assert.deepEqual(
    JSON.parse(await readFile(join(getAgentDir(), "pi-searxng.json"), "utf8")),
    getDefaultConfig(),
  );
});
test("obsolete config file remains untouched and is not migrated", async () => {
  const path = join(process.env.PI_CODING_AGENT_DIR, "pi-searxng-suite.json");
  const old = '{"maxResults":41,"agentCanPickCategory":true}';
  await writeFile(path, old);
  delete process.env.PI_SEARXNG_CONFIG_PATH;
  process.env.NODE_ENV = "production";
  const current = join(process.env.PI_CODING_AGENT_DIR, "pi-searxng.json");
  await rm(current, { force: true });
  loadConfig();
  assert.deepEqual(getConfig(), getDefaultConfig());
  assert.deepEqual(
    JSON.parse(await readFile(current, "utf8")),
    getDefaultConfig(),
  );
  assert.equal(await readFile(path, "utf8"), old);
});
test("native startup defers config errors, reports once, and does not overwrite unreadable JSON", async (t) => {
  const registered = await tools();
  await writeFile(process.env.PI_SEARXNG_CONFIG_PATH, "{");
  await registered.loader.reload();
  let extension = registered.loader.getExtensions().extensions[0];
  const notices = [];
  const ctx = { hasUI: true, ui: { notify: (...args) => notices.push(args) } };
  for (let i = 0; i < 2; i++)
    for (const handler of extension.handlers.get("session_start"))
      await handler({}, ctx);
  assert.equal(notices.length, 1);
  assert.match(notices[0][0], /SearXNG config error/);
  assert.equal(notices[0][1], "error");
  assert.equal(await readFile(process.env.PI_SEARXNG_CONFIG_PATH, "utf8"), "{");
  await registered.loader.reload();
  extension = registered.loader.getExtensions().extensions[0];
  const errors = [];
  t.mock.method(console, "error", (value) => errors.push(value));
  for (const handler of extension.handlers.get("session_start"))
    await handler({}, { hasUI: false });
  assert.equal(errors.length, 1);
  assert.match(errors[0], /SearXNG config error/);
});
test("missing config creates repaired defaults, copies cannot mutate active values", () => {
  let saved;
  loadConfig(assert.fail, {
    prepare() {},
    exists: () => false,
    read: assert.fail,
    write(_path, value) {
      saved = JSON.parse(value);
    },
  });
  const value = getConfig();
  value.maxResults = 1;
  assert.deepEqual(saved, getDefaultConfig());
  assert.deepEqual(getConfig(), getDefaultConfig());
});
test("native registration snapshots both schema and execution until resource reload", async () => {
  const registered = await tools({ maxResults: 3 });
  assert.equal(registered.search.parameters.properties.maxResults, undefined);
  assert.equal(registered.search.parameters.properties.category, undefined);
  assert.equal(registered.fetch.label, "web fetch");
  assert.equal(registered.search.label, "web search");
  await writeFile(
    process.env.PI_SEARXNG_CONFIG_PATH,
    JSON.stringify({
      maxResults: 7,
      agentCanLimitResults: true,
      agentCanPickCategory: true,
      fetchPreviewLines: 1,
    }),
  );
  const calls = [];
  state.fetch = async (url) => {
    calls.push(new URL(url));
    return Response.json({
      results: Array.from({ length: 9 }, (_, i) => ({
        title: `Title ${i}`,
        url: `https://example.org/${i}`,
        content: `Body ${i}`,
      })),
    });
  };
  const original = await registered.search.execute("original", {
    query: "offline",
    maxResults: 1,
    category: "news",
  });
  assert.equal(original.details.resultCount, 3);
  assert.equal(calls[0].searchParams.has("categories"), false);
  const next = await registered.reload();
  assert.equal(next.search.parameters.properties.maxResults.maximum, 7);
  assert.deepEqual(
    next.search.parameters.properties.category.anyOf.map((item) => item.const),
    ["general", "news", "science", "videos"],
  );
  const current = await next.search.execute("next", {
    query: "offline",
    maxResults: 2,
    category: "news",
  });
  assert.equal(current.details.resultCount, 2);
  assert.equal(calls[1].searchParams.get("categories"), "news");
  assert.equal(
    (await registered.search.execute("old", { query: "offline" })).details
      .resultCount,
    3,
  );
  assert.equal(
    (await next.search.execute("bounded", { query: "offline", maxResults: 99 }))
      .details.resultCount,
    7,
  );
  await rm(process.env.PI_SEARXNG_CONFIG_PATH);
});
