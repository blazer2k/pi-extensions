import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";
import { Duplex } from "node:stream";
import dns from "node:dns";
import { state } from "./no-network.mjs";
import { getValidUrl, lookupPublic } from "../src/helpers/url.ts";
import { webFetch } from "../src/api/fetch.ts";
import { getDefaultConfig } from "../src/config/definition.ts";

beforeEach(() => {
  state.fetch = state.lookup = state.connect = undefined;
});
const blocked = [
  "0.0.0.0",
  "10.0.0.1",
  "10.255.255.255",
  "100.64.0.1",
  "100.127.255.255",
  "127.0.0.1",
  "169.254.1.1",
  "172.16.0.1",
  "172.31.255.255",
  "192.0.0.1",
  "192.0.2.1",
  "192.88.99.1",
  "192.168.0.1",
  "198.18.0.1",
  "198.19.255.255",
  "198.51.100.1",
  "203.0.113.1",
  "224.0.0.1",
  "239.255.255.255",
  "240.0.0.1",
  "255.255.255.255",
  "::",
  "::1",
  "::127.0.0.1",
  "::ffff:127.0.0.1",
  "::ffff:192.168.0.1",
  "::ffff:0:8.8.8.8",
  "64:ff9b::808:808",
  "64:ff9b:1::1",
  "100::1",
  "100:0:0:1::1",
  "2001::1",
  "2001:2::1",
  "2001:db8::1",
  "2002:0808:0808::1",
  "3fff::1",
  "5f00::1",
  "fc00::1",
  "fdff::1",
  "fe80::1",
  "fec0::1",
  "ff02::1",
];
for (const address of blocked)
  test(`rejects special-use address ${address}`, () => {
    const url = `http://${address.includes(":") ? `[${address}]` : address}/`;
    assert.equal(getValidUrl(url, false), null);
    assert(getValidUrl(url, true));
  });
for (const host of [
  "localhost",
  "LOCALHOST.",
  "a.localhost",
  "local",
  "server.local",
  "server.local.",
  "2130706433",
  "0x7f000001",
  "0177.0.0.1",
])
  test(`rejects local/normalized host ${host}`, () =>
    assert.equal(getValidUrl(`http://${host}/`, false), null));
for (const value of [
  "file:///etc/passwd",
  "ftp://example.org",
  "data:text/plain,hello",
  "javascript:alert(1)",
  "https://user:password@example.org",
  "https://user@example.org",
  "not a URL",
  null,
  undefined,
])
  test(`private bypass does not allow scheme/credential violations ${String(value)}`, () =>
    assert.equal(getValidUrl(value, true), null));
for (const value of [
  "https://example.org/path?q=1",
  "http://8.8.8.8/",
  "https://[2606:4700:4700::1111]/",
])
  test(`accepts supported public destination ${value}`, () =>
    assert.equal(getValidUrl(value, false), value));

const lookup = (options = {}) =>
  new Promise((resolve, reject) =>
    lookupPublic("public.example", options, (error, address, family) =>
      error ? reject(error) : resolve({ address, family }),
    ),
  );
function answers(records) {
  state.lookup = (_host, options, callback) => {
    assert.equal(options.all, true);
    queueMicrotask(() => callback(null, records));
  };
}
test("DNS returns only checked answers without resolving again", async () => {
  const records = [
    { address: "8.8.8.8", family: 4 },
    { address: "2606:4700:4700::1111", family: 6 },
  ];
  answers(records);
  assert.deepEqual(await lookup({ all: true }), {
    address: records,
    family: undefined,
  });
  assert.deepEqual(await lookup({ family: 4 }), {
    address: "8.8.8.8",
    family: 4,
  });
});
for (const address of [
  "127.0.0.1",
  "10.0.0.1",
  "::ffff:127.0.0.1",
  "not-an-address",
])
  test(`rejects mixed public/unsafe DNS answers ${address}`, async () => {
    answers([
      { address: "8.8.8.8", family: 4 },
      { address, family: address.includes(":") ? 6 : 4 },
    ]);
    await assert.rejects(lookup({ all: true }), /Private or non-public/);
  });
test("DNS errors/empty responses propagate without inventing addresses", async () => {
  answers([]);
  await assert.rejects(lookup(), /No addresses/);
  const error = new Error("DNS failure");
  state.lookup = (_host, _options, callback) => callback(error);
  await assert.rejects(lookup(), (value) => value === error);
});

class Socket extends Duplex {
  constructor(response) {
    super();
    this.response = response;
    this.request = "";
  }
  _read() {}
  _write(chunk, _encoding, callback) {
    this.request += chunk.toString();
    if (this.request.includes("\r\n\r\n") && !this.sent) {
      this.sent = true;
      queueMicrotask(() => {
        this.push(this.response);
        this.push(null);
      });
    }
    callback();
  }
  setKeepAlive() {
    return this;
  }
  setNoDelay() {
    return this;
  }
  setTimeout() {
    return this;
  }
  ref() {
    return this;
  }
  unref() {
    return this;
  }
}
const response = (body = "connected", status = "200 OK", headers = "") =>
  Buffer.from(
    `HTTP/1.1 ${status}\r\nContent-Type: text/plain\r\nContent-Length: ${Buffer.byteLength(body)}\r\nConnection: close\r\n${headers}\r\n${body}`,
  );
function connector(replies, all = true, checked = true) {
  const dials = [];
  state.connect = (options) => {
    if (checked) assert.equal(options.lookup, lookupPublic);
    else assert.equal(options.lookup, undefined);
    const socket = new Socket(replies(options.host));
    const secure = Array.isArray(options.ALPNProtocols);
    if (secure) {
      socket.encrypted = true;
      socket.alpnProtocol = "http/1.1";
    }
    queueMicrotask(() =>
      (options.lookup ?? dns.lookup)(
        options.host,
        { all },
        (error, address, family) => {
          if (error) {
            socket.destroy(error);
            return;
          }
          const record = all ? address[0] : { address, family };
          socket.remoteAddress = record.address;
          socket.remoteFamily = record.family === 6 ? "IPv6" : "IPv4";
          dials.push(record.address);
          socket.emit(secure ? "secureConnect" : "connect");
        },
      ),
    );
    return socket;
  };
  return dials;
}
for (const protocol of ["http", "https"])
  for (const all of [false, true])
    test(`actual Node Undici ${protocol} uses production checked DNS (all=${all})`, async () => {
      let queries = 0;
      state.lookup = (_host, options, callback) => {
        queries++;
        assert.equal(options.all, true);
        queueMicrotask(() =>
          callback(null, [
            { address: queries === 1 ? "8.8.8.8" : "127.0.0.1", family: 4 },
          ]),
        );
      };
      const dials = connector(() => response(), all);
      const result = await webFetch(
        `${protocol}://public.example/text`,
        getDefaultConfig(),
      );
      assert.match(result.content[0].text, /connected/);
      assert.deepEqual(dials, ["8.8.8.8"]);
      assert.equal(queries, 1);
    });
test("actual Node connector refuses mixed DNS before any successful dial", async () => {
  answers([
    { address: "8.8.8.8", family: 4 },
    { address: "127.0.0.1", family: 4 },
  ]);
  const dials = connector(() => response());
  await assert.rejects(
    webFetch("http://public.example/text", getDefaultConfig()),
    /Private or non-public/,
  );
  assert.deepEqual(dials, []);
});
test("actual Node redirect connector rechecks the next hostname and blocks private DNS", async () => {
  const queried = [];
  state.lookup = (host, _options, callback) => {
    queried.push(host);
    queueMicrotask(() =>
      callback(null, [
        {
          address: host === "public.example" ? "8.8.8.8" : "10.0.0.1",
          family: 4,
        },
      ]),
    );
  };
  const dials = connector((host) =>
    host === "public.example"
      ? response("", "302 Found", "Location: http://next.example/final\r\n")
      : response(),
  );
  await assert.rejects(
    webFetch("http://public.example/start", getDefaultConfig()),
    /Private or non-public/,
  );
  assert.deepEqual(queried, ["public.example", "next.example"]);
  assert.deepEqual(dials, ["8.8.8.8"]);
});
test("private bypass changes address checks only and still uses actual Undici", async () => {
  state.lookup = (_host, _options, callback) =>
    queueMicrotask(() => callback(null, [{ address: "127.0.0.1", family: 4 }]));
  const dials = connector(() => response(), true, false);
  const result = await webFetch("http://private.example/text", {
    ...getDefaultConfig(),
    allowPrivateUrls: true,
  });
  assert.match(result.content[0].text, /connected/);
  assert.deepEqual(dials, ["127.0.0.1"]);
});
