import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { Container, Text, visibleWidth } from "@earendil-works/pi-tui";
import {
  initTheme,
  highlightCode,
  createReadTool,
  createCodemodeExtension,
  type CodemodeToolDetails,
  type ExtensionAPI,
  type ExtensionToolContext,
  type ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import type { AgentToolResult } from "@earendil-works/pi-agent-core";
import { loadConfig } from "../../config/store";
import { mkTheme, mkToolCtx, setTestConfig } from "../../testing/helpers";
import { createCodemodeRenderers } from "../codemode";
import { clearBlinkTimers } from "../rendering/state";
import { stripAnsi } from "../rendering/text";
import { buildCodemodeResultView } from "./model";
import type { CodemodeRenderState } from "./types";

type CodemodeNestedCall = CodemodeToolDetails["calls"][number];
const originalPath = process.env.PI_TUI_TWEAKS_CONFIG_PATH;
let directory: string;
beforeEach(() => {
  initTheme("dark", false);
  directory = mkdtempSync(join(tmpdir(), "pi-tui-tweaks-codemode-output-"));
  process.env.PI_TUI_TWEAKS_CONFIG_PATH = join(directory, "settings.json");
  loadConfig();
});
afterEach(() => {
  clearBlinkTimers();
  rmSync(directory, { recursive: true, force: true });
  if (originalPath === undefined) delete process.env.PI_TUI_TWEAKS_CONFIG_PATH;
  else process.env.PI_TUI_TWEAKS_CONFIG_PATH = originalPath;
  loadConfig();
});

function setup(
  renderers: Partial<Pick<ToolDefinition, "renderCall" | "renderResult">> = {},
  reportIssue: (issue: unknown) => void = () => {},
  isToolCallActive = () => true,
) {
  let definition!: ToolDefinition;
  createCodemodeExtension()({
    registerTool(tool: ToolDefinition) {
      definition = tool;
    },
    getSettings: () => ({}),
    getAllTools: () => [],
    appendEntry() {},
  } as unknown as ExtensionAPI);
  return {
    ...createCodemodeRenderers(
      { ...definition, ...renderers },
      { isToolCallActive, reportIssue },
    ),
    execute: definition.execute,
  };
}
function result(
  output: string,
  calls: CodemodeNestedCall[] = [],
): AgentToolResult<CodemodeToolDetails> {
  return {
    content: [
      {
        type: "text",
        text: "Script completed\nWall time 1.2 seconds\nOutput:\n",
      },
      { type: "text", text: output },
    ],
    details: { calls },
  };
}
function call(
  status: CodemodeNestedCall["status"],
  id = "nested",
  cost?: number,
): CodemodeNestedCall {
  return {
    id,
    name: `tool-${id}`,
    args: '{"secret":"nested arguments"}',
    status,
    durationMs: 100,
    cost,
  };
}
function render(
  input: AgentToolResult<CodemodeToolDetails | undefined> = result(""),
  expanded = false,
  isError = false,
  state: CodemodeRenderState = {},
  timing: { durationMs?: number } = { durationMs: 1200 },
) {
  const definition = setup();
  const context = mkToolCtx({
    expanded,
    isError,
    state: { _tuiTweaks: state },
    executionStarted: false,
    ...timing,
  });
  const component = definition.renderResult!(
    input,
    { expanded, isPartial: false },
    mkTheme(),
    context,
  );
  return {
    definition,
    context,
    component,
    text: component
      .render(200)
      .map((line) => stripAnsi(line).trimEnd())
      .join("\n"),
  };
}

describe("Codemode output", () => {
  it("shows short output and a bottom duration without unnecessary hints", () => {
    const { text } = render(result("one\ntwo\nthree"));
    expect(text).toContain("│  one\n │  two\n │  three");
    expect(text).toContain("╰─ Took 1.2s");
    expect(text).not.toContain("Script completed");
    expect(text).not.toContain("to expand");
  });

  it("uses one recorded duration instead of header or observed time", () => {
    for (const [durationMs, label] of [
      [0, "0ms"],
      [451, "451ms"],
      [1270, "1.3s"],
      [61000, "1m 1s"],
      [3601000, "1h 0m 1s"],
    ] as const) {
      for (const expanded of [false, true]) {
        const input = result("output");
        const snapshot = structuredClone(input);
        const { text } = render(
          input,
          expanded,
          false,
          { startedAt: 1000, endedAt: 9000 },
          { durationMs },
        );
        expect(text).toContain(`╰─ Took ${label}`);
        expect(text.match(/\b(?:Took|took) /g)).toHaveLength(1);
        expect(text).not.toContain("Wall time");
        expect(input).toEqual(snapshot);
      }
    }
  });

  it("omits unrecorded final timing even with a header or observed clock", () => {
    for (const expanded of [false, true]) {
      for (const state of [{}, { startedAt: 1000, endedAt: 9000 }]) {
        const { text } = render(
          result("old output"),
          expanded,
          false,
          state,
          {},
        );
        expect(text).toContain("old output");
        expect(text).not.toMatch(/\b(?:Took|took) /);
        expect(text).not.toContain("Wall time");
      }
    }
  });

  it("preserves timing-shaped script output while omitting only the native footer", () => {
    const payload = "Took 1.3s\n\nElapsed 1.3s\nTook 1.3s";
    const { text } = render(
      result(payload),
      true,
      false,
      {},
      { durationMs: 1270 },
    );
    expect(text.match(/Took 1\.3s/g)).toHaveLength(3);
    expect(text).toContain("Elapsed 1.3s");
    expect(text).toContain("Took 1.3s\n │\n │  Elapsed 1.3s");
    expect(text.match(/╰─ Took 1\.3s/g)).toHaveLength(1);
  });

  it("leaves unfamiliar native component layouts unchanged", () => {
    const native = new Container();
    native.addChild(new Text("Took 1.3s", 0, 0));
    const definition = setup({ renderResult: () => native });
    const component = definition.renderResult!(
      result("output"),
      { expanded: true, isPartial: false },
      mkTheme(),
      mkToolCtx({ expanded: true, durationMs: 1270 }),
    );
    expect(component.render(120).join("\n")).toContain("Took 1.3s");
    expect(native.children).toHaveLength(1);
  });

  it("selects the first and last logical lines around one omission row", () => {
    const { text } = render(result("one\nhidden\nhidden\nfour"));
    expect(text).toContain("one");
    expect(text).toContain("+2 lines");
    expect(text).toContain("four");
    expect(text).not.toContain("hidden");
    expect(text).toContain("to expand");
  });

  it("preserves selected and interior blank lines", () => {
    const { text } = render(result("\none\ntwo\nlast\n\n"));
    expect(text).toContain(" │\n");
    expect(text).toContain("last");
    expect(render(result("a\n\nb"), true).text).toContain("a\n │\n │  b");
  });

  it("summary hides ordinary output and reports its line count", () => {
    setTestConfig({
      tools: {
        collapsedOutputDisplay: "summary",
      },
    });
    const { text } = render(result("one\ntwo"));
    expect(text).not.toContain("one");
    expect(text).not.toContain("two");
    expect(text).toContain("╰─ Took 1.2s · 2 lines · ");
    expect(text).toContain("to expand");
  });

  it("shows separate script diagnostics rather than prior printed output", () => {
    for (const display of ["preview", "summary"] as const) {
      setTestConfig({
        tools: {
          collapsedOutputDisplay: display,
        },
      });
      const input = result("first\nsecond\nthird\nfourth");
      input.content.push({
        type: "text",
        text: "Script error:\nError: broken\nstack",
      });
      const joined = {
        ...input,
        content: [
          input.content[0]!,
          {
            type: "text" as const,
            text: "first\nsecond\nthird\nfourth\nScript error:\nError: broken\nstack",
          },
        ],
      };
      for (const output of [input, joined]) {
        const { text } = render(output, false, true);
        expect(text).toContain("Error: broken");
        expect(text).toContain("Script failed");
        expect(text.match(/Error: broken/g)).toHaveLength(1);
      }
    }
  });

  it("keeps headerless errors and avoids hints when the diagnostic is all output", () => {
    setTestConfig({
      tools: {
        collapsedOutputDisplay: "summary",
      },
    });
    const { component, text } = render(
      {
        content: [{ type: "text", text: "Invalid options" }],
        details: { calls: [] },
      },
      false,
      true,
      {},
      {},
    );
    expect(text).toContain("Invalid options");
    expect(text).not.toContain("Took");
    expect(text).not.toContain("to expand");
    expect(stripAnsi(component.render(15).join("\n"))).toContain("expand");
  });

  it("does not strip header-like text from ordinary output", () => {
    const input = {
      content: [
        {
          type: "text" as const,
          text: "Script completed is ordinary text\nWall time 1 seconds\nOutput:",
        },
      ],
      details: { calls: [] },
    };
    expect(render(input).text).toContain("Script completed is ordinary text");
    expect(buildCodemodeResultView(input).output).toBe(input.content[0]!.text);
  });

  it("summarizes nested statuses without treating a caught failure as script failure", () => {
    const { text } = render(
      result("ok", [
        call("ok"),
        call("running"),
        call("error"),
        call("cancelled"),
      ]),
    );
    for (const value of ["4 calls", "1 running", "1 failed", "1 cancelled"])
      expect(text).toContain(value);
    expect(text).not.toContain("nested arguments");
    expect(text).not.toContain("Script failed");
  });

  it("uses named closing corners without rewriting script output", () => {
    for (const treeCorner of ["rounded", "square"] as const) {
      setTestConfig({ tools: { treeCorner } });
      for (const expanded of [false, true]) {
        const { text } = render(result("payload ╰─ and └─"), expanded);
        expect(text).toContain(
          `${treeCorner === "square" ? "└" : "╰"}─ Took 1.2s`,
        );
        expect(text).toContain("payload ╰─ and └─");
      }
    }
  });

  it("keeps full expanded arguments, errors, blank lines and long output despite the list cap", () => {
    setTestConfig({
      tools: {
        expandedOutputLimit: 10,
      },
    });
    setTestConfig({
      tools: {
        collapsedOutputDisplay: "summary",
      },
    });
    const calls = Array.from({ length: 12 }, (_, i) => ({
      ...call("error", String(i)),
      error: `failure ${i}\nmore detail`,
    }));
    const { text } = render(result("x".repeat(400) + "\n\nend", calls), true);
    for (const nested of calls) {
      expect(text).toContain(nested.name);
      expect(text).toContain(`failure ${nested.id}`);
    }
    expect(text).toContain("nested arguments");
    expect(text.replace(/\n │  /g, "").match(/x/g)).toHaveLength(400);
    expect(text).toContain("end");
    expect(text).toContain("to collapse");
  });

  it("shows available model-call cost subtotals with small-cost precision", () => {
    expect(
      render(
        result("ok", [call("ok", "a", 0.000012), call("ok", "b", 0.000012)]),
      ).text,
    ).toContain("Model calls $0.000024");
    expect(
      render(result("ok", [call("ok", "a", 1.23), call("ok", "b", 2.34)])).text,
    ).toContain("Model calls $3.57");
    expect(render(result("ok", [call("ok")])).text).not.toContain(
      "Model calls",
    );
    const expanded = render(
      result("ok", [call("ok", "a", 1.23), call("ok", "b", 2.34)]),
      true,
    ).text;
    expect(expanded).toContain("Model calls: $3.57");
    expect(expanded).toContain("Model calls $3.57");
  });

  it("shows no-output only for completed textless, imageless results", () => {
    expect(render(result("")).text).toContain("(no output)");
    const input = {
      content: [{ type: "image" as const, data: "", mimeType: "image/png" }],
      details: { calls: [] },
    };
    const { text } = render(input);
    expect(text).toContain("1 image");
    expect(text).not.toContain("(no output)");
    for (const showImages of [false, true]) {
      const context = mkToolCtx({ showImages });
      expect(
        stripAnsi(
          setup().renderResult!(
            input,
            { expanded: false, isPartial: false },
            mkTheme(),
            context,
          )
            .render(120)
            .join("\n"),
        ),
      ).toContain("1 image");
    }
  });

  it("keeps real native image blocks unchanged in both display modes", async () => {
    const definition = setup();
    const png =
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/d1sAAAAASUVORK5CYII=";
    const context = {
      tools: [],
      sessionManager: { getBranch: () => [] },
    } as unknown as ExtensionToolContext;
    const input = await definition.execute(
      "image",
      { code: `image("data:image/png;base64,${png}");` },
      undefined,
      undefined,
      context,
    );
    const attachment = input.content.find((block) => block.type === "image")!;
    expect(attachment).toEqual({
      type: "image",
      data: png,
      mimeType: "image/png",
    });
    Object.freeze(input);
    Object.freeze(input.content);
    input.content.forEach(Object.freeze);
    for (const display of ["preview", "summary"] as const) {
      setTestConfig({
        tools: {
          collapsedOutputDisplay: display,
        },
      });
      for (const showImages of [false, true]) {
        const component = definition.renderResult!(
          input,
          { expanded: false, isPartial: false },
          mkTheme(),
          mkToolCtx({ showImages }),
        );
        const text = component.render(120).join("\n");
        expect(text).toContain("1 image");
        expect(text).not.toContain("(no output)");
        expect(input.content.find((block) => block.type === "image")).toBe(
          attachment,
        );
      }
    }
  });

  it("shows counts but no empty-output claim during progress", () => {
    const definition = setup();
    const context = mkToolCtx();
    const component = definition.renderResult!(
      result("", [call("running")]),
      { expanded: false, isPartial: true },
      mkTheme(),
      context,
    );
    const text = stripAnsi(component.render(120).join("\n"));
    expect(text).toContain("1 running");
    expect(text).not.toContain("(no output)");
  });

  it("keeps spill links visible and reports returned-line counts without treating local omission as truncation", () => {
    const path = "/tmp/codemode-output.txt";
    const input = {
      ...result(
        `Warning: truncated output (original token count: 100)\nTotal output lines: 30\n\nhead…20 tokens truncated…tail\n\n[Full output: ${path} (read with offset/limit)]`,
      ),
      details: { calls: [], fullOutputPath: path },
    };
    for (const display of ["preview", "summary"] as const) {
      setTestConfig({
        tools: {
          collapsedOutputDisplay: display,
        },
      });
      const { text } = render(input);
      expect(text).toContain(`Full output: ${path}`);
      expect(text).toContain("Truncated");
      expect(text).not.toContain("Total output lines");
      if (display === "summary") expect(text).toContain("1 returned line");
    }
    expect(render(result("a\nb\nc\nd")).text).not.toContain("Truncated");
  });

  it("keeps failed-spill warnings and leaves unfamiliar envelopes untouched", () => {
    const failed = result(
      "Warning: truncated output (original token count: 100)\nTotal output lines: 30\n\nhead…tail\n\n[Could not save the full output: permission denied]",
    );
    setTestConfig({
      tools: {
        collapsedOutputDisplay: "summary",
      },
    });
    expect(render(failed).text).toContain(
      "Could not save the full output: permission denied",
    );
    expect(
      buildCodemodeResultView(
        result(
          "Warning: truncated output (original token count: 100)\nTotal output lines: 30\n\nuser text",
        ),
      ).output,
    ).toContain("Total output lines: 30");
  });

  it("respects the hint preference and reuses components while updating metadata", () => {
    const { definition, context, component } = render(result("a\nb\nc\nd"));
    setTestConfig({
      tools: {
        showExpansionHint: false,
      },
    });
    const next = definition.renderResult!(
      result("next", [call("ok")]),
      { expanded: false, isPartial: false },
      mkTheme(),
      { ...context, lastComponent: component },
    );
    expect(next).toBe(component);
    expect(stripAnsi(next.render(120).join("\n"))).toContain("1 call");
    expect(stripAnsi(next.render(120).join("\n"))).not.toContain("to expand");
  });

  it("passes native expanded components back for reuse and forwards invalidation", () => {
    let invalidations = 0;
    const native = {
      render: () => ["kept native output"],
      invalidate: () => {
        invalidations++;
      },
    };
    const lastComponents: unknown[] = [];
    const definition = setup({
      renderResult: (_result, _options, _theme, context) => {
        lastComponents.push(context.lastComponent);
        return native;
      },
    });
    const context = mkToolCtx({ expanded: true });
    const options = { expanded: true, isPartial: false };
    const component = definition.renderResult!(
      result("first"),
      options,
      mkTheme(),
      context,
    );
    expect(component.render(120).join("\n")).toContain("kept native output");
    const before = invalidations;
    component.invalidate!();
    expect(invalidations).toBe(before + 1);
    const next = definition.renderResult!(result("next"), options, mkTheme(), {
      ...context,
      lastComponent: component,
    });
    expect(next).toBe(component);
    expect(lastComponents).toEqual([undefined, native]);
  });

  it("fits narrow widths across modes, expansion, ANSI, CJK and a long spill path", () => {
    const input = {
      ...result("\x1b[31m界".repeat(60) + "\x1b[0m\n\nthird\nfourth", [
        call("error"),
      ]),
      details: {
        calls: [call("error")],
        fullOutputPath: "/tmp/" + "long".repeat(40),
      },
    };
    for (const display of ["preview", "summary"] as const) {
      setTestConfig({
        tools: {
          collapsedOutputDisplay: display,
        },
      });
      for (const expanded of [false, true]) {
        const { component } = render(input, expanded, true);
        for (const width of [1, 2, 3, 4, 5, 10, 20, 40, 80, 120, 200, 40]) {
          expect(
            component
              .render(width)
              .filter((line) => visibleWidth(line) > width)
              .map((line) => `${width}: ${stripAnsi(line)}`),
          ).toEqual([]);
        }
      }
    }
  });

  it("bounds fallback previews when native metadata is malformed", () => {
    const input = {
      ...result(Array.from({ length: 100 }, (_, i) => `line ${i}`).join("\n")),
      details: { calls: {} },
    } as unknown as ReturnType<typeof result>;
    const { component } = render(input);
    expect(component.render(120)).toHaveLength(3);
    expect(component.render(120).join("\n")).toContain("line 99");
    expect(render(input, true).text).toContain("line 50");
  });

  it("preserves output on native factory, deferred layout and malformed-details failures", () => {
    const { text } = render(
      {
        ...result("kept output"),
        details: { calls: {} },
      } as unknown as ReturnType<typeof result>,
      true,
    );
    expect(text).toContain("kept output");
    const nativeResult = new Container();
    nativeResult.render = () => {
      throw new Error("native layout failed");
    };
    expect(
      render(result("kept output"), true, false, { nativeResult }).text,
    ).toContain("kept output");
  });

  it("reports native result factory and deferred layout failures while preserving output", () => {
    for (const deferred of [false, true]) {
      const issues: unknown[] = [];
      const fail = () => {
        throw new Error("native result failed");
      };
      const definition = setup(
        {
          renderResult: () =>
            deferred ? { render: fail, invalidate() {} } : fail(),
        },
        (issue) => issues.push(issue),
      );
      const component = definition.renderResult!(
        result("kept output"),
        { expanded: true, isPartial: false },
        mkTheme(),
        mkToolCtx({ expanded: true }),
      );
      expect(component.render(120).join("\n")).toContain("kept output");
      expect(issues).toEqual([
        expect.objectContaining({
          stage: "renderResult",
          toolName: "codemode",
        }),
      ]);
    }
  });

  it("tracks actual sandbox nested calls and caught failures through native progress", async () => {
    const definition = setup();
    const updates: unknown[] = [];
    let id = 0;
    const context = {
      tools: [createReadTool(directory)],
      sessionManager: { getBranch: () => [] },
      executeTool: async (_name: string, args: { path: string }) => ({
        toolCall: { id: `nested/${++id}` },
        isError: args.path === "fail",
        result: {
          content: [
            {
              type: "text",
              text: args.path === "fail" ? "nested failure" : "success",
            },
          ],
          details: undefined,
        },
      }),
    } as unknown as ExtensionToolContext;
    const input = await definition.execute(
      "nested",
      {
        code: 'const calls = await Promise.allSettled([tools.read({path:"ok"}), tools.read({path:"fail"})]); text(calls.map(c => c.status));',
      },
      undefined,
      (update) => updates.push(update),
      context,
    );
    expect(updates.length).toBeGreaterThan(0);
    expect(input.isError).not.toBe(true);
    const view = buildCodemodeResultView(input);
    expect(view.calls.map((nested) => nested.status).sort()).toEqual([
      "error",
      "ok",
    ]);
    const text = definition.renderResult!(
      input,
      { expanded: false, isPartial: false },
      mkTheme(),
      mkToolCtx(),
    )
      .render(200)
      .join("\n");
    expect(text).toContain("2 calls");
    expect(text).toContain("1 failed");
    expect(text).not.toContain("Script failed");
  });

  it("renders real spilled output without reading the spill file", async () => {
    const definition = setup();
    const context = {
      tools: [],
      sessionManager: { getBranch: () => [] },
    } as unknown as ExtensionToolContext;
    const input = await definition.execute(
      "spill",
      {
        code: '// @options: {"max_output_tokens": 10}\ntext("x".repeat(1000));',
      },
      undefined,
      undefined,
      context,
    );
    const view = buildCodemodeResultView(input);
    try {
      expect(view.truncated).toBe(true);
      expect(view.fullOutputPath).toBeString();
      expect(view.output).not.toContain("Full output:");
      setTestConfig({
        tools: {
          collapsedOutputDisplay: "summary",
        },
      });
      const component = definition.renderResult!(
        input,
        { expanded: false, isPartial: false },
        mkTheme(),
        mkToolCtx(),
      );
      expect(component.render(200).join("\n")).toContain("Full output:");
    } finally {
      if (view.fullOutputPath) rmSync(view.fullOutputPath);
    }
  });

  it("renders real successful and failed native sandbox executions unchanged", async () => {
    const definition = setup();
    const context = {
      tools: [],
      sessionManager: { getBranch: () => [] },
    } as unknown as ExtensionToolContext;
    for (const code of [
      'text("one"); text("two"); text("three"); text("four");',
      'text("before"); throw new Error("actual failure");',
      'console.log("before"); throw new Error("actual failure");',
    ]) {
      const input = await definition.execute(
        "real",
        { code },
        undefined,
        undefined,
        context,
      );
      const view = buildCodemodeResultView(input);
      expect(view.output).not.toContain("Wall time");
      const rendered = definition.renderResult!(
        input,
        { expanded: false, isPartial: false },
        mkTheme(),
        mkToolCtx({ executionStarted: false, isError: input.isError === true }),
      )
        .render(200)
        .join("\n");
      if (input.isError) {
        expect(rendered).toContain("actual failure");
        expect(view.output).toContain("before");
        expect(view.diagnostic).toBe("Error: actual failure");
      } else {
        expect(rendered).toContain("+6 lines");
        expect(view.output).toBe(
          "==> text 1/4 <==\none\n==> text 2/4 <==\ntwo\n==> text 3/4 <==\nthree\n==> text 4/4 <==\nfour",
        );
      }
    }
  });
});

describe("Codemode call", () => {
  it("blinks during argument generation but starts duration only at execution", () => {
    let active = false;
    const definition = setup(
      {},
      () => {},
      () => active,
    );
    const state: CodemodeRenderState = {};
    const context = mkToolCtx({
      state: { _tuiTweaks: state },
      executionStarted: false,
      isPartial: true,
    });
    definition.renderCall!(
      { code: 'text("unfinished' },
      mkTheme(),
      context,
    ).render(120);
    const blinkTimer = state.blinkTimer;
    expect(blinkTimer).toBeDefined();
    expect(state.startedAt).toBeUndefined();
    active = true;
    definition.renderCall!({ code: 'text("finished");' }, mkTheme(), {
      ...context,
      executionStarted: true,
    }).render(120);
    expect(state.blinkTimer).toBe(blinkTimer);
    expect(state.startedAt).toBeNumber();
  });

  it("highlights a one-line preview and retains full native expanded scripts", () => {
    initTheme("dark");
    const definition = setup();
    const state: CodemodeRenderState = {};
    const args = {
      code: 'const first = "界";\n\n  text(first);\ntext("last");',
    };
    const compact = definition.renderCall!(
      args,
      mkTheme(),
      mkToolCtx({ state: { _tuiTweaks: state } }),
    );
    const text = stripAnsi(compact.render(120).join("\n"));
    expect(text).toContain("Codemode const first");
    expect(text).not.toContain("last");
    expect(state.callExpandable).toBe(true);
    const expanded = stripAnsi(
      definition.renderCall!(
        args,
        mkTheme(),
        mkToolCtx({ state: { _tuiTweaks: state }, expanded: true }),
      )
        .render(120)
        .join("\n"),
    );
    expect(expanded).toContain("  text(first);");
    expect(expanded).toContain('text("last");');
    expect(expanded.split("\n").some((line) => line.trim() === "│")).toBe(true);
    expect(compact.render(120).join("\n")).toContain("\x1b[");
  });

  it("refreshes an unchanged live script preview when the theme changes", async () => {
    const { theme } =
      await import("../../../../../node_modules/@earendil-works/pi-coding-agent/dist/modes/interactive/theme/theme.js");
    const previousTheme = theme.name;
    const state: CodemodeRenderState = {};
    const context = mkToolCtx({
      state: { _tuiTweaks: state },
      isPartial: true,
    });
    const definition = setup();
    const code = 'const value = "preview";';
    try {
      initTheme("dark", false);
      definition.renderCall!({ code }, theme, context).render(120);
      const darkPreview = state.callHighlightCache!.preview;
      initTheme("light", false);
      definition.renderCall!({ code }, theme, context).render(120);
      expect(state.callHighlightCache!.preview).toBe(
        highlightCode(code, "javascript").join("\n"),
      );
      expect(state.callHighlightCache!.preview).not.toBe(darkPreview);
    } finally {
      initTheme(previousTheme, false);
    }
  });

  it("reports native call failures and retains complete expanded source", () => {
    for (const deferred of [false, true]) {
      const issues: unknown[] = [];
      const fail = () => {
        throw new Error("native call failed");
      };
      const definition = setup(
        {
          renderCall: () =>
            deferred ? { render: fail, invalidate() {} } : fail(),
        },
        (issue) => issues.push(issue),
      );
      const component = definition.renderCall!(
        { code: 'text("first");\ntext("last");' },
        mkTheme(),
        mkToolCtx({ expanded: true }),
      );
      const text = stripAnsi(component.render(120).join("\n"));
      expect(text).toContain('text("first");');
      expect(text).toContain('text("last");');
      expect(issues).toEqual([
        expect.objectContaining({ stage: "renderCall", toolName: "codemode" }),
      ]);
    }
  });

  it("changes expansion state on resize and honors capitalization", () => {
    setTestConfig({
      tools: {
        capitalizeNames: false,
      },
    });
    const definition = setup();
    const state: CodemodeRenderState = {};
    const component = definition.renderCall!(
      { code: 'text("' + "x".repeat(60) + '");' },
      mkTheme(),
      mkToolCtx({ state: { _tuiTweaks: state } }),
    );
    expect(stripAnsi(component.render(120).join("\n"))).toContain("codemode");
    expect(state.callExpandable).toBe(false);
    expect(component.render(40)).toHaveLength(1);
    expect(state.callExpandable).toBe(true);
    for (const width of [1, 2, 3, 4, 5, 10, 20, 40, 80])
      expect(
        component.render(width).every((line) => visibleWidth(line) <= width),
      ).toBe(true);
  });
});
