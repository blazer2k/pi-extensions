import { describe, expect, it, mock } from "bun:test";
import type { ToolRenderers } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { visibleWidth } from "@earendil-works/pi-tui";
import { mkTheme, mkToolCtx, setupCustomTool } from "../../testing/helpers";
import { patchTools } from "../built-ins";
import { createCodemodeRenderers } from "../codemode";

function checkHints(renderers: ToolRenderers, custom = false): void {
  for (const expanded of [false, true]) {
    for (const isError of [false, true]) {
      const keyText = mock(() => "alt+shift+e");
      const context = mkToolCtx({
        args: { path: "example.ts", content: "one\n", command: "echo one" },
        expanded,
        isError,
        keyText,
        state: custom
          ? { _tuiTweaks: { callExpandable: true } }
          : { callExpandable: true },
      });
      const result = renderers.renderResult!(
        {
          content: [{ type: "text", text: "one\ntwo\nthree\nfour" }],
          details: undefined,
        },
        { expanded, isPartial: false },
        mkTheme(),
        context,
      );
      expect(result.render(100).join("\n")).toContain(
        `alt+shift+e to ${expanded ? "collapse" : "expand"}`,
      );
      expect(keyText).toHaveBeenCalledWith("app.tools.expand");
      for (const width of [2, 10, 30, 80]) {
        for (const line of result.render(width)) {
          expect(visibleWidth(line)).toBeLessThanOrEqual(width);
        }
      }
    }
  }
}

describe("host keybinding hints", () => {
  for (const [name, renderers] of patchTools()) {
    it(`uses injected hints for ${name} results and errors`, () => {
      checkHints(renderers);
    });
  }

  it("uses the call context for partial Write previews", () => {
    const keyText = mock(() => "alt+shift+e");
    const result = patchTools().get("write")!.renderCall!(
      { path: "example.ts", content: "one\n" },
      mkTheme(),
      mkToolCtx({ keyText, argsComplete: false, isPartial: true }),
    );
    expect(result.render(100).join("\n")).toContain("alt+shift+e to expand");
    expect(keyText).toHaveBeenCalledWith("app.tools.expand");
  });

  it("uses injected hints for Codemode", () => {
    checkHints(
      createCodemodeRenderers(
        {},
        { isToolCallActive: () => false, reportIssue() {} },
      ),
      true,
    );
  });

  it("uses injected hints in generic custom-tool error fallback", () => {
    const wrapped = setupCustomTool({
      name: "example",
      label: "example",
      description: "example",
      parameters: Type.Object({}),
      async execute() {
        return { content: [], details: undefined };
      },
    });
    try {
      const keyText = mock(() => "alt+shift+e");
      const result = wrapped.renderers.renderResult!(
        {
          content: [{ type: "text", text: "first\nsecond" }],
          details: undefined,
        },
        { expanded: false, isPartial: false },
        mkTheme(),
        mkToolCtx({ keyText, isError: true }),
      );
      expect(result.render(100).join("\n")).toContain("alt+shift+e to expand");
      expect(keyText).toHaveBeenCalledWith("app.tools.expand");
    } finally {
      wrapped.dispose();
    }
  });
});
