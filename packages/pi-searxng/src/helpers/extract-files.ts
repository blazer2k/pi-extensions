import {
  lstat,
  mkdir,
  mkdtemp,
  open,
  readdir,
  rename,
  rm,
  rmdir,
  type FileHandle,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import {
  formatSize,
  withFileMutationQueue,
} from "@earendil-works/pi-coding-agent";
import { errorMessage } from "./error";

export async function createExtractionDirectory(
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

export async function removeEmptyExtractionDirectory(directory: string) {
  try {
    await rmdir(directory);
  } catch (error) {
    if (
      !(
        error instanceof Error &&
        "code" in error &&
        ["ENOENT", "ENOTEMPTY", "EEXIST"].includes(String(error.code))
      )
    ) {
      throw error;
    }
  }
}

function cleanupFailure(
  error: unknown,
  cleanupError: unknown,
  signal?: AbortSignal,
): unknown {
  return signal?.aborted
    ? error
    : new Error(
        `${errorMessage(error)}; unfinished-file cleanup failed: ${errorMessage(cleanupError)}`,
        { cause: error },
      );
}

async function sessionBytes(
  directory: string,
  signal?: AbortSignal,
): Promise<number> {
  let bytes = 0;
  for (const name of await readdir(directory)) {
    signal?.throwIfAborted();
    const path = join(directory, name);
    try {
      const stat = await lstat(path);
      if (stat.isDirectory()) bytes += await sessionBytes(path, signal);
      else if (stat.isFile()) bytes += stat.size;
      else throw new Error("Unexpected non-file entry in extraction storage");
    } catch (error) {
      if (
        !(error instanceof Error && "code" in error && error.code === "ENOENT")
      )
        throw error;
    }
  }
  return bytes;
}

async function writeData(
  file: FileHandle,
  data: string | Uint8Array | AsyncIterable<Uint8Array>,
  remaining: number,
  signal: AbortSignal | undefined,
  quotaError: () => Error,
): Promise<number> {
  let bytes = 0;
  const chunks =
    typeof data === "string" || data instanceof Uint8Array ? [data] : data;
  for await (const chunk of chunks) {
    signal?.throwIfAborted();
    const size = Buffer.byteLength(chunk);
    if (size > remaining - bytes) throw quotaError();
    await file.writeFile(chunk, { encoding: "utf8", signal });
    bytes += size;
  }
  await file.close();
  return bytes;
}

export async function writeExtractionFile(
  path: string,
  data: string | Uint8Array | AsyncIterable<Uint8Array>,
  maxSessionStorageBytes: number,
  signal?: AbortSignal,
): Promise<number> {
  const directory = dirname(path);
  const session = dirname(directory);
  const streamed = typeof data !== "string" && !(data instanceof Uint8Array);
  const writePath = streamed ? `${path}.part` : path;
  try {
    return await withFileMutationQueue(session, async () => {
      signal?.throwIfAborted();
      const remaining =
        maxSessionStorageBytes - (await sessionBytes(session, signal));
      const quotaError = () =>
        new Error(
          `Session storage exceeds maxSessionStorageBytes (${formatSize(maxSessionStorageBytes)}). Increase it in pi-searxng.json or remove files explicitly; earlier artifacts were not evicted.`,
        );
      if (remaining < 0) throw quotaError();
      if (!streamed && Buffer.byteLength(data) > remaining) throw quotaError();
      let file: FileHandle | undefined;
      let reserved: FileHandle | undefined;
      try {
        signal?.throwIfAborted();
        const handle = await open(writePath, "wx", 0o600);
        file = handle;
        const bytes = await writeData(
          handle,
          data,
          remaining,
          signal,
          quotaError,
        );
        if (streamed) {
          // Reserve the final name exclusively before publishing the closed download.
          reserved = await open(path, "wx", 0o600);
          await reserved.close();
          await rename(writePath, path);
        }
        return bytes;
      } catch (error) {
        let failure = error;
        for (const handle of [file, reserved]) {
          try {
            await handle?.close();
          } catch (closeError) {
            failure = cleanupFailure(failure, closeError, signal);
          }
        }
        try {
          if (file) await rm(writePath, { force: true });
          if (reserved) await rm(path, { force: true });
        } catch (cleanupError) {
          failure = cleanupFailure(failure, cleanupError, signal);
        }
        throw failure;
      }
    });
  } catch (error) {
    try {
      await removeEmptyExtractionDirectory(directory);
    } catch (cleanupError) {
      throw cleanupFailure(error, cleanupError, signal);
    }
    throw error;
  }
}
