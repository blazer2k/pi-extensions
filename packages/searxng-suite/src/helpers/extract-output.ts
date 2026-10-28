import { join } from "node:path";
import {
  DEFAULT_MAX_BYTES,
  DEFAULT_MAX_LINES,
  truncateHead,
  type AgentToolResult,
} from "@earendil-works/pi-coding-agent";
import { getExtractKind, type ExtractResponse } from "../extractors/shared";
import type { ExtractToolDetails } from "../tools/types";
import { buildToolFailure, errorMessage } from "./error";
import {
  removeEmptyExtractionDirectory,
  writeExtractionFile,
} from "./extract-files";

function getText(content: Array<{ type: string; text?: string }>): string {
  return content
    .filter((item) => item.type === "text")
    .map((item) => item.text ?? "")
    .join("\n\n");
}

function fileNotices(
  details: Pick<ExtractToolDetails, "originalPdfPath" | "fullOutputPath">,
): string {
  return [
    details.originalPdfPath
      ? `Original PDF: ${JSON.stringify(details.originalPdfPath)}`
      : "",
    details.fullOutputPath
      ? `Full output saved to: ${JSON.stringify(details.fullOutputPath)}`
      : "",
  ]
    .filter(Boolean)
    .join("\n");
}

function previewText(text: string, notice: string, sourceInfo = ""): string {
  const emptyPreview =
    "No text preview: the first line exceeds the remaining inline byte limit.";
  const metadataNotice = "Source metadata shortened to fit the inline limit.";
  const reserved = `${notice}\n\n${emptyPreview}\n\n${metadataNotice}\n\n`;
  const maxBytes = DEFAULT_MAX_BYTES - Buffer.byteLength(reserved, "utf8");
  const maxLines = DEFAULT_MAX_LINES - truncateHead(reserved).totalLines;
  if (maxBytes < 0 || maxLines < 0) {
    throw new Error("Output file notice is too long for the inline limits");
  }
  const source = truncateHead(sourceInfo, { maxBytes, maxLines });
  const header = [
    notice,
    source.truncated ? metadataNotice : "",
    source.content,
  ]
    .filter(Boolean)
    .join("\n\n");
  const preview = truncateHead(text, {
    maxBytes: DEFAULT_MAX_BYTES - Buffer.byteLength(`${header}\n\n`, "utf8"),
    maxLines: DEFAULT_MAX_LINES - truncateHead(header).totalLines - 1,
  });
  return [
    header,
    preview.firstLineExceedsLimit ? emptyPreview : preview.content,
  ]
    .filter(Boolean)
    .join("\n\n");
}

async function saveOutput(
  body: string,
  result: ExtractResponse,
  getOutputDirectory: () => Promise<string>,
  sourceInfo: string,
  signal?: AbortSignal,
) {
  let directory: string | undefined;
  try {
    directory = await getOutputDirectory();
    const kind = getExtractKind(result.contentType);
    const filename =
      kind === "html"
        ? "content.md"
        : kind === "json"
          ? "content.json"
          : "content.txt";
    const fullOutputPath = join(directory, filename);
    const output = previewText(
      body,
      `${fileNotices({ ...result, fullOutputPath })}\nRead or search the file with available tools.`,
      sourceInfo,
    );
    await writeExtractionFile(fullOutputPath, body, signal);
    return { fullOutputPath, output };
  } catch (error) {
    if (directory) {
      try {
        await removeEmptyExtractionDirectory(directory);
      } catch (cleanupError) {
        if (!signal?.aborted) {
          throw new Error(
            `${errorMessage(error)}; unfinished-file cleanup failed: ${errorMessage(cleanupError)}`,
            { cause: error },
          );
        }
      }
    }
    throw error;
  }
}

function outputFailure(
  details: Omit<ExtractToolDetails, "status">,
  cause: unknown,
  signal?: AbortSignal,
  content: ExtractResponse["content"] = [],
  sourceInfo = "",
): AgentToolResult<ExtractToolDetails> {
  const failure = buildToolFailure("Extract", details, cause, signal);
  const paths = fileNotices(details);
  if (signal?.aborted && !paths) return failure;
  const body = signal?.aborted ? "" : getText(content);
  const notice = paths
    ? `Extract incomplete\n${paths}`
    : getText(failure.content);
  const diagnostic = paths
    ? [getText(failure.content), sourceInfo].filter(Boolean).join("\n")
    : sourceInfo;
  const previewNotice =
    body && !details.fullOutputPath
      ? details.originalPdfPath
        ? "\nOnly the text preview is available; full text was not saved."
        : "\nOnly the preview is available; the full output was not saved."
      : details.originalPdfPath && !details.fullOutputPath
        ? "\nNo extracted PDF text is available in this response."
        : "";
  return {
    ...failure,
    content: [
      {
        type: "text",
        text: previewText(body, notice + previewNotice, diagnostic),
      },
      ...content.filter((item) => item.type === "image"),
    ],
  };
}

export async function buildExtractOutput(
  result: ExtractResponse,
  getOutputDirectory: () => Promise<string>,
  signal?: AbortSignal,
): Promise<AgentToolResult<ExtractToolDetails>> {
  const details = {
    url: result.sourceUrl,
    finalUrl: result.finalUrl,
    contentType: result.contentType,
    byteLength: result.byteLength,
    ...(result.originalPdfPath && { originalPdfPath: result.originalPdfPath }),
  };
  const kind = getExtractKind(result.contentType);
  const sourceInfo =
    kind === "json" || result.failure
      ? [
          `Source URL: ${result.sourceUrl}`,
          ...(result.finalUrl ? [`Final URL: ${result.finalUrl}`] : []),
          `Content-Type: ${result.contentType}`,
        ].join("\n")
      : "";
  if (signal?.aborted || result.failure) {
    return outputFailure(
      details,
      result.failure?.cause,
      signal,
      result.content,
      sourceInfo,
    );
  }
  const prefix = [fileNotices(details), sourceInfo].filter(Boolean).join("\n");
  const content = prefix
    ? [{ type: "text" as const, text: prefix }, ...result.content]
    : result.content;
  const full = truncateHead(getText(content));
  if (!full.truncated) {
    return { content, details: { ...details, status: "success" } };
  }
  const truncation = {
    truncated: full.truncated,
    truncatedBy: full.truncatedBy,
    totalLines: full.totalLines,
    totalBytes: full.totalBytes,
  };
  const body = getText(result.content);
  let savedOutput: { fullOutputPath: string; output: string };
  try {
    savedOutput = await saveOutput(
      body,
      result,
      getOutputDirectory,
      sourceInfo,
      signal,
    );
  } catch (error) {
    return outputFailure(
      { ...details, truncation },
      signal?.aborted
        ? error
        : new Error(`Could not save full output: ${errorMessage(error)}`, {
            cause: error,
          }),
      signal,
      result.content,
      sourceInfo,
    );
  }
  const { fullOutputPath, output } = savedOutput;
  const completedDetails = { ...details, fullOutputPath, truncation };
  const images = result.content.filter((item) => item.type === "image");
  if (signal?.aborted) {
    return outputFailure(
      completedDetails,
      signal.reason,
      signal,
      images,
      sourceInfo,
    );
  }
  return {
    content: [{ type: "text", text: output }, ...images],
    details: { ...completedDetails, status: "success" },
  };
}
