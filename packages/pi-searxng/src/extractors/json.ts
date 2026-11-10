import { readResponseBody, type ResponseBody } from "../helpers/request";
import type { ExtractResponse } from "./shared";

export async function extractJson(
  sourceUrl: string,
  contentType: string,
  res: ResponseBody,
  maxBytes: number,
  signal?: AbortSignal,
): Promise<ExtractResponse> {
  const buffer = await readResponseBody(res, maxBytes, signal);
  let raw: string;
  try {
    raw = new TextDecoder("utf-8", { fatal: true }).decode(buffer);
    // Validate without reserializing numbers, keys, or escapes.
    JSON.parse(raw);
  } catch (error) {
    throw new Error("Invalid JSON response: expected valid UTF-8 JSON", {
      cause: error,
    });
  }

  signal?.throwIfAborted();
  return {
    sourceUrl,
    contentType,
    byteLength: buffer.byteLength,
    content: [{ type: "text", text: raw }],
  };
}
