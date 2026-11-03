import type {
  Theme,
  ToolRenderResultOptions,
} from "@earendil-works/pi-coding-agent";
import {
  type Component,
  sliceByColumn,
  Text,
  truncateToWidth,
  visibleWidth,
  wrapTextWithAnsi,
} from "@earendil-works/pi-tui";
import {
  getBlinkIndicator,
  invalidateIfChanged,
  getStatusColor,
  getStatusSymbol,
  isBlinkOn,
  updateBlinkTimer,
} from "./state";
import { getConfig } from "../../config/store";
import { safeTruncateToWidth, stripAnsi } from "./text";
import type { BaseRenderState } from "./types";
import { isFullscreenTui } from "./tui-runtime";

export function getTreeEndPrefix(): "╰─ " | "└─ " {
  return getConfig().tools.treeCorner === "square" ? "└─ " : "╰─ ";
}

export function formatOmissionRow(
  hiddenCount: number,
  noun: { singular: string; plural: string },
  theme: Theme,
): string {
  const label = `${hiddenCount} ${
    hiddenCount === 1 ? noun.singular : noun.plural
  }`;
  return theme.fg("dim", `┊  ${theme.italic(`+${label}`)}`);
}

export function formatTreeLine(
  line: string,
  options: {
    theme: Theme;
    prefix: "│  " | "├─ " | "╰─ " | "└─ ";
    width?: number;
    color?: "toolOutput" | "error" | "muted";
  },
): { text: string; truncated: boolean } {
  const { theme, prefix, width, color } = options;
  const contentWidth = Math.max(1, (width ?? Infinity) - visibleWidth(prefix));
  const truncated = width !== undefined && visibleWidth(line) > contentWidth;
  const renderedLine = truncated
    ? truncateToWidth(line, contentWidth, theme.fg(color ?? "muted", "..."))
    : line;
  const styledLine =
    color === undefined ? renderedLine : theme.fg(color, renderedLine);

  return {
    text: theme.fg("dim", prefix) + styledLine,
    truncated,
  };
}

export function formatExpandableCallText(
  state: BaseRenderState,
  options: {
    expanded: boolean;
    collapsedText: string;
    fullText: string;
    compactIsLossy?: boolean;
    ellipsis: string;
  },
  width: number,
  invalidate: () => void,
): string {
  const expandable =
    options.compactIsLossy === true ||
    options.fullText.includes("\n") ||
    visibleWidth(options.fullText) > width;
  const changed = (state.callExpandable === true) !== expandable;
  state.callExpandable = expandable;
  invalidateIfChanged(changed, invalidate);
  return options.expanded
    ? options.fullText
    : safeTruncateToWidth(options.collapsedText, width, options.ellipsis);
}

export function getCallText(theme: Theme, outputPad = 1): TreeText {
  return new TreeText(theme.fg("dim", "│  "), outputPad);
}

export function getCallRenderParts(
  state: BaseRenderState,
  theme: Theme,
  toolContext: {
    executionStarted?: boolean;
    isPartial?: boolean;
    invalidate: () => void;
    outputPad?: number;
  },
  renderOptions?: {
    animate?: boolean;
    staticActive?: boolean;
  },
): { text: TreeText; prefix: string; isDone: boolean } {
  return {
    text: getCallText(theme, toolContext.outputPad),
    ...getCallPrefix(state, theme, toolContext, renderOptions),
  };
}

export function getCallPrefix(
  state: BaseRenderState,
  theme: Theme,
  toolContext: {
    executionStarted?: boolean;
    isPartial?: boolean;
    invalidate: () => void;
  },
  renderOptions?: { animate?: boolean; staticActive?: boolean },
): { prefix: string; isDone: boolean } {
  const isDone =
    state.hasResult ||
    (!toolContext.executionStarted && !toolContext.isPartial);
  const staticActive =
    renderOptions?.staticActive === true && !isDone && !isFullscreenTui();
  const animate = (renderOptions?.animate ?? true) && !staticActive;
  const blinkOn = animate ? isBlinkOn() : false;

  updateBlinkTimer(state, animate && !isDone, toolContext.invalidate);

  const color = staticActive ? "dim" : getStatusColor(isDone, blinkOn);
  const symbol = staticActive
    ? getBlinkIndicator().unfilled
    : getStatusSymbol(isDone, blinkOn);
  const prefix = theme.fg(color, `${symbol} `);

  return { prefix, isDone };
}

function wrapTreeText(
  text: string,
  width: number,
  callContinuationPrefix?: string,
): string {
  if (!text || width <= 3) return text;

  return text
    .split("\n")
    .flatMap((line, sourceLineIndex) => {
      const lineWidth = visibleWidth(line);
      const slicedPrefix = sliceByColumn(line, 0, 3);
      const visiblePrefix = stripAnsi(slicedPrefix);
      const hasTreePrefix = /^[│├╰└┊][─ ] /u.test(visiblePrefix);

      if (!hasTreePrefix && callContinuationPrefix) {
        const chunks = wrapTextWithAnsi(line, Math.max(1, width - 3));
        return chunks.map((chunk, chunkIndex) =>
          sourceLineIndex === 0 && chunkIndex === 0
            ? chunk
            : callContinuationPrefix + chunk,
        );
      }

      if (lineWidth <= width) return [line];
      if (!hasTreePrefix) return wrapTextWithAnsi(line, width);

      const rawPrefixStart = line.indexOf(visiblePrefix);
      const rawContentStart = rawPrefixStart + visiblePrefix.length;
      const content = line.slice(rawContentStart);
      const prefix = slicedPrefix + "\x1b[39m";
      const chunks = wrapTextWithAnsi(content, Math.max(1, width - 3));
      const continuationPrefix = prefix.replace(/[├╰└]─ /u, "│  ");

      return chunks.map((chunk, index) => {
        const isLastChunk = index === chunks.length - 1;
        const chunkPrefix =
          visiblePrefix === "╰─ " || visiblePrefix === "└─ "
            ? isLastChunk
              ? prefix
              : continuationPrefix
            : index === 0
              ? prefix
              : continuationPrefix;
        return chunkPrefix + chunk;
      });
    })
    .join("\n");
}

type TreeTextSource = string | ((width: number) => string);

class TreeText extends Text {
  // Native invalidation also covers deferred syntax grammar loading.
  onInvalidate?: () => void;
  private sourceText: TreeTextSource = "";
  private sourceComponent?: Component;
  private renderedSource?: TreeTextSource;
  private renderedWidth?: number;

  constructor(
    private readonly callContinuationPrefix?: string,
    private outputPad = 1,
  ) {
    super("", outputPad, 0);
  }

  override setPaddingX(outputPad: number): void {
    if (this.outputPad === outputPad) return;
    this.outputPad = outputPad;
    super.setPaddingX(outputPad);
  }

  override setText(text: TreeTextSource, sourceComponent?: Component): void {
    if (text === this.sourceText && sourceComponent === this.sourceComponent)
      return;
    this.sourceText = text;
    this.sourceComponent = sourceComponent;
    this.renderedSource = undefined;
    this.renderedWidth = undefined;
  }

  override invalidate(): void {
    this.onInvalidate?.();
    this.sourceComponent?.invalidate();
    this.renderedSource = undefined;
    super.invalidate();
  }

  override render(width: number): string[] {
    if (
      this.renderedSource !== this.sourceText ||
      this.renderedWidth !== width
    ) {
      const contentWidth = Math.max(1, width - 2 * this.outputPad);
      const source =
        typeof this.sourceText === "function"
          ? this.sourceText(contentWidth)
          : this.sourceText;
      super.setText(
        wrapTreeText(source, contentWidth, this.callContinuationPrefix),
      );
      this.renderedSource = this.sourceText;
      this.renderedWidth = width;
    }
    return super
      .render(width)
      .map((line) =>
        visibleWidth(line) > width
          ? safeTruncateToWidth(line, width, "")
          : line,
      );
  }
}

export function getResultText(
  state: BaseRenderState,
  options: ToolRenderResultOptions,
  lastComponent: unknown,
  outputPad = 1,
): TreeText {
  const previousText =
    lastComponent instanceof TreeText ? lastComponent : undefined;
  const text =
    state.expanded !== options.expanded || !previousText
      ? new TreeText()
      : previousText;

  state.expanded = options.expanded;
  text.setPaddingX(outputPad);
  return text;
}
