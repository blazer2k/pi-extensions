import { formatSize } from "@earendil-works/pi-coding-agent";

export interface ResponseBody {
  headers: Pick<Headers, "get">;
  body: {
    getReader(): Pick<
      ReadableStreamDefaultReader<Uint8Array>,
      "read" | "cancel" | "releaseLock"
    >;
  } | null;
}

export function createTimeoutSignal(
  timeoutMs: number,
  parentSignal?: AbortSignal,
): { signal: AbortSignal; stopTimer: () => void; cleanup: () => void } {
  const controller = new AbortController();
  const timer = setTimeout(
    () =>
      controller.abort(
        new DOMException(`Timed out after ${timeoutMs}ms`, "TimeoutError"),
      ),
    timeoutMs,
  );

  const signal = parentSignal
    ? AbortSignal.any([parentSignal, controller.signal])
    : controller.signal;

  return {
    signal,
    stopTimer: () => clearTimeout(timer),
    cleanup: () => {
      clearTimeout(timer);
      // Stop any unread response body on early failure.
      controller.abort();
    },
  };
}

export function checkResponseSize(res: ResponseBody, maxBytes: number): void {
  if (Number(res.headers.get("content-length")) > maxBytes) {
    throw new Error(contentLimitMessage(maxBytes));
  }
}

function contentLimitMessage(maxBytes: number): string {
  return `Content too large: limit is ${formatSize(maxBytes)} (maxContentBytes). Increase it in pi-searxng.json if needed.`;
}

export async function* readResponseChunks(
  res: ResponseBody,
  maxBytes: number,
  signal?: AbortSignal,
): AsyncGenerator<Uint8Array> {
  const reader = res.body?.getReader();
  const cancel = () => {
    // A slow source cleanup must not hold up a timeout or cancellation.
    void reader?.cancel(signal?.reason).catch(() => {});
  };
  signal?.addEventListener("abort", cancel, { once: true });

  try {
    signal?.throwIfAborted();
    checkResponseSize(res, maxBytes);
    if (!reader) return;
    let byteLength = 0;
    while (true) {
      const { done, value } = await reader.read();
      signal?.throwIfAborted();
      if (done) break;
      byteLength += value.byteLength;
      if (byteLength > maxBytes) throw new Error(contentLimitMessage(maxBytes));
      yield value;
    }
  } finally {
    signal?.removeEventListener("abort", cancel);
    cancel();
    reader?.releaseLock();
  }
}

export async function readResponseBody(
  res: ResponseBody,
  maxBytes: number,
  signal?: AbortSignal,
): Promise<Buffer> {
  const chunks: Uint8Array[] = [];
  let byteLength = 0;
  for await (const chunk of readResponseChunks(res, maxBytes, signal)) {
    chunks.push(chunk);
    byteLength += chunk.byteLength;
  }
  return Buffer.concat(chunks, byteLength);
}

export function getContentType(res: Pick<ResponseBody, "headers">): string {
  const header = res.headers.get("content-type") ?? "";
  return header.split(";")[0]?.trim().toLowerCase() ?? "";
}
