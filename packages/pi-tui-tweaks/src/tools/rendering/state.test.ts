import { describe, expect, it } from "bun:test";
import type { Theme } from "@earendil-works/pi-coding-agent";
import {
  buildExpansionHint,
  buildResultStatusParts,
  buildToolExpansionHint,
  clearBlinkTimers,
  getStatusColor,
  getStatusSymbol,
  updateResultState,
} from "./state";
import { formatTreeLine, getCallRenderParts } from "./tree";
import type { BaseRenderState } from "./types";
import { getConfig } from "../../config/store";
import { mkTheme, mkToolCtx, setTestConfig } from "../../testing/helpers";

describe("updateResultState", () => {
  it("returns true only when state changes", () => {
    const state: BaseRenderState = {};
    const changed = updateResultState(state, {
      hasResult: true,
      truncated: false,
      isError: false,
    });
    expect(changed).toBe(true);

    const same = updateResultState(state, {
      hasResult: true,
      truncated: false,
      isError: false,
    });
    expect(same).toBe(false);
  });
});

describe("result status rendering", () => {
  it("keeps truncation metadata but drops error metadata", () => {
    const theme = {
      ...mkTheme(),
      fg: (color: string, text: string) => `${color}:${text}`,
    } as Theme;

    expect(
      buildResultStatusParts({ isError: true, truncated: true }, theme),
    ).toEqual(["muted:Truncated"]);
  });

  it("always colors tree connectors with the healthy default", () => {
    const theme = {
      ...mkTheme(),
      fg: (color: string, text: string) => `${color}:${text}`,
    } as Theme;

    const output = formatTreeLine("failure", {
      theme,
      prefix: "╰─ ",
      color: "error",
    }).text;

    expect(output).toStartWith("dim:╰─ ");
    expect(output).toContain("error:failure");
  });
});

describe("buildExpansionHint", () => {
  it("returns a middle-dot-prefixed expand hint without parens", () => {
    const hint = buildExpansionHint(mkTheme(), "expand", mkToolCtx().keyText);
    expect(hint).toStartWith(" · ");
    expect(hint).toContain("to expand");
    expect(hint).not.toContain("(");
  });

  it("returns a middle-dot-prefixed collapse hint without parens", () => {
    const hint = buildExpansionHint(mkTheme(), "collapse", mkToolCtx().keyText);
    expect(hint).toStartWith(" · ");
    expect(hint).toContain("to collapse");
    expect(hint).not.toContain("(");
  });

  it("uses call expandability when the result itself is static", () => {
    const hint = buildToolExpansionHint(
      mkTheme(),
      { callExpandable: true },
      { expanded: false },
      false,
      mkToolCtx().keyText,
    );
    expect(hint).toContain("to expand");
  });

  it("returns empty hints when showExpansionHint is disabled", () => {
    const originalHint = getConfig().tools.showExpansionHint;
    setTestConfig({
      tools: {
        showExpansionHint: false,
      },
    });
    try {
      const theme = mkTheme();
      expect(buildExpansionHint(theme, "expand", mkToolCtx().keyText)).toBe("");
      expect(buildExpansionHint(theme, "collapse", mkToolCtx().keyText)).toBe(
        "",
      );
    } finally {
      setTestConfig({
        tools: {
          showExpansionHint: originalHint,
        },
      });
    }
  });
});

describe("tool call blink rendering", () => {
  it("captures blink phase once for symbol and color", () => {
    const originalNow = Date.now;
    let calls = 0;
    Date.now = () => (calls++ === 0 ? 0 : 500);

    try {
      const theme = {
        ...mkTheme(),
        fg: (color: string, text: string) => `[${color}]${text}`,
      } as Theme;
      const state: BaseRenderState = {};
      const { prefix } = getCallRenderParts(state, theme, {
        executionStarted: true,
        isPartial: false,
        invalidate: () => {},
      });

      expect(prefix).toBe("[success]● ");
    } finally {
      Date.now = originalNow;
      clearBlinkTimers();
    }
  });

  it("invalidates active blinkers from one shared aligned timer", () => {
    clearBlinkTimers();
    const originalNow = Date.now;
    const originalSetTimeout = globalThis.setTimeout;
    const originalClearTimeout = globalThis.clearTimeout;
    const scheduled: Array<{ callback: () => void; delay: number }> = [];
    const invalidated: string[] = [];

    Date.now = () => 100;
    globalThis.setTimeout = ((callback: () => void, delay?: number) => {
      scheduled.push({ callback, delay: delay ?? 0 });
      return { id: scheduled.length };
    }) as unknown as typeof setTimeout;
    globalThis.clearTimeout = (() => {}) as unknown as typeof clearTimeout;

    try {
      const theme = mkTheme();
      for (const id of ["a", "b", "c"]) {
        getCallRenderParts({}, theme, {
          executionStarted: true,
          isPartial: false,
          invalidate: () => invalidated.push(id),
        });
      }

      expect(scheduled).toHaveLength(1);
      expect(scheduled[0]!.delay).toBe(400);

      scheduled[0]!.callback();
      expect(invalidated).toEqual(["a", "b", "c"]);
      expect(scheduled).toHaveLength(2);
    } finally {
      Date.now = originalNow;
      globalThis.setTimeout = originalSetTimeout;
      globalThis.clearTimeout = originalClearTimeout;
      clearBlinkTimers();
    }
  });

  it("renders a static pending state when animation is disabled", () => {
    const state: BaseRenderState = {};
    const { prefix } = getCallRenderParts(
      state,
      mkTheme(),
      {
        executionStarted: true,
        isPartial: true,
        invalidate: () => {},
      },
      { animate: false },
    );

    expect(prefix).toBe("○ ");
    expect(state.blinkTimer).toBeUndefined();
  });

  it("uses the configured color for filled and completed indicators", () => {
    const originalColor = getConfig().tools.indicator.color;

    try {
      for (const color of ["success", "text", "toolTitle"] as const) {
        setTestConfig({
          tools: {
            indicator: {
              color: color,
            },
          },
        });
        expect(getStatusColor(false, true)).toBe(color);
        expect(getStatusColor(false, false)).toBe("dim");
        expect(getStatusColor(true, true)).toBe(color);
        expect(getStatusColor(true, false)).toBe(color);
      }
    } finally {
      setTestConfig({
        tools: {
          indicator: {
            color: originalColor,
          },
        },
      });
    }
  });

  it("renders configured indicator style symbols", () => {
    const originalStyle = getConfig().tools.indicator.style;
    try {
      setTestConfig({
        tools: {
          indicator: {
            style: "dot",
          },
        },
      });
      expect(getStatusSymbol(true, false)).toBe("•");
      expect(getStatusSymbol(false, true)).toBe("•");
      expect(getStatusSymbol(false, false)).toBe("◦");

      setTestConfig({
        tools: {
          indicator: {
            style: "diamond",
          },
        },
      });
      expect(getStatusSymbol(true, false)).toBe("◆");
      expect(getStatusSymbol(false, true)).toBe("◆");
      expect(getStatusSymbol(false, false)).toBe("◇");
    } finally {
      setTestConfig({
        tools: {
          indicator: {
            style: originalStyle,
          },
        },
      });
    }
  });
});

// --- formatListResult tests ---
