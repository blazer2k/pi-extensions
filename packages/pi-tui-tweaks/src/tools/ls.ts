import type {
  ToolRenderers,
  LsToolInput,
} from "@earendil-works/pi-coding-agent";
import { visibleWidth } from "@earendil-works/pi-tui";
import { formatToolLabel } from "./rendering/labels";
import { splitNativeListOutput } from "./list-rendering";
import { buildRenderResult, formatListResult } from "./rendering/results";
import { renderPath } from "./rendering/text";
import { getCallRenderParts, formatExpandableCallText } from "./rendering/tree";
import type { BaseRenderState, ListResultConfig } from "./rendering/types";

const LS_CONFIG: ListResultConfig = {
  emptyMessage: "(empty directory)",
  singularLabel: "entry",
  pluralLabel: "entries",
  preprocess: splitNativeListOutput,
};

export function patchLsTool(): ToolRenderers {
  return {
    renderShell: "self",
    renderCall(args, theme, toolCtx) {
      const state = toolCtx.state as BaseRenderState;
      const { text, prefix } = getCallRenderParts(state, theme, toolCtx);

      const renderArgs = args as LsToolInput;
      const limit = renderArgs.limit
        ? theme.fg("dim", ` (limit ${renderArgs.limit})`)
        : "";
      const path = renderArgs.path || ".";
      text.setText((width) => {
        const title = theme.fg(
          "toolTitle",
          theme.bold(formatToolLabel("ls") + " "),
        );
        const callWidth = Math.max(1, width - 3);
        const pathWidth = Math.max(
          1,
          callWidth - visibleWidth(prefix + title + limit),
        );
        return formatExpandableCallText(
          state,
          {
            expanded: toolCtx.expanded,
            collapsedText:
              prefix +
              title +
              renderPath(path, theme, toolCtx.cwd, pathWidth) +
              limit,
            fullText:
              prefix + title + renderPath(path, theme, toolCtx.cwd) + limit,
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
          LS_CONFIG,
          width,
          keyText,
        ),
    ),
  };
}
