import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";
import { state } from "./no-network.mjs";
import { tools, text } from "./helpers.mjs";

let search;
beforeEach(async () => {
  state.fetch = undefined;
  ({ search } = await tools({
    maxResults: 2,
    agentCanPickCategory: true,
    agentCanLimitResults: true,
  }));
});
test("registered search normalizes entries and retains diagnostics before limiting", async () => {
  state.fetch = async (url, options) => {
    const request = new URL(url);
    assert.equal(request.hostname, "searxng.invalid");
    assert.equal(request.searchParams.get("q"), "original query");
    assert.equal(request.searchParams.get("format"), "json");
    assert.equal(request.searchParams.get("categories"), "science");
    assert.equal(options.headers.Authorization, "Bearer offline-test-key");
    return Response.json({
      results: [
        { url: "javascript:alert(1)" },
        {
          title: null,
          url: "https://example.org/1",
          content: "<b>body</b><script>bad</script>",
        },
        { title: "<i>Second</i>", url: "https://example.org/2" },
        { title: "Third", url: "https://example.org/3" },
      ],
      unresponsive_engines: [
        ["<b>engine</b>", "\u001b[31mtimeout\u001b[0m\nreason"],
        [null],
      ],
      corrections: ["<b>corrected</b>", null],
      suggestions: [" alternative ", 7],
    });
  };
  const result = await search.execute("search", {
    query: " original query ",
    category: "science",
  });
  assert.equal(result.details.status, "success");
  assert.equal(result.details.query, "original query");
  assert.equal(result.details.resultCount, 2);
  assert.match(
    text(result),
    /1\. Untitled\nURL: https:\/\/example.org\/1\nbody/,
  );
  assert.match(text(result), /2\. Second/);
  assert.doesNotMatch(text(result), /Third|javascript:|<script>|\u001b/);
  assert.match(text(result), /engine: timeout reason/);
  assert.match(text(result), /1 invalid engine diagnostic/);
  assert.match(text(result), /Corrections: corrected/);
  assert.match(text(result), /Suggestions: alternative/);
});
for (const warnings of [undefined, [], [["engine", "timeout"]], "invalid"])
  test(`empty search never invents all-engine failure (${JSON.stringify(warnings)})`, async () => {
    state.fetch = async () =>
      Response.json({ results: [], unresponsive_engines: warnings });
    const result = await search.execute("empty", { query: "empty" });
    assert.equal(result.details.status, "success");
    assert.equal(result.details.resultCount, 0);
    assert.match(text(result), /No results were returned/);
    assert.doesNotMatch(text(result), /all engines failed/i);
    if (
      warnings === undefined ||
      (Array.isArray(warnings) && warnings.length === 0)
    )
      assert.match(text(result), /Try changing your query/);
  });
test("diagnostics/hints have bounded counts and sanitized lengths", async () => {
  state.fetch = async () =>
    Response.json({
      results: [],
      unresponsive_engines: Array.from({ length: 14 }, (_, i) => [
        `engine${i}`,
        "x".repeat(1000),
      ]),
      corrections: Array(9).fill("c".repeat(1000)),
      suggestions: Array(9).fill("s"),
    });
  const result = await search.execute("bounded", { query: "bounded" });
  assert.equal(result.details.warnings.length, 11);
  assert.match(
    result.details.warnings.at(-1),
    /4 more reported engine problems/,
  );
  assert(result.details.warnings.every((item) => item.length < 270));
  assert.equal((text(result).match(/s;/g) ?? []).length, 4);
});
test("shortened text never ends in half of an emoji", async () => {
  state.fetch = async () =>
    Response.json({
      results: [],
      suggestions: ["s".repeat(199) + "\u{1F600} tail"],
    });
  const result = await search.execute("emoji", { query: "emoji" });
  assert(text(result).isWellFormed());
  assert.match(text(result), /Suggestions: s{199}\.\.\./);
});
for (const raw of [
  null,
  {},
  { results: null },
  { results: [null] },
  { results: [{ title: 42 }] },
])
  test(`malformed search response is a native failure ${JSON.stringify(raw)}`, async () => {
    state.fetch = async () => Response.json(raw);
    const result = await search.execute("malformed", { query: "offline" });
    assert.equal(result.isError, true);
    assert.equal(result.details.status, "error");
    assert.match(text(result), /Invalid SearXNG response shape/);
  });
test("empty query and invalid category fail before making requests", async () => {
  let calls = 0;
  state.fetch = async () => {
    calls++;
    return Response.json({ results: [] });
  };
  const blank = await search.execute("blank", { query: "   " });
  assert.equal(blank.isError, true);
  assert.match(text(blank), /cannot be empty/);
  assert.equal(calls, 0);
  const result = await search.execute("category", {
    query: "offline",
    category: "unsupported",
  });
  assert.equal(result.isError, true);
  assert.match(text(result), /Invalid search category/);
  assert.equal(calls, 0);
});
for (const operation of ["search", "fetch"])
  test(`${operation} keeps arbitrary abort reasons private and HTTP errors native`, async () => {
    const registered = await tools();
    const tool = registered[operation];
    const params =
      operation === "search"
        ? { query: "offline" }
        : { url: "https://example.org/" };
    const controller = new AbortController();
    controller.abort({ toString: assert.fail });
    let calls = 0;
    state.fetch = async () => {
      calls++;
      throw new Error("Unexpected request");
    };
    const aborted = await tool.execute("aborted", params, controller.signal);
    assert.equal(aborted.isError, true);
    assert.equal(aborted.details.status, "aborted");
    assert.equal(
      text(aborted),
      operation === "search" ? "Search aborted" : "Fetch aborted",
    );
    assert.equal(aborted.details.error, undefined);
    assert.equal(calls, 0, "already-cancelled tools must not issue a request");
    state.fetch = async () =>
      new Response("", { status: 503, statusText: "Offline failure" });
    const failed = await tool.execute("failed", params);
    assert.equal(failed.isError, true);
    assert.equal(failed.details.status, "error");
    assert.match(text(failed), /503 Offline failure/);
    state.fetch = async () => {
      throw new DOMException("deadline", "TimeoutError");
    };
    const timeout = await tool.execute("timeout", params);
    assert.equal(timeout.details.status, "error");
    assert.match(text(timeout), /timed out/);
  });
test("errors are single-line terminal-safe bounded diagnostics", async () => {
  state.fetch = async () => {
    throw new Error("\u001b[31mproblem\u001b[0m\n" + "x".repeat(3000));
  };
  const result = await search.execute("diagnostic", { query: "offline" });
  assert.equal(result.isError, true);
  assert.doesNotMatch(text(result), /\u001b|\n/);
  assert.match(text(result), /problem/);
  assert(text(result).length < 1100);
});
