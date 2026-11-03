import type {
  ExtensionAPI,
  KeybindingHints,
  Theme,
  ToolRenderResultOptions,
} from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import {
  buildExpansionHint,
  buildResultStatusParts,
  buildToolExpansionHint,
  getExpandedOutputLimit,
  invalidateIfChanged,
  updateResultState,
} from "./state";
import { extractTextContent, normalizeOutput } from "./text";
import {
  formatOmissionRow,
  formatTreeLine,
  getResultText,
  getTreeEndPrefix,
} from "./tree";
import type {
  BaseRenderState,
  FormatResultFn,
  ListResultConfig,
  ResultStatusState,
  ToolTextResult,
} from "./types";

export function formatErrorBody(
  textContent: string,
  options: ToolRenderResultOptions,
  width: number,
  ellipsis = "...",
): { text: string; truncated: boolean } {
  const output = normalizeOutput(textContent);
  const lines = output.split("\n");
  let end = lines.length;
  while (end > 0 && lines[end - 1] === "") end--;
  const trimmed = lines.slice(0, end);

  if (options.expanded) {
    return { text: trimmed.join("\n"), truncated: false };
  }
  if (trimmed.length === 0) return { text: "", truncated: false };

  const maxLineWidth = Math.max(1, width);
  const firstLine = trimmed.find((line) => line.length > 0) ?? "";

  if (trimmed.length === 1 && visibleWidth(firstLine) <= maxLineWidth) {
    return { text: firstLine, truncated: false };
  }

  if (trimmed.length > 1) {
    return {
      text: truncateToWidth(
        `${firstLine}${firstLine ? " " : ""}${ellipsis}`,
        maxLineWidth,
        ellipsis,
      ),
      truncated: true,
    };
  }

  return {
    text: truncateToWidth(firstLine, maxLineWidth, ellipsis),
    truncated: true,
  };
}

export function formatSimpleErrorResult(
  textContent: string,
  state: BaseRenderState,
  options: ToolRenderResultOptions,
  theme: Theme,
  width: number,
  keyText: KeybindingHints["keyText"],
): string {
  const status = state.truncated
    ? buildResultStatusParts(state, theme).join(theme.fg("muted", " · "))
    : "";
  const errorWidth = Math.max(
    1,
    width - 3 - visibleWidth(status ? status + " · " : ""),
  );
  const collapsedBody = formatErrorBody(
    textContent,
    { ...options, expanded: false },
    errorWidth,
    theme.fg("error", "..."),
  );
  const isExpandable =
    state.callExpandable === true || state.truncated || collapsedBody.truncated;
  const bodyWidth = Math.max(
    1,
    errorWidth -
      (isExpandable
        ? visibleWidth(buildExpansionHint(theme, "expand", keyText))
        : 0),
  );
  const errorBody =
    !options.expanded && bodyWidth === errorWidth
      ? collapsedBody
      : formatErrorBody(
          textContent,
          options,
          bodyWidth,
          theme.fg("error", "..."),
        );
  const hasErrorBody = errorBody.text.length > 0;
  const bodyText = hasErrorBody ? errorBody.text : "error";

  if (options.expanded) {
    const collapseHint = isExpandable
      ? buildExpansionHint(
          theme,
          "collapse",
          keyText,
          status ? "suffix" : "standalone",
        )
      : "";
    const footer = status + collapseHint;
    const formatted = bodyText
      .split("\n")
      .map(
        (line, index, lines) =>
          formatTreeLine(line, {
            theme,
            prefix:
              !footer && index === lines.length - 1
                ? getTreeEndPrefix()
                : "│  ",
            color: "error",
          }).text,
      )
      .join("\n");

    return footer
      ? formatted + "\n" + theme.fg("dim", getTreeEndPrefix()) + footer
      : formatted;
  }

  const suffix = isExpandable
    ? buildExpansionHint(theme, "expand", keyText)
    : "";
  if (!state.truncated) {
    return (
      theme.fg("dim", getTreeEndPrefix()) + theme.fg("error", bodyText) + suffix
    );
  }

  return (
    theme.fg("dim", getTreeEndPrefix()) +
    status +
    (hasErrorBody
      ? theme.fg("muted", " · ") + theme.fg("error", bodyText)
      : "") +
    suffix
  );
}

export function formatListResult(
  result: ToolTextResult,
  state: ResultStatusState,
  options: ToolRenderResultOptions,
  theme: Theme,
  config: ListResultConfig,
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

  const normalized = normalizeOutput(extractTextContent(result));
  if (normalized === "" || normalized === config.emptyMessage) {
    const emptyParts = buildResultStatusParts(state, theme);
    emptyParts.push(theme.fg("muted", config.emptyMessage));
    return (
      theme.fg("dim", getTreeEndPrefix()) +
      emptyParts.join(theme.fg("muted", " · ")) +
      buildToolExpansionHint(theme, state, options, false, keyText)
    );
  }

  const items = config.preprocess(normalized);
  const total = items.length;
  const label = total === 1 ? config.singularLabel : config.pluralLabel;
  const summaryParts = buildResultStatusParts(state, theme);
  summaryParts.push(theme.fg("muted", `${total} ${label}`));
  const summary = summaryParts.join(theme.fg("muted", " · "));

  if (!options.expanded) {
    return (
      theme.fg("dim", getTreeEndPrefix()) +
      summary +
      buildToolExpansionHint(theme, state, options, true, keyText)
    );
  }

  const limit = getExpandedOutputLimit();
  const hasOmission = Number.isFinite(limit) && total > limit;
  const headCount = hasOmission ? Math.ceil(limit / 2) : total;
  const tailCount = hasOmission ? Math.floor(limit / 2) : 0;
  const head = items.slice(0, headCount);
  const tail = tailCount > 0 ? items.slice(-tailCount) : [];
  const hiddenCount = total - head.length - tail.length;
  const lines: string[] = [];

  const renderItem = (item: string) => {
    lines.push(
      formatTreeLine(item, {
        theme,
        prefix: "│  ",
        color: "toolOutput",
      }).text,
    );
  };

  head.forEach(renderItem);
  if (hiddenCount > 0) {
    lines.push(
      formatOmissionRow(
        hiddenCount,
        { singular: config.singularLabel, plural: config.pluralLabel },
        theme,
      ),
    );
  }
  tail.forEach(renderItem);
  lines.push(
    theme.fg("dim", getTreeEndPrefix()) +
      summary +
      buildToolExpansionHint(theme, state, options, true, keyText),
  );

  return lines.join("\n");
}

export function buildRenderResult(
  formatResult: FormatResultFn,
  isTruncated?: (details: unknown) => boolean,
): NonNullable<Parameters<ExtensionAPI["registerTool"]>[0]["renderResult"]> {
  return (result, options, theme, toolContext) => {
    const state = toolContext.state as BaseRenderState;
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
      truncated: isTruncated
        ? isTruncated(result.details)
        : details?.truncation?.truncated === true,
      isError: toolContext.isError,
    });

    invalidateIfChanged(changed, toolContext.invalidate);
    text.setText((width) =>
      formatResult(
        result,
        state as ResultStatusState,
        options,
        theme,
        width,
        toolContext.keyText,
      ),
    );
    return text;
  };
}
