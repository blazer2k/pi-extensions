import { type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { loadConfig } from "./config/store";
import { registerSearchTool } from "./tools/search";
import { registerFetchTool } from "./tools/fetch";
import { errorMessage } from "./helpers/error";

export default function (pi: ExtensionAPI) {
  const configErrors: unknown[] = [];
  loadConfig((err) => configErrors.push(err));

  pi.on("session_start", (_event, ctx) => {
    for (const err of configErrors.splice(0)) {
      const message = `SearXNG config error: ${errorMessage(err)}`;
      if (ctx.hasUI) ctx.ui.notify(message, "error");
      else console.error(message);
    }
  });

  registerSearchTool(pi);
  registerFetchTool(pi);
}
