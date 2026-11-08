import assert from "node:assert/strict";
import { test } from "node:test";
import { writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import {
  ToolExecutionComponent,
  initTheme,
} from "@earendil-works/pi-coding-agent";
import {
  KeybindingsManager,
  setKeybindings,
  stripTerminalSequences,
  visibleWidth,
} from "@earendil-works/pi-tui";
import { tools, text } from "./helpers.mjs";
import { state } from "./no-network.mjs";

initTheme("dark", false);
setKeybindings(
  new KeybindingsManager({
    "app.tools.expand": {
      defaultKeys: "alt+shift+e",
      description: "Toggle tool output",
    },
  }),
);
const plain = (rows) => stripTerminalSequences(rows.join("\n"));
const row = (tool, renderer, result, args) => {
  const component = new ToolExecutionComponent(
    tool.name,
    "native-row",
    args,
    { outputPad: 1 },
    renderer,
    { requestRender() {} },
    process.cwd(),
  );
  component.setArgsComplete();
  component.updateResult(
    { ...result, isError: result.isError === true },
    false,
  );
  return component;
};
for (const wrapped of [false, true])
  for (const capitalize of wrapped ? [false, true] : [false])
    test(`native rows: TUI=${wrapped}, capitalization=${capitalize}, configured hints/resize/expansion`, async () => {
      await writeFile(
        process.env.PI_TUI_TWEAKS_CONFIG_PATH,
        JSON.stringify({
          tools: { capitalizeNames: capitalize, expandedOutputLimit: 1 },
        }),
      );
      const registered = await tools(
        { fetchPreviewLines: 4, maxResults: 12 },
        new URL("../src/index.ts", import.meta.url),
        wrapped
          ? [
              fileURLToPath(
                new URL("../../pi-tui-tweaks/index.ts", import.meta.url),
              ),
            ]
          : [],
      );
      const loaded = registered.loader.getExtensions();
      const own = loaded.extensions.find((item) => item.tools.has("web_fetch"));
      loaded.runtime.getAllTools = () =>
        [...own.tools].map(([name, item]) => ({
          ...item.definition,
          name,
          sourceInfo: own.sourceInfo,
        }));
      const resolve = (tool) => {
        const order = [];
        const probes = ["first", "second"].map((label) => (_name, next) => {
          order.push(label);
          return next();
        });
        const resolvers = [
          ...probes,
          ...loaded.extensions.flatMap(
            (extension) => extension.toolRenderers ?? [],
          ),
        ];
        const at = (index) =>
          index < resolvers.length
            ? resolvers[index](tool.name, () => at(index + 1))
            : tool;
        const renderer = at(0);
        assert.deepEqual(order, ["first", "second"]);
        if (wrapped)
          assert.notEqual(
            renderer,
            tool,
            "exercise the actual installed TUI extension resolver",
          );
        return renderer;
      };
      const body = Array.from(
        { length: 100 },
        (_, i) => `DOC${i + 1} ` + "long text ".repeat(15),
      ).join("\n");
      state.fetch = async () =>
        new Response(body, { headers: { "Content-Type": "text/plain" } });
      const result = await registered.fetch.execute(
        "fetch",
        { url: "https://example.org/text" },
        undefined,
        undefined,
        { sessionManager: { getSessionId: assert.fail } },
      );
      const original = structuredClone(result);
      const component = row(
        registered.fetch,
        resolve(registered.fetch),
        result,
        { url: "https://example.org/text" },
      );
      const collapsed = plain(component.render(100));
      assert.match(collapsed, /100 lines/);
      assert.doesNotMatch(collapsed, /DOC1 /);
      assert.match(collapsed, /to expand/);
      component.setExpanded(true);
      for (const width of [35, 100, 160, 35]) {
        const rendered = component.render(width),
          output = plain(rendered);
        assert(rendered.every((line) => visibleWidth(line) <= width));
        for (const number of [1, 2, 99, 100])
          assert.match(output, new RegExp(`DOC${number} `));
        assert.match(output, /\+96 lines/);
        assert.match(output, /Source URL:/);
        assert.match(output, /to collapse/);
        assert.match(output, /(?:option|alt)\+shift\+e/);
      }
      assert(
        component
          .render(160)
          .join("\n")
          .includes(
            `\u001b[1m${wrapped && capitalize ? "Web fetch" : "web fetch"}\u001b[22m`,
          ),
      );
      component.invalidate();
      assert.match(plain(component.render(80)), /\+96 lines/);
      component.setExpanded(false);
      assert.doesNotMatch(plain(component.render(80)), /DOC1 /);
      assert.deepEqual(result, original);
      state.fetch = async () =>
        Response.json({
          results: Array.from({ length: 12 }, (_, i) => ({
            title: `ENTRY${i + 1}`,
            url: `https://example.org/${i}`,
            content: "Snippet",
          })),
          unresponsive_engines: [["engine", "timeout"]],
          suggestions: ["another"],
          corrections: ["term"],
        });
      const found = await registered.search.execute("search", {
        query: "offline",
      });
      const searchRow = row(
        registered.search,
        resolve(registered.search),
        found,
        { query: "offline" },
      );
      assert.match(plain(searchRow.render(100)), /12 results/);
      assert.doesNotMatch(plain(searchRow.render(100)), /ENTRY/);
      searchRow.setExpanded(true);
      const expanded = plain(searchRow.render(100));
      for (const value of [
        "ENTRY12",
        "Search warnings:",
        "Suggestions:",
        "Corrections:",
        "to collapse",
      ])
        assert(expanded.includes(value));
      assert.match(text(found), /ENTRY12/);
      await writeFile(
        process.env.PI_SEARXNG_CONFIG_PATH,
        JSON.stringify({ fetchPreviewLines: -1 }),
      );
      const next = await registered.reload();
      const unlimited = row(next.fetch, next.fetch, result, {
        url: "https://example.org/text",
      });
      unlimited.setExpanded(true);
      const all = plain(unlimited.render(45));
      assert.equal((all.match(/DOC\d+ /g) ?? []).length, 100);
      assert.doesNotMatch(all, /\+96 lines/);
      component.setExpanded(true);
      assert.match(
        plain(component.render(80)),
        /\+96 lines/,
        "existing rows retain their captured setting",
      );
      for (const extension of registered.loader.getExtensions().extensions)
        for (const handler of extension.handlers.get("session_shutdown") ?? [])
          await handler({}, {});
      for (const extension of loaded.extensions)
        for (const handler of extension.handlers.get("session_shutdown") ?? [])
          await handler({}, {});
      state.fetch = undefined;
    });

test("search and fetch rendering performs no file access", async () => {
  const registered = await tools();
  state.fetch = async () =>
    new Response("RENDER_BODY\nlast", {
      headers: { "Content-Type": "text/plain" },
    });
  const fetched = await registered.fetch.execute(
    "render-fetch",
    { url: "https://example.org/text" },
    undefined,
    undefined,
    { sessionManager: { getSessionId: assert.fail } },
  );
  state.fetch = async () =>
    Response.json({
      results: [
        {
          title: "RENDER_SEARCH",
          url: "https://example.org/result",
          content: "snippet",
        },
      ],
    });
  const found = await registered.search.execute("render-search", {
    query: "offline",
  });
  const calls = [];
  state.fileAccess = (method) => {
    calls.push(method);
    throw new Error(`Unexpected renderer file access: ${method}`);
  };
  try {
    for (const [tool, result, args, marker] of [
      [
        registered.fetch,
        fetched,
        { url: "https://example.org/text" },
        "RENDER_BODY",
      ],
      [registered.search, found, { query: "offline" }, "RENDER_SEARCH"],
    ]) {
      const component = row(tool, tool, result, args);
      for (const expanded of [false, true]) {
        component.setExpanded(expanded);
        for (const width of [35, 100]) {
          const rendered = plain(component.render(width));
          if (expanded) assert(rendered.includes(marker));
          component.invalidate();
        }
      }
    }
  } finally {
    state.fileAccess = undefined;
    state.fetch = undefined;
  }
  assert.deepEqual(
    calls,
    [],
    "renderer must not hide caught file-access failures",
  );
});
