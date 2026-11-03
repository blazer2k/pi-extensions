import { isAbsolute, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { Theme } from "@earendil-works/pi-coding-agent";
import {
  getCapabilities,
  hyperlink,
  truncateToWidth,
  visibleWidth,
} from "@earendil-works/pi-tui";
import { shortenPath } from "../../shared/path";
import type { ToolTextResult } from "./types";

function truncatePathMiddle(filePath: string, maxWidth: number): string {
  if (maxWidth <= 0) return "";
  if (visibleWidth(filePath) <= maxWidth) return filePath;

  const parts = filePath.split("/");
  const filename = parts.pop() ?? "";
  if (!filename || parts.length === 0) {
    return truncateToWidth(filePath, maxWidth, "...");
  }

  const maxHeadCount = Math.min(parts.length, 6);
  for (let headCount = maxHeadCount; headCount >= 0; headCount--) {
    for (
      let tailCount = parts.length - headCount - 1;
      tailCount >= 0;
      tailCount--
    ) {
      const head = parts.slice(0, headCount);
      const tail = tailCount === 0 ? [] : parts.slice(-tailCount);
      const candidate = [...head, "...", ...tail, filename].join("/");
      if (visibleWidth(candidate) <= maxWidth) return candidate;
    }
  }

  const prefix = ".../";
  const filenameWidth = Math.max(1, maxWidth - visibleWidth(prefix));
  return prefix + truncateToWidth(filename, filenameWidth, "...");
}

export function renderPath(
  rawPath: unknown,
  theme: Theme,
  cwd: string,
  maxWidth?: number,
  emptyFallback = "...",
): string {
  if (rawPath == null || rawPath === "") {
    return theme.fg("toolOutput", emptyFallback);
  }
  if (typeof rawPath !== "string") return theme.fg("error", "[invalid arg]");

  const displayPath = shortenPath(sanitizeDisplayText(rawPath));
  const visiblePath =
    maxWidth === undefined
      ? displayPath
      : truncatePathMiddle(displayPath, maxWidth);
  const styled = theme.fg("accent", visiblePath);
  if (!getCapabilities().hyperlinks) return styled;

  const absolutePath = isAbsolute(rawPath) ? rawPath : resolve(cwd, rawPath);
  return hyperlink(styled, pathToFileURL(absolutePath).href);
}

function getOpenOsc8Terminator(
  text: string,
): "\u0007" | "\u001B\\" | undefined {
  let active: "\u0007" | "\u001B\\" | undefined;
  let index = 0;

  while (index < text.length) {
    const start = text.indexOf("\u001B]8;", index);
    if (start === -1) break;

    const belEnd = text.indexOf("\u0007", start + 4);
    const stEnd = text.indexOf("\u001B\\", start + 4);
    const usesBel = belEnd !== -1 && (stEnd === -1 || belEnd < stEnd);
    const end = usesBel ? belEnd : stEnd;
    if (end === -1) break;

    const body = text.slice(start + 4, end);
    const separator = body.indexOf(";");
    if (separator !== -1) {
      const url = body.slice(separator + 1);
      active = url ? (usesBel ? "\u0007" : "\u001B\\") : undefined;
    }

    index = end + (usesBel ? 1 : 2);
  }

  return active;
}

export function closeOpenHyperlink(text: string): string {
  const terminator = getOpenOsc8Terminator(text);
  return terminator ? `${text}\u001B]8;;${terminator}` : text;
}

export function safeTruncateToWidth(
  text: string,
  maxWidth: number,
  ellipsis = "...",
  pad = false,
): string {
  return closeOpenHyperlink(truncateToWidth(text, maxWidth, ellipsis, pad));
}

export function normalizeOutput(text: string): string {
  return text.endsWith("\n") ? text.slice(0, -1) : text;
}

export function countLines(text: string): number {
  const trimmed = normalizeOutput(text);
  return trimmed.length === 0 ? 0 : trimmed.split("\n").length;
}

export function stripAnsi(value: string): string {
  if (!value.includes("\u001B") && !value.includes("\u009B")) return value;

  // Kept in sync with pi's display sanitizer.
  const st = "(?:\\u0007|\\u001B\\u005C|\\u009C)";
  const osc = `(?:\\u001B\\][\\s\\S]*?${st})`;
  const csi =
    "(?:(?:\\u001B\\[|\\u009B)[<=>]|[\\u001B\\u009B][[\\]()#;?]*)(?:\\d{1,4}(?:[;:]\\d{0,4})*)?[\\dA-PR-TZcf-nq-uy=><~]";
  return value.replace(new RegExp(`${osc}|${csi}`, "g"), "");
}

function sanitizeTextOutput(value: string): string {
  return Array.from(stripAnsi(value))
    .filter((char) => {
      const code = char.codePointAt(0);
      if (code === undefined) return false;
      if (code === 0x09 || code === 0x0a || code === 0x0d) return true;
      if (code <= 0x1f) return false;
      if (code >= 0xfff9 && code <= 0xfffb) return false;
      return true;
    })
    .join("")
    .replace(/\r/g, "");
}

export function sanitizeMultilineDisplayText(value: string): string {
  return sanitizeTextOutput(value).replace(/\t/g, " ");
}

export function sanitizeDisplayText(value: string): string {
  return sanitizeTextOutput(value).replace(/[\n\t]+/g, " ");
}

export function extractTextContent(result: ToolTextResult): string {
  return sanitizeTextOutput(
    result.content
      .filter(
        (content) =>
          content.type === "text" && typeof content.text === "string",
      )
      .map((content) => content.text ?? "")
      .join("\n"),
  );
}
