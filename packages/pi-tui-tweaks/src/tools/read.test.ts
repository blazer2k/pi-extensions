import { describe, expect, it } from "bun:test";
import { getPackageDir, type Theme } from "@earendil-works/pi-coding-agent";
import { join } from "node:path";
import { stripAnsi } from "./rendering/text";
import { patchReadTool } from "./read";
import { mkTheme, mkToolCtx, setupTool } from "../testing/helpers";
import { PI_0_84_3_OUTPUT } from "./test-fixtures/pi-0.84.3";

function setupReadTool() {
  return setupTool(patchReadTool);
}

describe("read renderCall", () => {
  it("renders normal path", () => {
    const def = setupReadTool();
    const renderCall = def.renderCall!;
    const theme = mkTheme();
    const ctx = mkToolCtx();

    const component = renderCall({ path: "src/index.ts" }, theme, ctx);

    const text = component.render(120).join("\n");
    expect(text).toContain("Read");
    expect(text).toContain("src/index.ts");
  });

  it("renders line range as dim", () => {
    const def = setupReadTool();
    const renderCall = def.renderCall!;
    const theme = {
      ...mkTheme(),
      fg: (color: string, text: string) => `${color}:${text}`,
    } as Theme;
    const ctx = mkToolCtx();

    const component = renderCall(
      { path: "src/index.ts", offset: 10, limit: 5 },
      theme,
      ctx,
    );

    const text = component.render(120).join("\n");
    expect(text).toContain("dim::10-14");
  });

  for (const { name, args, range } of [
    {
      name: "null offset and limit",
      args: { offset: null, limit: null },
      range: "",
    },
    { name: "null offset", args: { offset: null, limit: 5 }, range: ":1-5" },
    { name: "null limit", args: { offset: 10, limit: null }, range: ":10" },
  ]) {
    it(`treats ${name} as absent`, () => {
      const def = setupReadTool();
      const path = "src/index.ts";

      for (const expanded of [false, true]) {
        const text = stripAnsi(
          def.renderCall!({ path, ...args }, mkTheme(), mkToolCtx({ expanded }))
            .render(120)
            .join("\n"),
        );

        expect(text).toContain(`${path}${range}`);
        if (!range) expect(text).not.toContain(`${path}:`);
        if (range === ":10") expect(text).not.toContain(`${path}:10-`);
      }
    });
  }

  it("formats raw ranges consistently in normal, resource, docs, and skill headers", () => {
    const def = setupReadTool();
    const paths = [
      "src/index.ts",
      "/tmp/read-ranges/AGENTS.md",
      join(getPackageDir(), "docs", "extensions.md"),
      "/tmp/read-ranges/my-skill/SKILL.md",
    ];
    for (const [offset, limit, range] of [
      [25, 13, ":25-37"],
      ["25", "13", ":25-37"],
      [null, "13", ":1-13"],
      ["25", null, ":25"],
      ["abc", 13, ""],
      [25, "", ""],
      [25, "Infinity", ""],
      [NaN, 13, ""],
      [false, 13, ""],
      [25, [], ""],
    ] as const) {
      for (const path of paths)
        for (const expanded of [false, true]) {
          const ranges: string[] = [];
          const theme = {
            ...mkTheme(),
            fg: (color: string, value: string) => {
              if (color === "dim" && value.startsWith(":")) ranges.push(value);
              return value;
            },
          } as Theme;
          const args = { path, offset, limit };
          const snapshot = structuredClone(args);
          const output = def.renderCall!(
            args,
            theme,
            mkToolCtx({
              expanded,
              executionStarted: false,
              state: { hasResult: true },
            }),
          )
            .render(240)
            .map(stripAnsi)
            .join("\n");
          expect([...new Set(ranges)]).toEqual(range ? [range] : []);
          if (range) expect(output).toContain(range);
          expect(args).toEqual(snapshot);
        }
    }
  });

  it("expands a truncated path and adds call-driven result hints", () => {
    const def = setupReadTool();
    const state = {};
    const path = `/tmp/${"segment/".repeat(12)}target.txt`;
    const args = { path };
    const collapsedCtx = mkToolCtx({ state, args });
    const collapsed = def.renderCall!(args, mkTheme(), collapsedCtx)
      .render(120)
      .join("\n");
    expect(collapsed).toContain("...");

    const collapsedResult = def.renderResult!(
      {
        content: [{ type: "text", text: "line1\nline2" }],
        details: undefined,
      },
      { expanded: false, isPartial: false },
      mkTheme(),
      collapsedCtx,
    );
    expect(collapsedResult.render(120).join("\n")).toContain("to expand");

    const expandedCtx = mkToolCtx({ expanded: true, state, args });
    const expanded = def.renderCall!(args, mkTheme(), expandedCtx)
      .render(40)
      .join("\n");
    expect(expanded).toContain("segment");
    expect(expanded).toContain("│  ");

    const expandedResult = def.renderResult!(
      {
        content: [{ type: "text", text: "line1\nline2" }],
        details: undefined,
      },
      { expanded: true, isPartial: false },
      mkTheme(),
      expandedCtx,
    );
    expect(expandedResult.render(120).join("\n")).toContain("to collapse");
  });

  it("uses compact skill format for SKILL.md and expands to its full path", () => {
    const def = setupReadTool();
    const renderCall = def.renderCall!;
    const theme = mkTheme();
    const ctx = mkToolCtx();

    const skillPath = `${process.cwd()}/some-skill/SKILL.md`;
    const component = renderCall({ path: skillPath }, theme, ctx);

    const text = component.render(120).join("\n");
    expect(text).toContain("[skill]");
    expect(text).toContain("some-skill");

    const expanded = renderCall({ path: skillPath }, theme, {
      ...ctx,
      expanded: true,
    })
      .render(50)
      .join("\n");
    expect(expanded).toContain("Read");
    expect(expanded).toContain("SKILL.md");
    expect(expanded).not.toContain("[skill]");
  });
});

describe("read renderResult", () => {
  it("excludes continuation notices from text line counts", () => {
    const def = setupReadTool();
    const renderResult = def.renderResult!;
    const component = renderResult(
      {
        content: [
          {
            type: "text",
            text: `line1\nline2\nline3\nline4\n\n${PI_0_84_3_OUTPUT.read.moreLines}`,
          },
        ],
        details: undefined,
      },
      { expanded: false, isPartial: false },
      mkTheme(),
      mkToolCtx(),
    );

    expect(component.render(120).join("\n")).toContain("4 lines");
  });

  it("counts tool-truncated content without its generated footer", () => {
    const def = setupReadTool();
    const renderResult = def.renderResult!;
    const component = renderResult(
      {
        content: [
          {
            type: "text",
            text: `line1\nline2\n\n${PI_0_84_3_OUTPUT.read.showingLines}`,
          },
        ],
        details: { truncation: { truncated: true } },
      },
      { expanded: false, isPartial: false },
      mkTheme(),
      mkToolCtx(),
    );

    expect(component.render(120).join("\n")).toContain("Truncated · 2 lines");
  });

  it("does not strip ordinary bracketed file content", () => {
    const def = setupReadTool();
    const renderResult = def.renderResult!;
    const component = renderResult(
      {
        content: [{ type: "text", text: "line1\n\n[ordinary note]" }],
        details: undefined,
      },
      { expanded: false, isPartial: false },
      mkTheme(),
      mkToolCtx(),
    );

    expect(component.render(120).join("\n")).toContain("3 lines");
  });

  it("reports image dimensions", () => {
    const def = setupReadTool();
    const renderResult = def.renderResult!;
    const theme = mkTheme();
    const ctx = mkToolCtx();

    const component = renderResult(
      {
        content: [
          { type: "image", data: "image-data", mimeType: "image/png" },
          { type: "text", text: "original 640x480" },
        ],
        details: undefined,
      },
      { expanded: false, isPartial: false },
      theme,
      ctx,
    );

    const output = component.render(120).join("\n");
    expect(output).toContain("Image (640x480)");
  });

  it("shows the model's image warning collapsed and expanded", () => {
    const renderResult = setupReadTool().renderResult!;
    for (const expanded of [false, true]) {
      const component = renderResult(
        {
          content: [
            { type: "image", data: "image-data", mimeType: "image/png" },
          ],
          details: { imageUnsupportedByModel: "text-only-model" },
        },
        { expanded, isPartial: false },
        mkTheme(),
        mkToolCtx({ expanded }),
      );

      const output = component.render(120).join("\n");
      expect(output).toContain(
        "text-only-model does not support images; it saw a placeholder instead",
      );
      expect(output).toContain("╰─ Image");
    }
  });

  it("reports image processing failures instead of text lines", () => {
    const def = setupReadTool();
    const renderResult = def.renderResult!;
    const theme = {
      ...mkTheme(),
      fg: (color: string, text: string) => `${color}:${text}`,
    } as Theme;
    const component = renderResult(
      {
        content: [
          {
            type: "text",
            text: "Read image file [image/png]\n[Image omitted: resize failed.]",
          },
        ],
        details: undefined,
      },
      { expanded: false, isPartial: false },
      theme,
      mkToolCtx(),
    );

    const output = component.render(120).join("\n");
    expect(output).toContain("│  muted:Image omitted: resize failed.");
    expect(output).toContain("╰─ warning:Image unavailable");
    expect(output).not.toContain("2 lines");
  });

  it("keeps the image warning style when the reason wraps", () => {
    const def = setupReadTool();
    const renderResult = def.renderResult!;
    const warningOpen = "\x1b[33m";
    const theme = {
      ...mkTheme(),
      fg: (color: string, text: string) => {
        const open =
          color === "warning"
            ? warningOpen
            : color === "muted"
              ? "\x1b[90m"
              : color === "dim"
                ? "\x1b[2m"
                : "";
        return `${open}${text}\x1b[0m`;
      },
    } as Theme;
    const component = renderResult(
      {
        content: [
          {
            type: "text",
            text: "Read image file [image/png]\n[Image omitted: could not be resized below the inline image size limit.]",
          },
        ],
        details: undefined,
      },
      { expanded: false, isPartial: false },
      theme,
      mkToolCtx(),
    );

    const warningLine = component
      .render(45)
      .find((line) => line.includes("Image unavailable"));
    expect(warningLine).toContain(`${warningOpen}Image unavailable`);
  });

  it("reports no content when empty", () => {
    const def = setupReadTool();
    const renderResult = def.renderResult!;
    const theme = mkTheme();
    const ctx = mkToolCtx();

    const component = renderResult(
      {
        content: [{ type: "text", text: "" }],
        details: undefined,
      },
      { expanded: false, isPartial: false },
      theme,
      ctx,
    );

    const output = component.render(120).join("\n");
    expect(output).toContain("no content");
  });
});
