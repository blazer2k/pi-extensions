import { formatSize } from "@earendil-works/pi-coding-agent";
import { readResponseBody, type ResponseBody } from "../helpers/request";
import { MAX_IMAGE_BYTES, type ExtractResponse } from "./shared";

const SUPPORTED_IMAGE_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
]);

export async function extractImage(
  sourceUrl: string,
  contentType: string,
  res: ResponseBody,
  signal?: AbortSignal,
): Promise<ExtractResponse> {
  if (!SUPPORTED_IMAGE_TYPES.has(contentType)) {
    throw new Error(`Unsupported image type: ${contentType}`);
  }

  const buffer = await readResponseBody(res, MAX_IMAGE_BYTES, signal);
  const base64 = buffer.toString("base64");

  return {
    sourceUrl,
    contentType,
    byteLength: buffer.byteLength,
    content: [
      {
        type: "text" as const,
        text: [
          `Image extracted from ${sourceUrl}`,
          `Content-Type: ${contentType}`,
          `Size: ${formatSize(buffer.byteLength)}`,
        ].join("\n"),
      },
      {
        type: "image" as const,
        data: base64,
        mimeType: contentType,
      },
    ],
  };
}
