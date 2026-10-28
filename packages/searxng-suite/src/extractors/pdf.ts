import { join } from "node:path";
import { truncateHead } from "@earendil-works/pi-coding-agent";
import { extractText, getDocumentProxy } from "unpdf";
import { readResponseBody, type ResponseBody } from "../helpers/request";
import {
  removeEmptyExtractionDirectory,
  writeExtractionFile,
} from "../helpers/extract-files";
import { MAX_PDF_BYTES, type ExtractResponse } from "./shared";

async function saveOriginalPdf(
  buffer: Uint8Array,
  getOutputDirectory: () => Promise<string>,
  signal?: AbortSignal,
): Promise<string> {
  const directory = await getOutputDirectory();
  const path = join(directory, "original.pdf");
  if (truncateHead(`Original PDF: ${JSON.stringify(path)}`).truncated) {
    await removeEmptyExtractionDirectory(directory);
    throw new Error("Original PDF path exceeds the inline limits");
  }
  await writeExtractionFile(path, buffer, signal);
  return path;
}

export async function extractPdf(
  sourceUrl: string,
  contentType: string,
  res: ResponseBody,
  getOutputDirectory: () => Promise<string>,
  signal?: AbortSignal,
): Promise<ExtractResponse> {
  const buffer = await readResponseBody(res, MAX_PDF_BYTES, signal);
  const originalPdfPath = await saveOriginalPdf(
    buffer,
    getOutputDirectory,
    signal,
  );
  const result: ExtractResponse = {
    sourceUrl,
    contentType,
    byteLength: buffer.byteLength,
    originalPdfPath,
    content: [],
  };
  let pdf: Awaited<ReturnType<typeof getDocumentProxy>> | undefined;
  try {
    signal?.throwIfAborted();
    pdf = await getDocumentProxy(new Uint8Array(buffer));
    signal?.throwIfAborted();
    const { totalPages, text } = await extractText(pdf, { mergePages: false });
    signal?.throwIfAborted();
    const pages = Array.isArray(text) ? text : [text];
    const body = pages.some((page) => page.trim())
      ? pages
          .map((pageText, index) =>
            [`Page ${index + 1}`, "", pageText.trim()].join("\n"),
          )
          .join("\n\n---\n\n")
          .trim()
      : "No readable text was extracted. This does not mean the PDF is empty.";
    result.content = [
      {
        type: "text",
        text: [
          `Source URL: ${sourceUrl}`,
          `Content-Type: ${contentType}`,
          `Pages: ${totalPages}`,
          "",
          "---",
          "",
          body,
        ].join("\n"),
      },
    ];
  } catch (cause) {
    result.failure = { cause: signal?.aborted ? signal.reason : cause };
  } finally {
    try {
      await pdf?.destroy();
    } catch (cause) {
      result.failure ??= { cause };
    }
  }
  if (signal?.aborted) result.failure = { cause: signal.reason };
  return result;
}
