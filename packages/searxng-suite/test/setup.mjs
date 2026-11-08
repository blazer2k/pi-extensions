import assert from "node:assert/strict";
import { extname } from "node:path";
import { registerHooks } from "node:module";
import { fileURLToPath } from "node:url";
import { state } from "./no-network.mjs";
import fs from "node:fs";
import promises from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";

assert(
  !process.versions.bun,
  "Transport and worker tests require Node, not Bun's Undici shim",
);
// Install before SDK loading so captured imports still honor the renderer IO guard.
for (const name of [
  "readFile",
  "writeFile",
  "appendFile",
  "open",
  "stat",
  "lstat",
  "access",
  "readdir",
  "opendir",
  "readlink",
]) {
  for (const [target, method] of [
    [fs, name],
    [fs, name + "Sync"],
    [promises, name],
  ]) {
    const original = target[method];
    if (typeof original !== "function") continue;
    target[method] = function (...args) {
      if (state.fileAccess) return state.fileAccess(method);
      return original.apply(this, args);
    };
  }
}
syncBuiltinESMExports();
// Cache the real CJS entry before redirecting Pi's resolved dependency imports.
await import("undici");
const source = new URL("../src/", import.meta.url).href;
const undiciEntry = import.meta.resolve("undici");
registerHooks({
  resolve(specifier, context, next) {
    const transport = new URL("./fixtures/undici.mjs", import.meta.url).href;
    if (
      ["undici", undiciEntry, fileURLToPath(undiciEntry)].includes(specifier) &&
      context.parentURL !== transport
    )
      return { url: transport, shortCircuit: true };
    if (specifier === "unpdf" && process.env.PI_SEARXNG_TEST_PDF === "1")
      return {
        url: new URL("./fixtures/pdf.mjs", import.meta.url).href,
        shortCircuit: true,
      };
    try {
      return next(specifier, context);
    } catch (error) {
      if (
        context.parentURL?.startsWith(source) &&
        specifier.startsWith(".") &&
        !extname(specifier)
      )
        return next(specifier + ".ts", context);
      throw error;
    }
  },
});
