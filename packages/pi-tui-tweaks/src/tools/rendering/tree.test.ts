import { describe, expect, it } from "bun:test";
import type {
  Theme,
  ToolRenderResultOptions,
} from "@earendil-works/pi-coding-agent";
import { visibleWidth } from "@earendil-works/pi-tui";
import { clearBlinkTimers } from "./state";
import {
  formatOmissionRow,
  formatTreeLine,
  getCallRenderParts,
  getResultText,
} from "./tree";
import { mkTheme } from "../../testing/helpers";

const optsExpanded: ToolRenderResultOptions = {
  expanded: true,
  isPartial: false,
};

describe("formatOmissionRow", () => {
  it("dims the row and italicizes only the hidden count", () => {
    const theme = {
      ...mkTheme(),
      fg: (color: string, text: string) => `<${color}>${text}</${color}>`,
      italic: (text: string) => `<italic>${text}</italic>`,
    } as Theme;

    expect(
      formatOmissionRow(1, { singular: "line", plural: "lines" }, theme),
    ).toBe("<dim>┊  <italic>+1 line</italic></dim>");
  });
});

describe("tree-aware text wrapping", () => {
  it("bounds wide characters at the one-column minimum without losing resized content", () => {
    const text = getResultText({}, optsExpanded, undefined);
    text.setText("│  界界界");
    for (const width of [1, 2, 3, 4, 5]) {
      expect(
        text.render(width).every((line) => visibleWidth(line) <= width),
      ).toBe(true);
    }
    expect(text.render(40).join("\n")).toContain("界界界");
  });

  it("evaluates width-aware text on resize and invalidation", () => {
    const widths: number[] = [];
    const text = getResultText({}, optsExpanded, undefined);
    text.setText((width) => {
      widths.push(width);
      return `╰─ width ${width}`;
    });

    expect(text.render(40).join("\n")).toContain("width 38");
    text.render(40);
    expect(text.render(80).join("\n")).toContain("width 78");
    text.invalidate();
    text.render(80);
    expect(widths).toEqual([38, 78, 78]);

    text.setText("╰─ static text");
    expect(text.render(40).join("\n")).toContain("static text");
    expect(widths).toEqual([38, 78, 78]);
  });

  it("invalidates caller-owned caches and the source component, not on width-only reflow", () => {
    const invalidations: string[] = [];
    const text = getResultText({}, optsExpanded, undefined);
    text.onInvalidate = () => {
      invalidations.push("cache");
    };
    text.setText("source", {
      render: () => ["source"],
      invalidate() {
        invalidations.push("component");
      },
    });
    text.render(40);
    text.render(80);
    expect(invalidations).toEqual([]);
    text.invalidate();
    expect(invalidations).toEqual(["cache", "component"]);
    expect(text.render(80).join("\n")).toContain("source");
  });

  it("reflows reused results when output padding changes at the same width", () => {
    const state = {};
    const text = getResultText(state, optsExpanded, undefined);
    const widths: number[] = [];
    text.setText((width) => {
      widths.push(width);
      return "╰─ " + "界 result ".repeat(12);
    });
    for (const outputPad of [1, 0, 1]) {
      expect(getResultText(state, optsExpanded, text, outputPad)).toBe(text);
      for (const width of [40, 1, 40]) {
        const rows = text.render(width);
        expect(rows.every((row) => visibleWidth(row) <= width)).toBe(true);
        if (width === 40)
          expect(rows[0]!.startsWith(" ")).toBe(outputPad === 1);
      }
    }
    expect(widths).toEqual([38, 1, 38, 40, 1, 40, 38, 1, 38]);
  });

  for (const corner of ["╰", "└"]) {
    it(`prefixes wrapped ${corner} results and closes only the final row`, () => {
      const text = getResultText({}, optsExpanded, undefined);
      text.setText(
        `├─ summary\n${corner}─ a long result line that wraps across several visual rows`,
      );
      const lines = text
        .render(28)
        .map((line) => line.trimEnd().slice(1))
        .filter(Boolean);
      expect(lines.length).toBeGreaterThan(3);
      expect(lines[0]).toStartWith("├─ ");
      expect(lines.slice(1, -1).every((line) => line.startsWith("│  "))).toBe(
        true,
      );
      expect(lines.at(-1)).toStartWith(`${corner}─ `);
    });
  }

  it("preserves content color across wrapped tree rows", () => {
    const dim = "\x1b[90m";
    const error = "\x1b[31m";
    const resetForeground = "\x1b[39m";
    const theme = {
      ...mkTheme(),
      fg: (color: string, value: string) =>
        `${color === "error" ? error : dim}${value}${resetForeground}`,
    } as Theme;
    const text = getResultText({}, optsExpanded, undefined);
    text.setText(
      formatTreeLine(
        "ENOENT: no such file or directory, access '/tmp/pi-tui-tweaks/missing-file.txt'",
        {
          theme,
          prefix: "└─ ",
          color: "error",
        },
      ).text,
    );

    const lines = text.render(52);
    const first = lines.find((line) => line.includes("ENOENT"));
    const second = lines.find((line) => line.includes("missing-file.txt"));
    const hasActiveError = (line: string, content: string) => {
      const contentStart = line.indexOf(content);
      return (
        line.lastIndexOf(error, contentStart) >
        Math.max(
          line.lastIndexOf(dim, contentStart),
          line.lastIndexOf(resetForeground, contentStart),
        )
      );
    };

    expect(first).toBeDefined();
    expect(second).toBeDefined();
    expect(hasActiveError(first!, "ENOENT")).toBe(true);
    expect(hasActiveError(second!, "'/tmp")).toBe(true);
  });

  it("prefixes wrapped tree rows embedded in partial tool calls", () => {
    const { text, prefix } = getCallRenderParts({}, mkTheme(), {
      executionStarted: true,
      isPartial: true,
      invalidate: () => {},
    });
    text.setText(
      `${prefix}Write file\n└─ a long preview line that wraps across visual rows`,
    );

    const lines = text
      .render(28)
      .map((line) => line.trimEnd().slice(1))
      .filter(Boolean);

    expect(lines.slice(1, -1).every((line) => line.startsWith("│  "))).toBe(
      true,
    );
    expect(lines.at(-1)).toStartWith("└─ ");
    clearBlinkTimers();
  });

  it("keeps dotted prefixes on wrapped omission rows", () => {
    const text = getResultText({}, optsExpanded, undefined);
    text.setText(
      "├─ took 562ms · ctrl+o to expand\n┊  +12345678901234567890 lines\n│  visible tail line\n╰─ last line",
    );

    const lines = text
      .render(28)
      .map((line) => line.trimEnd().slice(1))
      .filter(Boolean);

    expect(lines.every((line) => /^[├│╰┊]/u.test(line))).toBe(true);
    expect(
      lines.filter((line) => line.startsWith("┊  ")).length,
    ).toBeGreaterThanOrEqual(2);
    expect(lines.at(-1)).toStartWith("╰─ ");
  });
});
