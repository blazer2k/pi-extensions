import type {
  AgentToolResult,
  KeybindingHints,
  ToolRenderResultOptions,
  Theme,
} from "@earendil-works/pi-coding-agent";
import { formatSize } from "@earendil-works/pi-coding-agent";
import { Text, truncateToWidth } from "@earendil-works/pi-tui";
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
  return `${theme.fg("toolTitle", theme.bold(toolName))} ${query ?? ""}${category}`;
}

function getText(result: AgentToolResult<unknown>): string {
  return result.content
    .filter((item) => item.type === "text")
    .map((item) => item.text)
    .join("\n\n");
}

function styleOutput(text: string, theme: Theme): string {
  return text
    .split("\n")
    .map((line) => theme.fg("toolOutput", line))
    .join("\n");
}

function withExpandHint(
  summary: string,
  theme: Theme,
  keyHint: KeybindingHints["keyHint"],
): string {
  return (
    summary +
    theme.fg("muted", " \u00b7 ") +
    keyHint("app.tools.expand", "to expand")
  );
}

export function renderSearchResult(
  result: AgentToolResult<SearchToolDetails>,
  options: ToolRenderResultOptions,
  theme: Theme,
  keyHint: KeybindingHints["keyHint"],
): Text {
  const output = getText(result);
  const failure = getToolFailureStatus(result.details, theme);
  if (!options.expanded) {
    const summary = failure ?? buildSearchResultsSummary(result, theme);
    return new Text(
      output ? withExpandHint(summary, theme, keyHint) : summary,
      0,
      0,
    );
  }
  return new Text(
    output
      ? `\n${styleOutput(output, theme)}\n${keyHint("app.tools.expand", "to collapse")}`
      : (failure ?? ""),
    0,
    0,
  );
}

class FetchPreviewText extends Text {
  constructor(private readonly buildText: (width: number) => string) {
    super("", 0, 0);
  }
  override render(width: number): string[] {
    this.setText(this.buildText(width));
    return super.render(width);
  }
}

export function renderFetchResult(
  result: AgentToolResult<FetchToolDetails>,
  options: ToolRenderResultOptions,
  theme: Theme,
  limit: number,
  keyHint: KeybindingHints["keyHint"],
): Text {
  if (!options.expanded) {
    const summary =
      getToolFailureStatus(result.details, theme) ??
      buildFetchContentSummary(result, theme);
    const hasDetails = getText(result) || result.details.url;
    return new Text(
      hasDetails ? withExpandHint(summary, theme, keyHint) : summary,
      0,
      0,
    );
  }
  const text = getText(result);
  const bodyStart = result.details.bodyStart;
  const validStart =
    typeof bodyStart === "number" &&
    Number.isInteger(bodyStart) &&
    bodyStart >= 0 &&
    bodyStart <= text.length;
  const start = validStart ? bodyStart : 0;
  let metadata = text.slice(0, start);
  if (!validStart) {
    const details = result.details;
    metadata = [
      metadata,
      details.url ? `Source URL: ${details.url}` : "",
      details.finalUrl ? `Final URL: ${details.finalUrl}` : "",
      details.contentType ? `Content-Type: ${details.contentType}` : "",
      details.originalPdfPath
        ? `Original PDF: ${JSON.stringify(details.originalPdfPath)}`
        : "",
      details.fullOutputPath
        ? `${details.incomplete ? "Partial" : "Full"} output saved to: ${JSON.stringify(details.fullOutputPath)}`
        : "",
      details.stopReason ?? "",
    ]
      .filter(Boolean)
      .join("\n");
  }
  const body = text.slice(start);
  const lines = body ? body.split(/\r?\n/) : [];
  const omitted = limit === -1 ? 0 : Math.max(0, lines.length - limit);
  const head = omitted ? lines.slice(0, Math.ceil(limit / 2)) : lines;
  const tailCount = omitted ? Math.floor(limit / 2) : 0;
  const tail = tailCount ? lines.slice(-tailCount) : [];

  return new FetchPreviewText((width) => {
    const renderLine = (line: string) =>
      theme.fg(
        "toolOutput",
        limit === -1
          ? line
          : truncateToWidth(line.replace(/\t/g, "   "), width, "..."),
      );
    const output = [
      getToolFailureStatus(result.details, theme) ??
        buildFetchContentSummary(result, theme),
    ];
    if (metadata.trim()) output.push(styleOutput(metadata.trimEnd(), theme));
    if (lines.length && result.details.fullOutputPath)
      output.push(theme.fg("muted", "Returned text preview"));
    output.push(...head.map(renderLine));
    if (omitted)
      output.push(
        theme.fg("muted", `+${omitted} ${omitted === 1 ? "line" : "lines"}`),
      );
    output.push(...tail.map(renderLine));
    output.push(keyHint("app.tools.expand", "to collapse"));
    return output.join("\n");
  });
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

function isImageResult(result: AgentToolResult<FetchToolDetails>): boolean {
  return result.details.contentType?.startsWith("image/") ?? false;
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
