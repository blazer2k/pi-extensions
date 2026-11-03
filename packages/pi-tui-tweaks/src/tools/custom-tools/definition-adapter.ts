import type { ToolRenderers } from "@earendil-works/pi-coding-agent";
import type { Component } from "@earendil-works/pi-tui";
import { formatToolLabel } from "../rendering/labels";
import {
  buildResultStatusParts,
  invalidateIfChanged,
  updateResultState,
} from "../rendering/state";
import { safeTruncateToWidth } from "../rendering/text";
import {
  getCallRenderParts,
  getResultText,
  getTreeEndPrefix,
} from "../rendering/tree";
import type { BaseRenderState } from "../rendering/types";
import {
  applyArgumentHyperlinks,
  buildGenericCallHeader,
  sanitizeRenderedText,
} from "./display";
import { buildGenericResult } from "./result";
import type { CustomToolRenderingReporter } from "./types";

export const WRAPPED_TOOL = Symbol.for(
  "@blazer2k/pi-tui-tweaks/custom-tools/wrapped/v1",
);

type CustomRenderState = BaseRenderState & {
  callComponent?: Component;
  resultComponent?: Component;
};

type StateWithCustom = {
  _tuiTweaks?: CustomRenderState;
};

export function getCustomState(state: unknown): CustomRenderState {
  const root = state as StateWithCustom;
  root._tuiTweaks ??= {};
  return root._tuiTweaks;
}

export function shouldWrapRenderers(
  renderers: ToolRenderers & { [WRAPPED_TOOL]?: boolean },
): boolean {
  return !renderers[WRAPPED_TOOL] && renderers.renderShell !== "self";
}

export type DefinitionAdapterOptions = {
  isToolCallActive: (toolCallId: string) => boolean;
  reportIssue: CustomToolRenderingReporter;
  trackState?: (state: BaseRenderState) => void;
};

function renderComponentLines(
  component: Component,
  width: number,
  preserveBlankLines = false,
): string[] {
  const lines = component.render(width).map((line) => line.trimEnd());
  return preserveBlankLines ? lines : lines.filter((line) => line.length > 0);
}

function createCallRenderer(
  toolName: string,
  originalRenderCall: ToolRenderers["renderCall"],
  options: DefinitionAdapterOptions,
): NonNullable<ToolRenderers["renderCall"]> {
  return (args, theme, toolContext) => {
    const state = getCustomState(toolContext.state);
    options.trackState?.(state);
    const { text, prefix } = getCallRenderParts(state, theme, toolContext, {
      animate: options.isToolCallActive(toolContext.toolCallId),
    });
    const renderFallback = (width: number): string => {
      const label = formatToolLabel(toolName);
      const header = buildGenericCallHeader(
        args as Record<string, unknown>,
        label,
        theme,
      );
      return safeTruncateToWidth(
        prefix + header,
        width,
        theme.fg("accent", "..."),
      );
    };
    const reportError = (error: unknown): void => {
      state.callComponent = undefined;
      options.reportIssue({
        stage: "renderCall",
        toolName,
        error,
      });
    };

    if (originalRenderCall) {
      try {
        const component = originalRenderCall(args, theme, {
          ...toolContext,
          lastComponent: state.callComponent,
        });
        state.callComponent = component;

        text.setText((width) => {
          const nativeWidth = Math.max(1, width - 3);
          try {
            const lines = renderComponentLines(
              component,
              nativeWidth,
              toolContext.expanded,
            );
            let innerText = toolContext.expanded
              ? lines.map(sanitizeRenderedText).join("\n")
              : sanitizeRenderedText(lines.join(" "));
            innerText = formatToolLabel(innerText);
            innerText = applyArgumentHyperlinks(
              innerText,
              args,
              toolContext.cwd,
            );
            return toolContext.expanded
              ? prefix + innerText
              : safeTruncateToWidth(
                  prefix + innerText,
                  nativeWidth,
                  theme.fg("accent", "..."),
                );
          } catch (error) {
            reportError(error);
            return renderFallback(nativeWidth);
          }
        }, component);
        return text;
      } catch (error) {
        reportError(error);
      }
    }

    text.setText((width) => renderFallback(Math.max(1, width - 3)));
    return text;
  };
}

function createResultRenderer(
  toolName: string,
  originalRenderResult: ToolRenderers["renderResult"],
  adapterOptions: DefinitionAdapterOptions,
): NonNullable<ToolRenderers["renderResult"]> {
  const { reportIssue } = adapterOptions;
  return (result, options, theme, toolContext) => {
    const state = getCustomState(toolContext.state);
    const text = getResultText(
      state,
      options,
      toolContext.lastComponent,
      toolContext.outputPad,
    );
    const details = result.details as
      | { truncation?: { truncated?: boolean } }
      | undefined;
    const changed = updateResultState(state, {
      hasResult: !options.isPartial,
      truncated: details?.truncation?.truncated === true,
      isError: toolContext.isError,
    });
    invalidateIfChanged(changed, toolContext.invalidate);
    adapterOptions.trackState?.(state);

    if (!originalRenderResult) {
      text.setText((width) =>
        buildGenericResult(
          result,
          state,
          options,
          theme,
          width,
          toolContext.keyText,
        ),
      );
      return text;
    }

    let component: Component;
    try {
      component = originalRenderResult(result, options, theme, {
        ...toolContext,
        lastComponent: state.resultComponent,
      });
    } catch (error) {
      reportIssue({
        stage: "renderResult",
        toolName,
        error,
      });
      text.setText((width) =>
        buildGenericResult(
          result,
          state,
          options,
          theme,
          width,
          toolContext.keyText,
        ),
      );
      return text;
    }
    state.resultComponent = component;

    text.setText((width) => {
      try {
        const innerLines = renderComponentLines(
          component,
          Math.max(1, width - 3),
        );
        if (innerLines.length === 0) {
          return buildGenericResult(
            state.isError ? result : { content: [] },
            state,
            options,
            theme,
            width,
            toolContext.keyText,
          );
        }

        const renderedLines = innerLines.map((line, index) => {
          const prefix =
            index === innerLines.length - 1 ? getTreeEndPrefix() : "│  ";
          return theme.fg("dim", prefix) + line;
        });
        if (state.truncated) {
          const status = buildResultStatusParts(state, theme).join(
            theme.fg("muted", " · "),
          );
          renderedLines.unshift(theme.fg("dim", "├─ ") + status);
        }
        return renderedLines.join("\n");
      } catch (error) {
        reportIssue({
          stage: "renderResult",
          toolName,
          error,
        });
        return buildGenericResult(
          result,
          state,
          options,
          theme,
          width,
          toolContext.keyText,
        );
      }
    }, component);
    return text;
  };
}

export function createWrappedRenderers(
  toolName: string,
  renderers: ToolRenderers,
  options: DefinitionAdapterOptions,
): ToolRenderers & { [WRAPPED_TOOL]: true } {
  return {
    [WRAPPED_TOOL]: true,
    renderShell: "self",
    renderCall: createCallRenderer(toolName, renderers.renderCall, options),
    renderResult: createResultRenderer(
      toolName,
      renderers.renderResult,
      options,
    ),
  };
}
