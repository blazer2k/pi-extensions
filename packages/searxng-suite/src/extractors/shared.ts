export const MAX_TEXT_BYTES = 1024 * 1024;
export const MAX_TEXT_CHARS = 500_000;
export const MAX_HTML_BYTES = 2 * 1024 * 1024;
export const MAX_HTML_CHARS = 1_000_000;
export const MAX_PDF_BYTES = 50 * 1024 * 1024;
export const MAX_IMAGE_BYTES = 50 * 1024 * 1024;

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
