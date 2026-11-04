import { join } from "node:path";
import {
  DEFAULT_MAX_BYTES,
  DEFAULT_MAX_LINES,
  truncateHead,
  type AgentToolResult,
} from "@earendil-works/pi-coding-agent";
import { getExtractKind, type ExtractResponse } from "../extractors/shared";
import type { FetchToolDetails } from "../tools/types";
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
  details: Pick<
    FetchToolDetails,
    "originalPdfPath" | "fullOutputPath" | "incomplete"
  >,
): string {
  return [
    details.originalPdfPath
      ? `Original PDF: ${JSON.stringify(details.originalPdfPath)}`
      : "",
    details.fullOutputPath
      ? `${details.incomplete ? "Partial" : "Full"} output saved to: ${JSON.stringify(details.fullOutputPath)}`
      : "",
  ]
    .filter(Boolean)
    .join("\n");
}

function previewText(
  text: string,
  notice: string,
  sourceInfo = "",
  bodyStart = 0,
) {
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
  const output = [
    header,
    preview.firstLineExceedsLimit ? emptyPreview : preview.content,
  ]
    .filter(Boolean)
    .join("\n\n");
  const start = preview.firstLineExceedsLimit
    ? output.length
    : output.length -
      preview.content.length +
      Math.min(bodyStart, preview.content.length);
  return { output, bodyStart: start };
}

async function saveOutput(
  body: string,
  result: ExtractResponse,
  getOutputDirectory: () => Promise<string>,
  sourceInfo: string,
  signal: AbortSignal | undefined,
  maxSessionStorageBytes: number,
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
    const fullOutputPath = join(
      directory,
      result.failure
        ? filename.replace("content.", "content.partial.")
        : filename,
    );
    const preview = previewText(
      body,
      `${fileNotices({ ...result, fullOutputPath, incomplete: Boolean(result.failure) })}\nRead or search the file with available tools.`,
      sourceInfo,
      result.bodyStart,
    );
    await writeExtractionFile(
      fullOutputPath,
      body,
      maxSessionStorageBytes,
      signal,
    );
    return { fullOutputPath, ...preview };
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
  details: Omit<FetchToolDetails, "status">,
  cause: unknown,
  signal?: AbortSignal,
  content: ExtractResponse["content"] = [],
  sourceInfo = "",
  bodyStart = 0,
): AgentToolResult<FetchToolDetails> {
  const failure = buildToolFailure("Fetch", details, cause, signal);
  const paths = fileNotices(details);
  if (signal?.aborted && !paths) return failure;
  const body = signal?.aborted ? "" : getText(content);
  const notice = paths
    ? `Fetch incomplete\n${paths}`
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
  const preview = previewText(
    body,
    notice + previewNotice,
    diagnostic,
    bodyStart,
  );
  return {
    ...failure,
    content: [
      { type: "text", text: preview.output },
      ...content.filter((item) => item.type === "image"),
    ],
    details: { ...failure.details, bodyStart: preview.bodyStart },
  };
}

async function incompleteOutput(
  result: ExtractResponse,
  details: Omit<FetchToolDetails, "status">,
  getOutputDirectory: () => Promise<string>,
  sourceInfo: string,
  signal: AbortSignal | undefined,
  maxSessionStorageBytes: number,
): Promise<AgentToolResult<FetchToolDetails>> {
  const cause = result.failure?.cause;
  if (
    result.failure &&
    getExtractKind(result.contentType) !== "json" &&
    !signal?.aborted &&
    getText(result.content)
  ) {
    try {
      const saved = await saveOutput(
        getText(result.content),
        result,
        getOutputDirectory,
        sourceInfo,
        signal,
        maxSessionStorageBytes,
      );
      details = { ...details, fullOutputPath: saved.fullOutputPath };
    } catch (error) {
      if (!signal?.aborted) {
        const diagnostic = getText(
          buildToolFailure("Fetch", {}, error).content,
        );
        sourceInfo += `\nCould not save partial output: ${diagnostic}`;
      }
    }
  }
  return outputFailure(
    details,
    cause,
    signal,
    result.content,
    sourceInfo,
    result.bodyStart,
  );
}

export async function buildFetchOutput(
  result: ExtractResponse,
  getOutputDirectory: () => Promise<string>,
  maxSessionStorageBytes: number,
  signal?: AbortSignal,
): Promise<AgentToolResult<FetchToolDetails>> {
  const kind = getExtractKind(result.contentType);
  const measured =
    signal?.aborted || kind === "image" || (kind === "json" && result.failure)
      ? undefined
      : truncateHead(getText(result.content).slice(result.bodyStart ?? 0));
  const details = {
    url: result.sourceUrl,
    finalUrl: result.finalUrl,
    contentType: result.contentType,
    byteLength: result.byteLength,
    ...(result.originalPdfPath && { originalPdfPath: result.originalPdfPath }),
    ...(result.failure && { incomplete: true }),
    ...(result.stopReason && { stopReason: result.stopReason }),
    ...(result.pdfPages && { pdfPages: result.pdfPages }),
    ...(measured && {
      textLines: measured.totalLines,
      textBytes: measured.totalBytes,
    }),
  };
  const sourceInfo =
    kind === "json" || result.failure
      ? [
          `Source URL: ${result.sourceUrl}`,
          ...(result.finalUrl ? [`Final URL: ${result.finalUrl}`] : []),
          `Content-Type: ${result.contentType}`,
          ...(result.pdfPages
            ? [
                `PDF pages: ${result.pdfPages.processed} processed of ${result.pdfPages.total ?? "unknown"}; text accepted for ${result.pdfPages.accepted ? `pages 1-${result.pdfPages.accepted}` : "no pages"}.`,
              ]
            : []),
          ...(result.stopReason ? [result.stopReason] : []),
        ].join("\n")
      : "";
  if (signal?.aborted || result.failure) {
    return incompleteOutput(
      result,
      details,
      getOutputDirectory,
      sourceInfo,
      signal,
      maxSessionStorageBytes,
    );
  }
  const prefix = [fileNotices(details), sourceInfo].filter(Boolean).join("\n");
  const content = prefix
    ? [{ type: "text" as const, text: prefix }, ...result.content]
    : result.content;
  const full = truncateHead(getText(content));
  if (!full.truncated) {
    const text = getText(content);
    const body = getText(result.content);
    const start =
      text.length -
      body.length +
      (kind === "image"
        ? body.length
        : Math.min(result.bodyStart ?? 0, body.length));
    return {
      content,
      details: {
        ...details,
        status: "success",
        bodyStart: start,
      },
    };
  }
  const truncation = {
    truncated: full.truncated,
    truncatedBy: full.truncatedBy,
    totalLines: full.totalLines,
    totalBytes: full.totalBytes,
  };
  const body = getText(result.content);
  let savedOutput: Awaited<ReturnType<typeof saveOutput>>;
  try {
    savedOutput = await saveOutput(
      body,
      result,
      getOutputDirectory,
      sourceInfo,
      signal,
      maxSessionStorageBytes,
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
      result.bodyStart,
    );
  }
  const { fullOutputPath, output, bodyStart } = savedOutput;
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
    details: { ...completedDetails, status: "success", bodyStart },
  };
}
