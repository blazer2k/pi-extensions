import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test";
import {
  initTheme,
  createBashToolDefinition,
  type ExtensionToolContext,
  type Theme,
} from "@earendil-works/pi-coding-agent";
import { getConfig } from "../config/store";
import { patchBashTool } from "./bash";
import { clearBlinkTimers, getBlinkIndicator } from "./rendering/state";
import { stripAnsi } from "./rendering/text";
import {
  mkTheme,
  mkToolCtx,
  setupTool,
  setTestConfig,
} from "../testing/helpers";
import type { BashRenderState } from "./bash/types";
import { PI_0_84_3_OUTPUT } from "./test-fixtures/pi-0.84.3";

function setupBashTool() {
  return setupTool(patchBashTool);
}

afterEach(() => clearBlinkTimers());

describe("bash renderCall", () => {
  it("collapses whitespace and renders timeout as dim", () => {
    const def = setupBashTool();
    const renderCall = def.renderCall!;
    const theme = {
      ...mkTheme(),
      fg: (color: string, text: string) => `${color}:${text}`,
    } as Theme;
    const ctx = mkToolCtx({ expanded: false });

    const component = renderCall(
      { command: "echo   hello\npwd", timeout: 10 },
      theme,
      ctx,
    );

    const text = stripAnsi(component.render(120).join("\n"));
    expect(text).toContain("echo hello");
    expect(text).toContain("dim: (timeout 10s)");
    expect(text).not.toContain("echo   hello\npwd");
  });

  it("expands the full command with connected continuation lines", () => {
    const def = setupBashTool();
    const renderCall = def.renderCall!;
    const theme = mkTheme();
    const ctx = mkToolCtx({ expanded: true });
    const command =
      "echo   hello with a command long enough to wrap across rows\npwd && printf done";

    const component = renderCall({ command, timeout: 10 }, theme, ctx);
    const lines = component
      .render(36)
      .map((line) => stripAnsi(line).trimEnd().slice(1))
      .filter(Boolean);

    expect(lines.join("\n")).toContain("echo   hello");
    expect(lines.join("\n")).toContain("printf done");
    expect(lines.slice(1).every((line) => line.startsWith("│  "))).toBe(true);
    expect(lines.join("\n")).not.toContain("...");
  });

  it("syntax-highlights commands while preserving collapsed truncation", () => {
    initTheme("dark");
    const def = setupBashTool();
    const state: BashRenderState = {};
    const command = `echo "$HOME" && printf '%s' ${"x".repeat(100)}-tail`;
    const component = def.renderCall!(
      { command },
      mkTheme(),
      mkToolCtx({ executionStarted: false, isPartial: false, state }),
    );
    const output = component.render(120).join("\n");
    const visibleOutput = stripAnsi(output);

    expect(output).toContain("\x1b[");
    expect(visibleOutput).toContain("...");
    expect(visibleOutput).not.toContain("-tail");
    expect(state.callExpandable).toBe(true);
  });

  it("reuses highlighted commands until the source changes", () => {
    const def = setupBashTool();
    const state: BashRenderState = {};
    const theme = mkTheme();
    const context = mkToolCtx({
      executionStarted: false,
      isPartial: false,
      state,
    });

    def.renderCall!({ command: "echo one" }, theme, context).render(120);
    const firstCache = state.callHighlightCache;
    def.renderCall!({ command: "echo one" }, theme, context).render(120);
    expect(state.callHighlightCache).toBe(firstCache);

    def.renderCall!({ command: "echo two" }, theme, context).render(120);
    expect(state.callHighlightCache).not.toBe(firstCache);
  });

  it("refreshes completed command colors after a theme change", async () => {
    const { theme } =
      await import("../../../../node_modules/@earendil-works/pi-coding-agent/dist/modes/interactive/theme/theme.js");
    const def = setupBashTool();
    const state: BashRenderState = {};
    const context = mkToolCtx({
      executionStarted: false,
      isPartial: false,
      state,
    });

    try {
      initTheme("dark");
      def.renderCall!({ command: `echo "$HOME"` }, theme, context).render(120);
      const darkCache = state.callHighlightCache;

      state.hasResult = true;
      initTheme("light");
      def.renderCall!({ command: `echo "$HOME"` }, theme, context).render(120);

      expect(state.callHighlightCache).not.toBe(darkCache);
      expect(state.callHighlightCache?.collapsedCommand).not.toBe(
        darkCache?.collapsedCommand,
      );
    } finally {
      initTheme("dark");
    }
  });

  it("uses a static dim indicator for effectively expanded calls", () => {
    const def = setupBashTool();
    const state = {};
    const theme = {
      ...mkTheme(),
      fg: (color: string, text: string) => `${color}:${text}`,
    } as Theme;
    const output = def.renderCall!(
      { command: "printf one\nprintf two" },
      theme,
      mkToolCtx({ expanded: true, executionStarted: true, state }),
    )
      .render(120)
      .join("\n");

    expect(output).toContain(`dim:${getBlinkIndicator().unfilled}`);
    expect((state as { blinkTimer?: unknown }).blinkTimer).toBeUndefined();
  });

  it("keeps the blink timer when expanded-mode calls remain compact", () => {
    const def = setupBashTool();
    const state: BashRenderState = {};
    const context = mkToolCtx({ expanded: true, isPartial: true, state });
    const args = { command: "sleep 10" };

    def.renderCall!(args, mkTheme(), context).render(120);
    const timer = state.blinkTimer;
    expect(timer).toBeDefined();

    const component = def.renderCall!(args, mkTheme(), context);
    expect(state.blinkTimer).toBe(timer);
    component.render(120);
    expect(state.blinkTimer).toBe(timer);
    clearBlinkTimers();
  });

  it("preserves command boundaries and safe whitespace when expanded", () => {
    const def = setupBashTool();
    const renderCall = def.renderCall!;
    const component = renderCall(
      { command: "first command\r\n\tsecond command", timeout: 30 },
      mkTheme(),
      mkToolCtx({ expanded: true }),
    );
    const lines = component
      .render(120)
      .map((line) => stripAnsi(line).trimEnd());

    expect(lines.some((line) => line.includes("first command"))).toBe(true);
    expect(lines.some((line) => line.includes("│   second command"))).toBe(
      true,
    );
  });

  it("keeps an expanded timeout suffix intact", () => {
    const def = setupBashTool();
    const renderCall = def.renderCall!;
    const component = renderCall(
      {
        command:
          "printf 'a command whose final source line is deliberately long enough to force its timeout onto a separate row'",
        timeout: 30,
      },
      mkTheme(),
      mkToolCtx({ expanded: true }),
    );
    const lines = component.render(120).map((line) => line.trimEnd());

    expect(lines.filter((line) => line.includes("(timeout 30s)"))).toHaveLength(
      1,
    );
  });

  it("renders incomplete partial args without throwing", () => {
    const def = setupBashTool();
    const renderCall = def.renderCall!;
    const theme = mkTheme();
    const ctx = mkToolCtx({ isPartial: true, argsComplete: false });

    const component = renderCall({}, theme, ctx);
    const text = component.render(120).join("\n");
    expect(text).toContain("Bash");
    expect(text).toContain("...");
  });
});

describe("bash renderResult", () => {
  it("shows duration in result", () => {
    const def = setupBashTool();
    const renderResult = def.renderResult!;
    const theme = mkTheme();
    const ctx = mkToolCtx();

    const component = renderResult(
      {
        content: [{ type: "text", text: "hello" }],
        details: {},
      },
      { expanded: false, isPartial: false },
      theme,
      { ...ctx, durationMs: 1200 },
    );

    const output = component.render(120).join("\n");
    expect(output).toContain("Took 1.2s");
  });

  it("uses only Pi's recorded duration for completed results", () => {
    const def = patchBashTool();
    for (const [durationMs, expected] of [
      [2345, "Took 2.3s"],
      [0, "Took 0ms"],
      [undefined, undefined],
    ] as const) {
      for (const isError of [false, true]) {
        const input = {
          content: [
            {
              type: "text" as const,
              text: isError ? "Command aborted" : "done",
            },
          ],
          details: {},
        };
        const snapshot = structuredClone(input);
        const component = def.renderResult!(
          input,
          { expanded: false, isPartial: false },
          mkTheme(),
          mkToolCtx({
            durationMs,
            isError,
            state: { startedAt: Date.now() - 9999 },
          }),
        );
        const output = component.render(80).join("\n");
        if (expected) expect(output).toContain(expected);
        else expect(output).not.toContain("Took");
        expect(input).toEqual(snapshot);
      }
    }
  });

  it("formats minute and hour durations", () => {
    const def = setupBashTool();

    for (const [durationMs, expected] of [
      [62_000, "Took 1m 2s"],
      [3_784_000, "Took 1h 3m 4s"],
    ] as const) {
      const component = def.renderResult!(
        {
          content: [{ type: "text", text: "hello" }],
          details: {},
        },
        { expanded: false, isPartial: false },
        mkTheme(),
        mkToolCtx({ durationMs }),
      );

      expect(component.render(120).join("\n")).toContain(expected);
    }
  });

  it("renders an aborted execution without inventing its duration", async () => {
    const execute = createBashToolDefinition(process.cwd()).execute;
    const controller = new AbortController();
    controller.abort();
    let errorText = "";

    try {
      await execute(
        "failed-call",
        { command: "echo hello" },
        controller.signal,
        undefined,
        {
          cwd: process.cwd(),
          sessionManager: {
            getSessionId: () => "bash-test-session",
            getSessionFile: () => undefined,
          },
        } as unknown as ExtensionToolContext,
      );
    } catch (error) {
      errorText = error instanceof Error ? error.message : String(error);
    }

    expect(errorText).toContain("Command aborted");
    const def = patchBashTool();

    const component = def.renderResult!(
      { content: [{ type: "text", text: errorText }], details: undefined },
      { expanded: false, isPartial: false },
      mkTheme(),
      mkToolCtx({
        toolCallId: "failed-call",
        isError: true,
        state: {},
      }),
    );

    expect(component.render(120).join("\n")).not.toContain("Took ");
  });

  it("preserves nonzero exit results without inventing their duration", async () => {
    const result = await createBashToolDefinition(process.cwd()).execute(
      "nonzero-call",
      { command: "echo before failure; exit 4" },
      undefined,
      undefined,
      {
        cwd: process.cwd(),
        sessionManager: {
          getSessionId: () => "bash-test-session",
          getSessionFile: () => undefined,
        },
      } as unknown as ExtensionToolContext,
    );

    expect(result.isError).toBe(true);
    expect(result.structuredContent).toMatchObject({
      output: "before failure\n",
      exit_code: 4,
    });
    expect(
      (result.details as { durationMs?: number } | undefined)?.durationMs,
    ).toBeUndefined();
    const snapshot = structuredClone(result);
    const def = patchBashTool();

    const component = def.renderResult!(
      result,
      { expanded: false, isPartial: false },
      mkTheme(),
      mkToolCtx({ toolCallId: "nonzero-call", isError: result.isError }),
    );
    const text = stripAnsi(component.render(120).join("\n"));

    expect(text).toContain("before failure");
    expect(text).toContain("exited with code 4");
    expect(text).not.toContain("Took ");
    expect(result).toEqual(snapshot);
  });

  it("renders native timeout statuses as the status row", async () => {
    // The second shell exits while a bounded background writer keeps the
    // output pipe busy, so Pi appends the shell's real exit code.
    const cases = [
      ["echo started; sleep 2", /^Command timed out after 0\.3 seconds$/],
      [
        "(i=0; while [ $i -lt 100 ]; do echo tick; sleep 0.02; i=$((i+1)); done) & echo started; exit 3",
        /^Command timed out after 0\.3 seconds\. The shell exited with code 3 /,
      ],
    ] as const;

    for (const [command, expectedStatus] of cases) {
      let errorText = "";

      try {
        await createBashToolDefinition(process.cwd()).execute(
          "timeout-call",
          { command, timeout: 0.3 },
          undefined,
          undefined,
          {
            cwd: process.cwd(),
            sessionManager: {
              getSessionId: () => "bash-test-session",
              getSessionFile: () => undefined,
            },
          } as unknown as ExtensionToolContext,
        );
      } catch (error) {
        errorText = error instanceof Error ? error.message : String(error);
      }

      const status = errorText.split("\n").at(-1) ?? "";
      expect(status).toMatch(expectedStatus);

      const component = patchBashTool().renderResult!(
        { content: [{ type: "text", text: errorText }], details: undefined },
        { expanded: false, isPartial: false },
        mkTheme(),
        mkToolCtx({ toolCallId: "timeout-call", isError: true, state: {} }),
      );
      const text = stripAnsi(component.render(400).join("\n"));

      expect(text).toContain("started");
      expect(text).toContain(`─ ${status}`);
    }
  });

  it("puts duration before truncation metadata", () => {
    const def = setupBashTool();
    const renderResult = def.renderResult!;
    const theme = mkTheme();
    const ctx = mkToolCtx();

    const component = renderResult(
      {
        content: [{ type: "text", text: "hello" }],
        details: {
          truncation: { truncated: true },
        },
      },
      { expanded: false, isPartial: false },
      theme,
      { ...ctx, durationMs: 50 },
    );

    const output = component.render(120).join("\n");
    expect(output).toContain("Took 50ms · Truncated");
  });

  it("omits error metadata from single-line and expanded errors", () => {
    const def = setupBashTool();
    const renderResult = def.renderResult!;
    const theme = mkTheme();

    for (const expanded of [false, true]) {
      const ctx = mkToolCtx({ isError: true, expanded });
      const component = renderResult(
        {
          content: [{ type: "text", text: "failure" }],
          details: {
            truncation: { truncated: true },
          },
        },
        { expanded, isPartial: false },
        theme,
        { ...ctx, durationMs: 50 },
      );

      const output = component.render(120).join("\n");
      expect(output).toContain("Took 50ms · Truncated");
      expect(output).not.toContain("error ·");
    }
  });

  it("omits an empty metadata row from short multi-line errors", () => {
    const def = setupBashTool();
    const renderResult = def.renderResult!;
    const theme = mkTheme();

    for (const expanded of [false, true]) {
      const ctx = mkToolCtx({ isError: true, expanded });
      const component = renderResult(
        {
          content: [
            {
              type: "text",
              text: "line one\nline two\nline three\nCommand exited with code 3",
            },
          ],
          details: {},
        },
        { expanded, isPartial: false },
        theme,
        ctx,
      );

      const output = component.render(120).join("\n");
      expect(output).not.toContain("├─");
      expect(output).toContain("│  line one");
      expect(output).toContain("╰─ Command exited with code 3");
    }
  });

  let originalDisplay: "preview" | "summary";
  beforeEach(() => {
    originalDisplay = getConfig().tools.collapsedOutputDisplay;
    setTestConfig({
      tools: {
        collapsedOutputDisplay: "preview",
      },
    });
  });
  afterEach(() => {
    setTestConfig({
      tools: {
        collapsedOutputDisplay: originalDisplay,
      },
    });
  });

  it("preview mode shows one head and one tail line around an omission row", () => {
    const def = setupBashTool();
    const output = def.renderResult!(
      {
        content: [
          {
            type: "text",
            text: Array.from(
              { length: 10 },
              (_, i) => `L${String(i + 1).padStart(2, "0")}`,
            ).join("\n"),
          },
        ],
        details: {},
      },
      { expanded: false, isPartial: false },
      mkTheme(),
      mkToolCtx({ durationMs: 50 }),
    )
      .render(120)
      .join("\n");

    expect(output).toContain("│  L01");
    expect(output).not.toContain("L02");
    expect(output).not.toContain("L09");
    expect(output).toContain("│  L10");
    expect(output).toContain("┊  +8 lines");
    expect(output.split("\n").at(-1)).toContain("╰─ Took 50ms");
  });

  it("renders selected blank preview lines as empty tree rows", () => {
    const def = setupBashTool();
    const lines = def.renderResult!(
      {
        content: [{ type: "text", text: "\none\ntwo\nthree\nfour" }],
        details: {},
      },
      { expanded: false, isPartial: false },
      mkTheme(),
      mkToolCtx({ durationMs: 50 }),
    )
      .render(120)
      .map((line) => line.trimEnd());
    expect(lines[0]?.trim()).toBe("│");
    expect(lines[1]).toContain("┊  +3 lines");
    expect(lines[2]).toContain("│  four");
  });

  it("preview mode shows all three lines without enabling expansion", () => {
    const def = setupBashTool();
    const output = def.renderResult!(
      {
        content: [{ type: "text", text: "one\ntwo\nthree" }],
        details: {},
      },
      { expanded: false, isPartial: false },
      mkTheme(),
      mkToolCtx({ durationMs: 50 }),
    )
      .render(120)
      .join("\n");

    for (const line of ["one", "two", "three"]) {
      expect(output).toContain(`│  ${line}`);
    }
    expect(output).not.toContain("ctrl+o");
    expect(output.split("\n").at(-1)).toContain("╰─ Took 50ms");
  });

  it("summary mode hides output and includes its line count", () => {
    setTestConfig({
      tools: {
        collapsedOutputDisplay: "summary",
      },
    });
    const def = setupBashTool();
    const output = def.renderResult!(
      {
        content: [{ type: "text", text: "one\ntwo\nthree" }],
        details: {},
      },
      { expanded: false, isPartial: false },
      mkTheme(),
      mkToolCtx({ durationMs: 50 }),
    )
      .render(120)
      .join("\n");

    expect(output).not.toContain("│  one");
    expect(output).toContain("╰─ Took 50ms · 3 lines");
    expect(output).toContain("to expand");
  });

  it("puts normalized errors before the metadata footer", () => {
    setTestConfig({
      tools: {
        collapsedOutputDisplay: "summary",
      },
    });
    const def = setupBashTool();
    const output = def.renderResult!(
      {
        content: [
          {
            type: "text",
            text: `one\ntwo\nthree\n${PI_0_84_3_OUTPUT.bash.exited}`,
          },
        ],
        details: {},
      },
      { expanded: false, isPartial: false },
      mkTheme(),
      mkToolCtx({ isError: true, durationMs: 50 }),
    )
      .render(120)
      .join("\n");
    const lines = output.split("\n");

    expect(lines.at(-2)).toContain(`├─ ${PI_0_84_3_OUTPUT.bash.exited}`);
    expect(lines.at(-1)).toContain("╰─ Took 50ms · 3 lines");
    expect(lines.at(-1)).toContain("to expand");
  });

  it("renders a truncated command only once across the expanded call and result", () => {
    const def = setupBashTool();
    const theme = mkTheme();
    const state: BashRenderState = {};
    const commandLine = `echo command-appears-once-${"x".repeat(120)}`;
    const args = { command: `${commandLine}\npwd` };

    const collapsed = def.renderCall!(args, theme, mkToolCtx({ state, args }))
      .render(80)
      .join("\n");
    expect(stripAnsi(collapsed)).toContain("...");
    expect(state.callExpandable).toBe(true);

    const ctx = mkToolCtx({ expanded: true, state, args });
    const result = def.renderResult!(
      {
        content: [{ type: "text", text: "done" }],
        details: {},
      },
      { expanded: true, isPartial: false },
      theme,
      { ...ctx, durationMs: 50 },
    );
    const call = def.renderCall!(args, theme, ctx);
    const output = [...call.render(200), ...result.render(200)]
      .map(stripAnsi)
      .join("\n");

    expect(output.split(commandLine)).toHaveLength(2);
    expect(output).toContain("│  pwd");
    expect(output).toContain("done");
  });

  it("shows collapse hints only for effectively expanded results", () => {
    const def = setupBashTool();
    const renderResult = def.renderResult!;
    const theme = mkTheme();
    const tenLines = Array.from(
      { length: 10 },
      (_, i) => `L${String(i + 1).padStart(2, "0")}`,
    ).join("\n");

    const expanded = renderResult(
      {
        content: [{ type: "text", text: tenLines }],
        details: {},
      },
      { expanded: true, isPartial: false },
      theme,
      mkToolCtx({ expanded: true, durationMs: 50 }),
    );
    expect(expanded.render(120).join("\n")).toContain("to collapse");

    const expandedSingleLine = renderResult(
      {
        content: [{ type: "text", text: "done" }],
        details: {},
      },
      { expanded: true, isPartial: false },
      theme,
      mkToolCtx({ expanded: true, durationMs: 50 }),
    );
    expect(expandedSingleLine.render(120).join("\n")).not.toContain(
      "to collapse",
    );

    const originalHint = getConfig().tools.showExpansionHint;
    setTestConfig({
      tools: {
        showExpansionHint: false,
      },
    });
    try {
      const collapsed = renderResult(
        {
          content: [{ type: "text", text: tenLines }],
          details: {},
        },
        { expanded: false, isPartial: false },
        theme,
        mkToolCtx({ durationMs: 50 }),
      );
      expect(collapsed.render(120).join("\n")).not.toContain("to expand");

      const expandedDisabled = renderResult(
        {
          content: [{ type: "text", text: tenLines }],
          details: {},
        },
        { expanded: true, isPartial: false },
        theme,
        mkToolCtx({ expanded: true, durationMs: 50 }),
      );
      expect(expandedDisabled.render(120).join("\n")).not.toContain(
        "to collapse",
      );
    } finally {
      setTestConfig({
        tools: {
          showExpansionHint: originalHint,
        },
      });
    }
  });

  it("keeps tree prefixes on wrapped expanded output", () => {
    const def = setupBashTool();
    const renderResult = def.renderResult!;
    const theme = mkTheme();
    const ctx = mkToolCtx({ expanded: true });

    const component = renderResult(
      {
        content: [
          {
            type: "text",
            text: [
              "first output line that wraps across several visual rows",
              "second output line that also wraps across several visual rows",
            ].join("\n"),
          },
        ],
        details: {},
      },
      { expanded: true, isPartial: false },
      theme,
      { ...ctx, durationMs: 50 },
    );

    const lines = component
      .render(36)
      .map((line) => line.trimEnd().slice(1))
      .filter(Boolean);

    expect(lines.length).toBeGreaterThan(3);
    expect(lines.every((line) => /^[├│╰]/u.test(line))).toBe(true);
    expect(lines.at(-1)).toStartWith("╰─ ");
  });

  it("renders recognized status-only failures compactly", () => {
    const def = setupBashTool();
    const renderResult = def.renderResult!;

    for (const status of [
      PI_0_84_3_OUTPUT.bash.timedOut,
      PI_0_84_3_OUTPUT.bash.aborted,
    ]) {
      const component = renderResult(
        { content: [{ type: "text", text: status }], details: {} },
        { expanded: false, isPartial: false },
        mkTheme(),
        mkToolCtx({ isError: true }),
      );
      const output = component.render(120).join("\n");

      expect(output).toContain(`╰─ ${status}`);
      expect(output).not.toContain("ctrl+o");
    }
  });

  it("strips Pi's native truncation footer from displayed output", () => {
    const def = setupBashTool();
    const component = def.renderResult!(
      {
        content: [
          {
            type: "text",
            text: `line one\nline two\n\n${PI_0_84_3_OUTPUT.bash.showingLines}`,
          },
        ],
        details: {
          truncation: { truncated: true },
          fullOutputPath: PI_0_84_3_OUTPUT.bash.fullOutputPath,
        },
      },
      { expanded: true, isPartial: false },
      mkTheme(),
      mkToolCtx({ expanded: true, durationMs: 50 }),
    );

    const output = component.render(120).join("\n");
    expect(output).toContain("line one");
    expect(output).toContain("line two");
    expect(output).toContain("Truncated");
    expect(output).not.toContain(PI_0_84_3_OUTPUT.bash.fullOutputPath);
  });

  it("uses Pi's native no-output wording and call-driven hints", () => {
    const def = setupBashTool();
    const short = def.renderResult!(
      {
        content: [{ type: "text", text: "" }],
        details: {},
      },
      { expanded: false, isPartial: false },
      mkTheme(),
      mkToolCtx({ durationMs: 12 }),
    )
      .render(120)
      .join("\n");
    const longCall = def.renderResult!(
      {
        content: [{ type: "text", text: "" }],
        details: {},
      },
      { expanded: false, isPartial: false },
      mkTheme(),
      mkToolCtx({ state: { callExpandable: true }, durationMs: 12 }),
    )
      .render(120)
      .join("\n");

    expect(short).toContain("╰─ Took 12ms · (no output)");
    expect(short).not.toContain("ctrl+o");
    expect(longCall).toContain("(no output) · ");
    expect(longCall).toContain("to expand");
  });

  it('error strips noisy "no output" prefix', () => {
    const def = setupBashTool();
    const renderResult = def.renderResult!;
    const theme = mkTheme();
    const ctx = mkToolCtx({ isError: true });

    const component = renderResult(
      {
        content: [
          {
            type: "text",
            text: "(no output)\n\nCommand exited with code 1",
          },
        ],
        details: {},
      },
      { expanded: false, isPartial: false },
      theme,
      { ...ctx, durationMs: 50 },
    );

    const output = component.render(120).join("\n");
    expect(output).not.toContain("(no output)");
    expect(output).toContain("Command exited with code 1");
  });

  it("colors command output normally and only the status as an error", () => {
    const def = setupBashTool();
    const renderResult = def.renderResult!;
    const theme = {
      ...mkTheme(),
      fg: (color: string, text: string) => `${color}:${text}`,
    } as Theme;
    const component = renderResult(
      {
        content: [
          {
            type: "text",
            text: "detail one\ndetail two\nCommand exited with code 9",
          },
        ],
        details: {},
      },
      { expanded: true, isPartial: false },
      theme,
      mkToolCtx({ isError: true, expanded: true }),
    );

    const output = component.render(120).join("\n");
    expect(output).toContain("toolOutput:detail one");
    expect(output).toContain("toolOutput:detail two");
    expect(output).not.toContain("error:detail one");
    expect(output).toContain("error:Command exited with code 9");
    expect(output).not.toContain("to collapse");
  });

  it("keeps unknown execution errors fully red", () => {
    const def = setupBashTool();
    const renderResult = def.renderResult!;
    const theme = {
      ...mkTheme(),
      fg: (color: string, text: string) => `${color}:${text}`,
    } as Theme;
    const component = renderResult(
      {
        content: [{ type: "text", text: "shell setup failed" }],
        details: {},
      },
      { expanded: false, isPartial: false },
      theme,
      mkToolCtx({ isError: true }),
    );

    expect(component.render(120).join("\n")).toContain(
      "error:shell setup failed",
    );
  });

  it("uses a separate metadata row for long expanded single-line output", () => {
    const def = setupBashTool();
    const renderResult = def.renderResult!;
    const component = renderResult(
      {
        content: [
          {
            type: "text",
            text: "a deliberately long output line that cannot share one row with duration metadata and the complete collapse hint without wrapping badly",
          },
        ],
        details: {},
      },
      { expanded: true, isPartial: false },
      mkTheme(),
      mkToolCtx({ expanded: true, durationMs: 50 }),
    );
    const lines = component
      .render(120)
      .map((line) => line.trimEnd())
      .filter(Boolean);

    const metadataLine = lines.find((line) => line.includes("Took 50ms"));
    expect(metadataLine).toContain("to collapse");
    expect(lines.at(-1)).toContain("╰─ Took 50ms");
  });

  it("shows short preview output and elapsed time while partial", () => {
    const clock = spyOn(Date, "now").mockReturnValue(4400);
    try {
      const def = setupBashTool();
      const state = { startedAt: 1000 };
      const ctx = mkToolCtx({ state, isPartial: true, durationMs: 99 });
      const component = def.renderResult!(
        {
          content: [{ type: "text", text: "line one\nline two\n\n" }],
          details: {},
        },
        { expanded: false, isPartial: true },
        mkTheme(),
        ctx,
      );
      const output = component.render(120).join("\n");
      expect(output).toContain("│  line one");
      expect(output).toContain("│  line two");
      expect(output).toContain("╰─ Elapsed 3.4s");
      expect(output).not.toContain("ctrl+o");
      def.renderResult!(
        { content: [], details: {} },
        { expanded: false, isPartial: false },
        mkTheme(),
        ctx,
      );
      expect((state as BashRenderState).durationTimer).toBeUndefined();
    } finally {
      clock.mockRestore();
    }
  });

  it("collapsed errors use the three-row output preview", () => {
    const def = setupBashTool();
    const renderResult = def.renderResult!;
    const theme = mkTheme();
    const ctx = mkToolCtx({ isError: true });

    const component = renderResult(
      {
        content: [
          {
            type: "text",
            text: `${Array.from({ length: 8 }, (_, i) => `line${i + 1}`).join("\n")}\nCommand exited with code 2`,
          },
        ],
        details: {
          truncation: { truncated: true },
        },
      },
      { expanded: false, isPartial: false },
      theme,
      { ...ctx, durationMs: 123 },
    );

    const output = component.render(120).join("\n");
    expect(output).toContain("Took 123ms · Truncated");
    expect(output).not.toContain("error ·");
    expect(output).toContain("│  line1");
    expect(output).not.toContain("│  line2");
    expect(output).not.toContain("│  line7");
    expect(output).toContain("│  line8");
    expect(output).toContain("┊  +6 lines");
    const lines = output.split("\n");
    expect(lines.at(-2)).toContain("├─ Command exited with code 2");
    expect(lines.at(-1)).toContain("╰─ Took 123ms · Truncated");
  });
});

describe("bash partial duration timer", () => {
  it("starts timer on partial result and clears it on final", () => {
    const def = setupBashTool();
    const renderCall = def.renderCall!;
    const renderResult = def.renderResult!;
    const theme = mkTheme();
    const state: Record<string, unknown> = {};
    const ctx = mkToolCtx({ executionStarted: true, isPartial: true, state });

    renderCall({ command: "sleep 10" }, theme, ctx);

    // Partial render should set a duration timer on state
    renderResult(
      {
        content: [{ type: "text", text: "..." }],
        details: {},
      },
      { expanded: false, isPartial: true },
      theme,
      ctx,
    );
    expect(state.durationTimer).toBeDefined();

    renderResult(
      {
        content: [{ type: "text", text: "done" }],
        details: {},
      },
      { expanded: false, isPartial: false },
      theme,
      { ...ctx, durationMs: 100 },
    );
    expect(state.durationTimer).toBeUndefined();

    clearBlinkTimers();
  });

  it("keeps status blinking for partial results until final result", () => {
    const def = setupBashTool();
    const renderCall = def.renderCall!;
    const renderResult = def.renderResult!;
    const theme = mkTheme();
    const state: Record<string, unknown> = {};
    const ctx = mkToolCtx({ executionStarted: true, isPartial: true, state });

    renderCall({ command: "sleep 10" }, theme, ctx).render(120);
    expect(state.blinkTimer).toBeDefined();

    renderResult(
      {
        content: [{ type: "text", text: "still running" }],
        details: {},
      },
      { expanded: false, isPartial: true },
      theme,
      ctx,
    );
    expect(state.hasResult).toBe(false);

    renderCall({ command: "sleep 10" }, theme, ctx).render(120);
    expect(state.blinkTimer).toBeDefined();

    renderResult(
      {
        content: [{ type: "text", text: "done" }],
        details: {},
      },
      { expanded: false, isPartial: false },
      theme,
      { ...ctx, durationMs: 100 },
    );
    expect(state.hasResult).toBe(true);

    renderCall({ command: "sleep 10" }, theme, {
      ...ctx,
      isPartial: false,
    }).render(120);
    expect(state.blinkTimer).toBeUndefined();

    clearBlinkTimers();
  });
});
