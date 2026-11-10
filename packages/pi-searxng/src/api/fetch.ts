import { Agent, fetch } from "undici";
import { createTimeoutSignal, getContentType } from "../helpers/request";
import { getValidUrl, lookupPublic } from "../helpers/url";
import {
  type ExtractResponse,
  getExtractKind,
  limitExtractContent,
} from "../extractors/shared";
import { extractHtml } from "../extractors/html";
import { extractPlainText } from "../extractors/text";
import { extractJson } from "../extractors/json";
import { extractPdf } from "../extractors/pdf";
import { extractImage } from "../extractors/image";

export interface FetchOptions {
  timeoutMs: number;
  signal?: AbortSignal;
  allowPrivateUrls: boolean;
  getOutputDirectory?: () => Promise<string>;
  maxContentBytes: number;
  pdfProcessingTimeoutMs: number;
  maxSessionStorageBytes: number;
}

const headers: Record<string, string> = {
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
  Accept:
    "text/html,application/xhtml+xml,text/plain,application/json,application/pdf,image/png,image/jpeg,image/webp,image/gif,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
  "Cache-Control": "no-cache",
  "Sec-Fetch-Dest": "document",
  "Sec-Fetch-Mode": "navigate",
  "Sec-Fetch-Site": "none",
  "Sec-Fetch-User": "?1",
  "Upgrade-Insecure-Requests": "1",
};

function adaptRedditUrl(url: string): string {
  try {
    const u = new URL(url);
    if (u.hostname === "www.reddit.com" || u.hostname === "reddit.com") {
      u.hostname = "old.reddit.com";
      return u.toString();
    }
  } catch {}
  return url;
}

export async function webFetch(
  url: string,
  options: FetchOptions,
): Promise<ExtractResponse> {
  const validatedUrl = getValidUrl(url, options.allowPrivateUrls);

  if (!validatedUrl) {
    throw new Error(`Invalid URL: ${url}`);
  }

  const dispatcher = new Agent({
    connect: { lookup: options.allowPrivateUrls ? undefined : lookupPublic },
  });
  const timeout = createTimeoutSignal(options.timeoutMs, options.signal);
  const maxBytes = options.maxContentBytes;
  const request = (target: string) =>
    fetch(target, {
      signal: timeout.signal,
      headers,
      dispatcher,
      redirect: "manual",
    });

  try {
    let finalUrl = getValidUrl(
      adaptRedditUrl(validatedUrl),
      options.allowPrivateUrls,
    );
    if (!finalUrl) throw new Error("Invalid extraction destination");
    let res = await request(finalUrl);
    for (
      let redirects = 0;
      [301, 302, 303, 307, 308].includes(res.status) &&
      res.headers.has("location");
      redirects++
    ) {
      void res.body?.cancel().catch(() => {});
      if (redirects >= 20) throw new Error("Too many redirects (limit: 20)");
      const next = getValidUrl(
        new URL(res.headers.get("location")!, finalUrl).href,
        options.allowPrivateUrls,
      );
      if (!next)
        throw new Error("Redirect to an invalid or private URL is not allowed");
      finalUrl = next;
      res = await request(finalUrl);
    }

    if (!res.ok) {
      throw new Error(`Fetch returned ${res.status} ${res.statusText}`);
    }

    const contentType = getContentType(res);
    const kind = getExtractKind(contentType);

    let result: ExtractResponse;
    switch (kind) {
      case "html":
        result = await extractHtml(
          validatedUrl,
          contentType,
          res,
          maxBytes,
          timeout.signal,
          finalUrl,
        );
        break;

      case "text":
        result = await extractPlainText(
          validatedUrl,
          contentType,
          res,
          maxBytes,
          timeout.signal,
        );
        break;

      case "json":
        result = await extractJson(
          validatedUrl,
          contentType,
          res,
          maxBytes,
          timeout.signal,
        );
        break;

      case "pdf":
        if (!options.getOutputDirectory) {
          throw new Error("PDF extraction requires an output directory");
        }
        result = await extractPdf(
          validatedUrl,
          contentType,
          res,
          options.getOutputDirectory,
          {
            maxContentBytes: maxBytes,
            maxSessionStorageBytes: options.maxSessionStorageBytes,
            pdfProcessingTimeoutMs: options.pdfProcessingTimeoutMs,
            stopDownloadTimeout: timeout.stopTimer,
            finalUrl: finalUrl !== validatedUrl ? finalUrl : undefined,
          },
          timeout.signal,
        );
        break;

      case "image":
        result = await extractImage(
          validatedUrl,
          contentType,
          res,
          maxBytes,
          timeout.signal,
        );
        break;

      default:
        throw new Error(
          `Unsupported content type: ${contentType || "unknown"}`,
        );
    }
    if (finalUrl !== validatedUrl) {
      result.finalUrl = finalUrl;
      if (kind !== "json" && kind !== "pdf") {
        const text = result.content.find((item) => item.type === "text");
        if (text) {
          const prefix = `Final URL: ${finalUrl}\n`;
          text.text = prefix + text.text;
          result.bodyStart = prefix.length + (result.bodyStart ?? 0);
        }
      }
    }
    return kind === "pdf" ? result : limitExtractContent(result, maxBytes);
  } catch (err) {
    timeout.signal.throwIfAborted();
    if (
      err instanceof TypeError &&
      err.cause instanceof Error &&
      err.cause.message
    ) {
      throw new Error(`Fetch failed: ${err.cause.message}`, { cause: err });
    }
    throw err;
  } finally {
    timeout.cleanup();
    void dispatcher.destroy().catch(() => {});
  }
}
