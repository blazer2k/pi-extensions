import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import {
  initTheme,
  type ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import { Text, visibleWidth, type Component } from "@earendil-works/pi-tui";
import {
  setupCustomTool,
  mkTheme,
  mkToolCtx,
  setupTool,
  setTestConfig,
} from "../../testing/helpers";
import { getConfig } from "../../config/store";
import { patchBashTool } from "../bash";
import { patchEditTool } from "../edit";
import { patchFindTool } from "../find";
import { patchGrepTool } from "../grep";
import { patchLsTool } from "../ls";
import { patchReadTool } from "../read";
import { patchWriteTool } from "../write";
import { clearBlinkTimers } from "./state";
import { stripAnsi } from "./text";

type Renderable = { render(width: number): readonly string[] };
type ToolResult = {
  content: Array<{ type: "text"; text: string }>;
  details: unknown;
};

let restorePiKeybindings: (() => void) | undefined;

beforeAll(async () => {
  // Resolve from Pi's entry point so this uses Pi's own TUI instance whether
  // npm installs it nested or deduplicates it at the workspace root.
  const piEntry = import.meta.resolve("@earendil-works/pi-coding-agent");
  const piTui = await import(
    import.meta.resolve("@earendil-works/pi-tui", piEntry)
  );
  const piRoot = dirname(dirname(fileURLToPath(piEntry)));
  const piKeybindings = await import(
    pathToFileURL(join(piRoot, "dist/core/keybindings.js")).href
  );
  const previous = piTui.getKeybindings();
  piTui.setKeybindings(new piKeybindings.KeybindingsManager());
  restorePiKeybindings = () => piTui.setKeybindings(previous);
});

afterAll(() => {
  restorePiKeybindings?.();
  clearBlinkTimers();
});

function meaningfulLines(component: Renderable, width = 80): string[] {
  return component
    .render(width)
    .map((line) => stripAnsi(line).trimEnd())
    .filter((line) => line.trim().length > 0);
}

function renderCompletedTool(
  patchTool: Parameters<typeof setupTool>[0],
  args: Record<string, unknown>,
  result: ToolResult,
  expanded = false,
  durationMs?: number,
): string[] {
  const definition = setupTool(patchTool);
  const state = {};
  const toolCtx = mkToolCtx({ state, args, expanded, durationMs });
  const resultComponent = definition.renderResult!(
    result,
    { expanded, isPartial: false },
    mkTheme(),
    toolCtx,
  );
  const callComponent = definition.renderCall!(args, mkTheme(), toolCtx);

  return [
    ...meaningfulLines(callComponent),
    ...meaningfulLines(resultComponent),
  ];
}

describe("built-in tool output", () => {
  it("pins completed Bash output", () => {
    expect(
      renderCompletedTool(
        patchBashTool,
        { command: "printf hello" },
        {
          content: [{ type: "text", text: "hello\nworld" }],
          details: {},
        },
        false,
        50,
      ),
    ).toEqual([
      " ● Bash $ printf hello",
      " │  hello",
      " │  world",
      " ╰─ Took 50ms",
    ]);
  });

  it("pins completed Read output", () => {
    expect(
      renderCompletedTool(
        patchReadTool,
        { path: "src/index.ts" },
        {
          content: [{ type: "text", text: "line one\nline two" }],
          details: undefined,
        },
        true,
      ),
    ).toEqual([" ● Read src/index.ts", " ╰─ 2 lines"]);
  });

  it("pins expanded Write output", () => {
    expect(
      renderCompletedTool(
        patchWriteTool,
        { path: "notes.txt", content: "alpha\nbeta" },
        {
          content: [{ type: "text", text: "wrote 2 lines" }],
          details: undefined,
        },
        true,
      ),
    ).toEqual([
      " ● Write notes.txt",
      " │  alpha",
      " │  beta",
      " ╰─ 2 lines · ctrl+o to collapse",
    ]);
  });

  it("pins collapsed Edit output", () => {
    expect(
      renderCompletedTool(
        patchEditTool,
        { path: "src/a.ts", edits: [{ oldText: "old", newText: "new" }] },
        {
          content: [{ type: "text", text: "edited" }],
          details: {
            diff: [
              "--- a/src/a.ts",
              "+++ b/src/a.ts",
              "@@ -1 +1 @@",
              "-old",
              "+new",
              "",
            ].join("\n"),
          },
        },
      ),
    ).toEqual([" ● Edit src/a.ts", " ╰─ +1 -1 · ctrl+o to expand"]);
  });

  it("pins expanded list output", () => {
    expect(
      renderCompletedTool(
        patchFindTool,
        { pattern: "*.ts", path: "src" },
        {
          content: [{ type: "text", text: "src/a.ts\nsrc/b.ts\nsrc/c.ts" }],
          details: undefined,
        },
        true,
      ),
    ).toEqual([
      " ● Find *.ts in src",
      " │  src/a.ts",
      " │  src/b.ts",
      " │  src/c.ts",
      " ╰─ 3 files · ctrl+o to collapse",
    ]);
  });
});

describe("custom tool output", () => {
  it("pins wrapped renderer output", () => {
    const definition: ToolDefinition = {
      name: "Lookup",
      label: "Lookup",
      description: "test lookup",
      parameters: {} as never,
      execute: async () => ({ content: [], details: undefined }),
      renderCall: () => new Text("Lookup pi", 0, 0),
      renderResult: () => new Text("2 matches", 0, 0),
    };
    const handle = setupCustomTool(definition);

    try {
      const wrapped = handle.renderers;
      const state = {};
      for (const outputPad of [0, 1]) {
        const toolCtx = mkToolCtx({ state, args: { query: "pi" }, outputPad });
        const result = wrapped.renderResult!(
          { content: [{ type: "text", text: "two" }], details: {} },
          { expanded: false, isPartial: false },
          mkTheme(),
          toolCtx,
        );
        const call = wrapped.renderCall!({ query: "pi" }, mkTheme(), toolCtx);
        const padding = " ".repeat(outputPad);
        expect([...meaningfulLines(call), ...meaningfulLines(result)]).toEqual([
          padding + "● Lookup pi",
          padding + "╰─ 2 matches",
        ]);
      }
    } finally {
      handle.dispose();
    }
  });
});

describe("terminal width contract", () => {
  const path = `/tmp/${"segment/".repeat(6)}tail.txt`;
  const pattern = `needle-${"x".repeat(30)}-tail`;
  const calls: Array<
    [Parameters<typeof setupTool>[0], Record<string, unknown>]
  > = [
    [patchReadTool, { path }],
    [patchWriteTool, { path, content: "hello" }],
    [patchEditTool, { path, edits: [{ oldText: "old", newText: "new" }] }],
    [patchLsTool, { path, limit: 50 }],
    [patchFindTool, { pattern, path }],
    [patchGrepTool, { pattern, path }],
    [patchBashTool, { command: `echo ${"x".repeat(90)}` }],
  ];

  for (const [patchTool, args] of calls) {
    it(`${patchTool.name} adapts collapsed calls and expansion flags on resize`, async () => {
      const definition = setupTool(patchTool);
      const state = { hasResult: true, callExpandable: false };
      let invalidations = 0;
      const context = mkToolCtx({
        state,
        args,
        executionStarted: false,
        invalidate: () => invalidations++,
      });
      const component = definition.renderCall!(args, mkTheme(), context);
      for (const width of [40, 200, 40]) {
        const rows = component.render(width);
        expect(rows).toHaveLength(1);
        expect(rows.every((row) => visibleWidth(row) <= width)).toBe(true);
        expect(state.callExpandable).toBe(width === 40);
        expect(stripAnsi(rows[0]!).includes("...")).toBe(width === 40);
        component.render(width);
      }
      await Promise.resolve();
      expect(invalidations).toBe(3);
    });
  }

  it("applies output padding to calls and results for every built-in", () => {
    for (const [patchTool, args] of calls) {
      const definition = setupTool(patchTool);
      const state = { hasResult: true };
      let previousResult: Component | undefined;
      for (const outputPad of [0, 1, 0]) {
        const context = mkToolCtx({
          state,
          args,
          outputPad,
          executionStarted: false,
          lastComponent: previousResult,
        });
        const call = definition.renderCall!(args, mkTheme(), context);
        const result = definition.renderResult!(
          { content: [{ type: "text", text: "result" }], details: {} },
          { expanded: false, isPartial: false },
          mkTheme(),
          context,
        );
        if (previousResult) expect(result).toBe(previousResult);
        previousResult = result;
        for (const component of [call, result]) {
          const rows = meaningfulLines(component, 40);
          expect(rows.length).toBeGreaterThan(0);
          expect(
            rows.every((row) => row.startsWith(" ") === (outputPad === 1)),
          ).toBe(true);
          expect(rows.every((row) => visibleWidth(row) <= 40)).toBe(true);
        }
      }
    }
  });

  it("changes only generated corners across core results and errors", () => {
    initTheme("dark", false);
    const originalCorner = getConfig().tools.treeCorner;
    const payload = "payload ╰─ and └─";
    try {
      for (const [patchTool, args] of calls) {
        const definition = setupTool(patchTool);
        for (const expanded of [false, true]) {
          for (const isError of [false, true]) {
            const render = () =>
              meaningfulLines(
                definition.renderResult!(
                  {
                    content: [{ type: "text", text: payload }],
                    details: { diff: `-old\n+${payload}` },
                  },
                  { expanded, isPartial: false },
                  mkTheme(),
                  mkToolCtx({
                    args:
                      patchTool === patchWriteTool
                        ? { ...args, content: payload }
                        : args,
                    expanded,
                    isError,
                  }),
                ),
              );
            setTestConfig({ tools: { treeCorner: "rounded" } });
            const rounded = render();
            expect(rounded.at(-1)).toStartWith(" ╰─ ");
            setTestConfig({ tools: { treeCorner: "square" } });
            expect(render()).toEqual(
              rounded.map((line) => line.replace(/^( *)╰─ /u, "$1└─ ")),
            );
          }
        }
      }
    } finally {
      setTestConfig({ tools: { treeCorner: originalCorner } });
    }
  });

  it("keeps Bash calls with timeouts on one row in narrow viewports", () => {
    const definition = setupTool(patchBashTool);
    const component = definition.renderCall!(
      { command: "echo hello", timeout: 30 },
      mkTheme(),
      mkToolCtx({ executionStarted: false }),
    );
    for (const width of [10, 20, 40, 80, 120]) {
      const rows = component.render(width);
      expect(rows).toHaveLength(1);
      expect(visibleWidth(rows[0]!)).toBeLessThanOrEqual(width);
    }
  });

  it("updates call-driven result hints on resize", () => {
    const definition = setupTool(patchLsTool);
    const state = { hasResult: true };
    const args = { path };
    const context = mkToolCtx({ state, args, executionStarted: false });
    const call = definition.renderCall!(args, mkTheme(), context);
    const result = definition.renderResult!(
      {
        content: [{ type: "text", text: "(empty directory)" }],
        details: undefined,
      },
      { expanded: false, isPartial: false },
      mkTheme(),
      context,
    );
    for (const width of [40, 200, 40]) {
      call.render(width);
      const output = meaningfulLines(result, width).join("\n");
      expect(output.includes("expand")).toBe(width === 40);
    }
  });

  it("updates Bash preview truncation and hints on resize", () => {
    const definition = setupTool(patchBashTool);
    const state = {
      hasResult: true,
      truncated: false,
      isError: false,
      resultExpandable: false,
    };
    const component = definition.renderResult!(
      {
        content: [{ type: "text", text: "x".repeat(60) }],
        details: {},
      },
      { expanded: false, isPartial: false },
      mkTheme(),
      mkToolCtx({ state }),
    );
    for (const width of [40, 200, 40]) {
      const rows = component.render(width);
      const output = rows.map(stripAnsi).join("\n");
      expect(rows).toHaveLength(2);
      expect(rows.every((row) => visibleWidth(row) <= width)).toBe(true);
      expect(state.resultExpandable).toBe(width === 40);
      expect(output.includes("...")).toBe(width === 40);
      expect(output.includes("to expand")).toBe(width === 40);
    }
  });

  it("reflows complete expanded Bash and Write output without truncation", () => {
    const body = `${"x".repeat(160)}\n\n  final line`;
    for (const patchTool of [patchBashTool, patchWriteTool]) {
      const definition = setupTool(patchTool);
      const component = definition.renderResult!(
        { content: [{ type: "text", text: body }], details: {} },
        { expanded: true, isPartial: false },
        mkTheme(),
        mkToolCtx({
          expanded: true,
          args: { path: "notes.txt", content: body },
        }),
      );
      for (const width of [40, 80, 120, 200, 40]) {
        const rows = component.render(width);
        const output = rows.map(stripAnsi).join("\n");
        expect(rows.every((row) => visibleWidth(row) <= width)).toBe(true);
        expect(output.match(/x/g)).toHaveLength(160);
        expect(output).toContain("final line");
        expect(output).not.toContain("...");
      }
    }
  });

  it("fits collapsed errors to the viewport for every built-in", () => {
    for (const [patchTool, args] of calls) {
      const definition = setupTool(patchTool);
      const component = definition.renderResult!(
        {
          content: [{ type: "text", text: `failure ${"x".repeat(100)}` }],
          details: {},
        },
        { expanded: false, isPartial: false },
        mkTheme(),
        mkToolCtx({ args, isError: true }),
      );
      for (const width of [40, 80, 120, 200]) {
        const rows = component.render(width);
        expect(rows.every((row) => visibleWidth(row) <= width)).toBe(true);
        expect(
          rows.filter((row) => stripAnsi(row).includes("failure")),
        ).toHaveLength(1);
        if (width === 200)
          expect(rows.map(stripAnsi).join("\n")).not.toContain("...");
      }
    }
  });

  it("stays within Pi's one-column minimum through width 200", () => {
    const definition = setupTool(patchFindTool);
    const state = {};
    const args = { pattern: "*.ts", path: "src" };
    const toolCtx = mkToolCtx({ state, args, expanded: true });
    const component = definition.renderResult!(
      {
        content: [{ type: "text", text: "src/a.ts\nsrc/b.ts\nsrc/c.ts" }],
        details: undefined,
      },
      { expanded: true, isPartial: false },
      mkTheme(),
      toolCtx,
    );

    for (let width = 0; width <= 200; width++) {
      for (const line of component.render(width)) {
        expect(visibleWidth(line)).toBeLessThanOrEqual(Math.max(width, 1));
      }
    }
  });
});
