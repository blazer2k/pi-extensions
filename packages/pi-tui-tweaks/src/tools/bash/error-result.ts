import type { KeybindingHints, Theme } from "@earendil-works/pi-coding-agent";
import { buildToolExpansionHint } from "../rendering/state";
import { buildBashMetadataParts, joinMetadata } from "./metadata";
import type { BashUnknownErrorView } from "./model";
import type { BashRenderState } from "./types";
import { formatOutputLines } from "../rendering/output";
import { getTreeEndPrefix } from "../rendering/tree";

export function renderUnknownError(
  view: BashUnknownErrorView,
  theme: Theme,
  state: BashRenderState,
  width: number,
  keyText: KeybindingHints["keyText"],
): string {
  const expandable =
    view.callExpandable || view.body.collapsedTruncated || view.toolTruncated;
  state.resultExpandable = expandable;
  const expanded = view.expanded && expandable;
  const metadataParts = buildBashMetadataParts(
    {
      durationSummary: view.durationSummary,
      toolTruncated: view.toolTruncated,
    },
    theme,
  );
  const metadata = joinMetadata(metadataParts, theme);
  const hint = buildToolExpansionHint(
    theme,
    state,
    { expanded },
    expandable,
    keyText,
    metadata ? "suffix" : "standalone",
  );
  const footer = metadata + hint;
  const body = expanded ? view.body.expandedText : view.body.collapsedText;
  const output = formatOutputLines(
    body || "error",
    theme,
    "error",
    expanded ? undefined : Math.max(1, width - 3),
    { closeLastLine: !footer },
  ).text;

  return [
    output,
    footer ? theme.fg("dim", getTreeEndPrefix()) + footer : undefined,
  ]
    .filter((line): line is string => Boolean(line))
    .join("\n");
}
