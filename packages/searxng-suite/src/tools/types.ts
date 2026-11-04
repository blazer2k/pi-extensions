import type { TruncationResult } from "@earendil-works/pi-coding-agent";
import type { ExtractResponse } from "../extractors/shared";

export type ToolStatus = "success" | "aborted" | "error";

export interface SearchToolDetails {
  query: string;
  status: ToolStatus;
  resultCount?: number;
  warnings?: string[];
  error?: string;
}

export interface FetchToolDetails {
  url: string;
  finalUrl?: string;
  status: ToolStatus;
  contentType?: string;
  byteLength?: number;
  fullOutputPath?: string;
  originalPdfPath?: string;
  incomplete?: boolean;
  stopReason?: string;
  // UTF-16 offset after metadata in joined text blocks.
  bodyStart?: number;
  pdfPages?: ExtractResponse["pdfPages"];
  // Counts describe the complete tool text, including source metadata.
  truncation?: Pick<
    TruncationResult,
    "truncated" | "truncatedBy" | "totalLines" | "totalBytes"
  >;
  error?: string;
}
