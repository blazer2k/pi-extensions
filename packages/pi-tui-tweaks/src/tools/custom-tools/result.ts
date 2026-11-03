import type {
  KeybindingHints,
  Theme,
  ToolRenderResultOptions,
} from "@earendil-works/pi-coding-agent";
import {
  buildResultStatusParts,
  getExpandedOutputLimit,
} from "../rendering/state";
import { extractTextContent, normalizeOutput } from "../rendering/text";
import { formatSimpleErrorResult } from "../rendering/results";
import { formatTreeLine, getTreeEndPrefix } from "../rendering/tree";
import type { BaseRenderState, ToolTextResult } from "../rendering/types";

export function buildGenericResult(
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

  const normalized = normalizeOutput(extractTextContent(result));
  if (!normalized) {
    const metadataParts = buildResultStatusParts(state, theme);
    metadataParts.push(theme.fg("muted", "(no output)"));
    return (
      theme.fg("dim", getTreeEndPrefix()) +
      metadataParts.join(theme.fg("muted", " · "))
    );
  }

  const lines = normalized.split("\n");
  const total = lines.length;
  const metadataParts = buildResultStatusParts(state, theme);
  metadataParts.push(
    theme.fg("muted", `${total} ${total === 1 ? "line" : "lines"}`),
  );
  const metadata = metadataParts.join(theme.fg("muted", " · "));

  if (!options.expanded) return theme.fg("dim", getTreeEndPrefix()) + metadata;

  const limit = getExpandedOutputLimit();
  const visible = lines.slice(0, limit);
  const remaining = Math.max(0, total - limit);
  const rendered: string[] = [theme.fg("dim", "├─ ") + metadata];

  visible.forEach((line, index) => {
    const isLast = index === visible.length - 1 && remaining === 0;
    rendered.push(
      formatTreeLine(line, {
        theme,
        prefix: isLast ? getTreeEndPrefix() : "│  ",
      }).text,
    );
  });

  if (remaining > 0) {
    rendered.push(
      theme.fg("dim", getTreeEndPrefix()) +
        theme.fg("muted", `${remaining} more lines`),
    );
  }

  return rendered.join("\n");
}
