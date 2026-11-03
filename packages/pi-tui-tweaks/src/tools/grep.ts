import type {
  ToolRenderers,
  GrepToolDetails,
  GrepToolInput,
} from "@earendil-works/pi-coding-agent";
import { formatToolLabel } from "./rendering/labels";
import { buildPatternPathCall, splitNativeListOutput } from "./list-rendering";
import { buildRenderResult, formatListResult } from "./rendering/results";
import { sanitizeDisplayText } from "./rendering/text";
import { getCallRenderParts, formatExpandableCallText } from "./rendering/tree";
import type { BaseRenderState, ListResultConfig } from "./rendering/types";

const GREP_CONFIG: ListResultConfig = {
  emptyMessage: "No matches found",
  singularLabel: "line",
  pluralLabel: "lines",
  preprocess: splitNativeListOutput,
};

export function patchGrepTool(): ToolRenderers {
  return {
    renderShell: "self",
    renderCall(args, theme, toolCtx) {
      const state = toolCtx.state as BaseRenderState;
      const { text, prefix } = getCallRenderParts(state, theme, toolCtx);

      const renderArgs = args as GrepToolInput;
      const glob = renderArgs.glob
        ? theme.fg("dim", ` ${sanitizeDisplayText(renderArgs.glob)}`)
        : "";
      const context = renderArgs.context
        ? theme.fg("dim", ` ±${renderArgs.context}`)
        : "";
      const limit = renderArgs.limit
        ? theme.fg("dim", ` (limit ${renderArgs.limit})`)
        : "";
      text.setText((width) => {
        const title = theme.fg(
          "toolTitle",
          theme.bold(formatToolLabel("grep") + " "),
        );
        const callWidth = Math.max(1, width - 3);
        const call = buildPatternPathCall({
          prefix,
          title,
          pattern: renderArgs.pattern,
          path: renderArgs.path,
          suffix: glob + context + limit,
          cwd: toolCtx.cwd,
          theme,
          width: callWidth,
        });
        return formatExpandableCallText(
          state,
          {
            expanded: toolCtx.expanded,
            ...call,
            ellipsis: theme.fg("accent", "..."),
          },
          callWidth,
          toolCtx.invalidate,
        );
      });
      return text;
    },
    renderResult: buildRenderResult(
      (result, state, options, theme, width, keyText) =>
        formatListResult(
          result,
          state,
          options,
          theme,
          GREP_CONFIG,
          width,
          keyText,
        ),
      (details) => {
        const d = details as GrepToolDetails | undefined;
        return d?.truncation?.truncated === true || d?.linesTruncated === true;
      },
    ),
  };
}
