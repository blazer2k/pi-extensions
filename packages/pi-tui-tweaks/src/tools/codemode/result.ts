import type {
  KeybindingHints,
  Theme,
  ToolRenderResultOptions,
} from "@earendil-works/pi-coding-agent";
import {
  formatCollapsedOutput,
  formatDuration,
  selectOutputWindow,
} from "../rendering/output";
import {
  buildToolExpansionHint,
  buildResultStatusParts,
  getCollapsedOutputDisplay,
} from "../rendering/state";
import type { ToolTextResult } from "../rendering/types";
import { renderPath } from "../rendering/text";
import { formatMetadataLabel } from "../rendering/labels";
import { formatTreeLine, getTreeEndPrefix } from "../rendering/tree";
import { buildCodemodeResultView } from "./model";
import type { CodemodeRenderState } from "./types";

export function formatCodemodeResult(
  result: ToolTextResult,
  state: CodemodeRenderState,
  options: ToolRenderResultOptions,
  theme: Theme,
  width: number,
  durationMs: number | undefined,
  keyText: KeybindingHints["keyText"],
  nativeLines?: string[],
  cwd = process.cwd(),
) {
  const data = buildCodemodeResultView(result);
  const display = getCollapsedOutputDisplay();
  const output = selectOutputWindow(data.output, display);
  const preview = formatCollapsedOutput(output, theme, "toolOutput", width);
  const diagnostic = state.isError
    ? formatTreeLine(data.diagnostic, {
        theme,
        prefix: "├─ ",
        width,
        color: "error",
      })
    : undefined;
  const diagnosticShowsOutput =
    display === "summary" &&
    diagnostic &&
    !diagnostic.truncated &&
    output.fullText === data.diagnostic;
  state.resultExpandable =
    data.calls.length > 0 ||
    (output.hiddenLines > 0 && !diagnosticShowsOutput) ||
    preview.truncated;
  const lines: string[] = [];
  if (options.expanded && nativeLines) {
    lines.push(...nativeLines.map((line) => theme.fg("dim", "│  ") + line));
  } else if (!options.isPartial) {
    if (preview.text) lines.push(preview.text);
    if (
      diagnostic &&
      ![...output.previewHeadLines, ...output.previewTailLines].includes(
        data.diagnostic,
      )
    ) {
      lines.push(diagnostic.text);
    }
    if (!output.totalLines && !data.images && !state.isError) {
      lines.push(theme.fg("dim", "│  (no output)"));
    }
  }
  if (data.fullOutputPath)
    lines.push(
      theme.fg("dim", "│  Full output: ") +
        renderPath(data.fullOutputPath, theme, cwd),
    );
  if (data.spillWarning && !options.expanded)
    lines.push(theme.fg("dim", "│  ") + theme.fg("warning", data.spillWarning));
  const metadata: string[] = [];
  if (data.calls.length)
    metadata.push(
      theme.fg(
        "muted",
        `${data.calls.length} ${data.calls.length === 1 ? "call" : "calls"}`,
      ),
    );
  for (const [status, label, color] of [
    ["running", "running", "warning"],
    ["error", "failed", "error"],
    ["cancelled", "cancelled", "muted"],
  ] as const) {
    const count = data.calls.filter((call) => call.status === status).length;
    if (count) metadata.push(theme.fg(color, `${count} ${label}`));
  }
  if (state.isError)
    metadata.push(theme.fg("error", formatMetadataLabel("script failed")));
  const duration = options.isPartial
    ? state.startedAt === undefined
      ? undefined
      : Math.max(0, (state.endedAt ?? Date.now()) - state.startedAt)
    : durationMs;
  if (duration !== undefined)
    metadata.push(
      theme.fg(
        "dim",
        formatMetadataLabel(
          `${options.isPartial ? "elapsed" : "took"} ${formatDuration(duration)}`,
        ),
      ),
    );
  const priced = data.calls.filter(
    (call) => typeof call.cost === "number" && Number.isFinite(call.cost),
  );
  if (priced.length) {
    const cost = priced.reduce((sum, call) => sum + call.cost!, 0);
    const amount =
      cost === 0 || cost >= 0.01 ? cost.toFixed(2) : cost.toPrecision(2);
    metadata.push(
      theme.fg("dim", formatMetadataLabel(`model calls $${amount}`)),
    );
  }
  if (!options.isPartial && display === "summary" && output.totalLines) {
    metadata.push(
      theme.fg(
        "muted",
        `${output.totalLines} ${data.truncated ? "returned " : ""}${output.totalLines === 1 ? "line" : "lines"}`,
      ),
    );
  }
  if (data.images)
    metadata.push(
      theme.fg(
        "muted",
        `${data.images} ${data.images === 1 ? "image" : "images"}`,
      ),
    );
  metadata.push(
    ...buildResultStatusParts({ truncated: data.truncated }, theme),
  );
  const hint = buildToolExpansionHint(
    theme,
    state,
    options,
    state.resultExpandable === true,
    keyText,
    "standalone",
  );
  if (hint) metadata.push(hint);
  if (metadata.length)
    lines.push(
      theme.fg("dim", getTreeEndPrefix()) +
        metadata.join(theme.fg("muted", " · ")),
    );
  return lines.join("\n");
}
