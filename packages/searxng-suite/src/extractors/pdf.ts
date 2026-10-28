import { extractText, getDocumentProxy } from "unpdf";
import { readResponseBody, type ResponseBody } from "../helpers/request";
import { MAX_PDF_BYTES, type ExtractResponse } from "./shared";

export async function extractPdf(
  sourceUrl: string,
  contentType: string,
  res: ResponseBody,
  signal?: AbortSignal,
): Promise<ExtractResponse> {
  const buffer = await readResponseBody(res, MAX_PDF_BYTES, signal);

  const pdf = await getDocumentProxy(new Uint8Array(buffer));
  const { totalPages, text } = await extractText(pdf, { mergePages: false });

  const pages = Array.isArray(text) ? text : [text];

  const body = pages
    .map((pageText, index) =>
      [`Page ${index + 1}`, "", pageText.trim()].join("\n"),
    )
    .join("\n\n---\n\n");

  const content = [
    `Source URL: ${sourceUrl}`,
    `Content-Type: ${contentType}`,
    `Pages: ${totalPages}`,
    "",
    "---",
    "",
    body.trim(),
  ].join("\n");

  return {
    sourceUrl,
    contentType,
    byteLength: buffer.byteLength,
    content: [
      {
        type: "text",
        text: content,
      },
    ],
  };
}
