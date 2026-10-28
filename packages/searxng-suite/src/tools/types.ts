import type { TruncationResult } from "@earendil-works/pi-coding-agent";

export type ToolStatus = "success" | "aborted" | "error";

export interface SearchToolDetails {
  query: string;
  status: ToolStatus;
  resultCount?: number;
  warnings?: string[];
  error?: string;
}

export interface ExtractToolDetails {
  url: string;
  finalUrl?: string;
  status: ToolStatus;
  contentType?: string;
  byteLength?: number;
  fullOutputPath?: string;
  // Counts describe the complete tool text, including source metadata.
  truncation?: Pick<
    TruncationResult,
    "truncated" | "truncatedBy" | "totalLines" | "totalBytes"
  >;
  error?: string;
}
