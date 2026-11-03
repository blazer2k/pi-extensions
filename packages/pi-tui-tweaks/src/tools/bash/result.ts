import type {
  KeybindingHints,
  Theme,
  ToolRenderResultOptions,
} from "@earendil-works/pi-coding-agent";
import {
  buildToolExpansionHint,
  getCollapsedOutputDisplay,
} from "../rendering/state";
import { formatCollapsedOutput, formatOutputLines } from "../rendering/output";
import type { ToolTextResult } from "../rendering/types";
import { getTreeEndPrefix } from "../rendering/tree";
import { renderUnknownError } from "./error-result";
import { buildBashMetadataParts, joinMetadata } from "./metadata";
import { buildBashResultView } from "./model";
import type { BashRenderState } from "./types";

export function formatBashResult(
  result: ToolTextResult,
  state: BashRenderState,
  options: ToolRenderResultOptions,
  theme: Theme,
  width: number,
  keyText: KeybindingHints["keyText"],
): string {
  const view = buildBashResultView(result, state, options, {
    collapsedDisplay: getCollapsedOutputDisplay(),
    errorEllipsis: theme.fg("error", "..."),
    errorWidth: Math.max(1, width - 3),
  });

  if (view.kind === "unknown-error") {
    return renderUnknownError(view, theme, state, width, keyText);
  }

  const collapsedOutput = formatCollapsedOutput(
    view.output,
    theme,
    "toolOutput",
    width,
  );
  const expandable =
    view.callExpandable ||
    view.output.hiddenLines > 0 ||
    collapsedOutput.truncated ||
    view.toolTruncated;
  state.resultExpandable = expandable;
  const expanded = view.expanded && expandable;
  const output = expanded
    ? formatOutputLines(view.output.fullText, theme, "toolOutput")
    : collapsedOutput;
  const metadataParts = buildBashMetadataParts(
    {
      durationSummary: view.durationSummary,
      totalLines: view.output.totalLines,
      includeLineCount:
        !expanded &&
        view.collapsedDisplay === "summary" &&
        view.output.totalLines > 0,
      toolTruncated: view.toolTruncated,
    },
    theme,
  );
  if (view.kind === "success" && view.output.totalLines === 0) {
    metadataParts.push(theme.fg("muted", "(no output)"));
  }

  let metadata = joinMetadata(metadataParts, theme);
  const hint = buildToolExpansionHint(
    theme,
    state,
    { expanded },
    expandable,
    keyText,
    metadata ? "suffix" : "standalone",
  );
  if (view.kind === "success" && !metadata && !hint) {
    metadata = theme.fg("muted", "output");
  }
  const footer = metadata + hint;

  return [
    output.text,
    view.kind === "command-error"
      ? theme.fg("dim", footer ? "├─ " : getTreeEndPrefix()) +
        theme.fg("error", view.status)
      : undefined,
    footer ? theme.fg("dim", getTreeEndPrefix()) + footer : undefined,
  ]
    .filter((line): line is string => Boolean(line))
    .join("\n");
}
