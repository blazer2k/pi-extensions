import { parseHTML } from "linkedom";
import TurndownService from "turndown";
import { readResponseBody, type ResponseBody } from "../helpers/request";
import {
  type ExtractResponse,
  MAX_HTML_BYTES,
  MAX_HTML_CHARS,
  MAX_MARKDOWN_CHARS,
  truncateContent,
} from "./shared";
import { extractContent } from "./content-extractor";

const turndown = new TurndownService({
  headingStyle: "atx",
  hr: "---",
  bulletListMarker: "-",
  codeBlockStyle: "fenced",
});

export function buildMetaString(document: Document): string {
  const meta = (name: string): string =>
    document
      .querySelector(`meta[name="${name}"], meta[property="${name}"]`)
      ?.getAttribute("content") ?? "";

  const title = document.title || meta("og:title") || "Untitled";
  const author = meta("author") || meta("article:author") || "";
  const date =
    meta("article:published_time") ||
    meta("og:published_time") ||
    meta("date") ||
    "";
  const description = meta("description") || meta("og:description") || "";

  const metaString = [
    `Title: ${title}`,
    author ? `Author: ${author}` : null,
    date ? `Published: ${date}` : null,
    description ? `Description: ${description}` : null,
  ]
    .filter(Boolean)
    .join("\n");

  return metaString;
}

function getMarkdownFromHTML(html: Element["innerHTML"]): string {
  return turndown.turndown(html).trimStart();
}

export async function extractHtml(
  sourceUrl: string,
  contentType: string,
  res: ResponseBody,
  signal?: AbortSignal,
  baseUrl = sourceUrl,
): Promise<ExtractResponse> {
  const raw = new TextDecoder().decode(
    await readResponseBody(res, MAX_HTML_BYTES, signal),
  );

  if (raw.length > MAX_HTML_CHARS) {
    throw new Error(
      `Content too large after download: ${raw.length} characters`,
    );
  }

  const { document } = parseHTML(raw);
  const body = document.body;

  if (!body) throw new Error("Fetch returned empty body");

  const html = extractContent(document, baseUrl);
  const metaString = buildMetaString(document);
  const markdown = getMarkdownFromHTML(html);

  const content = [
    `Source URL: ${sourceUrl}`,
    `Content-Type: ${contentType}`,
    "",
    "---",
    "",
    metaString,
    "",
    "---",
    "",
    markdown,
  ].join("\n");

  return {
    sourceUrl,
    contentType,
    content: [
      {
        type: "text" as const,
        text: truncateContent(content, MAX_MARKDOWN_CHARS, "verbose"),
      },
    ],
  };
}
