import { spawn } from "node:child_process";
import { mkdtemp, mkdir, readdir, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { fileURLToPath } from "node:url";

const tests = fileURLToPath(new URL("./", import.meta.url));
const extraUnits = process.argv.slice(2).map((path) => resolve(path));
const root = await mkdtemp(join(tmpdir(), "pi-tests-"));
try {
  for (const name of ["home", "agent"]) await mkdir(join(root, name));
  const home = await realpath(join(root, "home"));
  const cwd = join(home, "cwd");
  await mkdir(cwd);
  // Do not pass inherited credentials or personal config overrides to tests.
  const env = {
    PATH: process.env.PATH,
    TERM: "xterm-256color",
    HOME: home,
    TMPDIR: root,
    PI_CODING_AGENT_DIR: join(root, "agent"),
    PI_SEARXNG_CONFIG_PATH: join(root, "search.json"),
    PI_TUI_TWEAKS_CONFIG_PATH: join(root, "tui.json"),
    PI_SEARXNG_TEST_ROOT: root,
    SEARXNG_URL: "http://searxng.invalid",
    SEARXNG_API_KEY: "offline-test-key",
    NODE_ENV: "test",
    FORCE_COLOR: "1",
    NODE_OPTIONS: `--import=${new URL("./no-network.mjs", import.meta.url).href}`,
    NPM_CONFIG_USERCONFIG: join(root, "home", ".npmrc"),
    npm_config_userconfig: join(root, "home", ".npmrc"),
    npm_config_update_notifier: "false",
  };
  const run = (command, args) =>
    new Promise((done, reject) => {
      const child = spawn(command, args, {
        cwd,
        env,
        stdio: "inherit",
        timeout: 60000,
      });
      const interrupt = () => child.kill("SIGTERM");
      process.once("SIGINT", interrupt);
      process.once("SIGTERM", interrupt);
      const unlisten = () => {
        process.removeListener("SIGINT", interrupt);
        process.removeListener("SIGTERM", interrupt);
      };
      child.once("error", (error) => {
        unlisten();
        reject(error);
      });
      child.once("exit", (code) => {
        unlisten();
        done(code ?? 1);
      });
    });
  const files = (await readdir(tests)).sort();
  let status = await run("bun", [
    "test",
    "--preload",
    join(tests, "no-network.mjs"),
    ...extraUnits,
    ...files
      .filter((name) => name.endsWith(".test.ts"))
      .map((name) => join(tests, name)),
  ]);
  // Direct entrypoints keep Node's test-CLI flags out of production PDF workers.
  for (const name of files.filter((name) => name.endsWith(".test.mjs"))) {
    if (status !== 0) break;
    status = await run(process.execPath, [
      "--import",
      join(tests, "setup.mjs"),
      join(tests, name),
    ]);
  }
  process.exitCode = status;
} finally {
  await rm(root, { recursive: true, force: true });
}
