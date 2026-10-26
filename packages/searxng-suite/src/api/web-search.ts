import { stripVTControlCharacters } from "node:util";
import { parseHTML } from "linkedom";
import { Type } from "typebox";
import { Compile } from "typebox/compile";
import { createTimeoutSignal } from "../helpers/request";
import { getValidUrl } from "../helpers/url";
import { truncateContent } from "../extractors/shared";

export interface SearchOptions {
  limit: number;
  timeoutMs: number;
  safesearch: 0 | 1 | 2;
  category?: string;
  signal?: AbortSignal;
}

export const SEARCH_CATEGORIES = [
  "general",
  "news",
  "science",
  "videos",
] as const;

export interface SearchResult {
  title: string;
  url: string;
  content: string;
  engine: string;
}

export interface SearchResponse {
  results: SearchResult[];
  warnings?: string[];
  suggestions?: string[];
  corrections?: string[];
}

// SearxNG can return null for otherwise textual result fields.
const SearchResultSchema = Type.Object({
  title: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  url: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  content: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  engine: Type.Optional(Type.Union([Type.String(), Type.Null()])),
});

const SearchResponseSchema = Type.Object({
  results: Type.Array(SearchResultSchema),
  unresponsive_engines: Type.Optional(Type.Unknown()),
  suggestions: Type.Optional(Type.Unknown()),
  corrections: Type.Optional(Type.Unknown()),
});

const searchResponseValidator = Compile(SearchResponseSchema);

function cleanSearchText(value: string, maxChars: number): string {
  const { document } = parseHTML("<html><body></body></html>");
  const element = document.createElement("div");
  element.innerHTML = value;
  element.querySelectorAll("script, style").forEach((node) => node.remove());
  const text = stripVTControlCharacters(element.innerText)
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return truncateContent(text, maxChars);
}

function cleanSearchHints(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === "string")
    .map((item) => cleanSearchText(item, 200))
    .filter(Boolean)
    .slice(0, 5);
}

function engineWarnings(value: unknown): string[] {
  if (value == null) return [];
  if (!Array.isArray(value)) {
    return ["SearxNG returned invalid engine diagnostics."];
  }

  const warnings: string[] = [];
  let problemCount = 0;
  let invalidCount = 0;
  for (const entry of value) {
    if (
      !Array.isArray(entry) ||
      entry.length !== 2 ||
      typeof entry[0] !== "string" ||
      typeof entry[1] !== "string"
    ) {
      invalidCount++;
      continue;
    }
    const engine = cleanSearchText(entry[0], 50);
    const reason = cleanSearchText(entry[1], 200);
    if (!engine || !reason) {
      invalidCount++;
      continue;
    }
    problemCount++;
    if (warnings.length < 10) warnings.push(`${engine}: ${reason}`);
  }
  if (problemCount > warnings.length) {
    warnings.push(
      `${problemCount - warnings.length} more reported engine problems omitted.`,
    );
  }
  if (invalidCount) {
    warnings.push(
      `SearxNG returned ${invalidCount} invalid engine diagnostic entries.`,
    );
  }
  return warnings;
}

function normalizeSearchResponse(raw: unknown): SearchResponse {
  if (!searchResponseValidator.Check(raw)) {
    throw new Error("Invalid SearxNG response shape");
  }

  const warnings = engineWarnings(raw.unresponsive_engines);
  const suggestions = cleanSearchHints(raw.suggestions);
  const corrections = cleanSearchHints(raw.corrections);

  return {
    ...(warnings.length && { warnings }),
    ...(suggestions.length && { suggestions }),
    ...(corrections.length && { corrections }),
    results: raw.results.flatMap((result) => {
      const url = getValidUrl(result.url ?? "", true);
      if (!url) return [];
      return [
        {
          title: cleanSearchText(result.title ?? "", 200) || "Untitled",
          url,
          content: cleanSearchText(result.content ?? "", 1000),
          engine: cleanSearchText(result.engine ?? "", 50) || "unknown",
        },
      ];
    }),
  };
}

export async function webSearch(
  query: string,
  options: SearchOptions,
): Promise<SearchResponse> {
  const baseUrl = process.env.SEARXNG_URL || "http://localhost:8888";

  const url = new URL("/search", baseUrl);
  url.searchParams.set("q", query);
  url.searchParams.set("format", "json");
  url.searchParams.set("safesearch", options.safesearch.toString());

  if (options.category) {
    if (!SEARCH_CATEGORIES.some((category) => category === options.category)) {
      throw new Error(`Invalid search category: ${options.category}`);
    }

    url.searchParams.set("categories", options.category);
  }

  const headers: Record<string, string> = {
    Accept: "application/json",
  };

  const apiKey = process.env.SEARXNG_API_KEY;
  if (apiKey) {
    headers.Authorization = `Bearer ${apiKey}`;
  }

  const timeout = createTimeoutSignal(options.timeoutMs, options.signal);

  try {
    const res = await fetch(url.toString(), {
      signal: timeout.signal,
      headers,
    });

    if (!res.ok) {
      throw new Error(`SearxNG returned ${res.status} ${res.statusText}`);
    }

    const raw = await res.json();
    const response = normalizeSearchResponse(raw);
    const results = response.results.slice(0, options.limit);

    return { ...response, results };
  } catch (err) {
    timeout.signal.throwIfAborted();
    throw err;
  } finally {
    timeout.cleanup();
  }
}

export function formatSearchResults(response: SearchResponse): string {
  const results = response.results;

  const resultsString =
    results.length === 0
      ? response.warnings?.length
        ? "No results were returned."
        : "No results were returned. Try changing your query."
      : results
          .map((r, i) => `${i + 1}. ${r.title}\nURL: ${r.url}\n${r.content}`)
          .join("\n\n");

  return [
    ...(response.warnings?.length
      ? [
          `Search warnings:\n${response.warnings.map((warning) => `- ${warning}`).join("\n")}`,
        ]
      : []),
    resultsString,
    ...(response.corrections?.length
      ? [`Corrections: ${response.corrections.join("; ")}`]
      : []),
    ...(response.suggestions?.length
      ? [`Suggestions: ${response.suggestions.join("; ")}`]
      : []),
  ].join("\n\n");
}
