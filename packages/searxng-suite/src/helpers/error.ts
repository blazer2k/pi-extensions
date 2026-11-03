import { stripVTControlCharacters } from "node:util";
import type { AgentToolResult } from "@earendil-works/pi-coding-agent";
import { truncateContent } from "../extractors/shared";

export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export function isAbortError(err: unknown): boolean {
  return err instanceof DOMException && err.name === "AbortError";
}

export function isTimeoutError(err: unknown): boolean {
  return err instanceof DOMException && err.name === "TimeoutError";
}

export function buildToolFailure<T extends object>(
  operation: "Search" | "Fetch",
  details: T,
  err: unknown,
  signal?: AbortSignal,
): AgentToolResult<T & { status: "aborted" | "error"; error?: string }> {
  const cause = signal?.aborted ? signal.reason : err;
  const timedOut = isTimeoutError(cause);
  const aborted = !timedOut && (signal?.aborted || isAbortError(cause));
  const message = aborted
    ? ""
    : truncateContent(
        stripVTControlCharacters(errorMessage(cause))
          .replace(/[\u0000-\u001f\u007f-\u009f]/g, " ")
          .replace(/\s+/g, " ")
          .trim(),
        1000,
      );

  return {
    isError: true,
    content: [
      {
        type: "text",
        text: aborted
          ? `${operation} aborted`
          : timedOut
            ? `${operation} timed out`
            : `Error: ${message}`,
      },
    ],
    details: {
      ...details,
      status: aborted ? "aborted" : "error",
      ...(!aborted && { error: message }),
    },
  };
}
