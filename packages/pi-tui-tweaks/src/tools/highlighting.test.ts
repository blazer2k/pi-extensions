import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test";
import * as pi from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { theme } from "../../../../node_modules/@earendil-works/pi-coding-agent/dist/modes/interactive/theme/theme.js";
import { mkToolCtx as makeToolContext } from "../testing/helpers";
import { patchBashTool } from "./bash";
import { patchWriteTool } from "./write";
import type { BashRenderState } from "./bash/types";
import { createCodemodeRenderers } from "./codemode";
import { clearBlinkTimers } from "./rendering/state";

type RenderContext = Parameters<NonNullable<pi.ToolRenderers["renderCall"]>>[2];
const mkToolCtx = (overrides: Record<string, unknown> = {}): RenderContext =>
  makeToolContext(overrides);

let highlight: ReturnType<typeof spyOn<typeof pi, "highlightCode">>;
beforeEach(() => {
  pi.initTheme("dark", false);
  highlight = spyOn(pi, "highlightCode");
});
afterEach(() => {
  highlight.mockRestore();
  clearBlinkTimers();
  pi.initTheme("dark", false);
});

const result = {
  content: [{ type: "text" as const, text: "done" }],
  details: undefined,
};
const inactive = { isToolCallActive: () => false, reportIssue() {} };

function drawCall(
  renderers: pi.ToolRenderers,
  args: unknown,
  context: ReturnType<typeof mkToolCtx>,
) {
  const text = renderers.renderCall!(args, theme, context);
  context.lastComponent = text;
  return text.render(200).join("\n");
}

function writeContext(content: string, path = "example.ts") {
  return {
    ...mkToolCtx({
      state: {},
      expanded: true,
      isPartial: false,
      executionStarted: false,
    }),
    args: { path, content },
  };
}

function drawWrite(
  renderers: pi.ToolRenderers,
  context: ReturnType<typeof mkToolCtx>,
  isPartial = false,
) {
  const text = renderers.renderResult!(
    result,
    { expanded: context.expanded, isPartial },
    theme,
    context,
  );
  context.lastComponent = text;
  return text.render(300).join("\n");
}

describe("Bash highlighting cache", () => {
  it("highlights identical full and compact commands once, including completed refreshes", () => {
    const renderer = patchBashTool();
    const context = mkToolCtx({
      state: { hasResult: true },
      executionStarted: false,
    });
    for (let i = 0; i < 10; i++)
      drawCall(renderer, { command: "echo one" }, context);
    context.expanded = true;
    drawCall(renderer, { command: "echo one" }, context);
    expect(highlight).toHaveBeenCalledTimes(1);
  });

  it("highlights only the displayed view and reuses both views on toggles", () => {
    const renderer = patchBashTool();
    const state: BashRenderState = { hasResult: true };
    const context = mkToolCtx({ state, executionStarted: false });
    const args = { command: "echo one\necho two" };
    drawCall(renderer, args, context);
    expect(highlight).toHaveBeenCalledTimes(1);
    expect(state.callHighlightCache?.expandedCommand).toBeUndefined();
    context.expanded = true;
    drawCall(renderer, args, context);
    expect(highlight).toHaveBeenCalledTimes(2);
    context.expanded = false;
    drawCall(renderer, args, context);
    expect(highlight).toHaveBeenCalledTimes(2);
  });

  it("refreshes live colors after a theme change", () => {
    const renderer = patchBashTool();
    const context = mkToolCtx({ state: {}, executionStarted: true });
    const args = { command: 'echo "$HOME"' };
    const dark = drawCall(renderer, args, context);
    pi.initTheme("light", false);
    const light = drawCall(renderer, args, context);
    expect(light).toContain(pi.highlightCode(args.command, "bash").join("\n"));
    expect(light).not.toBe(dark);
  });

  it("drops highlights on component invalidation but not width-only reflow", () => {
    const renderer = patchBashTool();
    const context = mkToolCtx({
      state: { hasResult: true },
      executionStarted: false,
    });
    const args = { command: "echo one" };
    drawCall(renderer, args, context);
    context.lastComponent!.render(80);
    expect(highlight).toHaveBeenCalledTimes(1);
    context.lastComponent!.invalidate();
    drawCall(renderer, args, context);
    expect(highlight).toHaveBeenCalledTimes(2);
  });
});

describe("Codemode highlighting cache", () => {
  it("reuses an unchanged displayed first line through tail edits and completion", () => {
    const renderer = createCodemodeRenderers({}, inactive);
    const context = mkToolCtx({ state: {}, executionStarted: false });
    for (let i = 0; i < 10; i++)
      drawCall(
        renderer,
        { code: `const first = 1;\nconst tail = ${i};` },
        context,
      );
    expect(highlight).toHaveBeenCalledTimes(1);
    renderer.renderResult!(
      result,
      { expanded: false, isPartial: false },
      theme,
      context,
    );
    drawCall(renderer, { code: "const first = 1;\nconst tail = 9;" }, context);
    expect(highlight).toHaveBeenCalledTimes(1);
    drawCall(renderer, { code: "const first = 2;\nconst tail = 9;" }, context);
    expect(highlight).toHaveBeenCalledTimes(2);
  });

  it("does not highlight an unused preview when native expanded rendering succeeds", () => {
    const nativeCall = spyOn(
      { renderCall: () => new Text("codemode\nnative script", 0, 0) },
      "renderCall",
    );
    const renderer = createCodemodeRenderers(
      { renderCall: nativeCall },
      inactive,
    );
    const context = mkToolCtx({
      state: {},
      expanded: true,
      executionStarted: false,
    });
    const output = drawCall(
      renderer,
      { code: "const one = 1;\nconst two = 2;" },
      context,
    );
    expect(output).toContain("native script");
    expect(nativeCall).toHaveBeenCalledTimes(1);
    expect(highlight).not.toHaveBeenCalled();
  });

  it("reuses full fallback highlighting and clears it on invalidation", () => {
    const renderer = createCodemodeRenderers({}, inactive);
    const context = mkToolCtx({
      state: {},
      expanded: true,
      executionStarted: false,
    });
    const args = { code: "const one = 1;\nconst two = 2;" };
    for (let i = 0; i < 10; i++) drawCall(renderer, args, context);
    expect(highlight).toHaveBeenCalledTimes(1);
    context.lastComponent!.invalidate();
    drawCall(renderer, args, context);
    expect(highlight).toHaveBeenCalledTimes(2);
  });
});

describe("Write highlighting cache", () => {
  it("finishes streamed multiline context beyond the first 50 lines once", () => {
    const renderer = patchWriteTool();
    const prefix =
      Array.from({ length: 60 }, (_, i) => `const line${i} = ${i};`).join(
        "\n",
      ) + "\n/* comment";
    const content =
      prefix + "\nconst actuallyComment = 42;\n*/\nconst actualCode = 1;";
    const context = writeContext(content);
    context.isPartial = true;
    drawCall(renderer, { path: "example.ts", content: prefix }, context);
    drawCall(renderer, context.args, context);
    highlight.mockClear();
    const expected = pi.highlightCode(content, "typescript")[61]!;
    highlight.mockClear();
    const complete = drawWrite(renderer, context);
    expect(complete).toContain(expected);
    expect(highlight).toHaveBeenCalledTimes(1);
    drawWrite(renderer, context);
    expect(highlight).toHaveBeenCalledTimes(1);
  });

  it("does not re-highlight an unchanged contextual prefix after line 50", () => {
    const renderer = patchWriteTool();
    let content = Array.from(
      { length: 100 },
      (_, i) => `const line${i} = ${i};`,
    ).join("\n");
    const context = writeContext(content);
    context.isPartial = true;
    drawCall(renderer, { path: "example.ts", content }, context);
    highlight.mockClear();
    for (let i = 0; i < 5; i++) {
      content += `\nconst appended${i} = ${i};`;
      drawCall(renderer, { path: "example.ts", content }, context);
    }
    expect(
      highlight.mock.calls.every(([source]) => !source.includes("\n")),
    ).toBe(true);
  });

  it("refreshes completed colors when the theme changes", () => {
    const renderer = patchWriteTool();
    const context = writeContext('const greeting = "hello";');
    drawWrite(renderer, context);
    pi.initTheme("light", false);
    const output = drawWrite(renderer, context);
    expect(output).toContain(
      pi.highlightCode(context.args.content, "typescript")[0]!,
    );
  });

  it("reuses complete output until invalidation, then rebuilds it once", () => {
    const renderer = patchWriteTool();
    const context = writeContext('const greeting = "hello";');
    drawWrite(renderer, context);
    drawWrite(renderer, context);
    expect(highlight).toHaveBeenCalledTimes(1);
    context.lastComponent!.invalidate();
    drawWrite(renderer, context);
    expect(highlight).toHaveBeenCalledTimes(2);
    drawWrite(renderer, context);
    expect(highlight).toHaveBeenCalledTimes(2);
  });

  it("fully rebuilds on path, language, source rewrites and completed appends", () => {
    const renderer = patchWriteTool();
    const context = writeContext("const first = 1;");
    drawWrite(renderer, context);
    for (const args of [
      { path: "other.ts", content: "const first = 1;" },
      { path: "other.js", content: "const first = 1;" },
      { path: "other.js", content: "const second = 2;" },
      { path: "other.js", content: "const second = 2;\nconst third = 3;" },
    ]) {
      context.args = args;
      drawWrite(renderer, context);
    }
    expect(highlight).toHaveBeenCalledTimes(5);
  });
});
