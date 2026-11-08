import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import { afterEach, mock, test } from "node:test";
import { join, dirname } from "node:path";
import {
  createExtractionDirectory,
  writeExtractionFile,
} from "../src/helpers/extract-files.ts";
import { buildFetchOutput } from "../src/helpers/fetch-output.ts";
import { webFetch } from "../src/api/fetch.ts";
import { getDefaultConfig } from "../src/config/definition.ts";
import {
  DEFAULT_MAX_BYTES,
  DEFAULT_MAX_LINES,
  truncateHead,
} from "@earendil-works/pi-coding-agent";
import { state } from "./no-network.mjs";
import { tools, context, text } from "./helpers.mjs";

afterEach(() => {
  mock.restoreAll();
  syncBuiltinESMExports();
  state.fetch = undefined;
});
const directory = () => createExtractionDirectory(randomUUID());
const source = (body) => ({
  sourceUrl: "https://example.org/text",
  contentType: "text/plain",
  bodyStart: 0,
  content: [{ type: "text", text: body }],
});
for (const id of ["", "../escape", "/absolute", "a/b", "with space"])
  test(`session identity rejects ${JSON.stringify(id)}`, async () =>
    assert.rejects(
      createExtractionDirectory(id),
      /Invalid extraction session ID/,
    ));
test("session roots must be private owned directories, not symlinks", async () => {
  for (const mode of ["public", "symlink"]) {
    const id = randomUUID(),
      path = join(process.env.TMPDIR, `pi-searxng-session-${id}`);
    if (mode === "public") {
      await fs.mkdir(path);
      await fs.chmod(path, 0o777);
    } else {
      const target = await directory();
      await fs.symlink(target, path);
    }
    await assert.rejects(
      createExtractionDirectory(id),
      /private owned directory/,
    );
  }
});
test("exclusive writes preserve collisions, including preexisting .part and final files", async () => {
  for (const streamed of [false, true]) {
    const dir = await directory(),
      path = join(dir, "original.pdf");
    await fs.writeFile(path, "retained");
    const data = streamed
      ? (async function* () {
          yield Buffer.from("new");
        })()
      : "new";
    await assert.rejects(writeExtractionFile(path, data, 100), /EEXIST/);
    assert.equal(await fs.readFile(path, "utf8"), "retained");
    assert.deepEqual(await fs.readdir(dir), ["original.pdf"]);
  }
  const dir = await directory(),
    path = join(dir, "original.pdf");
  await fs.writeFile(path + ".part", "other owner");
  await assert.rejects(
    writeExtractionFile(
      path,
      (async function* () {
        yield Buffer.from("new");
      })(),
      100,
    ),
    /EEXIST/,
  );
  assert.equal(await fs.readFile(path + ".part", "utf8"), "other owner");
});
test("stream awaits disk writes before pulling the next chunk and publishes only at EOF", async () => {
  const dir = await directory(),
    path = join(dir, "original.pdf");
  const started = Promise.withResolvers(),
    release = Promise.withResolvers();
  let pulled = 0;
  const open = fs.open;
  mock.method(fs, "open", async (...args) => {
    const handle = await open(...args),
      write = handle.writeFile.bind(handle);
    if (args[0] === path + ".part")
      mock.method(handle, "writeFile", async (...values) => {
        started.resolve();
        await release.promise;
        return write(...values);
      });
    return handle;
  });
  syncBuiltinESMExports();
  const pending = writeExtractionFile(
    path,
    (async function* () {
      pulled++;
      yield Buffer.from("ab");
      pulled++;
      yield Buffer.from("cd");
    })(),
    4,
  );
  await started.promise;
  try {
    assert.equal(pulled, 1);
    await assert.rejects(fs.access(path), { code: "ENOENT" });
    await fs.access(path + ".part");
  } finally {
    release.resolve();
    await pending;
  }
  assert.equal(await pending, 4);
  assert.equal(await fs.readFile(path, "utf8"), "abcd");
  assert.deepEqual(await fs.readdir(dir), ["original.pdf"]);
  assert.equal((await fs.stat(dir)).mode & 0o777, 0o700);
});
test("actual close failure prevents publication and cleans only unfinished owned files", async () => {
  const dir = await directory(),
    path = join(dir, "original.pdf"),
    open = fs.open;
  mock.method(fs, "open", async (...args) => {
    const handle = await open(...args),
      close = handle.close.bind(handle);
    if (args[0] === path + ".part")
      mock.method(handle, "close", async () => {
        await close();
        throw new Error("CLOSE_FAILURE");
      });
    return handle;
  });
  syncBuiltinESMExports();
  await assert.rejects(
    writeExtractionFile(
      path,
      (async function* () {
        yield Buffer.from("ab");
      })(),
      4,
    ),
    /CLOSE_FAILURE/,
  );
  assert.deepEqual(await fs.readdir(dirname(dir)), []);
});
test("mid-stream quota and custom abort clean unfinished downloads without publishing", async () => {
  for (const aborted of [false, true]) {
    const dir = await directory(),
      path = join(dir, "original.pdf"),
      controller = new AbortController();
    const reason = { toString: assert.fail };
    const data = (async function* () {
      yield Buffer.from("ab");
      if (aborted) controller.abort(reason);
      yield Buffer.from("cd");
    })();
    await assert.rejects(
      writeExtractionFile(path, data, 3, controller.signal),
      (error) =>
        aborted
          ? error === reason
          : /maxSessionStorageBytes/.test(error.message),
    );
    assert.deepEqual(await fs.readdir(dirname(dir)), []);
  }
});
test("quota scanning rejects symlinks without following or changing their targets", async () => {
  const dir = await directory(),
    target = join(process.env.TMPDIR, `outside-${randomUUID()}`);
  await fs.writeFile(target, "retained");
  await fs.symlink(target, join(dir, "link"));
  await assert.rejects(
    writeExtractionFile(join(dir, "new"), "x", 100),
    /Unexpected non-file/,
  );
  assert.equal(await fs.readFile(target, "utf8"), "retained");
  assert.deepEqual(await fs.readdir(dir), ["link"]);
});
test("same-session concurrency serializes exact quota without eviction", async () => {
  const id = randomUUID(),
    first = await createExtractionDirectory(id),
    second = await createExtractionDirectory(id);
  const outcomes = await Promise.allSettled([
    writeExtractionFile(join(first, "one"), "12345", 8),
    writeExtractionFile(join(second, "two"), "67890", 8),
  ]);
  assert.equal(
    outcomes.filter((item) => item.status === "fulfilled").length,
    1,
  );
  assert.match(
    outcomes.find((item) => item.status === "rejected").reason.message,
    /maxSessionStorageBytes/,
  );
  assert.equal(await fs.readFile(join(first, "one"), "utf8"), "12345");
});
test("real disk additions, deletion and subsequent calls recalculate storage rather than using a ledger", async () => {
  const dir = await directory(),
    path = join(dir, "retained");
  await writeExtractionFile(path, "123", 8);
  await fs.writeFile(join(dir, "external"), "4567");
  await writeExtractionFile(join(dir, "exact"), "8", 8);
  await assert.rejects(
    writeExtractionFile(join(dir, "denied"), "9", 8),
    /maxSessionStorageBytes/,
  );
  await fs.rm(join(dir, "external"));
  await writeExtractionFile(join(dir, "reclaimed"), "abcd", 8);
  assert.equal(await fs.readFile(path, "utf8"), "123");
});
for (const dimension of ["bytes", "lines"])
  test(`native inline ${dimension} exact boundary vs full saved output`, async () => {
    for (const over of [false, true]) {
      const body =
        dimension === "bytes"
          ? "x".repeat(DEFAULT_MAX_BYTES + Number(over))
          : Array(DEFAULT_MAX_LINES + Number(over))
              .fill("x")
              .join("\n");
      let dir;
      const getDirectory = async () => (dir ??= await directory());
      const result = await buildFetchOutput(source(body), getDirectory, 100000);
      assert.equal(result.details.status, "success");
      assert.equal(Boolean(result.details.fullOutputPath), over);
      assert.equal(truncateHead(text(result)).truncated, false);
      if (over)
        assert.equal(
          await fs.readFile(result.details.fullOutputPath, "utf8"),
          body,
        );
      else assert.equal(dir, undefined);
    }
  });
test("valid UTF-8 conversion limit saves accepted partial text, never a split character", async () => {
  const raw = "\ud83d\ude00".repeat(100),
    url = "https://example.org/text";
  state.fetch = async () =>
    new Response(raw, { headers: { "Content-Type": "text/plain" } });
  const complete = await webFetch(url, getDefaultConfig());
  const prefix = text(complete).slice(0, complete.bodyStart);
  const prefixBytes = Buffer.byteLength(prefix),
    rawBytes = Buffer.byteLength(raw);
  const limit = prefixBytes + rawBytes - 3;
  assert(
    limit >= rawBytes,
    "download must fit before the converted-text cutoff",
  );
  assert.equal(
    (limit - prefixBytes) % 4,
    1,
    "fixture must cut inside the final emoji",
  );
  const { fetch } = await tools({ maxContentBytes: limit });
  const result = await fetch.execute(
    "partial",
    { url: "https://example.org/text" },
    undefined,
    undefined,
    context(),
  );
  assert.equal(result.isError, true);
  assert.match(result.details.fullOutputPath, /content\.partial\.txt$/);
  const saved = await fs.readFile(result.details.fullOutputPath, "utf8");
  assert(Buffer.byteLength(saved) <= limit);
  assert.doesNotMatch(saved, /\ufffd/);
  assert.equal(saved, prefix + raw.slice(0, -2));
  assert.equal(result.details.textBytes, rawBytes - 4);
});
test("search credentials are not injected into fetch metadata or retained files", async () => {
  const previous = process.env.SEARXNG_API_KEY;
  const key = `PRIVATE_SEARCH_KEY_${randomUUID()}`;
  process.env.SEARXNG_API_KEY = key;
  try {
    const registered = await tools();
    state.fetch = async (_url, options) => {
      assert.equal(options.headers.Authorization, `Bearer ${key}`);
      return Response.json({ results: [] });
    };
    assert.equal(
      (await registered.search.execute("auth", { query: "offline" })).details
        .status,
      "success",
    );
    const pdf = await fs.readFile(
      new URL("./fixtures/readable.pdf", import.meta.url),
    );
    for (const [type, payload] of [
      ["text/plain", "x".repeat(60000)],
      ["application/json", JSON.stringify({ body: "x".repeat(60000) })],
      ["application/pdf", pdf],
    ]) {
      state.fetch = async (_url, options) => {
        assert.equal(options.headers.Authorization, undefined);
        return new Response(payload, { headers: { "Content-Type": type } });
      };
      const result = await registered.fetch.execute(
        "private-key",
        { url: "https://example.org/document" },
        undefined,
        undefined,
        context(),
      );
      assert.equal(result.details.status, "success");
      assert.equal(JSON.stringify(result).includes(key), false);
      const paths = [
        result.details.originalPdfPath,
        result.details.fullOutputPath,
      ].filter(Boolean);
      assert(paths.length > 0);
      for (const path of paths)
        assert.equal(
          (await fs.readFile(path)).includes(Buffer.from(key)),
          false,
          "search key in retained artifact",
        );
    }
  } finally {
    process.env.SEARXNG_API_KEY = previous;
  }
});
test("late cancellation after close retains the completed full output file", async () => {
  const dir = await directory(),
    controller = new AbortController(),
    open = fs.open;
  const reason = { toString: assert.fail };
  mock.method(fs, "open", async (...args) => {
    const handle = await open(...args),
      close = handle.close.bind(handle);
    if (args[0] === join(dir, "content.txt"))
      mock.method(handle, "close", async () => {
        await close();
        controller.abort(reason);
      });
    return handle;
  });
  syncBuiltinESMExports();
  const body = "x".repeat(60000);
  const result = await buildFetchOutput(
    source(body),
    async () => dir,
    100000,
    controller.signal,
  );
  assert.equal(result.isError, true);
  assert.equal(result.details.status, "aborted");
  assert.equal(await fs.readFile(result.details.fullOutputPath, "utf8"), body);
  assert.match(text(result), /Full output saved to:/);
});
test("oversized file notices fail before writing content and keep the returned failure bounded", async () => {
  mock.method(fs, "open", assert.fail);
  syncBuiltinESMExports();
  const result = await buildFetchOutput(
    source("x".repeat(60000)),
    async () => "/" + "p".repeat(DEFAULT_MAX_BYTES + 1000),
    100000,
  );
  assert.equal(result.isError, true);
  assert.equal(result.details.fullOutputPath, undefined);
  assert.match(text(result), /Output file notice is too long/);
  assert.equal(truncateHead(text(result)).truncated, false);
});
test("native reload preserves original files and recalculates quota for the same session", async () => {
  const registered = await tools({ maxSessionStorageBytes: 65000 });
  const ctx = context();
  state.fetch = async () =>
    new Response("x".repeat(60000), {
      headers: { "Content-Type": "text/plain" },
    });
  const first = await registered.fetch.execute(
    "first",
    { url: "https://example.org/text" },
    undefined,
    undefined,
    ctx,
  );
  assert.equal(first.details.status, "success");
  const retained = await fs.readFile(first.details.fullOutputPath);
  const next = await registered.reload();
  const denied = await next.fetch.execute(
    "denied",
    { url: "https://example.org/text" },
    undefined,
    undefined,
    ctx,
  );
  assert.equal(denied.isError, true);
  assert.match(text(denied), /maxSessionStorageBytes/);
  assert.deepEqual(await fs.readFile(first.details.fullOutputPath), retained);
  await fs.rm(first.details.fullOutputPath);
  await assert.rejects(fs.readFile(first.details.fullOutputPath), {
    code: "ENOENT",
  });
  const reclaimed = await next.fetch.execute(
    "reclaimed",
    { url: "https://example.org/text" },
    undefined,
    undefined,
    ctx,
  );
  assert.equal(reclaimed.details.status, "success");
});
