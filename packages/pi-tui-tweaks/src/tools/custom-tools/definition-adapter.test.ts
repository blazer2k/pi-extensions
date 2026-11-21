import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import { Text, visibleWidth } from "@earendil-works/pi-tui";
import { loadConfig } from "../../config/store";
import {
  mkTheme,
  mkToolCtx,
  setupCustomTool,
  setTestConfig,
} from "../../testing/helpers";
import { clearBlinkTimers } from "../rendering/state";
import { stripAnsi } from "../rendering/text";
import type { BaseRenderState } from "../rendering/types";
import { createWrappedRenderers } from "./definition-adapter";

const originalPath = process.env.PI_TUI_TWEAKS_CONFIG_PATH;
let directory: string;
beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), "pi-tui-tweaks-custom-renderers-"));
  process.env.PI_TUI_TWEAKS_CONFIG_PATH = join(directory, "settings.json");
  loadConfig();
  setTestConfig({
    tools: {
      capitalizeNames: false,
    },
  });
});
afterEach(() => {
  clearBlinkTimers();
  rmSync(directory, { recursive: true, force: true });
  if (originalPath === undefined) delete process.env.PI_TUI_TWEAKS_CONFIG_PATH;
  else process.env.PI_TUI_TWEAKS_CONFIG_PATH = originalPath;
  loadConfig();
});
function tool(name = "myTool"): ToolDefinition {
  return {
    name,
    label: name,
    description: name,
    parameters: {} as any,
    execute: async () => ({ content: [], details: undefined }),
  };
}
function wrap(definition: ToolDefinition) {
  return createWrappedRenderers(definition.name, definition, {
    isToolCallActive: () => false,
    reportIssue() {},
  });
}
function plain(
  component: { render(width: number): readonly string[] },
  width = 80,
) {
  return component.render(width).map(stripAnsi).join("\n");
}
const result = {
  content: [{ type: "text" as const, text: "one\ntwo" }],
  details: undefined,
};
const resultOptions = { expanded: false, isPartial: false };

describe("custom renderer adapters", () => {
  for (const failure of ["missing", "factory", "layout"] as const) {
    it(`uses the tool identifier rather than a custom label for ${failure} call rendering`, () => {
      const definition = tool("web_search");
      definition.label = "Web Search";
      if (failure === "factory")
        definition.renderCall = () => {
          throw new Error("factory failed");
        };
      if (failure === "layout")
        definition.renderCall = () => ({
          render() {
            throw new Error("layout failed");
          },
          invalidate() {},
        });
      const issues: unknown[] = [];
      const fixture = setupCustomTool(definition, undefined, (issue) => {
        issues.push(issue);
      });
      for (const enabled of [false, true]) {
        setTestConfig({
          tools: {
            capitalizeNames: enabled,
          },
        });
        for (let repeat = 0; repeat < 2; repeat++) {
          const component = fixture.renderers.renderCall!(
            { query: "mixed Case", count: 5 },
            mkTheme(),
            mkToolCtx(),
          );
          for (const width of [40, 80, 120]) {
            const output = plain(component, width);
            expect(output).toContain(enabled ? "Web_search" : "web_search");
            expect(output).not.toContain("Web Search");
            expect(output).toContain('query="mixed Case"');
            expect(
              component
                .render(width)
                .every((row) => visibleWidth(row) <= width),
            ).toBe(true);
          }
        }
      }
      expect(issues).toHaveLength(failure === "missing" ? 0 : 1);
      if (failure !== "missing")
        expect(issues[0]).toEqual(
          expect.objectContaining({
            stage: "renderCall",
            toolName: "web_search",
          }),
        );
      fixture.dispose();
    });
  }

  it("uses named closing corners for native and fallback results without rewriting content", () => {
    const payload = "payload ╰─ and └─";
    for (const treeCorner of ["rounded", "square"] as const) {
      setTestConfig({ tools: { treeCorner } });
      const corner = treeCorner === "square" ? "└" : "╰";
      for (const hasRenderer of [false, true]) {
        const definition = tool();
        if (hasRenderer)
          definition.renderResult = () => new Text(payload, 0, 0);
        const renderer = wrap(definition).renderResult!;
        const input = {
          content: [{ type: "text" as const, text: payload }],
          details: undefined,
        };
        expect(
          plain(
            renderer(
              input,
              { ...resultOptions, expanded: true },
              mkTheme(),
              mkToolCtx(),
            ),
          ),
        ).toContain(`${corner}─ ${payload}`);
        expect(
          plain(renderer(input, resultOptions, mkTheme(), mkToolCtx())),
        ).toContain(`${corner}─ ${hasRenderer ? payload : "1 line"}`);
      }
    }
  });

  it("preserves safe ANSI styling from original call rendering", () => {
    const definition = tool();
    definition.renderCall = (_args, theme) =>
      new Text(theme.fg("toolTitle", "search") + " query", 0, 0);
    const theme = mkTheme();
    theme.fg = (_color, text) => `\x1b[35m${text}\x1b[39m`;
    const component = wrap(definition).renderCall!(
      { query: "query" },
      theme,
      mkToolCtx(),
    );
    expect(component.render(80).join("\n")).toContain("\x1b[35msearch\x1b[39m");
  });

  it("keeps collapsed calls compact and preserves all expanded multiline content", () => {
    const definition = tool("codemode");
    const flags: boolean[] = [];
    definition.renderCall = (_args, _theme, context) => {
      flags.push(context.expanded);
      return new Text(
        `codemode\n\x1b[32mconst message = "${"x".repeat(160)}";\x1b[39m\n\n  return message;`,
        0,
        0,
      );
    };
    const wrapped = wrap(definition);
    const collapsed = wrapped.renderCall!({}, mkTheme(), mkToolCtx());
    expect(collapsed.render(120)).toHaveLength(1);
    expect(plain(collapsed, 120)).toContain("...");
    expect(plain(collapsed, 120)).not.toContain("return message;");
    const expanded = wrapped.renderCall!(
      {},
      mkTheme(),
      mkToolCtx({ expanded: true }),
    );
    for (const width of [40, 80, 120]) {
      const rows = expanded.render(width);
      const output = rows.map(stripAnsi).join("\n");
      expect(rows.every((row) => visibleWidth(row) <= width)).toBe(true);
      expect(output).toContain("codemode");
      expect(output).toContain("│    return message;");
      expect(output.match(/x/g)).toHaveLength(160);
      expect(output).not.toContain("...");
      expect(rows.map(stripAnsi).map((row) => row.trim())).toContain("│");
      expect(rows.join("\n")).toContain("\x1b[32m");
    }
    expect(flags).toEqual([false, true]);
  });

  it("preserves extra native content supplied only in expanded calls", () => {
    const definition = tool("mcp");
    definition.renderCall = (_args, _theme, context) =>
      new Text(context.expanded ? "mcp\n  full argument" : "mcp preview", 0, 0);
    const wrapped = wrap(definition);
    expect(plain(wrapped.renderCall!({}, mkTheme(), mkToolCtx()))).toContain(
      "mcp preview",
    );
    const expanded = plain(
      wrapped.renderCall!({}, mkTheme(), mkToolCtx({ expanded: true })),
    );
    expect(expanded).toContain("│    full argument");
    expect(expanded).not.toContain("mcp preview");
  });

  it("sizes native result previews to the viewport and forwards invalidation", () => {
    const widths: number[] = [];
    let invalidations = 0;
    const definition = tool("preview");
    definition.renderResult = () => ({
      render(width) {
        widths.push(width);
        const rows = new Text(
          `\x1b[32m${"x".repeat(2000)}\x1b[39m`,
          0,
          0,
        ).render(width);
        return [...rows.slice(0, 5), `hidden: ${rows.length - 5}`];
      },
      invalidate() {
        invalidations++;
      },
    });
    const component = wrap(definition).renderResult!(
      { content: [], details: undefined },
      resultOptions,
      mkTheme(),
      mkToolCtx(),
    );
    for (const width of [40, 80, 120, 40]) {
      const rows = component.render(width);
      expect(rows.every((row) => visibleWidth(row) <= width)).toBe(true);
      expect(
        rows.map(stripAnsi).filter((row) => /^[│╰─ ]*x+\s*$/.test(row)),
      ).toHaveLength(5);
      expect(plain(component, width)).toContain(
        `hidden: ${Math.ceil(2000 / (width - 5)) - 5}`,
      );
      expect(rows.join("\n")).toContain("\x1b[32m");
    }
    expect(widths).toEqual([35, 75, 115, 35]);
    component.invalidate();
    component.render(40);
    expect(invalidations).toBe(1);
    expect(widths).toEqual([35, 75, 115, 35, 35]);
  });

  it("keeps custom calls on one row at narrow viewport widths", () => {
    const definition = tool("search");
    definition.renderCall = () => new Text("search " + "x".repeat(200), 0, 0);
    const component = wrap(definition).renderCall!({}, mkTheme(), mkToolCtx());
    for (const width of [40, 80, 120, 40]) {
      expect(component.render(width)).toHaveLength(1);
      expect(plain(component, width)).toContain("...");
      expect(visibleWidth(component.render(width)[0]!)).toBeLessThanOrEqual(
        width,
      );
    }
  });

  it("trims padded native result lines before adding tree prefixes", () => {
    const definition = tool();
    definition.renderResult = () => new Text("10 results", 0, 0);
    const output = plain(
      wrap(definition).renderResult!(
        { content: [], details: undefined },
        resultOptions,
        mkTheme(),
        mkToolCtx(),
      ),
    );
    expect(output.trim()).toBe("╰─ 10 results");
  });

  for (const failure of ["missing", "factory", "layout"] as const) {
    it(`uses generic results for ${failure} result rendering`, () => {
      const definition = tool();
      if (failure === "factory")
        definition.renderResult = () => {
          throw new Error("factory failed");
        };
      if (failure === "layout")
        definition.renderResult = () => ({
          render() {
            throw new Error("layout failed");
          },
          invalidate() {},
        });
      const issues: unknown[] = [];
      const fixture = setupCustomTool(definition, undefined, (issue) => {
        issues.push(issue);
      });
      const output = plain(
        fixture.renderers.renderResult!(
          result,
          resultOptions,
          mkTheme(),
          mkToolCtx(),
        ),
      );
      expect(output).toContain("2 lines");
      expect(issues).toHaveLength(failure === "missing" ? 0 : 1);
      fixture.dispose();
    });
  }

  it("keeps blank successful native displays empty, including image results", () => {
    const definition = tool();
    definition.renderResult = () => new Text("   ", 0, 0);
    const wrapped = wrap(definition);
    for (const expanded of [false, true]) {
      const output = plain(
        wrapped.renderResult!(
          {
            content: [
              { type: "text", text: "native renderer chose to hide this" },
              { type: "image", mimeType: "image/png", data: "AA==" },
            ],
            details: { truncation: { truncated: true } },
          },
          { ...resultOptions, expanded },
          mkTheme(),
          mkToolCtx({ expanded }),
        ),
      );
      expect(output.trim()).toBe("╰─ Truncated · (no output)");
    }
  });

  it("retains actual error content when the native result display is blank", () => {
    const definition = tool();
    definition.renderResult = () => new Text("   ", 0, 0);
    const wrapped = wrap(definition);
    for (const expanded of [false, true]) {
      const output = plain(
        wrapped.renderResult!(
          {
            content: [{ type: "text", text: "actual failure" }],
            details: { truncation: { truncated: true } },
          },
          { ...resultOptions, expanded },
          mkTheme(),
          mkToolCtx({ expanded, isError: true }),
        ),
      );
      expect(output).toContain("actual failure");
      expect(output).toContain("Truncated");
      expect(output).not.toContain("(no output)");
    }
  });

  for (const active of [false, true]) {
    it(`schedules blink invalidation only for active=${active} custom calls`, () => {
      const fixture = setupCustomTool(tool(), () => active);
      const state: BaseRenderState = {};
      fixture.renderers.renderCall!(
        {},
        mkTheme(),
        mkToolCtx({ state: { _tuiTweaks: state }, isPartial: true }),
      ).render(80);
      expect(state.blinkTimer !== undefined).toBe(active);
      fixture.dispose();
      expect(state.blinkTimer).toBeUndefined();
    });
  }

  it("keeps one blink through partial results and stops it on completion", () => {
    const fixture = setupCustomTool(tool(), () => true);
    const wrapped = fixture.renderers;
    const state: BaseRenderState = {};
    const context = mkToolCtx({
      state: { _tuiTweaks: state },
      isPartial: true,
    });
    wrapped.renderCall!({}, mkTheme(), context).render(80);
    const timer = state.blinkTimer;
    expect(timer).toBeDefined();
    for (const output of ["working", "still working"]) {
      wrapped.renderResult!(
        { content: [{ type: "text", text: output }], details: undefined },
        { expanded: false, isPartial: true },
        mkTheme(),
        context,
      ).render(80);
      expect(state.hasResult).toBe(false);
      wrapped.renderCall!({}, mkTheme(), context).render(80);
      expect(state.blinkTimer).toBe(timer);
    }
    wrapped.renderResult!(result, resultOptions, mkTheme(), {
      ...context,
      isPartial: false,
    }).render(80);
    expect(state.hasResult).toBe(true);
    expect(state.blinkTimer).toBeUndefined();
    fixture.dispose();
  });

  it("shows truncation without extra error metadata before custom output", () => {
    const definition = tool();
    definition.renderResult = () => new Text("failure details", 0, 0);
    const state: BaseRenderState = {};
    const output = plain(
      wrap(definition).renderResult!(
        { ...result, details: { truncation: { truncated: true } } },
        resultOptions,
        mkTheme(),
        mkToolCtx({ state: { _tuiTweaks: state }, isError: true }),
      ),
    );
    expect(output).toContain("Truncated");
    expect(output).toContain("failure details");
    expect(output).not.toContain("error ·");
    expect(state.truncated).toBe(true);
  });

  it("marks generic results truncated from tool details", () => {
    const state: BaseRenderState = {};
    const output = plain(
      wrap(tool()).renderResult!(
        { ...result, details: { truncation: { truncated: true } } },
        resultOptions,
        mkTheme(),
        mkToolCtx({ state: { _tuiTweaks: state } }),
      ),
    );
    expect(output).toContain("Truncated · 2 lines");
    expect(state.truncated).toBe(true);
  });

  for (const enabled of [false, true]) {
    it(`preserves native header wording and safe ANSI with capitalization=${enabled}`, () => {
      setTestConfig({
        tools: {
          capitalizeNames: enabled,
        },
      });
      for (const title of [
        "search",
        "\x1b[35msearch\x1b[39m",
        "\x1b[?25l\x1bsearch",
      ]) {
        const definition = tool();
        definition.label = "Web Search";
        definition.renderCall = () => new Text(title + " latest news", 0, 0);
        const output = plain(
          wrap(definition).renderCall!({}, mkTheme(), mkToolCtx()),
        );
        expect(output).toContain(enabled ? "Search" : "search");
        expect(output).not.toContain("Web Search");
        expect(output).toContain("latest news");
      }
    });
  }
});
