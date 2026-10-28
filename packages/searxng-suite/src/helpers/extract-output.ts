import { lstat, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  DEFAULT_MAX_BYTES,
  DEFAULT_MAX_LINES,
  truncateHead,
  withFileMutationQueue,
  type AgentToolResult,
} from "@earendil-works/pi-coding-agent";
import {
  getExtractKind,
  type ExtractKind,
  type ExtractResponse,
} from "../extractors/shared";
import type { ExtractToolDetails } from "../tools/types";
import { buildToolFailure, errorMessage } from "./error";

function getText(content: Array<{ type: string; text?: string }>): string {
  return content
    .filter((item) => item.type === "text")
    .map((item) => item.text ?? "")
    .join("\n\n");
}

async function createDirectory(
  sessionId: string,
  signal?: AbortSignal,
): Promise<string> {
  if (typeof sessionId !== "string" || !/^[a-zA-Z0-9_-]+$/.test(sessionId)) {
    throw new Error("Invalid extraction session ID");
  }
  signal?.throwIfAborted();
  const parent = resolve(tmpdir(), `pi-searxng-session-${sessionId}`);
  try {
    await mkdir(parent, { mode: 0o700 });
  } catch (error) {
    if (
      !(error instanceof Error && "code" in error && error.code === "EEXIST")
    ) {
      throw error;
    }
  }
  const stat = await lstat(parent);
  const uid = process.getuid?.();
  if (
    !stat.isDirectory() ||
    (uid !== undefined && (stat.uid !== uid || (stat.mode & 0o077) !== 0))
  ) {
    throw new Error(
      "Extraction session directory is not a private owned directory",
    );
  }
  signal?.throwIfAborted();
  return mkdtemp(join(parent, "extract-"));
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
  kind: ExtractKind | null,
  getSessionId: () => string,
  sourceInfo: string,
  signal?: AbortSignal,
) {
  let directory: string | undefined;
  try {
    directory = await createDirectory(getSessionId(), signal);
    const filename =
      kind === "html"
        ? "content.md"
        : kind === "json"
          ? "content.json"
          : "content.txt";
    const fullOutputPath = join(directory, filename);
    const output = previewText(
      body,
      `Full output saved to: ${JSON.stringify(fullOutputPath)}\nRead or search the file with available tools.`,
      sourceInfo,
    );
    await withFileMutationQueue(fullOutputPath, async () => {
      signal?.throwIfAborted();
      await writeFile(fullOutputPath, body, {
        encoding: "utf8",
        flag: "wx",
        mode: 0o600,
        signal,
      });
    });
    return { fullOutputPath, output };
  } catch (error) {
    if (directory) {
      try {
        await rm(directory, { recursive: true, force: true });
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

export async function buildExtractOutput(
  result: ExtractResponse,
  getSessionId: () => string,
  signal?: AbortSignal,
): Promise<AgentToolResult<ExtractToolDetails>> {
  const details = {
    url: result.sourceUrl,
    finalUrl: result.finalUrl,
    contentType: result.contentType,
    byteLength: result.byteLength,
  };
  if (signal?.aborted) {
    return buildToolFailure("Extract", details, signal.reason, signal);
  }
  const kind = getExtractKind(result.contentType);
  const sourceInfo =
    kind === "json"
      ? [
          `Source URL: ${result.sourceUrl}`,
          ...(result.finalUrl ? [`Final URL: ${result.finalUrl}`] : []),
          `Content-Type: ${result.contentType}`,
        ].join("\n")
      : "";
  const content = sourceInfo
    ? [{ type: "text" as const, text: sourceInfo }, ...result.content]
    : result.content;
  const fullText = getText(content);
  const full = truncateHead(fullText);
  if (!full.truncated) {
    return { content, details: { ...details, status: "success" } };
  }
  const truncation = {
    truncated: full.truncated,
    truncatedBy: full.truncatedBy,
    totalLines: full.totalLines,
    totalBytes: full.totalBytes,
  };
  const body = kind === "json" ? getText(result.content) : fullText;
  const images = result.content.filter((item) => item.type === "image");
  let savedOutput: { fullOutputPath: string; output: string };
  try {
    savedOutput = await saveOutput(
      body,
      kind,
      getSessionId,
      sourceInfo,
      signal,
    );
  } catch (error) {
    const failure = buildToolFailure(
      "Extract",
      details,
      signal?.aborted
        ? error
        : new Error(`Could not save full output: ${errorMessage(error)}`, {
            cause: error,
          }),
      signal,
    );
    if (signal?.aborted) return failure;
    return {
      ...failure,
      content: [
        {
          type: "text",
          text: previewText(
            body,
            `${getText(failure.content)}\nOnly the preview is available; the full output was not saved.`,
            sourceInfo,
          ),
        },
        ...images,
      ],
      details: { ...failure.details, truncation },
    };
  }
  const { fullOutputPath, output } = savedOutput;
  const completedDetails = { ...details, fullOutputPath, truncation };
  const failure = signal?.aborted
    ? buildToolFailure("Extract", completedDetails, signal.reason, signal)
    : undefined;
  return {
    ...failure,
    content: [
      {
        type: "text",
        text: failure
          ? previewText(
              "",
              `${getText(failure.content)}\nFull output saved to: ${JSON.stringify(fullOutputPath)}`,
              sourceInfo,
            )
          : output,
      },
      ...images,
    ],
    details: failure?.details ?? { ...completedDetails, status: "success" },
  };
}
