import { appendFile, access } from "node:fs/promises";
import { openSync, writeSync } from "node:fs";
import { workerData } from "node:worker_threads";

export async function getDocumentProxy(data) {
  const spec = JSON.parse(Buffer.from(data).toString());
  const log = async (value) => {
    if (spec.trace) await appendFile(spec.trace, value + "\n");
  };
  await access(workerData.path);
  try {
    await access(workerData.path + ".part");
    throw new Error("Original PDF still unfinished at parser entry");
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  await log("load-original-ready");
  const stuck = async (busy) => {
    const fd = openSync(spec.trace, "a");
    if (busy) {
      let n = 0;
      for (;;) if (++n % 1000000 === 0) writeSync(fd, "tick\n");
    }
    setInterval(() => writeSync(fd, "tick\n"), 10);
    await new Promise(() => {});
  };
  if (spec.exit !== undefined) process.exit(spec.exit);
  if (spec.busyLoad) await stuck(true);
  return {
    numPages: spec.pages.length,
    async getPage(number) {
      await log(`start:${number}`);
      return {
        async getTextContent() {
          if (spec.busyPage === number || spec.stuckPage === number)
            await stuck(spec.busyPage === number);
          if (spec.failPage === number) throw new Error("PAGE_FAILURE");
          if (spec.undefinedPage === number) throw undefined;
          await log(`processed:${number}`);
          const page = spec.pages[number - 1];
          return {
            items: [
              {
                str: typeof page === "number" ? "x".repeat(page) : page,
                hasEOL: false,
              },
            ],
          };
        },
        async cleanup() {
          await log(`cleanup:${number}`);
          if (spec.failCleanup === number) throw new Error("CLEANUP_FAILURE");
        },
      };
    },
    async destroy() {
      await log("destroy");
      if (spec.failDestroy) throw new Error("DESTROY_FAILURE");
    },
  };
}
