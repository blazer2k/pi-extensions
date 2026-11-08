import assert from "node:assert/strict";
import dns from "node:dns";
import net from "node:net";
import tls from "node:tls";
import { syncBuiltinESMExports } from "node:module";

assert(
  process.env.PI_SEARXNG_TEST_ROOT,
  "Run through npm test to isolate settings and files",
);
export const state = {
  fetch: undefined,
  lookup: undefined,
  connect: undefined,
  fileAccess: undefined,
};
export const blocked = () => {
  throw new Error("Unexpected network access in offline tests");
};
globalThis.fetch = (...args) =>
  state.fetch ? state.fetch(...args) : blocked();
for (const target of [
  dns,
  dns.promises,
  dns.Resolver?.prototype,
  dns.promises.Resolver?.prototype,
].filter(Boolean)) {
  for (const name of Object.getOwnPropertyNames(target)) {
    if (
      name === "lookup" ||
      name === "lookupService" ||
      name === "reverse" ||
      name.startsWith("resolve")
    )
      target[name] = blocked;
  }
}
dns.lookup = (...args) => (state.lookup ? state.lookup(...args) : blocked());
net.connect = net.createConnection = (...args) =>
  state.connect ? state.connect(...args) : blocked();
net.Socket.prototype.connect = blocked;
net.Server.prototype.listen = blocked;
tls.connect = (...args) => (state.connect ? state.connect(...args) : blocked());
syncBuiltinESMExports();
