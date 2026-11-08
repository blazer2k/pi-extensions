import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { test } from "node:test";
import { mkdtemp, readFile, symlink } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { state } from "./no-network.mjs";
import { tools, context, text } from "./helpers.mjs";

const exec = promisify(execFile);
test(
  "offline npm payload excludes tests and packed relative worker loads/reloads like source",
  { timeout: 30000 },
  async () => {
    const pkg = new URL("../", import.meta.url);
    const manifest = JSON.parse(
      await readFile(new URL("package.json", pkg), "utf8"),
    );
    const work = await mkdtemp(join(process.env.TMPDIR, "package-"));
    const { stdout } = await exec(
      "npm",
      [
        "pack",
        `--workspace=${manifest.name}`,
        "--offline",
        "--ignore-scripts",
        "--json",
        "--pack-destination",
        work,
      ],
      { cwd: fileURLToPath(pkg) },
    );
    const metadata = JSON.parse(stdout);
    const packed = Array.isArray(metadata)
      ? metadata[0]
      : metadata[manifest.name];
    assert.equal(packed.name, manifest.name);
    assert.equal(packed.version, manifest.version);
    const paths = packed.files.map((item) => item.path);
    assert(paths.includes("src/extractors/pdf-worker.mjs"));
    assert(paths.includes("src/index.ts"));
    assert(
      paths.every(
        (path) =>
          !/(?:^|\/)(?:test|fixtures|node_modules)(?:\/|$)|DO-NOT-COMMIT|\.test\./.test(
            path,
          ),
      ),
    );
    await exec("tar", ["-xf", join(work, packed.filename), "-C", work]);
    await symlink(
      fileURLToPath(new URL("../../../node_modules/", import.meta.url)),
      join(work, "node_modules"),
      "dir",
    );
    for (const path of paths)
      assert.deepEqual(
        await readFile(join(work, "package", path)),
        await readFile(new URL(path, pkg)),
        `source/packed bytes: ${path}`,
      );
    const entries = [
      new URL(manifest.pi.extensions[0], pkg),
      pathToFileURL(join(work, "package", manifest.pi.extensions[0])),
    ];
    const snapshots = [];
    for (const entry of entries) {
      const registered = await tools({}, entry);
      assert.equal(registered.fetch.label, "web fetch");
      assert.equal(registered.search.label, "web search");
      const bytes = await readFile(
        new URL("./fixtures/readable.pdf", import.meta.url),
      );
      state.fetch = async () =>
        new Response(bytes, { headers: { "Content-Type": "application/pdf" } });
      const pdf = await registered.fetch.execute(
        "packed-worker",
        { url: "https://example.org/pdf" },
        undefined,
        undefined,
        context(),
      );
      assert.equal(pdf.details.status, "success");
      assert.match(text(pdf), /OFFLINE_PDF_FIXTURE/);
      assert.deepEqual(await readFile(pdf.details.originalPdfPath), bytes);
      const raw =
        '{"number":900719925474099312345,"body":"' + "x".repeat(60000) + '"}\n';
      state.fetch = async () =>
        new Response(raw, { headers: { "Content-Type": "application/json" } });
      const json = await registered.fetch.execute(
        "packed-json",
        { url: "https://example.org/json" },
        undefined,
        undefined,
        context(),
      );
      assert.equal(json.details.status, "success");
      assert.equal(await readFile(json.details.fullOutputPath, "utf8"), raw);
      await registered.reload();
      assert.deepEqual(await readFile(pdf.details.originalPdfPath), bytes);
      assert.equal(await readFile(json.details.fullOutputPath, "utf8"), raw);
      snapshots.push({
        pages: pdf.details.pdfPages,
        pdfLines: pdf.details.textLines,
        pdfBytes: pdf.details.textBytes,
        jsonLines: json.details.textLines,
        jsonBytes: json.details.textBytes,
      });
    }
    assert.deepEqual(snapshots[0], snapshots[1]);
    state.fetch = undefined;
  },
);
