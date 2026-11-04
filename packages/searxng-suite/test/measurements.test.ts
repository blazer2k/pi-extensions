import { describe, expect, it } from "bun:test";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Theme } from "@earendil-works/pi-coding-agent";
import { formatSize } from "@earendil-works/pi-coding-agent";
import { buildFetchOutput } from "../src/helpers/fetch-output";
import { extractJson } from "../src/extractors/json";
import { extractPlainText } from "../src/extractors/text";
import type { ExtractResponse } from "../src/extractors/shared";
import type { FetchToolDetails } from "../src/tools/types";
import {
  buildFetchContentSummary,
  renderFetchResult,
} from "../src/ui/tool-rendering";

const url = "https://example.test/document";
const theme = { fg: (_color: string, text: string) => text } as Theme;
const noStorage = async (): Promise<string> => {
  throw new Error("Unexpected storage IO");
};
const dto = (
  text: string,
  options: Partial<ExtractResponse> = {},
): ExtractResponse => ({
  sourceUrl: url,
  contentType: "text/plain",
  content: [{ type: "text", text }],
  ...options,
});
const summary = (details: Partial<FetchToolDetails>) =>
  buildFetchContentSummary(
    {
      content: [
        {
          type: "text",
          text: "This text must not substitute for unknown totals.",
        },
      ],
      details: { url, status: "success", ...details },
    },
    theme,
  );
async function withDirectory(run: (directory: string) => Promise<void>) {
  const session = await mkdtemp(join(tmpdir(), "pi-searxng-measurements-"));
  const directory = join(session, "extract");
  try {
    await mkdir(directory, { mode: 0o700 });
    await run(directory);
  } finally {
    await rm(session, { recursive: true, force: true });
  }
}

describe("accepted document measurements", () => {
  for (const [body, lines, bytes] of [
    ["", 0, 0],
    ["one", 1, 3],
    ["one\n", 1, 4],
    ["\n", 1, 1],
    ["\n\n", 2, 2],
    ["a\n\n", 2, 3],
    ["a\r\nb\r\n", 2, 6],
    ["\u754c\u{1f600}", 1, 7],
  ] as const) {
    it(`uses native line counts and UTF-8 bytes for ${JSON.stringify(body)}`, async () => {
      const metadata = "Source metadata with \u{1f600}\n\n";
      const value = await buildFetchOutput(
        dto(metadata + body, { bodyStart: metadata.length }),
        noStorage,
        1000000,
      );
      expect(value.details.textLines).toBe(lines);
      expect(value.details.textBytes).toBe(bytes);
      expect(buildFetchContentSummary(value, theme)).toBe(
        `${lines} ${lines === 1 ? "line" : "lines"}, ${formatSize(bytes)} text`,
      );
    });
  }
  it("counts all text blocks and their existing blank-line separators", async () => {
    const value = await buildFetchOutput(
      {
        ...dto(""),
        content: [
          { type: "text", text: "one" },
          { type: "text", text: "two\n" },
        ],
      },
      noStorage,
      1000000,
    );
    expect(value.details.textLines).toBe(3);
    expect(value.details.textBytes).toBe(9);
    expect(value.content).toEqual([
      { type: "text", text: "one" },
      { type: "text", text: "two\n" },
    ]);
  });
  it("measures validated JSON without source metadata, BOM, or reserialization", async () => {
    const raw = ' {\n "n": 900719925474099312345, "n": 1, "s": "\\u0041"\n}\n';
    const downloaded = Buffer.concat([
      Buffer.from([0xef, 0xbb, 0xbf]),
      Buffer.from(raw),
    ]);
    const extracted = await extractJson(
      url,
      "application/json",
      new Response(downloaded),
      1000000,
    );
    const value = await buildFetchOutput(extracted, noStorage, 1000000);
    expect(value.content[1]).toEqual({ type: "text", text: raw });
    expect(value.details.textLines).toBe(3);
    expect(value.details.textBytes).toBe(Buffer.byteLength(raw));
    expect(value.details.byteLength).toBe(downloaded.length);
    expect(value.details.textBytes).not.toBe(value.details.byteLength);
  });
  it("retains full body totals after model spilling and UI head/tail selection", async () => {
    await withDirectory(async (directory) => {
      const raw = Array.from({ length: 3000 }, (_, i) => `line ${i + 1}`).join(
        "\n",
      );
      const extracted = await extractPlainText(
        url,
        "text/plain",
        new Response(raw),
        1000000,
      );
      const value = await buildFetchOutput(
        extracted,
        async () => directory,
        1000000,
      );
      expect(value.details.textLines).toBe(3000);
      expect(value.details.textBytes).toBe(Buffer.byteLength(raw));
      expect(value.details.truncation!.totalLines).toBeGreaterThan(3000);
      const saved = await readFile(value.details.fullOutputPath!, "utf8");
      expect(saved).toContain("line 3000");
      expect(Buffer.byteLength(saved)).toBeGreaterThan(
        value.details.textBytes!,
      );
      const expected = `3000 lines, ${formatSize(Buffer.byteLength(raw))} text`;
      for (const expanded of [false, true])
        for (const limit of [1, 20, -1]) {
          const component = renderFetchResult(
            value,
            { expanded, isPartial: false },
            theme,
            limit,
            (_id, description) => description,
          );
          expect(component.render(80).join("\n")).toContain(expected);
          expect(component.render(140).join("\n")).toContain(expected);
        }
    });
  });
  it("counts a full huge JSON line even when its inline text preview is empty", async () => {
    await withDirectory(async (directory) => {
      const raw =
        '{"n":900719925474099312345,"data":"' + "x".repeat(60000) + '"}\n';
      const value = await buildFetchOutput(
        dto(raw, { contentType: "application/json" }),
        async () => directory,
        1000000,
      );
      expect(value.details.textLines).toBe(1);
      expect(value.details.textBytes).toBe(Buffer.byteLength(raw));
      expect(value.content[0]).toMatchObject({ type: "text" });
      expect((value.content[0] as { text: string }).text).toContain(
        "No text preview:",
      );
      expect(await readFile(value.details.fullOutputPath!, "utf8")).toBe(raw);
      expect(buildFetchContentSummary(value, theme)).toBe(
        `1 line, ${formatSize(Buffer.byteLength(raw))} text`,
      );
    });
  });
  it("counts PDF page-text headings/separators but not generated source headers", async () => {
    const header =
      "Source URL: example\nContent-Type: application/pdf\nPages: 2\n\n---\n\n";
    const body = "Page 1\n\none\n\n---\n\nPage 2\n\ntwo";
    const value = await buildFetchOutput(
      dto(header + body, {
        contentType: "application/pdf",
        bodyStart: header.length,
        pdfPages: { total: 2, processed: 2, accepted: 2 },
      }),
      noStorage,
      1000000,
    );
    expect(value.details.textLines).toBe(9);
    expect(value.details.textBytes).toBe(29);
    expect(buildFetchContentSummary(value, theme)).toBe("2 pages, 29B text");
  });
  it("keeps no-readable-PDF text diagnostics out of accepted text measurements", async () => {
    const metadata =
      "Source URL: example\nNo readable text was extracted. This does not mean the PDF is empty.";
    const value = await buildFetchOutput(
      dto(metadata, {
        contentType: "application/pdf",
        bodyStart: metadata.length,
        pdfPages: { total: 1, processed: 1, accepted: 1 },
      }),
      noStorage,
      1000000,
    );
    expect(value.details.textLines).toBe(0);
    expect(value.details.textBytes).toBe(0);
    expect(buildFetchContentSummary(value, theme)).toBe(
      "1 page, no readable text",
    );
    expect(value.isError).not.toBe(true);
  });
  it("measures only accepted partial PDF text and preserves processed-versus-accepted metadata", async () => {
    await withDirectory(async (directory) => {
      const header = "Source URL: example\n\n---\n\n";
      const body = "Page 1\n\none";
      const value = await buildFetchOutput(
        dto(header + body, {
          contentType: "application/pdf",
          bodyStart: header.length,
          failure: { cause: new Error("Rejected page") },
          pdfPages: { total: 3, processed: 2, accepted: 1 },
        }),
        async () => directory,
        1000000,
      );
      expect(value.isError).toBe(true);
      expect(value.details.textBytes).toBe(11);
      expect(value.details.textLines).toBe(3);
      expect(value.details.pdfPages).toEqual({
        total: 3,
        processed: 2,
        accepted: 1,
      });
      const output = value.content
        .filter((item) => item.type === "text")
        .map((item) => item.text)
        .join("\n\n");
      expect(output).toContain("2 processed of 3");
      expect(output).toContain("text accepted for pages 1-1");
      expect(await readFile(value.details.fullOutputPath!, "utf8")).toBe(
        header + body,
      );
      const collapsed = renderFetchResult(
        value,
        { expanded: false, isPartial: false },
        theme,
        1,
        (_id, description) => description,
      )
        .render(200)
        .join("\n");
      expect(collapsed).toContain("Rejected page");
      expect(collapsed).not.toContain("11B text");
    });
  });
  it("preserves known totals when saving fails without claiming a completed file", async () => {
    await withDirectory(async (directory) => {
      const raw = "one\n".repeat(3000);
      const value = await buildFetchOutput(dto(raw), async () => directory, 1);
      expect(value.isError).toBe(true);
      expect(value.details.fullOutputPath).toBeUndefined();
      expect(value.details.textLines).toBe(3000);
      expect(value.details.textBytes).toBe(Buffer.byteLength(raw));
    });
  });
  it("does not scan document text or stringify custom reasons after cancellation", async () => {
    const controller = new AbortController();
    const reason = {
      toString() {
        throw new Error("Do not stringify");
      },
    };
    controller.abort(reason);
    const value = await buildFetchOutput(
      {
        ...dto(""),
        content: [
          {
            type: "text",
            get text(): string {
              throw new Error("Do not scan after abort");
            },
          },
        ],
      },
      noStorage,
      1000000,
      controller.signal,
    );
    expect(value.details.status).toBe("aborted");
    expect(value.details.textLines).toBeUndefined();
    expect(value.details.textBytes).toBeUndefined();
  });
  it("leaves image byte reporting and attachments unchanged", async () => {
    const image = {
      type: "image" as const,
      data: "bytes",
      mimeType: "image/png",
    };
    const value = await buildFetchOutput(
      {
        ...dto("Image metadata", {
          contentType: "image/png",
          byteLength: 1024,
        }),
        content: [{ type: "text", text: "Image metadata" }, image],
      },
      noStorage,
      1000000,
    );
    expect(value.details.textLines).toBeUndefined();
    expect(value.details.textBytes).toBeUndefined();
    expect(value.content[1]).toEqual(image);
    expect(buildFetchContentSummary(value, theme)).toBe(
      "Image attached (.png): 1.0KB",
    );
  });
});

describe("measured summary wording and historical results", () => {
  it("uses the agreed text and PDF wording", () => {
    expect(summary({ textLines: 245, textBytes: 12 * 1024 })).toBe(
      "245 lines, 12.0KB text",
    );
    expect(
      summary({
        contentType: "application/pdf",
        pdfPages: { total: 820, processed: 820, accepted: 820 },
        textBytes: Math.round(4.2 * 1024 * 1024),
      }),
    ).toBe("820 pages, 4.2MB text");
  });
  it("omits unknown quantities instead of measuring a historical preview", () => {
    expect(
      summary({
        fullOutputPath: "/not-read/content.txt",
        truncation: {
          truncated: true,
          truncatedBy: "bytes",
          totalLines: 9000,
          totalBytes: 2000000,
        },
      }),
    ).toBe("Text measurements unavailable");
    expect(summary({ textLines: 2 })).toBe("2 lines");
    expect(summary({ textBytes: 12 })).toBe("12B text");
    expect(
      summary({
        contentType: "application/pdf",
        pdfPages: { total: 820, processed: 820, accepted: 820 },
      }),
    ).toBe("820 pages");
    expect(summary({ contentType: "application/pdf", textBytes: 12 })).toBe(
      "12B text",
    );
    expect(
      summary({
        contentType: "application/pdf",
        pdfPages: { total: 0, processed: 0, accepted: 0 },
        textBytes: 0,
      }),
    ).toBe("0 pages, no readable text");
  });
});
