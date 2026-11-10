import assert from "node:assert/strict";
import { test } from "node:test";
import { state, blocked } from "./no-network.mjs";
import dns from "node:dns";
import promiseDns from "node:dns/promises";
import { randomUUID } from "node:crypto";
import { createExtractionDirectory } from "../src/helpers/extract-files.ts";
import { tools } from "./helpers.mjs";
import {
  readResponseBody,
  readResponseChunks,
  createTimeoutSignal,
} from "../src/helpers/request.ts";
import { webFetch } from "../src/api/fetch.ts";
import { getDefaultConfig } from "../src/config/definition.ts";

for (const [declared, chunks, limit, allowed] of [
  [undefined, ["ab", "cd"], 4, true],
  [undefined, ["ab", "cde"], 4, false],
  ["5", ["ab"], 4, false],
  ["2", ["ab", "cde"], 4, false],
  [undefined, ["\u00e9", "\ud83d\ude00"], 6, true],
  [undefined, ["\u00e9", "\ud83d\ude00"], 5, false],
])
  test(`bounded reader declared=${declared} actual=${Buffer.byteLength(chunks.join(""))} max=${limit}`, async () => {
    let cancelled = 0;
    const res = new Response(
      new ReadableStream({
        start(controller) {
          for (const text of chunks) controller.enqueue(Buffer.from(text));
          if (allowed) controller.close();
        },
        cancel() {
          cancelled++;
        },
      }),
      { headers: declared ? { "content-length": declared } : {} },
    );
    if (allowed)
      assert.equal(
        (await readResponseBody(res, limit)).toString(),
        chunks.join(""),
      );
    else {
      await assert.rejects(readResponseBody(res, limit), /maxContentBytes/);
      assert.equal(cancelled, 1);
    }
    assert.equal(res.body.locked, false);
  });
test("chunk iterator applies backpressure and cleans up an early consumer return", async () => {
  let produced = 0,
    cancelled = 0;
  const res = new Response(
    new ReadableStream({
      pull(controller) {
        produced++;
        controller.enqueue(Buffer.from("chunk"));
      },
      cancel() {
        cancelled++;
      },
    }),
  );
  const iterator = readResponseChunks(res, 1000);
  assert.equal((await iterator.next()).value.toString(), "chunk");
  await new Promise((resolve) => setImmediate(resolve));
  assert(produced <= 2, "only the consumed chunk plus one native queued chunk");
  await iterator.return();
  assert.equal(cancelled, 1);
  assert.equal(res.body.locked, false);
});
test("pre-abort preserves arbitrary reason identity and releases reader", async () => {
  const reason = { toString: assert.fail };
  const controller = new AbortController();
  controller.abort(reason);
  const res = new Response(new ReadableStream({ cancel() {} }));
  await assert.rejects(
    readResponseBody(res, 100, controller.signal),
    (value) => value === reason,
  );
  assert.equal(res.body.locked, false);
});
for (const type of [
  "text/plain",
  "text/html",
  "application/json",
  "image/png",
  "application/pdf",
])
  test(
    `deadline remains active while ${type} body stalls after headers`,
    { timeout: 3000 },
    async () => {
      let cancelled = 0;
      let res;
      state.fetch = async () =>
        (res = new Response(
          new ReadableStream({
            cancel() {
              cancelled++;
              return new Promise(() => {});
            },
          }),
          { headers: { "Content-Type": type } },
        ));
      await assert.rejects(
        webFetch("https://example.org/stalled", {
          ...getDefaultConfig(),
          timeoutMs: 40,
          getOutputDirectory: () => createExtractionDirectory(randomUUID()),
        }),
        (error) => error.name === "TimeoutError",
      );
      assert.equal(cancelled, 1);
      assert.equal(res.body.locked, false);
      state.fetch = undefined;
    },
  );
test(
  "mid-body arbitrary cancellation wins without stringification or slow cleanup wait",
  { timeout: 3000 },
  async () => {
    const controller = new AbortController();
    const reason = { toString: assert.fail };
    let cancelled;
    const res = new Response(
      new ReadableStream({
        cancel(value) {
          cancelled = value;
          return new Promise(() => {});
        },
      }),
    );
    const read = readResponseBody(res, 100, controller.signal);
    controller.abort(reason);
    await assert.rejects(read, (value) => value === reason);
    assert.equal(cancelled, reason);
    assert.equal(res.body.locked, false);
  },
);
test(
  "search deadline includes reading JSON after headers",
  { timeout: 3000 },
  async () => {
    const { search } = await tools({ timeoutMs: 1000 });
    state.fetch = async (_url, { signal }) => ({
      ok: true,
      json: () =>
        new Promise((_resolve, reject) =>
          signal.addEventListener("abort", () => reject(signal.reason), {
            once: true,
          }),
        ),
    });
    const result = await search.execute("body-deadline", { query: "offline" });
    assert.equal(result.isError, true);
    assert.equal(result.details.status, "error");
    assert.equal(result.content[0].text, "Search timed out");
    state.fetch = undefined;
  },
);
test("offline DNS guard blocks promise, resolve, reverse and resolver-instance entrypoints", () => {
  for (const target of [
    dns,
    promiseDns,
    dns.Resolver.prototype,
    promiseDns.Resolver.prototype,
  ]) {
    for (const name of Object.getOwnPropertyNames(target).filter(
      (name) =>
        name === "lookup" ||
        name === "lookupService" ||
        name === "reverse" ||
        name.startsWith("resolve"),
    )) {
      if (target === dns && name === "lookup") continue;
      assert.equal(target[name], blocked, `unguarded DNS entrypoint ${name}`);
      assert.throws(
        () => target[name]("offline.invalid"),
        /Unexpected network access/,
      );
    }
  }
});
test("stopping download deadline leaves parent cancellation active", async () => {
  const parent = new AbortController();
  const timeout = createTimeoutSignal(1, parent.signal);
  timeout.stopTimer();
  await new Promise((resolve) => setTimeout(resolve, 15));
  assert.equal(timeout.signal.aborted, false);
  parent.abort("parent");
  assert.equal(timeout.signal.reason, "parent");
  timeout.cleanup();
});
