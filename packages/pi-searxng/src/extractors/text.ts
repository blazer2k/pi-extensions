import { readResponseBody, type ResponseBody } from "../helpers/request";
import type { ExtractResponse } from "./shared";

export async function extractPlainText(
  sourceUrl: string,
  contentType: string,
  res: ResponseBody,
  maxBytes: number,
  signal?: AbortSignal,
): Promise<ExtractResponse> {
  const raw = new TextDecoder().decode(
    await readResponseBody(res, maxBytes, signal),
  );

  const content = [
    `Source URL: ${sourceUrl}`,
    `Content-Type: ${contentType}`,
    "",
    "---",
    "",
    raw,
  ].join("\n");

  return {
    sourceUrl,
    contentType,
    bodyStart: content.length - raw.length,
    content: [{ type: "text", text: content }],
  };
}
