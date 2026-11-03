import type {
  ToolRenderers,
  FindToolInput,
} from "@earendil-works/pi-coding-agent";
import { formatToolLabel } from "./rendering/labels";
import { buildPatternPathCall, splitNativeListOutput } from "./list-rendering";
import { buildRenderResult, formatListResult } from "./rendering/results";
import { getCallRenderParts, formatExpandableCallText } from "./rendering/tree";
import type { BaseRenderState, ListResultConfig } from "./rendering/types";

const FIND_CONFIG: ListResultConfig = {
  emptyMessage: "No files found matching pattern",
  singularLabel: "file",
  pluralLabel: "files",
  preprocess: splitNativeListOutput,
};

export function patchFindTool(): ToolRenderers {
  return {
    renderShell: "self",
    renderCall(args, theme, toolCtx) {
      const state = toolCtx.state as BaseRenderState;
      const { text, prefix } = getCallRenderParts(state, theme, toolCtx);

      const renderArgs = args as FindToolInput;
      const limit = renderArgs.limit
        ? theme.fg("dim", ` (limit ${renderArgs.limit})`)
        : "";
      text.setText((width) => {
        const title = theme.fg(
          "toolTitle",
          theme.bold(formatToolLabel("find") + " "),
        );
        const callWidth = Math.max(1, width - 3);
        const call = buildPatternPathCall({
          prefix,
          title,
          pattern: renderArgs.pattern,
          path: renderArgs.path,
          suffix: limit,
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
          FIND_CONFIG,
          width,
          keyText,
        ),
    ),
  };
}
