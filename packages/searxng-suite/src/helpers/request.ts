import { formatBytes } from "../extractors/shared";

export function createTimeoutSignal(
  timeoutMs: number,
  parentSignal?: AbortSignal,
): { signal: AbortSignal; cleanup: () => void } {
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
    cleanup: () => {
      clearTimeout(timer);
      // Stop any unread response body on early failure.
      controller.abort();
    },
  };
}

export async function readResponseBody(
  res: Response,
  maxBytes: number,
  signal?: AbortSignal,
): Promise<Buffer> {
  const reader = res.body?.getReader();
  const cancel = () => {
    // A slow source cleanup must not hold up a timeout or cancellation.
    void reader?.cancel(signal?.reason).catch(() => {});
  };
  signal?.addEventListener("abort", cancel, { once: true });

  try {
    signal?.throwIfAborted();
    const limitMessage = `Content too large: limit is ${formatBytes(maxBytes)}`;
    if (Number(res.headers.get("content-length")) > maxBytes) {
      throw new Error(limitMessage);
    }
    if (!reader) return Buffer.alloc(0);

    const chunks: Uint8Array[] = [];
    let byteLength = 0;
    while (true) {
      const { done, value } = await reader.read();
      signal?.throwIfAborted();
      if (done) break;
      byteLength += value.byteLength;
      if (byteLength > maxBytes) throw new Error(limitMessage);
      chunks.push(value);
    }
    return Buffer.concat(chunks, byteLength);
  } finally {
    signal?.removeEventListener("abort", cancel);
    cancel();
    reader?.releaseLock();
  }
}

export function getContentType(res: Response): string {
  const header = res.headers.get("content-type") ?? "";
  return header.split(";")[0]?.trim().toLowerCase() ?? "";
}
