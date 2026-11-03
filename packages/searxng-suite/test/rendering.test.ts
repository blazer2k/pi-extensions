import { describe, expect, it, mock } from "bun:test";
import type {
  ExtensionAPI,
  Theme,
  ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import { getConfig, loadConfig } from "../src/config/store";
import { registerFetchTool } from "../src/tools/fetch";
import { registerSearchTool } from "../src/tools/search";

type RenderContext = Parameters<NonNullable<ToolDefinition["renderResult"]>>[3];

const theme = { fg: (_color: string, text: string) => text } as Theme;

function registerTools(verbose: boolean): ToolDefinition[] {
  const original = getConfig();
  const tools: ToolDefinition[] = [];
  const api = {
    registerTool: (tool: ToolDefinition) => tools.push(tool),
  } as unknown as ExtensionAPI;
  try {
    loadConfig(undefined, {
      prepare() {},
      exists: () => true,
      read: () => JSON.stringify({ ...original, verbose }),
      write() {},
    });
    registerSearchTool(api);
    registerFetchTool(api);
  } finally {
    loadConfig(undefined, {
      prepare() {},
      exists: () => true,
      read: () => JSON.stringify(original),
      write() {},
    });
  }
  return tools;
}

describe("host keybinding hints", () => {
  for (const tool of registerTools(true)) {
    it(`uses the injected expansion hint for ${tool.name}`, () => {
      const keyHint = mock(
        (_key: string, description: string) => `alt+shift+e ${description}`,
      );
      const context = { keyHint } as unknown as RenderContext;
      const result = {
        content: [{ type: "text" as const, text: "x".repeat(1600) }],
        details: { status: "success", resultCount: 2 },
      };
      const render = (expanded: boolean) =>
        tool.renderResult!(
          result,
          { expanded, isPartial: false },
          theme,
          context,
        )
          .render(2000)
          .join("\n");

      expect(render(false)).toContain("100 more chars, alt+shift+e to expand");
      expect(keyHint).toHaveBeenCalledWith("app.tools.expand", "to expand");
      keyHint.mockClear();
      expect(render(true)).toContain("x".repeat(1600));
      expect(keyHint).not.toHaveBeenCalled();

      const error = tool.renderResult!(
        { ...result, details: { status: "error", error: "Fetch failed" } },
        { expanded: false, isPartial: false },
        theme,
        context,
      )
        .render(2000)
        .join("\n");
      expect(error).toContain("Fetch failed");
      expect(error).not.toContain("to expand");
      expect(keyHint).not.toHaveBeenCalled();
    });
  }

  it("keeps compact search count-only", () => {
    const search = registerTools(false).find(
      (tool) => tool.name === "web_search",
    )!;
    const keyHint = mock(() => "unused");
    const output = search.renderResult!(
      {
        content: [{ type: "text", text: "x".repeat(1600) }],
        details: { status: "success", resultCount: 2 },
      },
      { expanded: false, isPartial: false },
      theme,
      { keyHint } as unknown as RenderContext,
    )
      .render(100)
      .join("\n")
      .trim();
    expect(output).toBe("2 results");
    expect(keyHint).not.toHaveBeenCalled();
  });
});
