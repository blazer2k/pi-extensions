import type {
  KeybindingHints,
  Theme,
  ToolRenderResultOptions,
} from "@earendil-works/pi-coding-agent";
import {
  buildResultStatusParts,
  buildToolExpansionHint,
} from "../rendering/state";
import { formatSimpleErrorResult } from "../rendering/results";
import {
  countLines,
  extractTextContent,
  sanitizeDisplayText,
} from "../rendering/text";
import { formatTreeLine, getTreeEndPrefix } from "../rendering/tree";
import type { ResultStatusState, ToolTextResult } from "../rendering/types";

function stripReadContinuationNotice(text: string): string {
  const normalized = text.endsWith("\n") ? text.slice(0, -1) : text;
  const footerStart = normalized.lastIndexOf("\n\n[");
  if (footerStart === -1) return normalized;

  const footer = normalized.slice(footerStart + 2);
  const isContinuation =
    /^\[\d+ more lines? in file\. Use offset=\d+ to continue\.\]$/.test(
      footer,
    ) ||
    /^\[Showing lines \d+-\d+ of \d+(?: \([^)]+ limit\))?\. Use offset=\d+ to continue\.\]$/.test(
      footer,
    );
  return isContinuation
    ? normalized.slice(0, footerStart).trimEnd()
    : normalized;
}

function getImageReadMarker(text: string): { reason?: string } | undefined {
  const match = text.match(/^Read image file \[[^\]]+\](?:\n([\s\S]*))?$/);
  if (!match) return undefined;

  const reasonLine = match[1]
    ?.split("\n")
    .map((line) => line.trim())
    .find(Boolean);
  const reason = reasonLine?.replace(/^\[|\]$/g, "");
  return { reason: reason ? sanitizeDisplayText(reason) : undefined };
}

export function formatReadResult(
  result: ToolTextResult,
  state: ResultStatusState,
  options: ToolRenderResultOptions,
  theme: Theme,
  width: number,
  keyText: KeybindingHints["keyText"],
): string {
  const hasImage = result.content.some((content) => content.type === "image");
  const textContent = extractTextContent(result);

  if (state.isError) {
    return formatSimpleErrorResult(
      textContent,
      state,
      options,
      theme,
      width,
      keyText,
    );
  }

  const metadataParts = buildResultStatusParts(state, theme);
  const callHint = buildToolExpansionHint(
    theme,
    state,
    options,
    false,
    keyText,
  );
  const imageMarker = getImageReadMarker(textContent);

  if (hasImage) {
    const match = textContent.match(/original\s+(\d+)x(\d+)/i);
    metadataParts.push(
      theme.fg("muted", match ? `Image (${match[1]}x${match[2]})` : "Image"),
    );
  } else if (imageMarker) {
    metadataParts.push(theme.fg("warning", "Image unavailable"));
    const summary = metadataParts.join(theme.fg("muted", " · ")) + callHint;
    if (!imageMarker.reason)
      return theme.fg("dim", getTreeEndPrefix()) + summary;

    const reason = formatTreeLine(imageMarker.reason, {
      theme,
      prefix: "│  ",
      color: "muted",
    }).text;
    return reason + "\n" + theme.fg("dim", getTreeEndPrefix()) + summary;
  } else {
    const fileContent = stripReadContinuationNotice(textContent);
    const lines = countLines(fileContent);
    metadataParts.push(
      theme.fg(
        "muted",
        lines > 0 ? `${lines} ${lines === 1 ? "line" : "lines"}` : "no content",
      ),
    );
  }

  return (
    theme.fg("dim", getTreeEndPrefix()) +
    metadataParts.join(theme.fg("muted", " · ")) +
    callHint
  );
}
