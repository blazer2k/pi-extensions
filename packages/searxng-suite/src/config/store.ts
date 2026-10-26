import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { getDefaultConfig, validateConfig, type Config } from "./definition";

export interface ConfigStorage {
  prepare(configPath: string): void;
  exists(configPath: string): boolean;
  read(configPath: string): string;
  write(configPath: string, contents: string): void;
}

const nodeConfigStorage: ConfigStorage = {
  prepare(configPath) {
    mkdirSync(dirname(configPath), { recursive: true });
  },
  exists: existsSync,
  read(configPath) {
    return readFileSync(configPath, "utf-8");
  },
  write(configPath, contents) {
    writeFileSync(configPath, contents);
  },
};

function getConfigPath(): string {
  if (process.env.PI_SEARXNG_CONFIG_PATH) {
    return process.env.PI_SEARXNG_CONFIG_PATH;
  }
  if (process.env.NODE_ENV === "test") {
    return join(tmpdir(), "pi-searxng-test", "pi-searxng.json");
  }
  return join(getAgentDir(), "pi-searxng.json");
}

function reportConfigError(
  onError: ((error: unknown) => void) | undefined,
  message: string,
  error: unknown,
): void {
  if (onError) onError(error);
  else console.error(message, error);
}

let config = getDefaultConfig();

export function loadConfig(
  onError?: (error: unknown) => void,
  storage: ConfigStorage = nodeConfigStorage,
): void {
  const configPath = getConfigPath();

  try {
    storage.prepare(configPath);
    const saved: unknown = storage.exists(configPath)
      ? JSON.parse(storage.read(configPath))
      : {};
    config = validateConfig(saved);
  } catch (error) {
    config = getDefaultConfig();
    reportConfigError(
      onError,
      `Failed to load config from ${configPath}:`,
      error,
    );
    return;
  }

  try {
    // Keep validated settings active if persisting repairs fails.
    storage.write(configPath, JSON.stringify(config, null, 2));
  } catch (error) {
    reportConfigError(
      onError,
      `Failed to write config at ${configPath}:`,
      error,
    );
  }
}

export function getConfig(): Config {
  return structuredClone(config);
}
