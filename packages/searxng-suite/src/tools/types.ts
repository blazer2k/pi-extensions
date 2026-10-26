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
  error?: string;
}
