import type {
  AgentToolResult,
  KeybindingHints,
  ToolRenderResultOptions,
  Theme,
} from "@earendil-works/pi-coding-agent";
import { formatSize } from "@earendil-works/pi-coding-agent";
import { stripTerminalSequences } from "@earendil-works/pi-tui";
import type {
  ToolStatus,
  SearchToolDetails,
  FetchToolDetails,
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

function isImageResult(result: AgentToolResult<FetchToolDetails>): boolean {
  return result.details.contentType?.startsWith("image/") ?? false;
}

export function buildToolTextOutput(
  result: AgentToolResult<FetchToolDetails | SearchToolDetails>,
  options: ToolRenderResultOptions,
  theme: Theme,
  keyHint: KeybindingHints["keyHint"],
  maxCollapsedLines = 20,
  maxCollapsedChars = 1500,
): string {
  const output = result.content
    .filter((c) => c.type === "text")
    .map((c) => c.text)
    .join("\n\n");

  if (!output) return "";

  let preview = output;
  if (!options.expanded) {
    preview = output
      .split("\n")
      .slice(0, maxCollapsedLines)
      .join("\n")
      .slice(0, maxCollapsedChars);
    if (preview.length < output.length) {
      // Back up if the cutoff split a terminal escape sequence.
      while (stripTerminalSequences(preview).includes("\x1b")) {
        preview = preview.slice(0, preview.lastIndexOf("\x1b"));
      }
      // Do not leave half of a UTF-16 surrogate pair at the cutoff.
      preview = preview.replace(/[\uD800-\uDBFF]$/, "");
    }
  }
  let text = `\n${preview
    .split("\n")
    .map((line) => theme.fg("toolOutput", line))
    .join("\n")}`;
  const hiddenChars = output.length - preview.length;
  if (hiddenChars > 0) {
    text += `${theme.fg("muted", `\n... (${hiddenChars} more chars,`)} ${keyHint("app.tools.expand", "to expand")})`;
  }
  return text;
}

export function buildToolResultText<
  T extends SearchToolDetails | FetchToolDetails,
>(
  result: AgentToolResult<T>,
  options: ToolRenderResultOptions,
  theme: Theme,
  verbose: boolean,
  summarize: (result: AgentToolResult<T>, theme: Theme) => string,
  keyHint: KeybindingHints["keyHint"],
): string {
  return (
    getToolFailureStatus(result.details, theme) ??
    (verbose
      ? buildToolTextOutput(result, options, theme, keyHint)
      : summarize(result, theme))
  );
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

export function buildFetchContentSummary(
  result: AgentToolResult<FetchToolDetails>,
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
