import { homedir } from "node:os";
import { sep } from "node:path";
import { describe, expect, it } from "bun:test";
import {
  countLines,
  extractTextContent,
  normalizeOutput,
  renderPath,
  safeTruncateToWidth,
  sanitizeDisplayText,
  sanitizeMultilineDisplayText,
} from "./text";
import { mkTheme } from "../../testing/helpers";

describe("normalizeOutput", () => {
  it("removes only one trailing newline", () => {
    expect(normalizeOutput("a\n")).toBe("a");
  });

  it("keeps internal newlines when two trailing", () => {
    expect(normalizeOutput("a\n\n")).toBe("a\n");
  });

  it("leaves string without trailing newline unchanged", () => {
    expect(normalizeOutput("hello")).toBe("hello");
  });
});

describe("countLines", () => {
  it("returns 0 for empty string", () => {
    expect(countLines("")).toBe(0);
  });

  it("returns 1 for single line", () => {
    expect(countLines("a")).toBe(1);
  });

  it("handles trailing newline", () => {
    expect(countLines("a\nb\n")).toBe(2);
  });
});

describe("extractTextContent", () => {
  it("joins text content and ignores non-text content", () => {
    const result = {
      content: [
        { type: "text", text: "hello" },
        { type: "image", text: "img-data" },
        { type: "text", text: "world" },
      ],
    };
    expect(extractTextContent(result)).toBe("hello\nworld");
  });

  it("returns empty string when no text content", () => {
    const result = {
      content: [{ type: "image", text: "data" }],
    };
    expect(extractTextContent(result)).toBe("");
  });
});

describe("display sanitizers", () => {
  it("strips private CSI prefixes without consuming text after bare ESC modes", () => {
    for (const sequence of [
      "\x1b[<35;59;1M",
      "\x1b[>4;2m",
      "\x1b[=1h",
      "\x9b<35;59;1M",
    ]) {
      expect(sanitizeDisplayText(`before${sequence}after`)).toBe("beforeafter");
      expect(
        extractTextContent({
          content: [{ type: "text", text: sequence + "kept\n" }],
        }),
      ).toBe("kept\n");
    }
    expect(sanitizeDisplayText("\x1b=123\x1b>456")).toBe("123456");
  });

  it("strips ANSI/OSC sequences and flattens whitespace", () => {
    expect(sanitizeDisplayText("a\x1b[31mred\x1b[0m\n\ttext")).toBe(
      "ared text",
    );
    expect(
      sanitizeDisplayText("x\x1b]8;;https://e.test\x1b\\link\x1b]8;;\x1b\\y"),
    ).toBe("xlinky");
  });

  it("preserves safe newlines for expanded content", () => {
    expect(sanitizeMultilineDisplayText("first\r\n\tsecond")).toBe(
      "first\n second",
    );
  });
});

describe("renderPath", () => {
  it("renders invalid non-string args as error", () => {
    const theme = mkTheme();
    const output = renderPath(123 as unknown as string, theme, "/cwd");
    expect(output).toContain("[invalid arg]");
  });

  it("renders empty path as fallback", () => {
    const theme = mkTheme();
    const output = renderPath("", theme, "/cwd");
    expect(output).toContain("...");
  });

  it("shortens home directory paths", () => {
    const theme = mkTheme();
    const home = homedir();
    const output = renderPath(`${home}${sep}foo`, theme, "/cwd");
    expect(output).toContain(`~${sep}foo`);
  });

  it("supports forward slashes on Windows without treating backslashes as POSIX separators", () => {
    const theme = mkTheme();
    const home = homedir();

    if (sep === "\\") {
      expect(renderPath(`${home}/foo`, theme, "/cwd")).toContain("~/foo");
    } else {
      const siblingPath = `${home}\\foo`;
      expect(renderPath(siblingPath, theme, "/cwd")).toContain(siblingPath);
      expect(renderPath(siblingPath, theme, "/cwd")).not.toContain("~\\foo");
    }
  });

  it("does not shorten paths that only share the home prefix", () => {
    const theme = mkTheme();
    const home = homedir();
    const output = renderPath(`${home}2${sep}foo`, theme, "/cwd");
    expect(output).toContain(`${home}2${sep}foo`);
    expect(output).not.toContain(`~2${sep}foo`);
  });
});

describe("safeTruncateToWidth", () => {
  it("closes open OSC-8 hyperlinks", () => {
    // OSC 8 hyperlink that is never closed
    const open = "\x1b]8;http://example.com;link\x07";
    const result = safeTruncateToWidth(open, 5, "...");
    // Should contain a closing OSC-8 terminator
    expect(result).toContain("\x1b]8;;\x07");
  });
});
