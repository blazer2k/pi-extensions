import type {
  BashToolInput,
  BashToolDetails,
  ToolRenderers,
} from "@earendil-works/pi-coding-agent";
import { renderBashCall } from "./bash/call";
import { formatBashResult } from "./bash/result";
import type { BashRenderState } from "./bash/types";
import {
  invalidateIfChanged,
  registerToolTimer,
  unregisterToolTimer,
  updateResultState,
} from "./rendering/state";
import { getResultText } from "./rendering/tree";

const DURATION_UPDATE_INTERVAL_MS = 250;

export function patchBashTool(): ToolRenderers {
  return {
    renderShell: "self",
    renderCall(args, theme, toolContext) {
      return renderBashCall(args as BashToolInput, theme, toolContext);
    },
    renderResult(result, options, theme, toolContext) {
      const state = toolContext.state as BashRenderState;
      state.durationMs = options.isPartial ? undefined : toolContext.durationMs;
      const text = getResultText(
        state,
        options,
        toolContext.lastComponent,
        toolContext.outputPad,
      );
      const details = result.details as BashToolDetails | undefined;

      if (
        state.startedAt !== undefined &&
        options.isPartial &&
        !state.durationTimer
      ) {
        state.durationTimer = setInterval(
          () => toolContext.invalidate(),
          DURATION_UPDATE_INTERVAL_MS,
        );
        registerToolTimer(state.durationTimer);
      }

      if (!options.isPartial || toolContext.isError) {
        if (state.durationTimer) {
          clearInterval(state.durationTimer);
          unregisterToolTimer(state.durationTimer);
          state.durationTimer = undefined;
        }
      }

      const changed = updateResultState(state, {
        hasResult: !options.isPartial,
        truncated: details?.truncation?.truncated === true,
        isError: toolContext.isError,
      });
      invalidateIfChanged(changed, toolContext.invalidate);
      text.setText((width) => {
        const previousResultExpandable = state.resultExpandable === true;
        const output = formatBashResult(
          result,
          state,
          options,
          theme,
          width,
          toolContext.keyText,
        );
        invalidateIfChanged(
          previousResultExpandable !== (state.resultExpandable === true),
          toolContext.invalidate,
        );
        return output;
      });
      return text;
    },
  };
}
