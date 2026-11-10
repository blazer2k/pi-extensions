import assert from "node:assert/strict";
import { beforeEach, afterEach, test } from "node:test";
import { randomUUID } from "node:crypto";
import { readFile, stat, readdir } from "node:fs/promises";
import { join, dirname } from "node:path";
import { setTimeout as wait } from "node:timers/promises";
import { Worker } from "node:worker_threads";
import { webFetch } from "../src/api/fetch.ts";
import { createExtractionDirectory } from "../src/helpers/extract-files.ts";
import { getDefaultConfig } from "../src/config/definition.ts";
import { state } from "./no-network.mjs";
import { tools, context, text } from "./helpers.mjs";

let workerExits;
beforeEach((t) => {
  workerExits = 0;
  const terminate = Worker.prototype.terminate;
  t.mock.method(Worker.prototype, "terminate", function (...args) {
    this.once("exit", () => workerExits++);
    return terminate.apply(this, args);
  });
  process.env.PI_SEARXNG_TEST_PDF = "1";
  state.fetch = undefined;
});
afterEach(() => {
  delete process.env.PI_SEARXNG_TEST_PDF;
  state.fetch = undefined;
});
async function run(spec, config = {}, signal) {
  const trace = join(process.env.TMPDIR, `worker-${randomUUID()}.log`);
  const bytes = Buffer.from(JSON.stringify({ ...spec, trace }));
  state.fetch = async () =>
    new Response(bytes, { headers: { "Content-Type": "application/pdf" } });
  const { fetch } = await tools({
    maxContentBytes: 100000,
    maxSessionStorageBytes: 200000,
    pdfProcessingTimeoutMs: 5000,
    ...config,
  });
  const result = await fetch.execute(
    "pdf",
    { url: "https://example.org/document.pdf" },
    signal,
    undefined,
    context(),
  );
  const exitsAtResult = workerExits;
  assert.deepEqual(await readFile(result.details.originalPdfPath), bytes);
  return { result, trace, bytes, exitsAtResult };
}
test("worker sees a fully published original; pages are sequential and cleaned up", async () => {
  const { result, trace } = await run({ pages: ["one", "", "three"] });
  assert.equal(result.isError, undefined);
  assert.deepEqual(result.details.pdfPages, {
    total: 3,
    processed: 3,
    accepted: 3,
  });
  assert.deepEqual((await readFile(trace, "utf8")).trim().split("\n"), [
    "load-original-ready",
    "start:1",
    "processed:1",
    "cleanup:1",
    "start:2",
    "processed:2",
    "cleanup:2",
    "start:3",
    "processed:3",
    "cleanup:3",
    "destroy",
  ]);
  const body = "Page 1\n\none\n\n---\n\nPage 2\n\n\n\n---\n\nPage 3\n\nthree";
  assert.equal(text(result).slice(result.details.bodyStart), body);
  assert.equal(result.details.textBytes, Buffer.byteLength(body));
  assert.equal(
    (await stat(result.details.originalPdfPath)).mode & 0o777,
    0o600,
  );
  assert.deepEqual(await readdir(dirname(result.details.originalPdfPath)), [
    "original.pdf",
  ]);
});
test("converted byte ceiling distinguishes processed from accepted and saves only accepted pages", async () => {
  const { result } = await run(
    { pages: ["accepted", 2000, "not processed"] },
    { maxContentBytes: 350 },
  );
  assert.equal(result.isError, true);
  assert.deepEqual(result.details.pdfPages, {
    total: 3,
    processed: 2,
    accepted: 1,
  });
  assert.match(result.details.fullOutputPath, /content\.partial\.txt$/);
  const saved = await readFile(result.details.fullOutputPath, "utf8");
  assert.match(saved, /Page 1\n\naccepted/);
  assert.doesNotMatch(saved, /Page 2|not processed/);
  assert.match(text(result), /2 processed of 3; text accepted for pages 1-1/);
  assert.match(text(result), /maxContentBytes/);
});
for (const failure of [
  { failPage: 2 },
  { undefinedPage: 2 },
  { failCleanup: 2 },
  { failDestroy: true },
])
  test(`worker failure remains native error and retains original/partial text ${JSON.stringify(failure)}`, async () => {
    const { result } = await run({ pages: ["first", "second"], ...failure });
    assert.equal(result.isError, true);
    assert.equal(result.details.status, "error");
    assert.equal(result.details.incomplete, true);
    assert.match(result.details.fullOutputPath, /\.partial\.txt$/);
    assert.match(
      await readFile(result.details.fullOutputPath, "utf8"),
      /first/,
    );
  });
test("early worker exit has unknown total and preserves the original", async () => {
  const { result } = await run({ pages: [], exit: 0 });
  assert.equal(result.isError, true);
  assert.deepEqual(result.details.pdfPages, { processed: 0, accepted: 0 });
  assert.match(text(result), /PDF worker exited before completion/);
  assert.equal(result.details.fullOutputPath, undefined);
});
for (const mode of ["busyPage", "stuckPage", "busyLoad"])
  test(
    `deadline actively terminates and awaits ${mode} worker`,
    { timeout: 10000 },
    async () => {
      const spec = {
        pages: ["accepted", "blocked"],
        [mode]: mode === "busyLoad" ? true : 2,
      };
      const { result, trace, exitsAtResult } = await run(spec, {
        timeoutMs: 1000,
        pdfProcessingTimeoutMs: 2000,
      });
      assert.equal(result.isError, true);
      assert.match(text(result), /pdfProcessingTimeoutMs/);
      assert.equal(
        exitsAtResult,
        1,
        "actual worker exit must precede the tool result",
      );
      const stopped = await readFile(trace, "utf8");
      assert.match(
        stopped,
        /tick/,
        "fixture must actually be running before interruption",
      );
      assert.match(stopped, /load-original-ready/);
      assert.equal(
        result.details.pdfPages.accepted,
        mode === "busyLoad" ? 0 : 1,
      );
      assert.equal(
        result.details.pdfPages.total,
        mode === "busyLoad" ? undefined : 2,
      );
    },
  );
test(
  "mid-conversion custom cancellation terminates worker but keeps completed original",
  { timeout: 10000 },
  async () => {
    const controller = new AbortController();
    const reason = { toString: assert.fail };
    const trace = join(process.env.TMPDIR, `cancel-${randomUUID()}.log`);
    const bytes = Buffer.from(
      JSON.stringify({ pages: ["first", "stuck"], stuckPage: 2, trace }),
    );
    state.fetch = async () =>
      new Response(bytes, { headers: { "Content-Type": "application/pdf" } });
    const { fetch } = await tools({ pdfProcessingTimeoutMs: 8000 });
    const pending = fetch.execute(
      "cancel",
      { url: "https://example.org/pdf" },
      controller.signal,
      undefined,
      context(),
    );
    const limit = Date.now() + 5000;
    let result, exitsAtResult;
    try {
      while (true) {
        const log = await readFile(trace, "utf8").catch(() => "");
        if (log.includes("tick")) break;
        assert(
          Date.now() < limit,
          "worker did not reach the asynchronous stall",
        );
        await wait(10);
      }
      controller.abort(reason);
      result = await pending;
      exitsAtResult = workerExits;
    } finally {
      controller.abort(reason);
      await pending;
    }
    assert.equal(result.details.status, "aborted");
    assert.equal(result.isError, true);
    assert.deepEqual(await readFile(result.details.originalPdfPath), bytes);
    assert.equal(exitsAtResult, 1, "cancel must await actual worker exit");
    assert.equal(result.details.fullOutputPath, undefined);
  },
);
test(
  "PDF completion awaits the termination promise, independently of later file IO",
  { timeout: 10000 },
  async (t) => {
    const entered = Promise.withResolvers(),
      release = Promise.withResolvers();
    const terminate = Worker.prototype.terminate;
    t.mock.method(Worker.prototype, "terminate", function (...args) {
      const completed = terminate.apply(this, args);
      entered.resolve();
      return completed.then(() => release.promise);
    });
    const trace = join(process.env.TMPDIR, `termination-${randomUUID()}.log`);
    state.fetch = async () =>
      new Response(JSON.stringify({ pages: ["complete"], trace }), {
        headers: { "Content-Type": "application/pdf" },
      });
    const pending = webFetch("https://example.org/pdf", {
      ...getDefaultConfig(),
      pdfProcessingTimeoutMs: 5000,
      getOutputDirectory: () => createExtractionDirectory(randomUUID()),
    });
    let settled = false;
    pending.then(
      () => {
        settled = true;
      },
      () => {
        settled = true;
      },
    );
    try {
      await Promise.race([
        entered.promise,
        pending.then(() => assert.fail("PDF returned without terminating")),
      ]);
      await new Promise((resolve) => setImmediate(resolve));
      assert.equal(
        settled,
        false,
        "PDF must not return while its termination promise is pending",
      );
    } finally {
      release.resolve();
      await pending;
    }
  },
);
test("no page cap and large accepted PDF text can spill beside its original", async () => {
  const { result } = await run({ pages: Array(100).fill(600) });
  assert.equal(result.details.status, "success");
  assert.deepEqual(result.details.pdfPages, {
    total: 100,
    processed: 100,
    accepted: 100,
  });
  assert.equal(
    dirname(result.details.originalPdfPath),
    dirname(result.details.fullOutputPath),
  );
  assert.match(
    await readFile(result.details.fullOutputPath, "utf8"),
    /Page 100/,
  );
  assert.equal(result.details.truncation.truncated, true);
});
for (const name of ["readable", "image-only", "invalid"])
  test(`actual unpdf worker handles ${name} bytes (no converter/network)`, async () => {
    delete process.env.PI_SEARXNG_TEST_PDF;
    const bytes =
      name === "invalid"
        ? Buffer.from("not a PDF")
        : await readFile(new URL(`./fixtures/${name}.pdf`, import.meta.url));
    state.fetch = async () =>
      new Response(bytes, { headers: { "Content-Type": "application/pdf" } });
    const { fetch } = await tools();
    const result = await fetch.execute(
      "real-pdf",
      { url: "https://example.org/pdf" },
      undefined,
      undefined,
      context(),
    );
    assert.deepEqual(await readFile(result.details.originalPdfPath), bytes);
    assert.equal(result.isError === true, name === "invalid");
    if (name === "readable") {
      assert.match(text(result), /OFFLINE_PDF_FIXTURE/);
      assert.equal(
        result.details.pdfPages.accepted,
        result.details.pdfPages.total,
      );
      assert(result.details.textBytes > 0);
    }
    if (name === "image-only") {
      assert.match(
        text(result),
        /No readable text was extracted\. This does not mean the PDF is empty/,
      );
      assert.equal(result.details.textBytes, 0);
      assert.equal(result.details.textLines, 0);
    }
  });
