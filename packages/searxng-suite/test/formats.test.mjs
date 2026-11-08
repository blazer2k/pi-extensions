import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";
import { readFile } from "node:fs/promises";
import { state } from "./no-network.mjs";
import { tools, context, text } from "./helpers.mjs";
import { webFetch } from "../src/api/fetch.ts";
import { getDefaultConfig } from "../src/config/definition.ts";
import { truncateHead } from "@earendil-works/pi-coding-agent";

let fetcher;
beforeEach(async () => {
  ({ fetch: fetcher } = await tools());
  state.fetch = undefined;
});
const noStorage = { sessionManager: { getSessionId: assert.fail } };
for (const raw of [
  "null",
  "true",
  "42",
  '"root"',
  "[]",
  '{"n":900719925474099312345,"k":1,"k":2,"escape":"\\u0061"} \r\n',
])
  test(`JSON keeps exact decoded spelling for ${raw.slice(0, 30)}`, async () => {
    state.fetch = async () =>
      new Response(raw, {
        headers: { "Content-Type": "Application/JSON; charset=utf-8" },
      });
    const result = await fetcher.execute(
      "json",
      { url: "https://example.org/data" },
      undefined,
      undefined,
      noStorage,
    );
    assert.equal(result.details.status, "success");
    assert.equal(text(result).slice(result.details.bodyStart), raw);
    assert.equal(result.details.textBytes, Buffer.byteLength(raw));
    assert.equal(result.details.fullOutputPath, undefined);
  });
test("JSON removes one leading BOM, rejects a second and malformed UTF-8/syntax", async () => {
  const bom = Buffer.from([0xef, 0xbb, 0xbf]);
  state.fetch = async () =>
    new Response(Buffer.concat([bom, Buffer.from(' {"ok":true} ')]), {
      headers: { "Content-Type": "application/json" },
    });
  const valid = await fetcher.execute(
    "bom",
    { url: "https://example.org/json" },
    undefined,
    undefined,
    noStorage,
  );
  assert.equal(text(valid).slice(valid.details.bodyStart), ' {"ok":true} ');
  for (const body of [
    Buffer.concat([bom, bom, Buffer.from("null")]),
    Buffer.from([0x22, 0xff, 0x22]),
    Buffer.from("{bad}"),
  ]) {
    state.fetch = async () =>
      new Response(body, { headers: { "Content-Type": "application/json" } });
    const result = await fetcher.execute(
      "invalid-json",
      { url: "https://example.org/json" },
      undefined,
      undefined,
      noStorage,
    );
    assert.equal(result.isError, true);
    assert.match(
      text(result),
      /Invalid JSON response: expected valid UTF-8 JSON/,
    );
    assert.equal(result.details.fullOutputPath, undefined);
  }
});
test("oversized JSON saves raw payload only and returns a bounded envelope", async () => {
  const raw =
    ' {"n":900719925474099312345,"body":"' + "x".repeat(60000) + '"} \n';
  state.fetch = async () =>
    new Response(raw, { headers: { "Content-Type": "application/json" } });
  const result = await fetcher.execute(
    "large-json",
    { url: "https://example.org/json" },
    undefined,
    undefined,
    context(),
  );
  assert.equal(result.details.status, "success");
  assert.match(result.details.fullOutputPath, /content\.json$/);
  assert.equal(await readFile(result.details.fullOutputPath, "utf8"), raw);
  assert.match(text(result), /No text preview/);
  assert.equal(truncateHead(text(result)).truncated, false);
  assert.equal(result.details.textBytes, Buffer.byteLength(raw));
});
test("plain text preserves document whitespace and Unicode without counting source metadata", async () => {
  const raw = "  first\r\n\r\n\u00e9\ud83d\ude00\nlast  \n";
  state.fetch = async () =>
    new Response(raw, { headers: { "Content-Type": "text/plain" } });
  const result = await fetcher.execute(
    "text",
    { url: "https://example.org/text" },
    undefined,
    undefined,
    noStorage,
  );
  assert.equal(text(result).slice(result.details.bodyStart), raw);
  assert.equal(result.details.textBytes, Buffer.byteLength(raw));
  assert.equal(result.details.textLines, 4);
});
for (const mime of [
  "application/problem+json",
  "application/x-ndjson",
  "application/octet-stream",
])
  test(`unsupported MIME ${mime} does not silently sniff/fallback`, async () => {
    state.fetch = async () =>
      new Response("{}", { headers: { "Content-Type": mime } });
    const result = await fetcher.execute("unsupported", {
      url: "https://example.org/data",
    });
    assert.equal(result.isError, true);
    assert.match(text(result), /Unsupported content type/);
  });
test("image bytes/attachment MIME are unchanged and do not touch storage", async () => {
  const bytes = Buffer.from([0, 1, 2, 127, 128, 255]);
  state.fetch = async () =>
    new Response(bytes, { headers: { "Content-Type": "image/png" } });
  const result = await fetcher.execute(
    "image",
    { url: "https://example.org/image" },
    undefined,
    undefined,
    noStorage,
  );
  assert.equal(result.details.status, "success");
  assert.deepEqual(
    result.content.find((item) => item.type === "image"),
    { type: "image", data: bytes.toString("base64"), mimeType: "image/png" },
  );
  assert.equal(result.details.textBytes, undefined);
});
for (const status of [301, 302, 303, 307, 308])
  test(`redirect ${status} validates target and uses final HTML link base`, async () => {
    const calls = [];
    state.fetch = async (url, options) => {
      calls.push(url);
      assert.equal(options.redirect, "manual");
      assert.equal(options.headers.Authorization, undefined);
      return calls.length === 1
        ? new Response(null, {
            status,
            headers: { Location: "https://final.example/dir/page" },
          })
        : new Response(
            '<html><head><title>Final</title></head><body><article><p>Readable article.</p><a href="child">Child</a><img src="../image.png"></article></body></html>',
            { headers: { "Content-Type": "text/html" } },
          );
    };
    const result = await fetcher.execute(
      "redirect",
      { url: "https://source.example/start" },
      undefined,
      undefined,
      noStorage,
    );
    assert.equal(result.details.status, "success");
    assert.equal(result.details.finalUrl, "https://final.example/dir/page");
    assert.match(text(result), /https:\/\/final.example\/dir\/child/);
    assert.match(text(result), /https:\/\/final.example\/image.png/);
    assert.match(
      text(result).slice(0, result.details.bodyStart),
      /Source URL: https:\/\/source.example\/start/,
    );
    assert.deepEqual(calls, [
      "https://source.example/start",
      "https://final.example/dir/page",
    ]);
  });
for (const target of [
  "http://127.0.0.1/",
  "http://[::1]/",
  "http://server.local/",
  "https://user:password@example.org/",
  "file:///tmp/test",
])
  test(`redirect target policy rejects ${target} without a second request`, async () => {
    let calls = 0;
    state.fetch = async () => {
      calls++;
      return new Response(null, { status: 302, headers: { Location: target } });
    };
    const result = await fetcher.execute("blocked-redirect", {
      url: "https://example.org/start",
    });
    assert.equal(result.isError, true);
    assert.equal(calls, 1);
  });
test("twenty redirects are allowed, a twenty-first is refused", async () => {
  for (const limit of [20, 21]) {
    let calls = 0;
    state.fetch = async () =>
      ++calls <= limit
        ? new Response(null, {
            status: 302,
            headers: { Location: `/hop-${calls}` },
          })
        : new Response("done", { headers: { "Content-Type": "text/plain" } });
    const result = await fetcher.execute(
      "cap",
      { url: "https://example.org/start" },
      undefined,
      undefined,
      noStorage,
    );
    assert.equal(calls, 21);
    assert.equal(result.isError === true, limit === 21);
    if (limit === 21) assert.match(text(result), /Too many redirects/);
  }
});
test("tracked Reddit adaptation is exact-host only, preserves original identity and revalidates", async () => {
  for (const [source, target] of [
    ["https://www.reddit.com/r/test", "https://old.reddit.com/r/test"],
    ["https://reddit.com/r/test", "https://old.reddit.com/r/test"],
    [
      "https://reddit.com.example.org/r/test",
      "https://reddit.com.example.org/r/test",
    ],
  ]) {
    state.fetch = async (url) => {
      assert.equal(url, target);
      return new Response("document", {
        headers: { "Content-Type": "text/plain" },
      });
    };
    const result = await webFetch(source, getDefaultConfig());
    assert.equal(result.sourceUrl, source);
    assert.equal(result.finalUrl, source === target ? undefined : target);
  }
});
test("HTML removes structural link menus and strong promotional tails", async () => {
  const links = Array.from(
    { length: 15 },
    (_, i) => `<a href="/nav-${i}">NAVNOISE${i}</a>`,
  ).join(" ");
  const article = "Substantive article evidence with useful findings. ".repeat(
    40,
  );
  state.fetch = async () =>
    new Response(
      `<html><body><main><div class="menu">${links}</div><p>${article}</p><section><h2>Found this article interesting?</h2>TAILNOISE</section><p>AFTERTAILNOISE</p></main></body></html>`,
      { headers: { "Content-Type": "text/html" } },
    );
  const result = await fetcher.execute(
    "clean-html",
    { url: "https://example.org/article" },
    undefined,
    undefined,
    noStorage,
  );
  assert.equal(result.details.status, "success");
  assert.match(text(result), /Substantive article evidence/);
  assert.doesNotMatch(text(result), /NAVNOISE|TAILNOISE/);
});
for (const discussion of [false, true])
  test(`conservative HTML cleaner preserves references and ${discussion ? "discussion" : "article"} endings`, async () => {
    const links = Array.from(
      { length: 15 },
      (_, i) => `<a href="/ref-${i}">Reference ${i}</a>`,
    ).join(" ");
    const body = `<p>${"Article evidence with substantive content. ".repeat(40)}</p><section class="references">${links}</section>`;
    const tail = discussion
      ? '<div class="discussion-timeline"><div class="timeline-comment">comment one</div><div class="timeline-comment">comment two</div><div class="timeline-comment"><h2>Found this article interesting?</h2>LASTCOMMENTEVIDENCE</div></div>'
      : "<section><h2>Latest news</h2><p>LASTARTICLEEVIDENCE</p></section>";
    state.fetch = async () =>
      new Response(
        `<html><head><title>Research</title></head><body><nav>REMOVE_NAV</nav><main>${body}${tail}<footer>REMOVE_FOOTER</footer></main></body></html>`,
        { headers: { "Content-Type": "text/html" } },
      );
    const result = await fetcher.execute(
      "html",
      { url: "https://example.org/article" },
      undefined,
      undefined,
      noStorage,
    );
    assert.equal(result.details.status, "success");
    assert.match(text(result), /Reference 14/);
    assert.match(
      text(result),
      discussion ? /LASTCOMMENTEVIDENCE/ : /LASTARTICLEEVIDENCE/,
    );
    assert.doesNotMatch(text(result), /REMOVE_NAV|REMOVE_FOOTER/);
  });
