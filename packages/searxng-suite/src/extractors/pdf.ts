import { join } from "node:path";
import { on } from "node:events";
import { Worker } from "node:worker_threads";
import { formatSize, truncateHead } from "@earendil-works/pi-coding-agent";
import {
  checkResponseSize,
  createTimeoutSignal,
  readResponseChunks,
  type ResponseBody,
} from "../helpers/request";
import {
  removeEmptyExtractionDirectory,
  writeExtractionFile,
} from "../helpers/extract-files";
import type { ExtractResponse } from "./shared";

interface PdfOptions {
  maxContentBytes: number;
  maxSessionStorageBytes: number;
  pdfProcessingTimeoutMs: number;
  stopDownloadTimeout?: () => void;
  finalUrl?: string;
}

type PdfMessage =
  | { type: "document"; total: number }
  | { type: "page"; number: number; text: string }
  | { type: "error"; message: string }
  | { type: "done" };

async function collectPdfPages(
  worker: Worker,
  result: ExtractResponse,
  maxBytes: number,
  duration: number,
  processingSignal: AbortSignal,
  deadline: number,
  signal?: AbortSignal,
) {
  const pages: string[] = [];
  const progress = result.pdfPages!;
  let header = "";
  let bytes = 0;
  let trailingBytes = 0;
  let readable = false;
  let completed = false;
  const expired = () => {
    result.stopReason = `PDF processing reached pdfProcessingTimeoutMs (${duration} ms). Increase it in pi-searxng.json if needed.`;
    return new DOMException(result.stopReason, "TimeoutError");
  };
  const checkDeadline = () => {
    signal?.throwIfAborted();
    if (processingSignal.aborted || performance.now() >= deadline)
      throw expired();
  };
  const sizeLimit = () =>
    new Error(
      `Converted PDF text reached maxContentBytes (${formatSize(maxBytes)}). Increase it in pi-searxng.json if needed.`,
    );
  try {
    const messages = on(worker, "message", {
      signal: processingSignal,
      close: ["exit"],
    }) as AsyncIterable<[PdfMessage]>;
    for await (const [message] of messages) {
      checkDeadline();
      if (message.type === "error") throw new Error(message.message);
      if (message.type === "done") {
        completed = true;
        break;
      }
      if (message.type === "document") {
        progress.total = message.total;
        header = [
          ...(result.finalUrl ? [`Final URL: ${result.finalUrl}`] : []),
          `Source URL: ${result.sourceUrl}`,
          `Content-Type: ${result.contentType}`,
          `Pages: ${message.total}`,
          "",
          "---",
          "",
          "",
        ].join("\n");
        bytes = Buffer.byteLength(header);
      } else {
        progress.processed = message.number;
        const text = message.text.trim();
        const page = `Page ${message.number}\n\n${text}`;
        const tail = text ? 0 : 2;
        const size =
          trailingBytes +
          (pages.length ? 7 : 0) +
          Buffer.byteLength(page) -
          tail;
        if (size > maxBytes - bytes) throw sizeLimit();
        pages.push(page);
        readable ||= Boolean(text);
        bytes += size;
        trailingBytes = tail;
        progress.accepted++;
      }
      if (progress.processed < progress.total!) {
        checkDeadline();
        const minimum =
          trailingBytes +
          (pages.length ? 7 : 0) +
          Buffer.byteLength(`Page ${progress.processed + 1}`);
        if (bytes + minimum > maxBytes) throw sizeLimit();
        worker.postMessage("next");
      }
    }
    if (!completed) throw new Error("PDF worker exited before completion");
  } catch (cause) {
    result.failure = {
      cause: signal?.aborted
        ? signal.reason
        : processingSignal.aborted
          ? expired()
          : cause,
    };
  }
  return { header, pages, readable };
}

async function convertPdf(
  result: ExtractResponse,
  maxBytes: number,
  duration: number,
  signal?: AbortSignal,
) {
  const timeout = createTimeoutSignal(duration, signal);
  const deadline = performance.now() + duration;
  result.pdfPages = { processed: 0, accepted: 0 };
  let worker: Worker | undefined;
  let converted = { header: "", pages: [] as string[], readable: false };
  try {
    timeout.signal.throwIfAborted();
    worker = new Worker(new URL("./pdf-worker.mjs", import.meta.url), {
      workerData: { path: result.originalPdfPath },
      stdout: true,
      stderr: true,
      execArgv: process.execArgv.filter(
        (arg, index, args) =>
          arg !== "--input-type" &&
          !arg.startsWith("--input-type=") &&
          args[index - 1] !== "--input-type",
      ),
    });
    // Handle late errors until the iterator closes and termination completes.
    worker.on("error", () => {});
    worker.stdout.resume();
    worker.stderr.resume();
    converted = await collectPdfPages(
      worker,
      result,
      maxBytes,
      duration,
      timeout.signal,
      deadline,
      signal,
    );
  } catch (cause) {
    result.failure = { cause: signal?.aborted ? signal.reason : cause };
  } finally {
    try {
      await worker?.terminate();
      worker?.removeAllListeners();
    } finally {
      timeout.cleanup();
    }
  }
  const { header, pages, readable } = converted;
  if (signal?.aborted) result.failure = { cause: signal.reason };
  const body =
    !result.failure && !readable
      ? "No readable text was extracted. This does not mean the PDF is empty."
      : pages.join("\n\n---\n\n").trim();
  if (body) {
    if (Buffer.byteLength(header + body) > maxBytes) {
      result.failure ??= {
        cause: new Error(
          `Converted PDF text exceeds maxContentBytes (${formatSize(maxBytes)}). Increase it in pi-searxng.json if needed.`,
        ),
      };
    } else {
      result.content = [{ type: "text", text: header + body }];
    }
  }
}

export async function extractPdf(
  sourceUrl: string,
  contentType: string,
  res: ResponseBody,
  getOutputDirectory: () => Promise<string>,
  options: PdfOptions,
  signal?: AbortSignal,
): Promise<ExtractResponse> {
  const maxBytes = options.maxContentBytes;
  try {
    checkResponseSize(res, maxBytes);
  } catch (error) {
    const reader = res.body?.getReader();
    void reader?.cancel().catch(() => {});
    reader?.releaseLock();
    throw error;
  }
  signal?.throwIfAborted();
  const directory = await getOutputDirectory();
  const originalPdfPath = join(directory, "original.pdf");
  if (
    truncateHead(`Original PDF: ${JSON.stringify(originalPdfPath)}`).truncated
  ) {
    await removeEmptyExtractionDirectory(directory);
    throw new Error("Original PDF path exceeds the inline limits");
  }
  const byteLength = await writeExtractionFile(
    originalPdfPath,
    readResponseChunks(res, maxBytes, signal),
    options.maxSessionStorageBytes,
    signal,
  );
  options.stopDownloadTimeout?.();
  const result: ExtractResponse = {
    sourceUrl,
    contentType,
    byteLength,
    originalPdfPath,
    ...(options.finalUrl && { finalUrl: options.finalUrl }),
    content: [],
  };
  await convertPdf(result, maxBytes, options.pdfProcessingTimeoutMs, signal);
  return result;
}
