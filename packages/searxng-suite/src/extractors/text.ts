import { readResponseBody, type ResponseBody } from "../helpers/request";
import {
  type ExtractResponse,
  MAX_TEXT_BYTES,
  MAX_TEXT_CHARS,
  MAX_MARKDOWN_CHARS,
  truncateContent,
} from "./shared";

export async function extractPlainText(
  sourceUrl: string,
  contentType: string,
  res: ResponseBody,
  signal?: AbortSignal,
): Promise<ExtractResponse> {
  const raw = new TextDecoder().decode(
    await readResponseBody(res, MAX_TEXT_BYTES, signal),
  );

  if (raw.length > MAX_TEXT_CHARS) {
    throw new Error(
      `Text content too large after download: ${raw.length} characters`,
    );
  }

  const content = [
    `Source URL: ${sourceUrl}`,
    `Content-Type: ${contentType}`,
    "",
    "---",
    "",
    raw.trim(),
  ].join("\n");

  return {
    sourceUrl,
    contentType,
    content: [
      {
        type: "text" as const,
        text: truncateContent(content, MAX_MARKDOWN_CHARS, "verbose"),
      },
    ],
  };
}
