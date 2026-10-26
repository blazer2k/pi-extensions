import { homedir } from "node:os";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { Type } from "typebox";
import { Compile } from "typebox/compile";

const configPath = join(homedir(), ".pi", "agent", "pi-searxng-suite.json");

export interface Config {
  limit: number;
  llmCanOverrideLimit: boolean;
  timeoutMs: number;
  safesearch: 0 | 1 | 2;
  llmCanPickCategory: boolean;
  allowPrivateUrls: boolean;
  verbose: boolean;
}

const defaultConfig: Config = {
  limit: 10,
  llmCanOverrideLimit: false,
  timeoutMs: 15000,
  safesearch: 0,
  llmCanPickCategory: false,
  allowPrivateUrls: false,
  verbose: false,
};

const ConfigSchema = Type.Object(
  {
    limit: Type.Number({ minimum: 1, maximum: 50 }),
    llmCanOverrideLimit: Type.Boolean(),
    timeoutMs: Type.Number({ minimum: 1000, maximum: 120000 }),
    safesearch: Type.Union([Type.Literal(0), Type.Literal(1), Type.Literal(2)]),
    llmCanPickCategory: Type.Boolean(),
    allowPrivateUrls: Type.Boolean(),
    verbose: Type.Boolean(),
  },
  { additionalProperties: false },
);

export type ConfigKey = keyof Config;

let config: Config = { ...defaultConfig };
const configValidator = Compile(ConfigSchema);

function validateConfig(raw: unknown): Config {
  if (typeof raw !== "object" || raw === null) return defaultConfig;

  const merged = { ...defaultConfig, ...raw };
  if (!configValidator.Check(merged)) {
    return { ...defaultConfig };
  }

  return merged as Config;
}

export function loadConfig(onError?: (error: unknown) => void): void {
  try {
    mkdirSync(dirname(configPath), { recursive: true });

    if (!existsSync(configPath)) {
      config = { ...defaultConfig };
      writeFileSync(configPath, JSON.stringify(config, null, 2));
      return;
    }

    const saved = JSON.parse(readFileSync(configPath, "utf-8"));
    const validated = validateConfig(saved);
    config = validated;

    // Normalize config by adding missing default keys.
    writeFileSync(configPath, JSON.stringify(validated, null, 2));
  } catch (error) {
    config = { ...defaultConfig };

    try {
      mkdirSync(dirname(configPath), { recursive: true });
      writeFileSync(configPath, JSON.stringify(config, null, 2));
    } catch (repairError) {
      if (onError) {
        onError(repairError);
        return;
      }

      console.error(`Failed to repair config at ${configPath}:`, repairError);
      return;
    }

    if (onError) {
      onError(error);
      return;
    }

    console.error(`Failed to load config from ${configPath}:`, error);
  }
}

function parseConfigValue(id: ConfigKey, value: string): Config[ConfigKey] {
  switch (id) {
    case "limit":
      return Number(value);
    case "llmCanOverrideLimit":
      return value === "true";
    case "timeoutMs":
      return Number(value);
    case "safesearch":
      const num = Number(value);
      if (num !== 0 && num !== 1 && num !== 2) {
        throw new Error(`Invalid safesearch value: ${value}`);
      }
      return num;
    case "llmCanPickCategory":
      return value === "true";
    case "allowPrivateUrls":
      return value === "true";
    case "verbose":
      return value === "true";
  }
}

export function saveConfig(id: ConfigKey, value: string): void {
  const parsed = parseConfigValue(id, value);

  const updated = { ...config, [id]: parsed };
  if (!configValidator.Check(updated)) {
    throw new Error(`Invalid config update: ${id}=${value}`);
  }

  mkdirSync(dirname(configPath), { recursive: true });
  writeFileSync(configPath, JSON.stringify(updated, null, 2));
  config = updated as Config;
}

export function getConfig(): Config {
  return { ...config };
}
