import type {
  AgentToolResult,
  ToolRenderResultOptions,
  Theme,
} from "@earendil-works/pi-coding-agent";
import { formatSize, keyHint } from "@earendil-works/pi-coding-agent";
import type {
  ToolStatus,
  SearchToolDetails,
  ExtractToolDetails,
} from "../tools/types";
import { getExtractTextLength } from "../extractors/shared";

interface ToolStatusDetails {
  status: ToolStatus;
  error?: string;
}

export function getToolFailureStatus(
  details: ToolStatusDetails,
  theme: Theme,
): string | null {
  if (details.status === "error") {
    return theme.fg("error", `${details.error || "Unknown error"}`);
  }

  if (details.status === "aborted") {
    return theme.fg("muted", "Aborted");
  }

  return null;
}

export function getApproxTokens(charCount: number): string {
  const rawTokenCount = Math.ceil(charCount / 4);

  const tokenCount =
    rawTokenCount < 1000 ? rawTokenCount : Math.ceil(rawTokenCount / 100) * 100;

  return tokenCount < 1000 ? tokenCount.toString() : `${tokenCount / 1000}k`;
}

export function buildToolCallText(
  toolName: string,
  query: string,
  theme: Theme,
  searchCategory?: string,
): string {
  const category =
    searchCategory && searchCategory !== "general"
      ? ` ${theme.fg("dim", `(${searchCategory})`)}`
      : "";

  return `${theme.fg("toolTitle", toolName)} ${query ?? ""}${category}`;
}

function isImageResult(result: AgentToolResult<ExtractToolDetails>): boolean {
  return result.details.contentType?.startsWith("image/") ?? false;
}

export function buildToolTextOutput(
  result: AgentToolResult<ExtractToolDetails | SearchToolDetails>,
  options: ToolRenderResultOptions,
  theme: Theme,
  maxCollapsedLines = 20,
  maxCollapsedChars = 1500,
): string {
  const output = result.content
    .filter((c) => c.type === "text")
    .map((c) => c.text)
    .join("\n\n");

  if (!output) return "";

  if (!options.expanded && output.length > maxCollapsedChars) {
    const collapsed = output.slice(0, maxCollapsedChars);
    const hiddenChars = output.length - maxCollapsedChars;

    return (
      `\n${collapsed
        .split("\n")
        .map((line) => theme.fg("toolOutput", line))
        .join("\n")}` +
      `${theme.fg("muted", `\n... (${hiddenChars} more chars,`)} ${keyHint("app.tools.expand", "to expand")})`
    );
  }
  const lines = output.split("\n");
  const maxLines = options.expanded ? lines.length : maxCollapsedLines;
  const displayLines = lines.slice(0, maxLines);
  const remainingLines = lines.length - maxLines;

  let text = `\n${displayLines.map((line) => theme.fg("toolOutput", line)).join("\n")}`;

  if (remainingLines > 0) {
    text += `${theme.fg("muted", `\n... (${remainingLines} more lines,`)} ${keyHint("app.tools.expand", "to expand")})`;
  }

  return text;
}

export function buildSearchResultsSummary(
  result: AgentToolResult<SearchToolDetails>,
  theme: Theme,
): string {
  const resultCount = result.details.resultCount ?? 0;
  return theme.fg(
    "dim",
    resultCount !== 0 ? `${resultCount} results` : "No results",
  );
}

export function buildExtractContentSummary(
  result: AgentToolResult<ExtractToolDetails>,
  theme: Theme,
): string {
  if (isImageResult(result)) {
    const format = result.details.contentType?.split("/")[1] ?? "";
    const sizeText =
      result.details.byteLength === undefined
        ? ""
        : `: ${formatSize(result.details.byteLength)}`;

    return theme.fg("dim", `Image attached (.${format})${sizeText}`);
  }

  const textLength = getExtractTextLength(result.content);

  if (textLength === 0) {
    return theme.fg("dim", "Empty");
  }

  return theme.fg(
    "dim",
    `${textLength} chars (~${getApproxTokens(textLength)} tokens)`,
  );
}
