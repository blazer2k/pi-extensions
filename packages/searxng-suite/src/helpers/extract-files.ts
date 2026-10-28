import {
  lstat,
  mkdir,
  mkdtemp,
  open,
  rm,
  rmdir,
  type FileHandle,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { withFileMutationQueue } from "@earendil-works/pi-coding-agent";
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

export async function writeExtractionFile(
  path: string,
  data: string | Uint8Array,
  signal?: AbortSignal,
) {
  try {
    await withFileMutationQueue(path, async () => {
      let file: FileHandle | undefined;
      try {
        signal?.throwIfAborted();
        const handle = await open(path, "wx", 0o600);
        file = handle;
        try {
          await handle.writeFile(data, { encoding: "utf8", signal });
        } catch (error) {
          try {
            await handle.close();
          } catch (closeError) {
            throw cleanupFailure(error, closeError, signal);
          }
          throw error;
        }
        await handle.close();
      } catch (error) {
        if (file) {
          try {
            await rm(path, { force: true });
          } catch (cleanupError) {
            throw cleanupFailure(error, cleanupError, signal);
          }
        }
        throw error;
      }
    });
  } catch (error) {
    try {
      await removeEmptyExtractionDirectory(dirname(path));
    } catch (cleanupError) {
      throw cleanupFailure(error, cleanupError, signal);
    }
    throw error;
  }
}
