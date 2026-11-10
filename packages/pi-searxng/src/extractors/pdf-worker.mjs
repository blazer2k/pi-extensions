import { readFile } from "node:fs/promises";
import { on } from "node:events";
import { parentPort, workerData } from "node:worker_threads";
import { getDocumentProxy } from "unpdf";

const commands = on(parentPort, "message");
let document;
let failure;
try {
  const buffer = await readFile(workerData.path);
  document = await getDocumentProxy(
    new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength),
  );
  parentPort.postMessage({ type: "document", total: document.numPages });
  let number = 1;
  if (document.numPages > 0) {
    for await (const [_command] of commands) {
      const page = await document.getPage(number);
      try {
        const { items } = await page.getTextContent();
        const text = items
          .filter((item) => item.str != null)
          .map((item) => item.str + (item.hasEOL ? "\n" : ""))
          .join("");
        parentPort.postMessage({ type: "page", number, text });
        number++;
      } finally {
        await page.cleanup();
      }
      if (number > document.numPages) break;
    }
  }
} catch (cause) {
  failure = { cause };
} finally {
  await commands.return();
  try {
    await document?.destroy();
  } catch (cause) {
    failure ??= { cause };
  }
  if (failure) {
    let message;
    try {
      message =
        failure.cause instanceof Error
          ? failure.cause.message
          : String(failure.cause);
    } catch {
      message = "PDF conversion failed with an unreadable diagnostic";
    }
    parentPort.postMessage({ type: "error", message });
  } else {
    parentPort.postMessage({ type: "done" });
  }
  parentPort.close();
}
