import { formatSize } from "@earendil-works/pi-coding-agent";

export type ExtractKind = "html" | "text" | "json" | "pdf" | "image";

export type ExtractContent =
  | { type: "text"; text: string }
  | { type: "image"; data: string; mimeType: string };

export interface ExtractResponse {
  sourceUrl: string;
  finalUrl?: string;
  contentType: string;
  byteLength?: number;
  originalPdfPath?: string;
  failure?: { cause: unknown };
  stopReason?: string;
  pdfPages?: { total?: number; processed: number; accepted: number };
  content: ExtractContent[];
}

export function getExtractKind(contentType: string): ExtractKind | null {
  if (contentType === "text/html" || contentType === "application/xhtml+xml") {
    return "html";
  }

  if (contentType.startsWith("text/")) {
    return "text";
  }

  if (contentType.startsWith("image/")) {
    return "image";
  }

  if (contentType === "application/json") {
    return "json";
  }

  if (contentType === "application/pdf") {
    return "pdf";
  }

  return null;
}

export function limitExtractContent(
  result: ExtractResponse,
  maxBytes: number,
): ExtractResponse {
  const text = result.content
    .filter((item) => item.type === "text")
    .map((item) => item.text)
    .join("\n\n");
  if (Buffer.byteLength(text, "utf8") <= maxBytes) return result;
  const cause = new Error(
    `Converted text exceeds maxContentBytes (${formatSize(maxBytes)}). Increase it in pi-searxng.json if needed.`,
  );
  const preview =
    getExtractKind(result.contentType) === "json"
      ? ""
      : new TextDecoder().decode(Buffer.from(text).subarray(0, maxBytes), {
          stream: true,
        });
  return {
    ...result,
    failure: result.failure ?? { cause },
    content: [
      ...(preview ? [{ type: "text" as const, text: preview }] : []),
      ...result.content.filter((item) => item.type === "image"),
    ],
  };
}

export function truncateContent(
  content: string,
  maxChars: number,
  displayString: "..." | "verbose" = "...",
): string {
  if (content.length <= maxChars) return content;

  const display =
    displayString === "verbose"
      ? `\n\n[Content truncated at ${maxChars} characters]`
      : "...";

  return `${content.slice(0, maxChars)}${display}`;
}

export function getExtractTextLength(
  content: Array<{ type: string; text?: string }>,
): number {
  return content.reduce((sum, item) => {
    if (item.type !== "text") return sum;
    return sum + (item.text?.length ?? 0);
  }, 0);
}
