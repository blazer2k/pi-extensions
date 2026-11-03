import { writeFileSync } from "node:fs";
import {
  keyHint,
  keyText,
  type Theme,
  type ToolDefinition,
  type ToolInfo,
  type ToolRenderers,
  type SourceInfo,
} from "@earendil-works/pi-coding-agent";
import type { Config } from "../config/definition";
import { getConfig, loadConfig } from "../config/store";
import { createToolRendering } from "../tools/tool-registration";
import type { CustomToolRenderingReporter } from "../tools/custom-tools/types";

type ConfigUpdates = {
  header?: Partial<Config["header"]>;
  workingIndicator?: Partial<Config["workingIndicator"]>;
  tools?: Partial<Omit<Config["tools"], "indicator">> & {
    indicator?: Partial<Config["tools"]["indicator"]>;
  };
  editor?: Partial<Config["editor"]>;
};

function updatedConfig(updates: ConfigUpdates): Config {
  const config = getConfig();
  return {
    header: { ...config.header, ...updates.header },
    workingIndicator: {
      ...config.workingIndicator,
      ...updates.workingIndicator,
    },
    tools: {
      ...config.tools,
      ...updates.tools,
      indicator: { ...config.tools.indicator, ...updates.tools?.indicator },
    },
    editor: { ...config.editor, ...updates.editor },
  };
}

export function setTestConfig(updates: ConfigUpdates): void {
  const config = updatedConfig(updates);
  loadConfig(undefined, {
    prepare() {},
    exists: () => true,
    read: () => JSON.stringify(config),
    write() {},
  });
}

export function writeTestConfig(updates: ConfigUpdates): void {
  const path = process.env.PI_TUI_TWEAKS_CONFIG_PATH;
  if (!path) throw new Error("A temporary config path is required");
  writeFileSync(path, JSON.stringify(updatedConfig(updates)));
  loadConfig();
}

export function mkTheme(): Theme {
  return {
    fg: (_color: string, text: string) => text,
    bg: (_color: string, text: string) => text,
    bold: (text: string) => text,
    italic: (text: string) => text,
    underline: (text: string) => text,
    inverse: (text: string) => text,
    strikethrough: (text: string) => text,
    getFgAnsi: () => "",
    getBgAnsi: () => "",
    getColorMode: () => "truecolor",
    getThinkingBorderColor: () => (s: string) => s,
    getBashModeBorderColor: () => (s: string) => s,
  } as unknown as Theme;
}

export function setupTool(createRenderers: () => ToolRenderers) {
  return createRenderers();
}

export function setupCustomTool(
  definition: ToolDefinition,
  isToolCallActive: (toolCallId: string) => boolean = () => false,
  reportIssue: CustomToolRenderingReporter = () => {},
  sourceInfo: SourceInfo = {
    source: "inline",
    path: "<inline:test>",
    scope: "temporary",
    origin: "top-level",
  },
) {
  let enabled = true;
  const rendering = createToolRendering(
    {
      getAllTools: () => [
        {
          ...definition,
          exposure: definition.exposure ?? "direct",
          sourceInfo,
        } as ToolInfo,
      ],
    },
    { isToolCallActive, isEnabled: () => enabled, reportIssue },
  );
  return {
    renderers: rendering.resolve(definition.name, () => definition)!,
    clearCustomTimers: rendering.clearCustomTimers,
    dispose() {
      enabled = false;
      rendering.reset();
    },
  };
}

export function mkToolCtx(overrides: Record<string, unknown> = {}) {
  return {
    args: {},
    toolCallId: "call-1",
    invalidate: () => {},
    lastComponent: undefined,
    state: {},
    cwd: process.cwd(),
    executionStarted: true,
    isPartial: false,
    isError: false,
    expanded: false,
    argsComplete: true,
    showImages: false,
    durationMs: undefined as number | undefined,
    outputPad: 1,
    keyText,
    keyHint,
    ...overrides,
  };
}
