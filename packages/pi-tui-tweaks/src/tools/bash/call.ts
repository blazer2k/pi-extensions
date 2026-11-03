import {
  highlightCode,
  type BashToolInput,
  type Theme,
} from "@earendil-works/pi-coding-agent";
import {
  truncateToWidth,
  visibleWidth,
  type Text,
} from "@earendil-works/pi-tui";
import { getBlinkIndicator, invalidateIfChanged } from "../rendering/state";
import {
  sanitizeMultilineDisplayText,
  safeTruncateToWidth,
} from "../rendering/text";
import { getCallText, getCallPrefix } from "../rendering/tree";
import type { BashRenderState } from "./types";
import { formatToolLabel } from "../rendering/labels";

type BashCallContext = {
  state: unknown;
  executionStarted?: boolean;
  isPartial?: boolean;
  expanded: boolean;
  outputPad: number;
  invalidate: () => void;
};

function getHighlightedCommand(
  state: BashRenderState,
  source: string,
  collapsedSource: string,
  expanded: boolean,
  theme: Theme,
): string {
  const colors = theme.colors;
  if (
    state.callHighlightCache?.source !== source ||
    state.callHighlightCache.colors !== colors
  ) {
    state.callHighlightCache = { source, colors };
  }
  const cache = state.callHighlightCache;
  const key = expanded ? "expandedCommand" : "collapsedCommand";
  return (cache[key] ??=
    (source === collapsedSource
      ? (cache.expandedCommand ?? cache.collapsedCommand)
      : undefined) ??
    highlightCode(expanded ? source : collapsedSource, "bash").join("\n"));
}

export function renderBashCall(
  args: BashToolInput,
  theme: Theme,
  toolContext: BashCallContext,
): Text {
  const state = toolContext.state as BashRenderState;

  if (toolContext.executionStarted && state.startedAt === undefined) {
    state.startedAt = Date.now();
  }

  const command =
    typeof args.command === "string"
      ? sanitizeMultilineDisplayText(args.command)
      : "...";
  const collapsedSource = command.replace(/\s+/g, " ").trim();
  const timeoutText = args.timeout ? `(timeout ${args.timeout}s)` : "";
  const inlineTimeoutSuffix = timeoutText
    ? theme.fg("dim", ` ${timeoutText}`)
    : "";
  const text = getCallText(theme, toolContext.outputPad);
  text.onInvalidate = () => {
    state.callHighlightCache = undefined;
  };
  text.setText((width) => {
    const title = theme.fg(
      "toolTitle",
      theme.bold(formatToolLabel("bash") + " "),
    );
    const staticWidth =
      visibleWidth(`${getBlinkIndicator().filled} `) +
      visibleWidth(title) +
      visibleWidth("$ ") +
      visibleWidth(inlineTimeoutSuffix);
    const commandBudget = Math.max(1, width - 3 - staticWidth);
    const callExpandable =
      staticWidth + visibleWidth(collapsedSource) > Math.max(1, width - 3) ||
      command.includes("\n");
    const changed = (state.callExpandable === true) !== callExpandable;
    state.callExpandable = callExpandable;
    invalidateIfChanged(changed, toolContext.invalidate);
    const expanded =
      toolContext.expanded &&
      (callExpandable || state.resultExpandable === true);
    const { prefix } = getCallPrefix(state, theme, toolContext, {
      staticActive: expanded,
    });
    const highlightedCommand = getHighlightedCommand(
      state,
      command,
      collapsedSource,
      expanded,
      theme,
    );
    const visibleCommand = expanded
      ? highlightedCommand
      : truncateToWidth(
          highlightedCommand,
          commandBudget,
          theme.fg("dim", "..."),
        );
    const finalCommandLine = visibleCommand.split("\n").at(-1) ?? "";
    const timeoutOnOwnLine =
      expanded &&
      timeoutText.length > 0 &&
      visibleWidth(finalCommandLine + ` ${timeoutText}`) >
        commandBudget + visibleWidth(inlineTimeoutSuffix);
    const timeoutDisplay = timeoutOnOwnLine
      ? `\n${theme.fg("dim", timeoutText)}`
      : inlineTimeoutSuffix;
    const display =
      prefix + title + theme.fg("dim", "$ ") + visibleCommand + timeoutDisplay;
    return expanded
      ? display
      : safeTruncateToWidth(
          display,
          Math.max(1, width - 3),
          theme.fg("dim", "..."),
        );
  });
  return text;
}
