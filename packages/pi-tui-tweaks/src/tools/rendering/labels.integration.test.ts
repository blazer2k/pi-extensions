import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import {
  createCodemodeExtension,
  ExtensionRunner,
  getPackageDir,
  initTheme,
  type ExtensionAPI,
  type ToolDefinition,
  type ToolRenderers,
} from "@earendil-works/pi-coding-agent";
import { Text, visibleWidth } from "@earendil-works/pi-tui";

import { loadConfig } from "../../config/store";
import {
  mkTheme,
  mkToolCtx,
  setupTool,
  setupCustomTool,
  setTestConfig,
} from "../../testing/helpers";
import { patchBashTool } from "../bash";
import { createCodemodeRenderers } from "../codemode";
import { createWrappedRenderers } from "../custom-tools/definition-adapter";
import { patchEditTool } from "../edit";
import { patchFindTool } from "../find";
import { patchGrepTool } from "../grep";
import { patchLsTool } from "../ls";
import { patchReadTool } from "../read";
import { patchWriteTool } from "../write";
import { clearBlinkTimers } from "./state";
import { stripAnsi } from "./text";
import type { BaseRenderState } from "./types";

const originalPath = process.env.PI_TUI_TWEAKS_CONFIG_PATH;
let directory: string;
beforeEach(() => {
  initTheme("dark", false);
  directory = mkdtempSync(join(tmpdir(), "pi-tui-tweaks-tool-labels-"));
  process.env.PI_TUI_TWEAKS_CONFIG_PATH = join(directory, "settings.json");
  loadConfig();
});
afterEach(() => {
  clearBlinkTimers();
  if (originalPath === undefined) delete process.env.PI_TUI_TWEAKS_CONFIG_PATH;
  else process.env.PI_TUI_TWEAKS_CONFIG_PATH = originalPath;
  rmSync(directory, { recursive: true, force: true });
  loadConfig();
});

const coreCases: Array<{
  name: string;
  patch: Parameters<typeof setupTool>[0];
  args: Record<string, unknown>;
}> = [
  { name: "read", patch: patchReadTool, args: { path: "CaseFile.txt" } },
  {
    name: "write",
    patch: patchWriteTool,
    args: { path: "CaseFile.txt", content: "contents stay lowercase" },
  },
  {
    name: "edit",
    patch: patchEditTool,
    args: { path: "CaseFile.txt", edits: [{ oldText: "old", newText: "new" }] },
  },
  {
    name: "bash",
    patch: patchBashTool,
    args: { command: 'printf "mixed Case"' },
  },
  { name: "ls", patch: patchLsTool, args: { path: "CaseDirectory" } },
  {
    name: "find",
    patch: patchFindTool,
    args: { pattern: "*.MixedCase", path: "CaseDirectory" },
  },
  {
    name: "grep",
    patch: patchGrepTool,
    args: { pattern: "mixedCase", path: "CaseDirectory" },
  },
];

function nativeCodemode(): ToolDefinition {
  let definition!: ToolDefinition;
  createCodemodeExtension()({
    registerTool(tool: ToolDefinition) {
      definition = tool;
    },
    getSettings: () => ({}),
    getAllTools: () => [],
    appendEntry() {},
  } as unknown as ExtensionAPI);
  return definition;
}
const adapterOptions = { isToolCallActive: () => false, reportIssue: () => {} };
function text(
  component: { render(width: number): readonly string[] },
  width = 160,
) {
  return stripAnsi(component.render(width).join("\n"));
}
function label(name: string, enabled: boolean) {
  return enabled ? name[0]!.toUpperCase() + name.slice(1) : name;
}

describe("tool-call capitalization", () => {
  for (const testCase of coreCases) {
    it(`applies both values to ${testCase.name} without changing arguments`, () => {
      const definition = setupTool(testCase.patch);
      const originalArgs = structuredClone(testCase.args);
      for (const enabled of [true, false]) {
        setTestConfig({
          tools: {
            capitalizeNames: enabled,
          },
        });
        for (const expanded of [false, true]) {
          const context = mkToolCtx({
            expanded,
            executionStarted: false,
            state: { hasResult: true },
          });
          const component = definition.renderCall!(
            testCase.args,
            mkTheme(),
            context,
          );
          expect(text(component)).toContain(
            ` ${label(testCase.name, enabled)} `,
          );
          expect(Object.keys(definition).sort()).toEqual([
            "renderCall",
            "renderResult",
            "renderShell",
          ]);
          expect(testCase.args).toEqual(originalArgs);
        }
      }
    });

    it(`refreshes a reused ${testCase.name} component without restarting its indicator`, () => {
      const definition = setupTool(testCase.patch);
      const state: BaseRenderState = {};
      const context = mkToolCtx({
        executionStarted: false,
        isPartial: true,
        state,
      });
      const component = definition.renderCall!(
        testCase.args,
        mkTheme(),
        context,
      );
      expect(text(component)).toContain(` ${label(testCase.name, true)} `);
      const blink = state.blinkTimer;
      expect(blink).toBeDefined();
      for (const enabled of [false, true]) {
        setTestConfig({
          tools: {
            capitalizeNames: enabled,
          },
        });
        component.invalidate();
        expect(text(component)).toContain(` ${label(testCase.name, enabled)} `);
        expect(state.blinkTimer).toBe(blink);
      }
    });
  }

  it("applies metadata capitalization to core error/truncation rows without changing payloads", () => {
    const payload = "took truncated script failed model calls stay lowercase";
    const input = {
      content: [{ type: "text" as const, text: payload }],
      details: { truncation: { truncated: true } },
    };
    const snapshot = structuredClone(input);
    for (const testCase of coreCases) {
      const definition = setupTool(testCase.patch);
      for (const expanded of [false, true]) {
        const component = definition.renderResult!(
          input,
          { expanded, isPartial: false },
          mkTheme(),
          mkToolCtx({
            expanded,
            isError: true,
            durationMs: 1234,
            args: testCase.args,
          }),
        );
        for (const capitalizeMetadata of [true, false, true]) {
          setTestConfig({
            tools: { capitalizeMetadata, capitalizeNames: false },
          });
          component.invalidate();
          const output = text(component);
          expect(output).toContain(
            capitalizeMetadata ? "Truncated" : "truncated",
          );
          if (!capitalizeMetadata) expect(output).not.toContain("Truncated");
          expect(output).toContain(payload);
          if (testCase.name === "bash")
            expect(output).toContain(
              capitalizeMetadata ? "Took 1.2s" : "took 1.2s",
            );
        }
      }
    }
    expect(input).toEqual(snapshot);
  });

  it("capitalizes only owned Codemode metadata in partial and final views", () => {
    const wrapped = createCodemodeRenderers(nativeCodemode(), adapterOptions);
    const payload = "took truncated script failed model calls stay lowercase";
    const input = {
      content: [
        {
          type: "text" as const,
          text: "Script failed\nWall time 99.0 seconds\nOutput:\n",
        },
        { type: "text" as const, text: payload },
      ],
      details: {
        fullOutputPath: "/tmp/full-output.txt",
        calls: [
          {
            id: "a",
            name: "read",
            args: "lowercase args",
            status: "ok" as const,
            cost: 0.01,
          },
          {
            id: "b",
            name: "write",
            args: "lowercase args",
            status: "error" as const,
            cost: 0.02,
          },
        ],
      },
    };
    const snapshot = structuredClone(input);
    for (const capitalizeMetadata of [true, false]) {
      setTestConfig({ tools: { capitalizeMetadata, capitalizeNames: false } });
      for (const expanded of [false, true])
        for (const isPartial of [false, true]) {
          const component = wrapped.renderResult!(
            input,
            { expanded, isPartial },
            mkTheme(),
            mkToolCtx({
              expanded,
              isPartial,
              isError: true,
              durationMs: 1200,
              state: { _tuiTweaks: { startedAt: 1000, endedAt: 2200 } },
            }),
          );
          const output = text(component);
          for (const [original, capitalized] of [
            ["truncated", "Truncated"],
            ["script failed", "Script failed"],
            ["model calls $0.03", "Model calls $0.03"],
          ])
            expect(output).toContain(
              capitalizeMetadata ? capitalized! : original!,
            );
          expect(output).toContain(
            `${capitalizeMetadata ? (isPartial ? "Elapsed" : "Took") : isPartial ? "elapsed" : "took"} 1.2s`,
          );
          expect(output).toContain("2 calls");
          expect(output).toContain("1 failed");
          if (!isPartial) expect(output).toContain(payload);
          if (expanded) expect(output).toContain("lowercase args");
        }
    }
    expect(input).toEqual(snapshot);
  });

  it("uses the shared metadata rule for native custom output and generic fallbacks", () => {
    const payload = "took truncated script failed model calls stay lowercase";
    const input = {
      content: [{ type: "text" as const, text: payload }],
      details: { truncation: { truncated: true } },
    };
    const native = () => new Text(payload, 0, 0);
    for (const renderResult of [
      undefined,
      native,
      () => {
        throw new Error("native failure");
      },
    ]) {
      const wrapped = createWrappedRenderers(
        "custom",
        { renderResult },
        adapterOptions,
      );
      for (const capitalizeMetadata of [true, false]) {
        setTestConfig({ tools: { capitalizeMetadata } });
        for (const expanded of [false, true]) {
          const output = text(
            wrapped.renderResult!(
              input,
              { expanded, isPartial: false },
              mkTheme(),
              mkToolCtx({ expanded }),
            ),
          );
          expect(output).toContain(
            capitalizeMetadata ? "Truncated" : "truncated",
          );
          if (!capitalizeMetadata) expect(output).not.toContain("Truncated");
          if (expanded || renderResult === native)
            expect(output).toContain(payload);
          expect(output).not.toContain("Stay lowercase");
        }
      }
    }
  });

  it("capitalizes core headers even when custom-tool wrapping is disabled", () => {
    setTestConfig({
      tools: {
        enhanceCustomTools: false,
      },
    });
    const registryMethod = ExtensionRunner.prototype.getAllRegisteredTools;
    for (const enabled of [false, true]) {
      setTestConfig({
        tools: {
          capitalizeNames: enabled,
        },
      });
      for (const testCase of coreCases) {
        const component = setupTool(testCase.patch).renderCall!(
          testCase.args,
          mkTheme(),
          mkToolCtx({ executionStarted: false }),
        );
        expect(text(component)).toContain(` ${label(testCase.name, enabled)} `);
      }
    }
    expect(ExtensionRunner.prototype.getAllRegisteredTools).toBe(
      registryMethod,
    );
  });

  it("covers compact Read headers without renaming resource tags or paths", () => {
    const definition = setupTool(patchReadTool);
    for (const enabled of [true, false]) {
      setTestConfig({
        tools: {
          capitalizeNames: enabled,
        },
      });
      for (const [path, kind, filename] of [
        [
          join(getPackageDir(), "docs", "extensions.md"),
          "docs",
          "extensions.md",
        ],
        [join(directory, "AGENTS.md"), "resource", "AGENTS.md"],
        [join(directory, "mySkill", "SKILL.md"), "skill", "mySkill"],
      ]) {
        const args = { path, offset: 2, limit: 3 };
        const context = mkToolCtx({ cwd: directory, executionStarted: false });
        const collapsed = text(
          definition.renderCall!(args, mkTheme(), context),
          1000,
        );
        expect(collapsed).toContain(
          kind === "skill" ? "[skill]" : `${label("read", enabled)} ${kind}`,
        );
        expect(collapsed).toContain(filename!);
        expect(collapsed).toContain(":2-4");
        const expanded = text(
          definition.renderCall!(args, mkTheme(), {
            ...context,
            expanded: true,
          }),
          1000,
        );
        expect(expanded).toContain(` ${label("read", enabled)} `);
        expect(expanded).toContain(kind === "skill" ? "SKILL.md" : filename!);
      }
    }
  });

  it("refreshes Codemode without restarting its blink or changing native details", () => {
    const native = nativeCodemode();
    const wrapped = createCodemodeRenderers(native, adapterOptions);
    const state: BaseRenderState = {};
    const context = mkToolCtx({
      executionStarted: false,
      isPartial: true,
      state: { _tuiTweaks: state },
    });
    const args = { code: 'text("keep mixed Case");\ntext("last");' };
    const component = wrapped.renderCall!(args, mkTheme(), context);
    expect(text(component)).toContain("Codemode");
    const blink = state.blinkTimer;
    expect(blink).toBeDefined();
    for (const enabled of [false, true]) {
      setTestConfig({
        tools: {
          capitalizeNames: enabled,
        },
      });
      component.invalidate();
      expect(text(component)).toContain(` ${label("codemode", enabled)} `);
      expect(state.blinkTimer).toBe(blink);
    }
    for (const enabled of [false, true]) {
      setTestConfig({
        tools: {
          capitalizeNames: enabled,
        },
      });
      const context = mkToolCtx({ executionStarted: false });
      expect(
        text(
          wrapped.renderCall!(args, mkTheme(), { ...context, expanded: true }),
        ),
      ).toContain(` ${label("codemode", enabled)}`);
      const result = {
        content: [{ type: "text" as const, text: "output remains lowercase" }],
        details: {
          calls: [
            {
              id: "nested",
              name: "read",
              args: '{"path":"CaseFile.txt"}',
              status: "ok",
            },
          ],
        },
      };
      const snapshot = structuredClone(result);
      const output = text(
        wrapped.renderResult!(
          result,
          { expanded: true, isPartial: false },
          mkTheme(),
          context,
        ),
      );
      expect(output).toContain("read");
      expect(output).toContain("output remains lowercase");
      expect(result).toEqual(snapshot);
      expect("execute" in wrapped).toBe(false);
    }
  });

  it("uses the same rule for third-party native headers and both fallback paths", () => {
    const native = nativeCodemode();
    const renderers: Array<ToolDefinition["renderCall"]> = [
      undefined,
      () =>
        new Text(
          '\x1b[35msearchAPI\x1b[0m query="mixed Case"\n\n  detail staysLower',
          0,
          0,
        ),
      () => {
        throw new Error("factory failed");
      },
      () => ({
        render() {
          throw new Error("layout failed");
        },
        invalidate() {},
      }),
    ];
    for (const renderCall of renderers) {
      const definition = {
        ...native,
        name: "searchAPI",
        label: "searchAPI",
        renderCall,
      };
      const wrapped = createWrappedRenderers(
        definition.name,
        definition,
        adapterOptions,
      );
      const args = { query: "mixed Case" };
      for (const expanded of [false, true]) {
        const component = wrapped.renderCall!(
          args,
          mkTheme(),
          mkToolCtx({ expanded, executionStarted: false }),
        );
        for (const enabled of [true, false, true]) {
          setTestConfig({
            tools: {
              capitalizeNames: enabled,
            },
          });
          component.invalidate();
          const output = text(component);
          expect(output).toContain(label("searchAPI", enabled));
          expect(output).toContain("mixed Case");
          if (renderCall === renderers[1] && expanded)
            expect(output).toContain("  detail staysLower");
          expect("execute" in wrapped).toBe(false);
          expect(definition.name).toBe("searchAPI");
        }
      }
    }
    const proper = createWrappedRenderers(
      "searchAPI",
      { renderCall: undefined },
      adapterOptions,
    );
    setTestConfig({
      tools: {
        capitalizeNames: false,
      },
    });
    expect(text(proper.renderCall!({}, mkTheme(), mkToolCtx()))).toContain(
      "searchAPI",
    );
  });

  it("leaves self-rendering third-party labels and metadata untouched with either setting", () => {
    const native = {
      ...nativeCodemode(),
      name: "searchAPI",
      label: "searchAPI",
      renderShell: "self" as const,
      renderCall: () => new Text("searchAPI", 0, 0),
      renderResult: () => new Text("took · truncated · script failed", 0, 0),
    };
    const fixture = setupCustomTool(native);
    try {
      for (const enabled of [true, false]) {
        setTestConfig({
          tools: {
            capitalizeNames: enabled,
            capitalizeMetadata: enabled,
          },
        });
        const registered = fixture.renderers;
        expect(registered).toBe(native);
        expect(
          text(registered.renderCall!({}, mkTheme(), mkToolCtx())).trimEnd(),
        ).toBe("searchAPI");
        expect(
          text(
            registered.renderResult!(
              { content: [], details: undefined },
              { expanded: true, isPartial: false },
              mkTheme(),
              mkToolCtx(),
            ),
          ).trimEnd(),
        ).toBe("took · truncated · script failed");
      }
    } finally {
      fixture.dispose();
    }
  });

  it("fits resized core, Codemode and third-party headers with both settings", () => {
    const native = nativeCodemode();
    const cases: Array<{
      definition: ToolRenderers;
      args: Record<string, unknown>;
    }> = coreCases.map((testCase) => ({
      definition: setupTool(testCase.patch),
      args: {
        ...testCase.args,
        path: "界".repeat(70) + "/CaseFile.txt",
        command: "echo " + "x".repeat(300),
      },
    }));
    cases.push({
      definition: createCodemodeRenderers(native, adapterOptions),
      args: { code: 'text("' + "x".repeat(300) + '");\ntext("last");' },
    });
    cases.push({
      definition: createWrappedRenderers(
        "searchAPI",
        {
          renderCall: () => new Text("searchAPI " + "界".repeat(70), 0, 0),
        },
        adapterOptions,
      ),
      args: {},
    });
    for (const { definition, args } of cases) {
      for (const expanded of [false, true]) {
        const component = definition.renderCall!(
          args,
          mkTheme(),
          mkToolCtx({ expanded, executionStarted: false }),
        );
        for (const enabled of [true, false]) {
          setTestConfig({
            tools: {
              capitalizeNames: enabled,
            },
          });
          component.invalidate();
          for (const width of [1, 2, 3, 5, 10, 20, 40, 80, 120, 200, 40]) {
            expect(
              component
                .render(width)
                .every((row) => visibleWidth(row) <= width),
            ).toBe(true);
          }
        }
      }
    }
  });
});
