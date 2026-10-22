import type {
  ExtensionAPI,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import type { Handle } from "../shared/handle";
import { getConfig } from "../config/store";
import { EnhancedEditor } from "./component";
import { formatStatusLine, type EditorStatusIndicator } from "./frame";
import { getTotalUsage } from "./usage";

type EditorRuntime = {
  invalidateUsage: (() => void) | null;
};

const runtimes = new WeakMap<ExtensionAPI, EditorRuntime>();

function getRuntime(pi: ExtensionAPI): EditorRuntime {
  const existing = runtimes.get(pi);
  if (existing) return existing;

  const runtime: EditorRuntime = { invalidateUsage: null };
  const invalidateUsage = async () => runtime.invalidateUsage?.();
  pi.on("agent_end", invalidateUsage);
  pi.on("session_compact", invalidateUsage);
  pi.on("session_tree", invalidateUsage);
  runtimes.set(pi, runtime);
  return runtime;
}

export function registerEditor(
  pi: ExtensionAPI,
  ctx: ExtensionContext,
  onStatusIndicator?: (indicator: EditorStatusIndicator | undefined) => void,
): Handle {
  const style = getConfig().editor.style;
  if (style === "native") return { dispose() {} };

  const runtime = getRuntime(pi);
  let getGitBranch: () => string | null = () => null;
  let requestRender: (() => void) | null = null;
  let footerOwned = false;
  let disposed = false;
  let cachedUsage = getTotalUsage(ctx);

  const invalidateUsage = () => {
    cachedUsage = getTotalUsage(ctx);
    requestRender?.();
  };
  runtime.invalidateUsage = invalidateUsage;

  // The editor already displays model, context, cost, cwd, and branch data;
  // keep only extension-owned statuses in the footer.
  ctx.ui.setFooter((tui, theme, footerData) => {
    footerOwned = true;
    requestRender = () => tui.requestRender();
    getGitBranch = () => footerData.getGitBranch();
    const statuses = footerData.getExtensionStatuses();
    const disposeBranchChange = footerData.onBranchChange?.(() =>
      tui.requestRender(),
    );

    return {
      render: (width: number) => formatStatusLine(statuses, width, theme),
      invalidate() {},
      dispose() {
        footerOwned = false;
        disposeBranchChange?.();
      },
    };
  });

  const previousEditorFactory = ctx.ui.getEditorComponent();
  const editorFactory: NonNullable<
    ReturnType<ExtensionContext["ui"]["getEditorComponent"]>
  > = (tui, theme, keybindings) => {
    requestRender = () => tui.requestRender();
    return new EnhancedEditor(
      tui,
      theme,
      keybindings,
      ctx,
      pi,
      () => getGitBranch(),
      () => cachedUsage,
      style,
      onStatusIndicator,
    );
  };

  ctx.ui.setEditorComponent(editorFactory);

  return {
    dispose() {
      if (disposed) return;
      disposed = true;
      if (runtime.invalidateUsage === invalidateUsage) {
        runtime.invalidateUsage = null;
      }
      requestRender = null;
      if (ctx.ui.getEditorComponent() === editorFactory) {
        ctx.ui.setEditorComponent(previousEditorFactory);
      }
      if (footerOwned) {
        footerOwned = false;
        ctx.ui.setFooter(undefined);
      }
    },
  };
}
