import {
  renderDiff,
  Theme,
  type KeybindingHints,
  type EditToolDetails,
  type EditToolInput,
  type ToolRenderers,
  type ToolRenderResultOptions,
} from "@earendil-works/pi-coding-agent";
import { visibleWidth } from "@earendil-works/pi-tui";
import { formatToolLabel } from "./rendering/labels";
import {
  buildRenderResult,
  formatSimpleErrorResult,
} from "./rendering/results";
import {
  buildResultStatusParts,
  buildToolExpansionHint,
} from "./rendering/state";
import { extractTextContent, renderPath } from "./rendering/text";
import {
  formatTreeLine,
  getCallRenderParts,
  getTreeEndPrefix,
  formatExpandableCallText,
} from "./rendering/tree";
import type { BaseRenderState, ToolTextResult } from "./rendering/types";

export function parseDiffStats(diff: string): {
  added: number;
  removed: number;
} {
  let added = 0;
  let removed = 0;
  for (const line of diff.split("\n")) {
    if (line.startsWith("+") && !line.startsWith("+++")) {
      added++;
    } else if (line.startsWith("-") && !line.startsWith("---")) {
      removed++;
    }
  }
  return { added, removed };
}

function formatEditResult(
  result: ToolTextResult,
  state: BaseRenderState,
  options: ToolRenderResultOptions,
  theme: Theme,
  width: number,
  keyText: KeybindingHints["keyText"],
): string {
  if (state.isError) {
    return formatSimpleErrorResult(
      extractTextContent(result),
      state,
      options,
      theme,
      width,
      keyText,
    );
  }

  const metadataParts = buildResultStatusParts(state, theme);
  const diff = (result.details as EditToolDetails | undefined)?.diff;
  if (!diff) {
    metadataParts.push(theme.fg("muted", "no diff"));
    return (
      theme.fg("dim", getTreeEndPrefix()) +
      metadataParts.join(theme.fg("muted", " · ")) +
      buildToolExpansionHint(theme, state, options, false, keyText)
    );
  }

  const { added, removed } = parseDiffStats(diff);
  const parts: string[] = [];
  if (added) {
    parts.push(theme.fg("toolDiffAdded", `+${added}`));
  }
  if (removed) {
    parts.push(theme.fg("toolDiffRemoved", `-${removed}`));
  }

  const stats = parts.join(" ");
  if (stats) metadataParts.push(stats);
  const metadata = metadataParts.join(theme.fg("muted", " · "));
  const hint = buildToolExpansionHint(
    theme,
    state,
    options,
    true,
    keyText,
    metadata ? "suffix" : "standalone",
  );

  if (!options.expanded) {
    return theme.fg("dim", getTreeEndPrefix()) + metadata + hint;
  }

  const rendered = renderDiff(diff);
  const hasFooter = Boolean(metadata || hint);
  const renderedLines = rendered.split("\n").map(
    (line, index, lines) =>
      formatTreeLine(line, {
        theme,
        prefix:
          !hasFooter && index === lines.length - 1 ? getTreeEndPrefix() : "│  ",
      }).text,
  );
  if (hasFooter) {
    renderedLines.push(theme.fg("dim", getTreeEndPrefix()) + metadata + hint);
  }
  return renderedLines.join("\n");
}

export function patchEditTool(): ToolRenderers {
  return {
    renderShell: "self",
    renderCall(args, theme, toolCtx) {
      const state = toolCtx.state as BaseRenderState;
      const renderArgs = args as EditToolInput;
      const { text, prefix } = getCallRenderParts(state, theme, toolCtx);

      const fullPath = renderPath(renderArgs.path, theme, toolCtx.cwd);
      text.setText((width) => {
        const title = theme.fg(
          "toolTitle",
          theme.bold(formatToolLabel("edit") + " "),
        );
        const callWidth = Math.max(1, width - 3);
        const pathWidth = Math.max(1, callWidth - visibleWidth(prefix + title));
        return formatExpandableCallText(
          state,
          {
            expanded: toolCtx.expanded,
            collapsedText:
              prefix +
              title +
              renderPath(renderArgs.path, theme, toolCtx.cwd, pathWidth),
            fullText: prefix + title + fullPath,
            compactIsLossy: visibleWidth(fullPath) > pathWidth,
            ellipsis: theme.fg("accent", "..."),
          },
          callWidth,
          toolCtx.invalidate,
        );
      });
      return text;
    },
    renderResult: buildRenderResult(formatEditResult),
  };
}
