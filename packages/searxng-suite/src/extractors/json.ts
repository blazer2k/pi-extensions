import { readResponseBody, type ResponseBody } from "../helpers/request";
import { MAX_TEXT_BYTES, type ExtractResponse } from "./shared";

export async function extractJson(
  sourceUrl: string,
  contentType: string,
  res: ResponseBody,
  signal?: AbortSignal,
): Promise<ExtractResponse> {
  const buffer = await readResponseBody(res, MAX_TEXT_BYTES, signal);
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

  return {
    sourceUrl,
    contentType,
    byteLength: buffer.byteLength,
    content: [{ type: "text", text: raw }],
  };
}
