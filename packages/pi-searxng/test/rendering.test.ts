import { describe, expect, it, mock } from "bun:test";
import type {
  AgentToolResult,
  ExtensionAPI,
  Theme,
  ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import { truncateHead } from "@earendil-works/pi-coding-agent";
import { stripTerminalSequences, visibleWidth } from "@earendil-works/pi-tui";
import { getConfig, loadConfig } from "../src/config/store";
import { registerFetchTool } from "../src/tools/fetch";
import { registerSearchTool } from "../src/tools/search";
import type { FetchToolDetails } from "../src/tools/types";
import { buildFetchOutput } from "../src/helpers/fetch-output";
import { extractPlainText } from "../src/extractors/text";
import { extractHtml } from "../src/extractors/html";

type RenderContext = Parameters<NonNullable<ToolDefinition["renderResult"]>>[3];
const theme = {
  fg: (_color: string, text: string) => text,
  bold: (text: string) => `\x1b[1m${text}\x1b[22m`,
} as Theme;
const keyHint = mock(
  (_key: string, description: string) => `alt+shift+e ${description}`,
);
const context = { keyHint } as unknown as RenderContext;

function registerTools(fetchPreviewLines = 20): ToolDefinition[] {
  const original = getConfig();
  const tools: ToolDefinition[] = [];
  const api = {
    registerTool: (tool: ToolDefinition) => tools.push(tool),
  } as unknown as ExtensionAPI;
  const load = (saved: unknown) =>
    loadConfig(undefined, {
      prepare() {},
      exists: () => true,
      read: () => JSON.stringify(saved),
      write() {},
    });
  try {
    load({ ...original, fetchPreviewLines });
    registerSearchTool(api);
    registerFetchTool(api);
  } finally {
    load(original);
  }
  return tools;
}

function result(
  body: string,
  metadata = "",
): AgentToolResult<FetchToolDetails> {
  return {
    content: [{ type: "text", text: metadata + body }],
    details: {
      url: "https://example.test",
      status: "success",
      bodyStart: metadata.length,
      textLines: truncateHead(body).totalLines,
      textBytes: Buffer.byteLength(body, "utf8"),
    },
  };
}
function component(
  value: AgentToolResult<FetchToolDetails>,
  limit = 20,
  expanded = true,
) {
  const fetch = registerTools(limit).find((tool) => tool.name === "web_fetch")!;
  return fetch.renderResult!(
    value,
    { expanded, isPartial: false },
    theme,
    context,
  );
}
function text(value: ReturnType<typeof component>, width = 100): string {
  return stripTerminalSequences(
    value
      .render(width)
      .map((line) => line.trimEnd())
      .join("\n"),
  ).trim();
}
const lines = (count: number) =>
  Array.from({ length: count }, (_, i) => `line ${i + 1}`).join("\n");

describe("native expansion and fetch previews", () => {
  for (const [limit, head, tail] of [
    [6, 3, 3],
    [5, 3, 2],
    [1, 1, 0],
  ]) {
    it(`splits a ${limit}-line budget without counting metadata`, () => {
      const output = text(
        component(
          result(
            lines(10),
            "Source metadata\nFull output saved to: /tmp/example\n",
          ),
          limit,
        ),
      );
      const visible = output
        .split("\n")
        .filter((line) => /^line \d+$/.test(line));
      expect(visible).toEqual([
        ...Array.from({ length: head! }, (_, i) => `line ${i + 1}`),
        ...Array.from({ length: tail! }, (_, i) => `line ${11 - tail! + i}`),
      ]);
      expect(output).toContain(`+${10 - limit!} lines`);
      expect(output).toContain("Source metadata");
      expect(output).toContain("Full output saved to: /tmp/example");
      expect(output).not.toContain("to expand");
    });
  }
  it("handles empty, exact, one extra and unlimited content", () => {
    expect(text(component(result(""), 1))).not.toContain("+1 line");
    expect(text(component(result(lines(3)), 3))).not.toContain("+1 line");
    expect(text(component(result(lines(4)), 3))).toContain("+1 line");
    const output = text(component(result(lines(30)), -1));
    expect(output).toContain(lines(30));
    expect(output).not.toMatch(/\+\d+ lines?/);
  });
  it("counts internal blank lines, trailing lines and document headings", () => {
    const output = text(component(result("# Heading\n\nPage 1\n\nlast\n"), 3));
    expect(output).toContain("# Heading\n\n+3 lines\n");
    expect(output).not.toContain("Page 1");
    expect(output).not.toContain("last");
  });
  it("clips long lines even below N and restores them on resize", () => {
    const value = result("x".repeat(250));
    const before = structuredClone(value);
    const view = component(value, 20);
    const narrow = text(view, 30);
    expect(narrow).toContain("x".repeat(27) + "...");
    expect(narrow).not.toContain("x".repeat(30));
    expect(narrow).not.toContain("+1 line");
    expect(text(view, 300)).toContain("x".repeat(250));
    expect(text(view, 30)).toBe(narrow);
    view.invalidate();
    expect(text(view, 30)).toBe(narrow);
    expect(value).toEqual(before);
    expect(text(component(value, -1), 30)).toContain("x".repeat(30) + "\n");
  });
  it("uses ANSI-aware width and keeps Unicode/tab clipping valid", () => {
    const view = component(
      result("\x1b[31m" + "\u754c\u{1f600}\t".repeat(30) + "\x1b[39m"),
      2,
    );
    for (const width of [4, 7, 20, 80]) {
      const rendered = view.render(width);
      expect(rendered.every((line) => visibleWidth(line) <= width)).toBe(true);
      expect(rendered.join("\n")).not.toContain("\ufffd");
      expect(stripTerminalSequences(rendered.join("\n"))).not.toContain("\x1b");
    }
  });
  it("shows host-provided expand and collapse hints beside unchanged fetch summaries", () => {
    keyHint.mockClear();
    const value = result(lines(8));
    const collapsed = text(component(value, 2, false));
    expect(collapsed).toStartWith("8 lines, 55B text");
    expect(collapsed).toEndWith("alt+shift+e to expand");
    expect(keyHint).toHaveBeenCalledWith("app.tools.expand", "to expand");
    keyHint.mockClear();
    expect(text(component(value, 2))).toContain("alt+shift+e to collapse");
    expect(keyHint).toHaveBeenCalledWith("app.tools.expand", "to collapse");
  });
  it("keeps errors, partial status and file paths outside N", () => {
    const value = result(
      lines(12),
      "Fetch incomplete\nOriginal PDF: /tmp/original.pdf\nPartial output saved to: /tmp/content.partial.txt\nError: processing stopped\n",
    );
    value.isError = true;
    Object.assign(value.details, {
      status: "error",
      incomplete: true,
      error: "processing stopped",
      originalPdfPath: "/tmp/original.pdf",
      fullOutputPath: "/tmp/content.partial.txt",
    });
    const output = text(component(value, 2));
    expect(output).toContain("processing stopped");
    expect(output).toContain("Original PDF: /tmp/original.pdf");
    expect(output).toContain(
      "Partial output saved to: /tmp/content.partial.txt",
    );
    expect(output).toContain("Returned text preview");
    expect(output).toContain("+10 lines");
    expect(text(component(value, 2, false))).toBe(
      "processing stopped \u00b7 alt+shift+e to expand",
    );
  });
  it("renders historical/missing metadata honestly without hiding file references", () => {
    const value = result(lines(8));
    delete value.details.bodyStart;
    value.details.originalPdfPath = "/tmp/original.pdf";
    expect(text(component(value, 2))).toContain("/tmp/original.pdf");
    value.details.status = "aborted";
    expect(text(component(value, 2, false))).toBe(
      "Aborted \u00b7 alt+shift+e to expand",
    );
    expect(text(component(value, 2))).toContain("/tmp/original.pdf");
  });
  it("keeps search count-only collapsed and complete expanded regardless of fetch limit", () => {
    const search = registerTools(1).find((tool) => tool.name === "web_search")!;
    const output =
      "Search warnings:\n- engine timeout\n\n" +
      Array.from(
        { length: 40 },
        (_, i) => `${i + 1}. Title\nURL: https://example.test/${i}\nSnippet`,
      ).join("\n\n") +
      "\n\nCorrections: term\n\nSuggestions: another";
    const value = {
      content: [{ type: "text" as const, text: output }],
      details: { status: "success", resultCount: 40 },
    };
    const render = (expanded: boolean) =>
      text(
        search.renderResult!(
          value,
          { expanded, isPartial: false },
          theme,
          context,
        ),
        200,
      );
    expect(render(false)).toBe("40 results \u00b7 alt+shift+e to expand");
    expect(render(true)).toBe(output + "\nalt+shift+e to collapse");
    expect(render(true)).not.toMatch(/\+\d+ lines/);
    value.details.status = "error";
    Object.assign(value.details, { error: "Search failed" });
    expect(render(false)).toBe("Search failed \u00b7 alt+shift+e to expand");
    expect(render(true)).toContain(output);
  });
  it("does not advertise search expansion without available detail text", () => {
    const search = registerTools().find((tool) => tool.name === "web_search")!;
    keyHint.mockClear();
    const output = search.renderResult!(
      { content: [], details: { status: "success", resultCount: 0 } },
      { expanded: false, isPartial: false },
      theme,
      context,
    );
    expect(text(output)).toBe("No results");
    expect(keyHint).not.toHaveBeenCalled();
  });
  it("bolds only titles and leaves incomplete arguments harmless", () => {
    for (const tool of registerTools()) {
      const value = tool.renderCall!(
        {
          query: "MiXeD query",
          url: "https://example.test/MiXeD",
          category: "news",
        },
        theme,
        {} as never,
      )
        .render(500)
        .join("\n");
      expect(value).toContain(`\x1b[1m${tool.label}\x1b[22m`);
      expect(value).not.toContain("\x1b[1mMiXeD");
      const empty = tool.renderCall!({}, theme, {} as never)
        .render(100)
        .join("\n");
      expect(empty).not.toContain("undefined");
    }
  });
});

describe("execution-owned preview ranges", () => {
  const noStorage = async (): Promise<string> => {
    throw new Error("Unexpected file IO");
  };
  for (const kind of ["text", "html"] as const) {
    it(`excludes generated ${kind} metadata without parsing content headings`, async () => {
      const raw =
        kind === "html"
          ? "<html><head><title>Title</title></head><body><article><h1>Inside</h1><p>first</p><p>last</p></article></body></html>"
          : "# Inside\nfirst\nlast";
      const response = new Response(raw);
      const extracted =
        kind === "html"
          ? await extractHtml(
              "https://example.test",
              "text/html",
              response,
              10000,
            )
          : await extractPlainText(
              "https://example.test",
              "text/plain",
              response,
              10000,
            );
      const value = await buildFetchOutput(extracted, noStorage, 10000);
      const start = value.details.bodyStart!;
      const rawText = value.content
        .filter((item) => item.type === "text")
        .map((item) => item.text)
        .join("\n\n");
      expect(rawText.slice(0, start)).toContain("Source URL:");
      if (kind === "html")
        expect(rawText.slice(0, start)).toContain("Title: Title");
      expect(rawText.slice(start)).toStartWith("# Inside");
      expect(text(component(value, 1))).toContain("# Inside");
      expect(text(component(value, 1))).toContain("Source URL:");
    });
  }
  it("keeps exact JSON and image attachments unchanged", async () => {
    const raw = '{ "n": 999999999999999999, "n": 1 }';
    const content = [{ type: "text" as const, text: raw }];
    const value = await buildFetchOutput(
      {
        sourceUrl: "https://example.test",
        contentType: "application/json",
        content,
      },
      noStorage,
      10000,
    );
    expect(value.content[1]).toEqual(content[0]!);
    expect(text(component(value, 1))).toContain(raw);
    const image = {
      type: "image" as const,
      data: "image-bytes",
      mimeType: "image/png",
    };
    const imageResult = await buildFetchOutput(
      {
        sourceUrl: "https://example.test",
        contentType: "image/png",
        byteLength: 12,
        content: [{ type: "text", text: "Image metadata" }, image],
      },
      noStorage,
      10000,
    );
    expect(imageResult.content[1]).toEqual(image);
    expect(text(component(imageResult, 1, false))).toBe(
      "Image attached (.png): 12B \u00b7 alt+shift+e to expand",
    );
    expect(text(component(imageResult, 1))).toContain("Image metadata");
  });
});
