import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import { CustomEditor } from "@earendil-works/pi-coding-agent";
import {
  CURSOR_MARKER,
  truncateToWidth,
  visibleWidth,
  type AutocompleteProvider,
} from "@earendil-works/pi-tui";
import { stripAnsi } from "../tools/rendering/text";
import type {
  ExtensionAPI,
  ExtensionContext,
  KeybindingsManager,
} from "@earendil-works/pi-coding-agent";
import type { EditorTheme, TUI } from "@earendil-works/pi-tui";
import type { Config } from "../config/definition";
import { getConfig, loadConfig, type ConfigStorage } from "../config/store";
import { mkTheme, setTestConfig } from "../testing/helpers";
import { EnhancedEditor } from "./component";
import type { EditorStatusIndicator } from "./frame";

const memoryStorage: ConfigStorage = {
  prepare() {},
  exists: () => true,
  read: () => "{}",
  write() {},
};

let previousConfig: Config;

beforeEach(() => {
  previousConfig = getConfig();
  loadConfig(undefined, memoryStorage);
});

afterEach(() => {
  loadConfig(undefined, {
    ...memoryStorage,
    read: () => JSON.stringify(previousConfig),
  });
});

function createEditor(
  command = "hello",
  style: "compact" | "rounded" = "rounded",
  onStatusIndicator?: (indicator: EditorStatusIndicator | undefined) => void,
) {
  let dimFrameCalls = 0;
  const frameColors: string[] = [];
  let thinkingBorderCalls = 0;
  let bashBorderCalls = 0;
  const uiTheme = {
    ...mkTheme(),
    fg: (color: string, text: string) => {
      frameColors.push(color);
      if (color === "dim") dimFrameCalls++;
      return text;
    },
    getThinkingBorderColor: (_level: string) => {
      thinkingBorderCalls++;
      return (text: string) => text;
    },
    getBashModeBorderColor: () => {
      bashBorderCalls++;
      return (text: string) => text;
    },
  };
  const context = {
    cwd: "/repo",
    model: {
      id: "test-model",
      contextWindow: 100_000,
      reasoning: true,
      thinkingLevelMap: { high: "high" },
    },
    getContextUsage: () => ({ percent: 75 }),
    ui: { theme: uiTheme },
  } as unknown as ExtensionContext;
  const pi = {
    getThinkingLevel: () => "high",
  } as unknown as ExtensionAPI;
  const tui = {
    terminal: { rows: 24 },
    requestRender: () => {},
  } as unknown as TUI;
  const editorTheme = {
    borderColor: (text: string) => text,
    selectList: {
      selectedPrefix: (text: string) => text,
      selectedText: (text: string) => text,
      description: (text: string) => text,
      scrollInfo: (text: string) => text,
      noMatch: (text: string) => text,
    },
  } as unknown as EditorTheme;
  const keybindings = { matches: () => false } as unknown as KeybindingsManager;
  const editor = new EnhancedEditor(
    tui,
    editorTheme,
    keybindings,
    context,
    pi,
    () => "main",
    () => ({
      inputTokens: 1_500,
      outputTokens: 500,
      cacheReadTokens: 2_000,
      cacheWriteTokens: 3_000,
      totalCost: 0.25,
    }),
    style,
    onStatusIndicator,
  );
  editor.setText(command);

  return {
    editor,
    uiTheme,
    pi,
    native: new CustomEditor(tui, editorTheme, keybindings, { paddingX: 1 }),
    getFrameColors: () => frameColors,
    getDimFrameCalls: () => dimFrameCalls,
    getThinkingBorderCalls: () => thinkingBorderCalls,
    getBashBorderCalls: () => bashBorderCalls,
  };
}

describe("EnhancedEditor", () => {
  it("assembles status content with the default dim frame and cost", () => {
    const { editor, getDimFrameCalls, getThinkingBorderCalls } = createEditor();
    const output = editor.render(80).join("\n");

    expect(output).toContain("/repo (main)");
    expect(output).toContain("test-model (high)");
    expect(output).toContain("↑1.5k ↓500 $0.25 75.0%/100k");
    expect(getDimFrameCalls()).toBeGreaterThan(0);
    expect(getThinkingBorderCalls()).toBe(0);
  });

  it("uses each configured color in either custom style", () => {
    for (const style of ["compact", "rounded"] as const) {
      for (const editorColor of ["thinking", "dim", "muted"] as const) {
        setTestConfig({
          editor: {
            color: editorColor,
          },
        });
        const { editor, getThinkingBorderCalls, getFrameColors } = createEditor(
          "hello",
          style,
        );
        editor.render(80);
        expect(getThinkingBorderCalls() > 0).toBe(editorColor === "thinking");
        if (editorColor !== "thinking")
          expect(getFrameColors()).toContain(editorColor);
      }
    }
  });

  it("shares border colors with cached supplied statuses without refresh loops or disposal", () => {
    for (const style of ["compact", "rounded"] as const) {
      for (const label of ["Native Working", "Compacting context"]) {
        setTestConfig({ workingIndicator: { style: "native" } });
        const { editor, uiTheme, pi } = createEditor("hello", style);
        let palette = 0;
        const color = (index: number, value: string) =>
          `\x1b[38;5;${index + palette}m${value}\x1b[39m`;
        uiTheme.fg = (token, value) =>
          color(token === "dim" ? 240 : 250, value);
        uiTheme.getThinkingBorderColor = (level) => (value) =>
          color(level === "high" ? 200 : 201, value);
        uiTheme.getBashModeBorderColor = () => (value) => color(40, value);
        let cached = color(99, label);
        const indicator = {
          renderInBorder: (width: number) => truncateToWidth(cached, width, ""),
          renderSpinnerInBorder: (width: number) =>
            truncateToWidth(editor.borderColor("*"), width, ""),
          invalidate: mock(() => {
            cached = editor.borderColor(label);
          }),
          dispose: mock(() => {}),
        } as unknown as EditorStatusIndicator;
        editor.setWorkingStatusIndicator(indicator);
        for (const [editorColor, input, level, index] of [
          ["dim", "hello", "high", 240],
          ["muted", "hello", "high", 250],
          ["thinking", "hello", "high", 200],
          ["thinking", "hello", "low", 201],
          ["dim", " !pwd", "low", 40],
          ["dim", "hello", "low", 240],
        ] as const) {
          setTestConfig({ editor: { color: editorColor } });
          editor.setText(input);
          pi.getThinkingLevel = () => level;
          expect(editor.render(80)[0]).toContain(color(index, label));
          expect(editor.borderColor(label)).toBe(color(index, label));
          const refreshed = (indicator.invalidate as ReturnType<typeof mock>)
            .mock.calls.length;
          editor.render(80);
          expect(indicator.invalidate).toHaveBeenCalledTimes(refreshed);
        }
        palette = 1;
        expect(editor.render(80)[0]).toContain(color(240, label));
        editor.borderColor = (value) => color(99, value);
        indicator.invalidate();
        expect(editor.render(80)[0]).toContain(color(240, label));
        expect(indicator.dispose).not.toHaveBeenCalled();
        editor.setWorkingStatusIndicator(undefined);
        expect(editor.render(80)[0]).not.toContain(label);
        expect(indicator.dispose).not.toHaveBeenCalled();
      }
    }
  });

  it("hands standalone statuses to the shimmer controller without embedding or disposing them", () => {
    for (const style of ["compact", "rounded"] as const) {
      const onStatus = mock(
        (_indicator: EditorStatusIndicator | undefined) => {},
      );
      const { editor } = createEditor("hello", style, onStatus);
      const indicator = {
        kind: "compaction",
        dispose: mock(() => {}),
      } as unknown as EditorStatusIndicator;
      expect(editor.embedWorkingStatus).toBe(true);
      editor.setWorkingStatusIndicator(indicator);
      expect(onStatus).toHaveBeenLastCalledWith(indicator);
      expect(editor.render(80).join("\n")).not.toContain("Compacting");
      editor.setWorkingStatusIndicator(undefined);
      expect(onStatus).toHaveBeenLastCalledWith(undefined);
      expect(indicator.dispose).not.toHaveBeenCalled();
    }
  });

  it("applies every metadata toggle to both custom styles", () => {
    for (const style of ["compact", "rounded"] as const) {
      const { editor } = createEditor("hello", style);
      setTestConfig({
        editor: {
          showThinkingLevel: false,
          showBranch: false,
          showCacheTokens: false,
          showCost: false,
        },
      });
      const hidden = editor.render(120).join("\n");
      expect(hidden).not.toContain("(high)");
      expect(hidden).not.toContain("(main)");
      expect(hidden).not.toContain("R2.0k");
      expect(hidden).not.toContain("W3.0k");
      expect(hidden).not.toContain("$0.25");
      setTestConfig({
        editor: {
          showThinkingLevel: true,
          showBranch: true,
          showCacheTokens: true,
          showCost: true,
        },
      });
      const shown = editor.render(120).join("\n");
      expect(shown).toContain("(high)");
      expect(shown).toContain("(main)");
      expect(shown).toContain("R2.0k W3.0k $0.25");
    }
  });

  it("uses the Bash border for shell input in either custom style", () => {
    for (const style of ["compact", "rounded"] as const) {
      const { editor, getBashBorderCalls, getThinkingBorderCalls } =
        createEditor("!pwd", style);
      editor.render(80);
      expect(getBashBorderCalls()).toBeGreaterThan(0);
      expect(getThinkingBorderCalls()).toBe(0);
    }
  });

  it("keeps compact input, padding, cursor, wrapping, and scrolling identical to native", () => {
    const text = Array.from(
      { length: 20 },
      (_, i) => `${i}: 界 wide input and words`,
    ).join("\n");
    const { editor, native } = createEditor(text, "compact");
    native.setText(text);
    editor.focused = native.focused = true;
    for (const width of [12, 40, 80]) {
      for (let i = 0; i < 8; i++) {
        editor.handleInput("\x1b[A");
        native.handleInput("\x1b[A");
      }
      const expected = native.render(width);
      const actual = editor.render(width);
      expect(actual.slice(1, -1)).toEqual(expected.slice(1, -1));
      expect(actual.join("\n")).toContain(CURSOR_MARKER);
      expect(actual.join("\n")).not.toMatch(/[╭╮╰╯│▲▼]/u);
      for (const index of [0, expected.length - 1]) {
        const notice = stripAnsi(expected[index]!).match(/[↑↓] \d+ more/);
        if (notice && width >= 40)
          expect(stripAnsi(actual[index]!)).toContain(notice[0]);
      }
      expect(editor.getText()).toBe(native.getText());
    }
  });

  it("keeps compact autocomplete below the lower rule and preserves native completion", async () => {
    const { editor, native } = createEditor("/h", "compact");
    native.setText("/h");
    const provider: AutocompleteProvider = {
      async getSuggestions() {
        return { prefix: "/h", items: [{ value: "/hello", label: "/hello" }] };
      },
      applyCompletion() {
        return { lines: ["/hello"], cursorLine: 0, cursorCol: 6 };
      },
    };
    for (const instance of [editor, native]) {
      instance.setAutocompleteProvider(provider);
      instance.focused = true;
      instance.handleInput("\t");
    }
    await Bun.sleep(0);
    expect(editor.isShowingAutocomplete()).toBe(true);
    expect(editor.render(80).slice(1, 2)).toEqual(
      native.render(80).slice(1, 2),
    );
    expect(editor.render(80).slice(3)).toEqual(native.render(80).slice(3));
    expect(stripAnsi(editor.render(80)[2]!)).toContain("test-model");
    editor.handleInput("\t");
    native.handleInput("\t");
    expect(editor.getText()).toBe("/hello");
    expect(editor.getText()).toBe(native.getText());
    expect(editor.isShowingAutocomplete()).toBe(false);
  });

  it("embeds supplied native statuses without changing input, scrolling, autocomplete, or ownership", async () => {
    for (const style of ["compact", "rounded"] as const) {
      setTestConfig({
        workingIndicator: {
          style: "native",
        },
      });
      const { editor } = createEditor("draft 界 input", style);
      expect(editor.embedWorkingStatus).toBe(true);
      editor.focused = true;
      const before = editor.render(80);
      const indicator = {
        renderInBorder: mock((width: number) =>
          truncateToWidth("\x1b[33m* Pi Working\x1b[0m", width, ""),
        ),
        renderSpinnerInBorder: mock((width: number) =>
          truncateToWidth("\x1b[33m*\x1b[0m", width, ""),
        ),
        invalidate: mock(() => {}),
        dispose: mock(() => {}),
      } as unknown as EditorStatusIndicator;
      editor.setWorkingStatusIndicator(indicator);
      const active = editor.render(80);
      expect(active[0]).toContain("\x1b[33m* Pi Working\x1b[0m");
      expect(stripAnsi(active[0]!)).toContain("/repo (main)");
      expect(active.slice(1)).toEqual(before.slice(1));
      expect(active[0]!.startsWith("╭")).toBe(style === "rounded");
      editor.setWorkingStatusIndicator(undefined);
      expect(editor.render(80)).toEqual(before);
      expect(indicator.dispose).not.toHaveBeenCalled();

      editor.setText(
        Array.from({ length: 20 }, (_, i) => `line ${i}`).join("\n"),
      );
      const scrolled = editor.render(80);
      editor.setWorkingStatusIndicator(indicator);
      expect(editor.render(80).slice(1)).toEqual(scrolled.slice(1));
      if (style === "compact")
        expect(stripAnsi(editor.render(80)[0]!)).toMatch(/↑ \d+ more/);
      else expect(editor.render(80).slice(1).join("\n")).toContain("▲");
      editor.setText("long input".repeat(10));
      for (let width = 0; width <= 200; width++) {
        for (const line of editor.render(width))
          expect(visibleWidth(line)).toBeLessThanOrEqual(width);
      }
      expect(indicator.renderSpinnerInBorder).toHaveBeenCalled();

      editor.setText("/h");
      editor.setAutocompleteProvider({
        async getSuggestions() {
          return {
            prefix: "/h",
            items: [{ value: "/hello", label: "/hello" }],
          };
        },
        applyCompletion() {
          return { lines: ["/hello"], cursorLine: 0, cursorCol: 6 };
        },
      });
      editor.handleInput("\t");
      await Bun.sleep(0);
      expect(editor.isShowingAutocomplete()).toBe(true);
      editor.setWorkingStatusIndicator(undefined);
      const completion = editor.render(80);
      editor.setWorkingStatusIndicator(indicator);
      expect(editor.render(80).slice(1)).toEqual(completion.slice(1));
      expect(indicator.dispose).not.toHaveBeenCalled();
      editor.handleInput("\t");
      expect(editor.getText()).toBe("/hello");
    }
    setTestConfig({
      workingIndicator: {
        style: "shimmer",
      },
    });
    expect(createEditor().editor.embedWorkingStatus).toBe(false);
  });

  it("fits both custom styles at widths zero through 200", () => {
    for (const style of ["compact", "rounded"] as const) {
      const { editor } = createEditor("long input".repeat(20), style);
      for (let width = 0; width <= 200; width++) {
        for (const line of editor.render(width))
          expect(visibleWidth(line)).toBeLessThanOrEqual(width);
      }
    }
  });
});
