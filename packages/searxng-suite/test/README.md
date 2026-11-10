# Offline tests

Install the repository's declared development dependencies before running tests. From the repository root:

```bash
npm test
npm test --workspace=@blazer2k/searxng-suite
npm run check
npm run format:check
```

The first command includes the unchanged TUI Tweaks suite. The workspace command runs SearXNG only; `npm test` from `packages/searxng-suite` does the same. Neither test command installs dependencies or contacts a live service/model. They run with the Node executable that launches the runner and the existing Bun development dependency.

## Isolation and runners

`run.mjs` owns a private temporary root with isolated HOME, agent directory, configuration and working directory. Child environments contain PATH and explicit test values, not inherited search/model credentials or personal config overrides. The runner removes its root on completion/failure, forwards interruption and limits each child process to 60 seconds.

Existing `.test.ts` unit/rendering cases run on Bun. `.test.mjs` transport, filesystem, worker and native-loader cases run in separate real Node processes using `node:test` and `node:assert/strict`. Direct helpers use Node's built-in type stripping plus a test-only relative `.ts` resolver; registered tools load through Pi's public `DefaultResourceLoader`. No build, transpiler or loader dependency is added.

Each Node test file is a direct entrypoint rather than a `node --test` child. On the validated Node 24.21.0 installation, the test CLI expanded `process.execArgv` with worker-incompatible defaults. Direct entrypoints keep those flags out of the production PDF worker. The setup preloads the real CommonJS Undici entry before redirecting Pi's resolved dependency imports; this avoids the require/ESM cycle reproduced on Node 22.19.0.

The runner is fail-fast: a failed Bun stage skips Node files, and a failed Node file skips later files. Positional arguments are internal additional Bun suite paths, not arbitrary Bun CLI flags.

## Guards and fixtures

HTTP and callback DNS responses are controlled fixtures. Connector tests use actual Node Undici and its HTTP/HTTPS connector factories with in-memory duplex sockets; they do not perform a real TLS handshake. Other TCP/TLS connections and listeners are blocked. Promise/callback DNS resolve/reverse APIs and Resolver instances are guarded. Guard tests verify function identity before invocation so a missing guard cannot turn into a live DNS query. These are API-level guards, not an OS sandbox.

Filesystem wrappers installed before SDK loading support a render-only gate. Tests count and block file access while rendering, including cached imports and failures caught by a renderer. Ordinary test setup/execution still uses real private files. A generated sentinel search key is checked separately against fetch headers, returned metadata and retained artifacts; documents are not redacted.

PDF tests distinguish actual unpdf conversion from synthetic worker scheduling/failure/stall scenarios. Exit counts are captured immediately when execution resolves, before artifact IO. A separate test withholds the termination promise to verify that the API awaits it. See [fixture provenance and regeneration](fixtures/README.md).

The packaging check creates and extracts an offline npm tarball, compares every shipped file with source, excludes tests, fixtures and media, and exercises the extracted entry and relative worker with already-installed dependencies. It does not install packages or publish anything.

## Validating changes

Run the root suite and type/format checks after edits. Transport and workers must be checked on Node; Bun's Undici shim is not a substitute. Minimum-runtime validation uses a separately obtained Node 22.19.0 installation, not an automatic download by these scripts.

For regression-test changes, also verify that a deliberately broken implementation fails the named test. Use a disposable package copy, keep network guards active, restore the copy afterward and never mutate production source in the working tree. Worker termination, request-count, migration-path, renderer IO, credential-file, UTF-8 boundary and resolver-order regressions have been checked this way on Node 22.19.0 and 24.21.0. A green suite alone does not establish that a new assertion detects its intended regression.
