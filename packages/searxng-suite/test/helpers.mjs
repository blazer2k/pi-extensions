import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import {
  DefaultResourceLoader,
  SettingsManager,
} from "@earendil-works/pi-coding-agent";

export const text = (result) =>
  result.content
    .filter((item) => item.type === "text")
    .map((item) => item.text)
    .join("\n\n");
export const context = (id = randomUUID()) => ({
  sessionManager: { getSessionId: () => id },
});
export async function tools(
  config = {},
  entry = new URL("../src/index.ts", import.meta.url),
  extra = [],
) {
  await writeFile(process.env.PI_SEARXNG_CONFIG_PATH, JSON.stringify(config));
  const loader = new DefaultResourceLoader({
    cwd: process.cwd(),
    agentDir: process.env.PI_CODING_AGENT_DIR,
    settingsManager: SettingsManager.inMemory({ packages: [], extensions: [] }),
    additionalExtensionPaths: [fileURLToPath(entry), ...extra],
    noExtensions: true,
    noSkills: true,
    noPromptTemplates: true,
    noThemes: true,
    noContextFiles: true,
  });
  const reload = async () => {
    await loader.reload();
    const loaded = loader.getExtensions();
    assert.deepEqual(loaded.errors, []);
    const extension = loaded.extensions.find((item) =>
      item.tools.has("web_fetch"),
    );
    assert(extension);
    assert.deepEqual([...extension.tools.keys()].sort(), [
      "web_fetch",
      "web_search",
    ]);
    return {
      fetch: extension.tools.get("web_fetch").definition,
      search: extension.tools.get("web_search").definition,
    };
  };
  return { loader, reload, ...(await reload()) };
}
