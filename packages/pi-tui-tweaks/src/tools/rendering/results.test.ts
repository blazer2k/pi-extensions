import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import type {
  Theme,
  ToolRenderResultOptions,
} from "@earendil-works/pi-coding-agent";
import {
  formatErrorBody,
  formatListResult,
  formatSimpleErrorResult,
} from "./results";
import { extractTextContent } from "./text";
import type {
  BaseRenderState,
  ListResultConfig,
  ResultStatusState,
} from "./types";
import { getConfig } from "../../config/store";
import { mkTheme, setTestConfig } from "../../testing/helpers";

const opts: ToolRenderResultOptions = { expanded: false, isPartial: false };
const optsExpanded: ToolRenderResultOptions = {
  expanded: true,
  isPartial: false,
};

describe("formatErrorBody", () => {
  it("compacts long single-line errors when collapsed", () => {
    const error =
      "A very long error message that definitely exceeds the available viewport width";
    const { text, truncated } = formatErrorBody(error, opts, 40, "...");
    expect(truncated).toBe(true);
    expect(text).not.toBe(error);
  });

  it("marks multi-line errors as truncated even when they fit", () => {
    const error = "line1\nline2\nline3";
    const { text, truncated } = formatErrorBody(error, opts, 40, "...");
    expect(truncated).toBe(true);
    expect(text).toBe("line1 ...");
  });

  it("preserves full error when expanded", () => {
    const error = "line1\nline2\nline3";
    const { text, truncated } = formatErrorBody(error, optsExpanded, 40, "...");
    expect(truncated).toBe(false);
    expect(text).toBe("line1\nline2\nline3");
  });
});

describe("formatSimpleErrorResult", () => {
  it("renders error text with tree prefix", () => {
    const theme = mkTheme();
    const state: BaseRenderState = { isError: true };
    const result = {
      content: [{ type: "text", text: "something went wrong" }],
    };
    const output = formatSimpleErrorResult(
      extractTextContent(result),
      state,
      opts,
      theme,
      80,
    );
    expect(output).toContain("╰─");
    expect(output).toContain("something went wrong");
  });

  it("shows truncation without error metadata", () => {
    const theme = mkTheme();
    const state: BaseRenderState = { isError: true, truncated: true };

    for (const options of [opts, optsExpanded]) {
      const output = formatSimpleErrorResult(
        "something went wrong",
        state,
        options,
        theme,
        80,
      );
      expect(output).toContain("Truncated");
      expect(output).not.toContain("error ·");
    }
  });

  it("renders one-line collapsed previews and restores tree rows when expanded", () => {
    const theme = mkTheme();
    const state: BaseRenderState = { isError: true };
    const error = "rg: regex parse error:\n    (?:[)\n       ^";

    const collapsed = formatSimpleErrorResult(error, state, opts, theme, 80);
    expect(collapsed).toContain("╰─ rg: regex parse error: ...");
    expect(collapsed).toContain("to expand");
    expect(collapsed.split("\n")).toHaveLength(1);

    const expanded = formatSimpleErrorResult(
      error,
      state,
      optsExpanded,
      theme,
      80,
    );
    expect(expanded).toContain("to collapse");
    expect(expanded).toContain("│      (?:[)");
    expect(expanded).toContain("│         ^");
    expect(expanded.split("\n").at(-1)).toContain("╰─  to collapse");
  });

  it("labels empty errors without offering expansion", () => {
    const output = formatSimpleErrorResult(
      "",
      { isError: true },
      opts,
      mkTheme(),
      80,
    );
    expect(output).toContain("╰─ error");
    expect(output).not.toContain("ctrl+o");
  });
});

const baseConfig: ListResultConfig = {
  emptyMessage: "(empty)",
  singularLabel: "file",
  pluralLabel: "files",
  preprocess: (text) => text.split("\n").filter((l) => l.length > 0),
};

function resultStatusState(
  overrides: Partial<ResultStatusState> = {},
): ResultStatusState {
  return { truncated: false, isError: false, ...overrides };
}

describe("formatListResult", () => {
  let originalLimit: ReturnType<
    typeof getConfig
  >["tools"]["expandedOutputLimit"];
  beforeEach(() => {
    originalLimit = getConfig().tools.expandedOutputLimit;
    setTestConfig({
      tools: {
        expandedOutputLimit: 20,
      },
    });
  });
  afterEach(() => {
    setTestConfig({
      tools: {
        expandedOutputLimit: originalLimit,
      },
    });
  });

  it("renders empty message", () => {
    const theme = mkTheme();
    const state = resultStatusState();
    const result = {
      content: [{ type: "text", text: "(empty)" }],
    };
    const output = formatListResult(result, state, opts, theme, baseConfig, 80);
    expect(output).toContain("╰─");
    expect(output).toContain("(empty)");
  });

  it("puts truncation before an empty-result message", () => {
    const output = formatListResult(
      {
        content: [{ type: "text", text: "(empty)" }],
        details: { truncation: { truncated: true } },
      },
      resultStatusState({ truncated: true }),
      opts,
      mkTheme(),
      baseConfig,
      80,
    );

    expect(output).toContain("Truncated · (empty)");
  });

  it("collapsed shows count and expand hint", () => {
    const theme = mkTheme();
    const state = resultStatusState();
    const result = {
      content: [{ type: "text", text: "a.txt\nb.txt\nc.txt" }],
    };
    const output = formatListResult(result, state, opts, theme, baseConfig, 80);
    expect(output).toContain("3 files");
    expect(output).toContain("to expand");
  });

  it("expanded splits the configured entries around an omission row", () => {
    const lines = Array.from({ length: 25 }, (_, i) => `file${i}.txt`).join(
      "\n",
    );
    const output = formatListResult(
      { content: [{ type: "text", text: lines }] },
      resultStatusState(),
      optsExpanded,
      mkTheme(),
      baseConfig,
      80,
    );
    const rendered = output.split("\n");

    expect(output).toContain("file0.txt");
    expect(output).toContain("file9.txt");
    expect(output).not.toContain("file10.txt");
    expect(output).not.toContain("file14.txt");
    expect(output).toContain("file15.txt");
    expect(output).toContain("file24.txt");
    expect(output).toContain("┊  +5 files");
    expect(rendered.at(-1)).toContain("╰─ 25 files");
  });

  it("handles small, odd, and larger-than-output limits without duplicating items", () => {
    const items = Array.from({ length: 9 }, (_, index) => `file${index}.txt`);
    for (const [limit, indices, hidden] of [
      [1, [0], 8],
      [2, [0, 8], 7],
      [3, [0, 1, 8], 6],
      [7, [0, 1, 2, 3, 6, 7, 8], 2],
      [25, [0, 1, 2, 3, 4, 5, 6, 7, 8], 0],
    ] as const) {
      setTestConfig({ tools: { expandedOutputLimit: limit } });
      const output = formatListResult(
        { content: [{ type: "text", text: items.join("\n") }] },
        resultStatusState(),
        optsExpanded,
        mkTheme(),
        baseConfig,
        80,
      );
      const rows = output.split("\n");
      expect(
        rows.filter((row) => row.startsWith("│  ")).map((row) => row.slice(3)),
      ).toEqual(indices.map((index) => `file${index}.txt`));
      if (hidden) expect(output).toContain(`┊  +${hidden} files`);
      else expect(output).not.toContain("┊");
      expect(rows.at(-1)).toContain("╰─ 9 files");
    }
  });

  it("renders every item when expandedOutputLimit is unlimited", () => {
    setTestConfig({
      tools: {
        expandedOutputLimit: -1,
      },
    });
    const items = Array.from({ length: 25 }, (_, i) => `file${i}.txt`);
    const output = formatListResult(
      { content: [{ type: "text", text: items.join("\n") }] },
      resultStatusState(),
      optsExpanded,
      mkTheme(),
      baseConfig,
      80,
    ).split("\n");

    expect(output.slice(0, -1)).toEqual(items.map((item) => `│  ${item}`));
    expect(output.at(-1)).toContain(`╰─ ${items.length} files`);
  });

  it("colors counts as muted and omits redundant result limits", () => {
    const theme = {
      ...mkTheme(),
      fg: (color: string, text: string) => `${color}:${text}`,
    } as Theme;
    const state = resultStatusState();
    const result = {
      content: [{ type: "text", text: "a.txt\nb.txt" }],
      details: { resultLimitReached: 1000 },
    };
    const output = formatListResult(result, state, opts, theme, baseConfig, 80);
    expect(output).toContain("muted:2 files");
    expect(output).not.toContain("1000 limit");
  });

  it("puts truncation before count metadata", () => {
    const theme = mkTheme();
    const state = resultStatusState({ truncated: true });
    const result = {
      content: [{ type: "text", text: "a.txt\nb.txt" }],
      details: { resultLimitReached: 1000 },
    };
    const output = formatListResult(result, state, opts, theme, baseConfig, 80);
    expect(output).toContain("Truncated · 2 files");
    expect(output).not.toContain("1000 limit");
  });

  it("keeps the connector dim regardless of truncation", () => {
    const theme = {
      ...mkTheme(),
      fg: (color: string, text: string) => `${color}:${text}`,
    } as Theme;

    expect(
      formatListResult(
        { content: [{ type: "text", text: "a.txt" }] },
        resultStatusState({ truncated: true }),
        opts,
        theme,
        baseConfig,
        80,
      ),
    ).toContain("dim:╰─ ");

    expect(
      formatListResult(
        { content: [{ type: "text", text: "a.txt" }] },
        resultStatusState(),
        opts,
        theme,
        baseConfig,
        80,
      ),
    ).toContain("dim:╰─ ");
  });
});
