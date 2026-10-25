import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import {
  createExtensionRuntime,
  ExtensionRunner,
  type Extension,
  type ExtensionAPI,
  type ExtensionContext,
  type ExtensionUIContext,
} from "@earendil-works/pi-coding-agent";
import {
  indexedColor,
  oklchColor,
  rgbColor,
  getKeybindings,
  setKeybindings,
  KeybindingsManager,
  Text,
  visibleWidth,
  type Component,
  type TUI,
  type Color as ThemeColor,
} from "@earendil-works/pi-tui";
import { assembleRunDuration, registerWorkingIndicator } from "./indicator";
import { getConfig } from "../config/store";
import { setTestConfig } from "../testing/helpers";
import type { EditorStatusIndicator } from "../editor/frame";
import { stripAnsi } from "../tools/rendering/text";

let previousKeybindings: ReturnType<typeof getKeybindings>;
beforeEach(() => {
  previousKeybindings = getKeybindings();
  setKeybindings(
    new KeybindingsManager({
      "app.interrupt": { defaultKeys: "escape", description: "Cancel" },
    }),
  );
});
afterEach(() => setKeybindings(previousKeybindings));

function mkIndicatorHarness(colors?: {
  muted: ThemeColor;
  accent: ThemeColor;
  success?: ThemeColor;
  text?: ThemeColor;
}) {
  const handlers: Record<string, Array<(...args: any[]) => void>> = {};
  const pi = {
    on: (event: string, handler: (...args: any[]) => void) => {
      handlers[event] = handlers[event] ?? [];
      handlers[event].push(handler);
    },
  } as unknown as ExtensionAPI;

  let notifyCount = 0;
  let lastFrames: string[] | null = null;
  let lastIntervalMs: number | undefined;
  let widget: (Component & { dispose?(): void }) | undefined;
  const ctx = {
    ui: {
      getEditorComponent: () => undefined,
      setWidget: (_key: string, content: unknown) => {
        widget?.dispose?.();
        widget =
          typeof content === "function"
            ? content({ requestRender() {} } as TUI)
            : undefined;
      },
      setWorkingIndicator: (options?: {
        frames: string[];
        intervalMs?: number;
      }) => {
        lastFrames = options?.frames ?? null;
        lastIntervalMs = options?.intervalMs;
      },
      setWorkingMessage: () => {},
      notify: () => {
        notifyCount++;
      },
      theme: {
        colors,
        fg: (_color: string, text: string) => text,
        getFgAnsi: () => "",
        getColorMode: () => (colors ? "truecolor" : "ansi"),
      },
    },
  } as unknown as ExtensionContext;

  return {
    pi,
    ctx,
    handlers,
    getNotifyCount: () => notifyCount,
    getLastFrames: () => lastFrames,
    getLastIntervalMs: () => lastIntervalMs,
    renderStatus: (width = 120) => {
      widget?.invalidate();
      return widget?.render(width) ?? [];
    },
    hasWidget: () => widget !== undefined,
  };
}

function installFakeClock(initialTime = 10_000) {
  const originalNow = Date.now;
  let now = initialTime;
  Date.now = () => now;

  return {
    advance(milliseconds: number) {
      now += milliseconds;
    },
    restore() {
      Date.now = originalNow;
    },
  };
}

describe("working indicator rendering", () => {
  it("separates duration and interrupt metadata with a middle dot", () => {
    const previous = getConfig();
    const clock = installFakeClock();
    setTestConfig({
      workingIndicator: { showDuration: true, showInterruptHint: true },
    });
    const { pi, ctx, handlers, getLastFrames } = mkIndicatorHarness();
    const handle = registerWorkingIndicator(pi, ctx);
    try {
      handlers.agent_start![0]!();
      expect(getLastFrames()![0]).toBe("Working (0s · escape to interrupt)");
    } finally {
      handle.dispose();
      clock.restore();
      setTestConfig(previous);
    }
  });

  it("uses the selected shimmer highlight while keeping suffixes dim", () => {
    const previous = getConfig();
    const clock = installFakeClock(11_000);
    const { pi, ctx, handlers, getLastFrames } = mkIndicatorHarness({
      muted: rgbColor(10, 20, 30),
      accent: rgbColor(100, 150, 200),
      success: rgbColor(20, 220, 60),
      text: rgbColor(240, 245, 250),
    });
    ctx.ui.theme.fg = (color, text) => `[${color}]${text}`;
    const handle = registerWorkingIndicator(pi, ctx);
    try {
      for (const [shimmerColor, r, g, b] of [
        ["accent", 27, 44, 62],
        ["success", 12, 57, 36],
        ["text", 53, 62, 71],
      ] as const) {
        setTestConfig({
          workingIndicator: {
            shimmerColor,
            showDuration: true,
            showInterruptHint: true,
          },
        });
        handlers.agent_start![0]!();
        const frame = getLastFrames()![0]!;
        expect(frame).toStartWith(`\x1b[38;2;${r};${g};${b}mW\x1b[39m`);
        expect(frame).toEndWith("[dim] (0s · escape to interrupt)");
      }
    } finally {
      handle.dispose();
      clock.restore();
      setTestConfig(previous);
    }
  });

  for (const [name, ansi] of [
    ["terminal-default", "\x1b[39m"],
    ["faint", "\x1b[38;2;40;50;60m\x1b[2m"],
  ] as const) {
    it(`uses resolved ${name} colors instead of ANSI escapes`, () => {
      const { pi, ctx, handlers, getLastFrames } = mkIndicatorHarness({
        muted: rgbColor(10, 20, 30),
        accent: rgbColor(100, 150, 200),
      });
      ctx.ui.theme.getFgAnsi = () => ansi;
      const clock = installFakeClock(11_000);
      const handle = registerWorkingIndicator(pi, ctx);
      try {
        handlers.agent_start![0]!();
        expect(getLastFrames()![0]).toStartWith("\x1b[38;2;27;44;62mW\x1b[39m");
      } finally {
        handle.dispose();
        clock.restore();
      }
    });
  }

  it("mixes indexed and OKLCH theme colors in RGB", () => {
    const { pi, ctx, handlers, getLastFrames } = mkIndicatorHarness({
      muted: indexedColor(196),
      accent: oklchColor(1, 0, 0),
    });
    const clock = installFakeClock(11_000);
    const handle = registerWorkingIndicator(pi, ctx);
    try {
      handlers.agent_start![0]!();
      expect(getLastFrames()![0]).toStartWith("\x1b[38;2;255;47;47mW\x1b[39m");
      expect(getLastFrames()![0]).toContain("\x1b[38;2;255;224;224mk\x1b[39m");
    } finally {
      handle.dispose();
      clock.restore();
    }
  });

  it("uses dim text without resolving colors outside truecolor mode", () => {
    const previous = getConfig();
    const { pi, ctx, handlers, getLastFrames } = mkIndicatorHarness();
    ctx.ui.theme.getColorMode = () => "256color";
    ctx.ui.theme.fg = (color, text) => `[${color}]${text}`;
    Object.defineProperty(ctx.ui.theme, "colors", {
      get() {
        throw new Error("Non-truecolor rendering must not resolve colors");
      },
    });
    const handle = registerWorkingIndicator(pi, ctx);
    try {
      for (const shimmerColor of ["accent", "success", "text"] as const) {
        setTestConfig({ workingIndicator: { shimmerColor } });
        handlers.agent_start![0]!();
        expect(getLastFrames()![0]).toStartWith("[dim]Working");
        expect(getLastFrames()![0]).not.toContain("\x1b[38;2;");
      }
    } finally {
      handle.dispose();
      setTestConfig(previous);
    }
  });

  it("reads current theme colors on each frame", () => {
    const previous = getConfig();
    setTestConfig({ workingIndicator: { shimmerColor: "success" } });
    const colors = {
      muted: rgbColor(10, 20, 30),
      accent: rgbColor(100, 150, 200),
      success: rgbColor(100, 150, 200),
    };
    const { pi, ctx, handlers, getLastFrames } = mkIndicatorHarness(colors);
    const clock = installFakeClock();
    const handle = registerWorkingIndicator(pi, ctx);
    try {
      handlers.agent_start![0]!();
      expect(getLastFrames()![0]).toStartWith("\x1b[38;2;10;20;30mW");
      colors.muted = rgbColor(40, 50, 60);
      colors.success = rgbColor(200, 150, 100);
      clock.advance(1_000);
      handlers.agent_start![0]!();
      expect(getLastFrames()![0]).toStartWith("\x1b[38;2;70;69;67mW");
    } finally {
      handle.dispose();
      clock.restore();
      setTestConfig(previous);
    }
  });

  it("preserves the two-second sweep, frame interval, and per-character resets", () => {
    const { pi, ctx, handlers, getLastFrames, getLastIntervalMs } =
      mkIndicatorHarness({
        muted: rgbColor(10, 20, 30),
        accent: rgbColor(100, 150, 200),
      });
    const clock = installFakeClock();
    const handle = registerWorkingIndicator(pi, ctx);
    try {
      handlers.agent_start![0]!();
      const first = getLastFrames()![0]!;
      const base = [..."Working"]
        .map((ch) => `\x1b[38;2;10;20;30m${ch}\x1b[39m`)
        .join("");
      expect(first).toStartWith(base);
      expect(getLastIntervalMs()).toBe(100);
      clock.advance(1_000);
      handlers.agent_start![0]!();
      expect(getLastFrames()![0]).toStartWith(
        "\x1b[38;2;27;44;62mW\x1b[39m\x1b[38;2;51;79;107mo\x1b[39m" +
          "\x1b[38;2;74;113;151mr\x1b[39m\x1b[38;2;89;134;179mk\x1b[39m" +
          "\x1b[38;2;89;134;179mi\x1b[39m\x1b[38;2;74;113;151mn\x1b[39m" +
          "\x1b[38;2;51;79;107mg\x1b[39m",
      );
      clock.advance(1_000);
      handlers.agent_start![0]!();
      expect(getLastFrames()![0]).toStartWith(base);
    } finally {
      handle.dispose();
      clock.restore();
    }
  });
});

describe("assembleRunDuration", () => {
  it("formats seconds only", () => {
    const start = Date.now() - 30_000;
    expect(assembleRunDuration(start)).toBe("30s");
  });

  it("formats minutes and seconds", () => {
    const start = Date.now() - 125_000;
    expect(assembleRunDuration(start)).toBe("2m 5s");
  });

  it("formats hours, minutes and seconds", () => {
    const start = Date.now() - 3_700_000;
    expect(assembleRunDuration(start)).toBe("1h 1m 40s");
  });

  it("formats zero seconds", () => {
    // Use immediate past to avoid rounding edge
    const start = Date.now() - 400;
    expect(assembleRunDuration(start)).toBe("0s");
  });
});

function emitAssistantMessageEnd(
  handlers: Record<string, Array<(...args: any[]) => void>>,
  stopReason: string,
) {
  handlers.message_end![0]!({
    type: "message_end",
    message: { role: "assistant", stopReason },
  });
}

describe("registerWorkingIndicator", () => {
  it("keeps elapsed time through repeated stream retries and notifies once at settlement", () => {
    const previous = getConfig();
    setTestConfig({ workingIndicator: { showDuration: true } });
    const harness = mkIndicatorHarness();
    const notifications: string[] = [];
    harness.ctx.ui.notify = (message) => {
      notifications.push(message);
    };
    const clock = installFakeClock();
    const handle = registerWorkingIndicator(harness.pi, harness.ctx);
    try {
      harness.handlers.agent_start![0]!();
      handle.setStatusIndicator(suppliedStatus("working"));
      for (const attempt of [1, 2]) {
        clock.advance(5_000);
        harness.handlers.message_end![0]!({
          type: "message_end",
          message: {
            role: "assistant",
            stopReason: "error",
            errorMessage: "Error: WebSocket closed 1012",
          },
        });
        handle.setStatusIndicator(undefined);
        const retry = suppliedStatus("retry");
        handle.setStatusIndicator(retry);
        expect(harness.renderStatus().join("\n")).toContain("Native retry");
        clock.advance(2_000);
        harness.handlers.agent_start![0]!();
        handle.setStatusIndicator(suppliedStatus("working"));
        expect(harness.getLastFrames()![0]).toContain(
          `Working (${attempt * 7}s`,
        );
        expect(notifications).toEqual([]);
        expect(retry.setMessage).not.toHaveBeenCalled();
        expect(retry.setIndicator).not.toHaveBeenCalled();
        expect(retry.dispose).not.toHaveBeenCalled();
      }
      clock.advance(3_000);
      emitAssistantMessageEnd(harness.handlers, "stop");
      harness.handlers.agent_settled![0]!({
        type: "agent_settled",
        aborted: false,
      });
      expect(notifications).toEqual(["Worked for 17s"]);
      clock.advance(5_000);
      harness.handlers.agent_start![0]!();
      expect(harness.getLastFrames()![0]).toContain("Working (0s");
    } finally {
      handle.dispose();
      clock.restore();
      setTestConfig(previous);
    }
  });

  for (const stopReason of ["error", "aborted"] as const) {
    it(`clears retry timing after an ${stopReason} settlement`, () => {
      const previous = getConfig();
      setTestConfig({ workingIndicator: { showDuration: true } });
      const clock = installFakeClock();
      const { pi, ctx, handlers, getNotifyCount, getLastFrames } =
        mkIndicatorHarness();
      const handle = registerWorkingIndicator(pi, ctx);
      try {
        handlers.agent_start![0]!();
        clock.advance(5_000);
        emitAssistantMessageEnd(handlers, "error");
        handlers.agent_start![0]!();
        emitAssistantMessageEnd(handlers, stopReason);
        handlers.agent_settled![0]!({
          type: "agent_settled",
          aborted: stopReason === "aborted",
        });
        expect(getNotifyCount()).toBe(0);
        expect(getLastFrames()).toEqual([]);
        clock.advance(5_000);
        handlers.agent_start![0]!();
        expect(getLastFrames()![0]).toContain("Working (0s");
      } finally {
        handle.dispose();
        clock.restore();
        setTestConfig(previous);
      }
    });
  }

  it("notifies on agent_settled after a clean run", () => {
    const { pi, ctx, handlers, getNotifyCount } = mkIndicatorHarness();
    const handle = registerWorkingIndicator(pi, ctx);

    handlers.agent_start![0]!();
    emitAssistantMessageEnd(handlers, "stop");
    expect(getNotifyCount()).toBe(0);
    handlers.agent_settled![0]!({ type: "agent_settled" });

    expect(getNotifyCount()).toBe(1);
    handle.dispose();
  });

  it("handles missing message_end payload defensively", () => {
    const { pi, ctx, handlers, getNotifyCount } = mkIndicatorHarness();
    const handle = registerWorkingIndicator(pi, ctx);

    handlers.agent_start![0]!();
    expect(() => handlers.message_end![0]!({})).not.toThrow();
    handlers.agent_settled![0]!({ type: "agent_settled" });

    expect(getNotifyCount()).toBe(0);
    handle.dispose();
  });

  it("hides the indicator when the run settles", () => {
    const { pi, ctx, handlers, getLastFrames } = mkIndicatorHarness();
    const handle = registerWorkingIndicator(pi, ctx);

    handlers.agent_start![0]!();
    expect(getLastFrames()!.join("\n")).toContain("Working");
    handlers.agent_settled![0]!({ type: "agent_settled" });

    expect(getLastFrames()).toEqual([]);
    handle.dispose();
  });
});

describe("working indicator across UI prompts", () => {
  it("pauses while waiting for input and excludes that time", () => {
    const { pi, ctx, handlers, getLastFrames } = mkIndicatorHarness();
    const clock = installFakeClock();
    const handle = registerWorkingIndicator(pi, ctx);

    try {
      handlers.agent_start![0]!();
      clock.advance(1_100);
      handlers.ui_prompt_start![0]!({
        type: "ui_prompt_start",
        reason: "ui_prompt",
        kind: "custom",
      });
      expect(getLastFrames()).toEqual([]);

      clock.advance(5_000);
      handlers.ui_prompt_end![0]!({
        type: "ui_prompt_end",
        reason: "ui_prompt",
        kind: "custom",
      });

      expect(getLastFrames()!.join("\n")).toContain("Working");
      expect(getLastFrames()!.join("\n")).toContain("1s");
      expect(getLastFrames()!.join("\n")).not.toContain("6s");
    } finally {
      handle.dispose();
      clock.restore();
    }
  });

  it("reacts to prompts emitted by Pi's wrapped UI context", async () => {
    const { pi, ctx, handlers, getLastFrames } = mkIndicatorHarness();
    const handle = registerWorkingIndicator(pi, ctx);
    const extensionPath = "working-indicator-test";
    const extension: Extension = {
      path: extensionPath,
      resolvedPath: extensionPath,
      sourceInfo: {
        path: extensionPath,
        source: "test",
        scope: "temporary",
        origin: "top-level",
      },
      handlers: new Map(Object.entries(handlers)) as Extension["handlers"],
      tools: new Map(),
      messageRenderers: new Map(),
      commands: new Map(),
      flags: new Map(),
      shortcuts: new Map(),
    };
    const runner = new ExtensionRunner(
      [extension],
      createExtensionRuntime(),
      process.cwd(),
      {} as never,
      {} as never,
    );
    let closePrompt: (() => void) | undefined;
    const pendingPrompt = new Promise<void>((resolve) => {
      closePrompt = resolve;
    });
    runner.setUIContext(
      {
        custom: async () => pendingPrompt,
      } as unknown as ExtensionUIContext,
      "tui",
    );

    try {
      handlers.agent_start![0]!();
      const prompt = runner.getUIContext().custom(() => null as never);
      await Promise.resolve();
      expect(getLastFrames()).toEqual([]);

      closePrompt!();
      await prompt;
      await Promise.resolve();
      expect(getLastFrames()!.join("\n")).toContain("Working");
    } finally {
      closePrompt?.();
      handle.dispose();
    }
  });

  it("ignores prompts while the agent is idle", () => {
    const { pi, ctx, handlers, getLastFrames } = mkIndicatorHarness();
    const handle = registerWorkingIndicator(pi, ctx);

    handlers.ui_prompt_start![0]!({
      type: "ui_prompt_start",
      reason: "ui_prompt",
      kind: "select",
      title: "Choose",
    });
    handlers.ui_prompt_end![0]!({
      type: "ui_prompt_end",
      reason: "ui_prompt",
      kind: "select",
      title: "Choose",
    });

    expect(getLastFrames()).toBeNull();
    handle.dispose();
  });

  it("does not resume after the run settles during a prompt", () => {
    const { pi, ctx, handlers, getLastFrames } = mkIndicatorHarness();
    const handle = registerWorkingIndicator(pi, ctx);

    handlers.agent_start![0]!();
    handlers.ui_prompt_start![0]!({
      type: "ui_prompt_start",
      reason: "ui_prompt",
      kind: "confirm",
      title: "Continue?",
    });
    handlers.agent_settled![0]!({ type: "agent_settled" });
    handlers.ui_prompt_end![0]!({
      type: "ui_prompt_end",
      reason: "ui_prompt",
      kind: "confirm",
      title: "Continue?",
    });

    expect(getLastFrames()).toEqual([]);
    handle.dispose();
  });
});

function suppliedStatus(kind: EditorStatusIndicator["kind"]) {
  const text = new Text(`Native ${kind}`, 1, 0);
  return {
    kind,
    render: (width: number) => ["", ...text.render(width)],
    invalidate() {},
    setMessage: mock(() => {}),
    setIndicator: mock(() => {}),
    stop: mock(() => {}),
    dispose: mock(() => {}),
  } as unknown as EditorStatusIndicator;
}

describe("shimmer compaction status", () => {
  let previous: ReturnType<typeof getConfig>;
  beforeEach(() => {
    previous = getConfig();
    setTestConfig({
      workingIndicator: { showDuration: true, showInterruptHint: true },
    });
  });
  afterEach(() => setTestConfig(previous));

  for (const [reason, label] of [
    ["manual", "Compacting"],
    ["threshold", "Auto-compacting"],
    ["overflow", "Auto-compacting"],
  ] as const) {
    it(`renders ${reason} compaction while idle without changing Pi's indicator`, () => {
      const harness = mkIndicatorHarness();
      const clock = installFakeClock();
      const handle = registerWorkingIndicator(harness.pi, harness.ctx);
      const indicator = suppliedStatus("compaction");
      try {
        handle.setStatusIndicator(indicator);
        expect(harness.renderStatus().join("\n")).toContain(
          "Native compaction",
        );
        clock.advance(1_100);
        harness.handlers.session_before_compact![0]!({ reason });
        const text = harness.renderStatus().join("\n");
        expect(text).toContain(`${label} (1s · escape to cancel)`);
        expect(text.includes("Context overflow detected, ")).toBe(
          reason === "overflow",
        );
        expect(harness.getLastFrames()).toBeNull();
        for (const width of [0, 1, 2, 8, 24, 80])
          expect(
            harness
              .renderStatus(width)
              .every((row) => visibleWidth(row) <= width),
          ).toBe(true);
        handle.setStatusIndicator(undefined);
        expect(harness.renderStatus()).toEqual([]);
        expect(harness.getNotifyCount()).toBe(0);
      } finally {
        handle.dispose();
        clock.restore();
      }
      expect(harness.hasWidget()).toBe(false);
      for (const method of [
        indicator.setMessage,
        indicator.setIndicator,
        indicator.stop,
        indicator.dispose,
      ])
        expect(method).not.toHaveBeenCalled();
    });
  }

  it("keeps task time across compaction and excludes prompt waits from both clocks", () => {
    const harness = mkIndicatorHarness();
    const clock = installFakeClock();
    const handle = registerWorkingIndicator(harness.pi, harness.ctx);
    try {
      harness.handlers.agent_start![0]!();
      clock.advance(1_100);
      handle.setStatusIndicator(suppliedStatus("compaction"));
      harness.handlers.session_before_compact![0]!({ reason: "threshold" });
      clock.advance(2_100);
      harness.handlers.ui_prompt_start![0]!();
      clock.advance(5_000);
      expect(harness.renderStatus().join("\n")).toContain(
        "Auto-compacting (2s",
      );
      harness.handlers.ui_prompt_end![0]!();
      handle.setStatusIndicator(undefined);
      handle.setStatusIndicator(suppliedStatus("working"));
      harness.handlers.agent_start![0]!();
      expect(harness.getLastFrames()![0]).toContain("Working (3s");
      clock.advance(1_100);
      emitAssistantMessageEnd(harness.handlers, "stop");
      harness.handlers.agent_settled![0]!();
      expect(harness.getNotifyCount()).toBe(1);
    } finally {
      handle.dispose();
      clock.restore();
    }
  });

  it("starts a fresh Working clock after an idle manual compaction without an input event", () => {
    const harness = mkIndicatorHarness();
    const handle = registerWorkingIndicator(harness.pi, harness.ctx);
    try {
      handle.setStatusIndicator(suppliedStatus("compaction"));
      harness.handlers.session_before_compact![0]!({ reason: "manual" });
      handle.setStatusIndicator(undefined);
      handle.setStatusIndicator(suppliedStatus("working"));
      harness.handlers.agent_start![0]!();
      expect(harness.getLastFrames()![0]).toContain("Working (0s");
    } finally {
      handle.dispose();
    }
  });

  it("uses current colors, shared flags, and remapped or unbound cancel keys", () => {
    const harness = mkIndicatorHarness({
      muted: rgbColor(10, 20, 30),
      accent: rgbColor(100, 150, 200),
      success: rgbColor(20, 220, 60),
    });
    const clock = installFakeClock(11_000);
    const handle = registerWorkingIndicator(harness.pi, harness.ctx);
    try {
      handle.setStatusIndicator(suppliedStatus("compaction"));
      harness.handlers.session_before_compact![0]!({ reason: "manual" });
      getKeybindings().setUserBindings({ "app.interrupt": "ctrl+k" });
      const first = harness.renderStatus().join("\n");
      expect(stripAnsi(first)).toContain("Compacting (0s · ctrl+k to cancel)");
      setTestConfig({
        workingIndicator: {
          shimmerColor: "success",
          showDuration: false,
          showInterruptHint: false,
        },
      });
      const second = harness.renderStatus().join("\n");
      expect(second).not.toBe(first);
      expect(stripAnsi(second).trim()).toBe("Compacting");
      setTestConfig({ workingIndicator: { showInterruptHint: true } });
      getKeybindings().setUserBindings({ "app.interrupt": [] });
      expect(stripAnsi(harness.renderStatus().join("\n")).trim()).toBe(
        "Compacting",
      );
      harness.ctx.ui.theme.getColorMode = () => "256color";
      Object.defineProperty(harness.ctx.ui.theme, "colors", {
        get() {
          throw new Error("No colors needed outside truecolor");
        },
      });
      expect(stripAnsi(harness.renderStatus().join("\n")).trim()).toBe(
        "Compacting",
      );
    } finally {
      handle.dispose();
      clock.restore();
    }
  });

  it("passes retry, branch summary, and compaction without a reason through unchanged", () => {
    const harness = mkIndicatorHarness();
    const handle = registerWorkingIndicator(harness.pi, harness.ctx);
    try {
      for (const kind of ["retry", "branchSummary", "compaction"] as const) {
        const indicator = suppliedStatus(kind);
        handle.setStatusIndicator(indicator);
        expect(harness.renderStatus()).toEqual([
          ...indicator.render(120).slice(1),
          "",
        ]);
        expect(indicator.setIndicator).not.toHaveBeenCalled();
        expect(indicator.dispose).not.toHaveBeenCalled();
      }
    } finally {
      handle.dispose();
    }
  });

  it("keeps at most one extension timer and leaves a replacement editor alone", () => {
    const originalSetInterval = globalThis.setInterval;
    const originalClearInterval = globalThis.clearInterval;
    const active = new Set<unknown>();
    globalThis.setInterval = (() => {
      const timer = {};
      active.add(timer);
      expect(active.size).toBeLessThanOrEqual(1);
      return timer;
    }) as unknown as typeof setInterval;
    globalThis.clearInterval = ((timer: unknown) => {
      active.delete(timer);
    }) as typeof clearInterval;
    const harness = mkIndicatorHarness();
    const handle = registerWorkingIndicator(harness.pi, harness.ctx);
    const compaction = suppliedStatus("compaction");
    try {
      harness.handlers.agent_start![0]!();
      expect(active.size).toBe(1);
      handle.setStatusIndicator(compaction);
      expect(active.size).toBe(0);
      harness.handlers.session_before_compact![0]!({ reason: "manual" });
      expect(active.size).toBe(1);
      handle.setStatusIndicator(suppliedStatus("retry"));
      expect(active.size).toBe(0);
      handle.setStatusIndicator(compaction);
      harness.handlers.session_before_compact![0]!({ reason: "manual" });
      harness.ctx.ui.getEditorComponent = () => () => ({}) as never;
      expect(harness.renderStatus()).toEqual([]);
      expect(active.size).toBe(0);
      expect(compaction.dispose).not.toHaveBeenCalled();
    } finally {
      handle.dispose();
      globalThis.setInterval = originalSetInterval;
      globalThis.clearInterval = originalClearInterval;
    }
    expect(active.size).toBe(0);
  });

  it("cleans up idempotently without an old session clearing its replacement widget", () => {
    const harness = mkIndicatorHarness();
    const first = registerWorkingIndicator(harness.pi, harness.ctx);
    const indicator = suppliedStatus("compaction");
    first.setStatusIndicator(indicator);
    harness.handlers.session_before_compact![0]!({ reason: "manual" });
    expect(harness.renderStatus().join("\n")).toContain("Compacting");
    const second = registerWorkingIndicator(harness.pi, harness.ctx);
    try {
      second.setStatusIndicator(indicator);
      expect(harness.renderStatus().join("\n")).toContain("Native compaction");
      second.setStatusIndicator(suppliedStatus("compaction"));
      harness.handlers.session_before_compact![0]!({ reason: "manual" });
      first.dispose();
      expect(harness.renderStatus().join("\n")).toContain("Compacting");
      expect(harness.hasWidget()).toBe(true);
    } finally {
      first.dispose();
      second.dispose();
      second.dispose();
    }
    expect(harness.hasWidget()).toBe(false);
  });
});

describe("working indicator across auto-compaction", () => {
  it("keeps the total running time across a compaction split", () => {
    const { pi, ctx, handlers, getLastFrames } = mkIndicatorHarness();
    const clock = installFakeClock();
    const handle = registerWorkingIndicator(pi, ctx);

    try {
      handlers.agent_start![0]!();
      clock.advance(1_100);
      handlers["session_before_compact"]![0]!({
        type: "session_before_compact",
        reason: "threshold",
      });
      handlers.agent_start![0]!();

      expect(getLastFrames()!.join("\n")).toContain("1s");
    } finally {
      handle.dispose();
      clock.restore();
    }
  });

  it("keeps the indicator lit through the compaction gap", () => {
    const { pi, ctx, handlers, getLastFrames } = mkIndicatorHarness();
    const handle = registerWorkingIndicator(pi, ctx);

    handlers.agent_start![0]!();
    handlers["session_before_compact"]![0]!({
      type: "session_before_compact",
      reason: "threshold",
    });

    expect(getLastFrames()!.join("\n")).toContain("Working");
    handle.dispose();
  });

  it("resets the timer for a new task after compaction", () => {
    const { pi, ctx, handlers, getLastFrames } = mkIndicatorHarness();
    const clock = installFakeClock();
    const handle = registerWorkingIndicator(pi, ctx);

    try {
      handlers.agent_start![0]!();
      clock.advance(1_100);
      handlers["session_before_compact"]![0]!({
        type: "session_before_compact",
        reason: "threshold",
      });
      handlers.input![0]!({
        type: "input",
        text: "next task",
        source: "interactive",
      });
      handlers.agent_start![0]!();

      expect(getLastFrames()!.join("\n")).toContain("0s");
    } finally {
      handle.dispose();
      clock.restore();
    }
  });

  it("notifies once at final settle across a compaction split", () => {
    const { pi, ctx, handlers, getNotifyCount } = mkIndicatorHarness();
    const handle = registerWorkingIndicator(pi, ctx);

    handlers.agent_start![0]!();
    emitAssistantMessageEnd(handlers, "stop");
    handlers["session_before_compact"]![0]!({
      type: "session_before_compact",
      reason: "threshold",
    });
    handlers.agent_start![0]!();
    emitAssistantMessageEnd(handlers, "stop");
    expect(getNotifyCount()).toBe(0);
    handlers.agent_settled![0]!({ type: "agent_settled" });

    expect(getNotifyCount()).toBe(1);
    handle.dispose();
  });

  it("does not notify for aborted runs", () => {
    const { pi, ctx, handlers, getNotifyCount } = mkIndicatorHarness();
    const handle = registerWorkingIndicator(pi, ctx);

    handlers.agent_start![0]!();
    emitAssistantMessageEnd(handlers, "aborted");
    handlers.agent_settled![0]!({ type: "agent_settled" });

    expect(getNotifyCount()).toBe(0);
    handle.dispose();
  });
});
