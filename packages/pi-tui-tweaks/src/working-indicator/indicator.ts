import {
  keyText,
  type ExtensionAPI,
  type ExtensionContext,
  type SessionBeforeCompactEvent,
  type Theme,
} from "@earendil-works/pi-coding-agent";
import {
  mixColors,
  styleText,
  Text,
  truncateToWidth,
} from "@earendil-works/pi-tui";
import type { Config } from "../config/definition";
import { getConfig } from "../config/store";
import type { EditorStatusIndicator } from "../editor/frame";

const WIDGET_KEY = "pi-tui-tweaks:working-status";
type CompactionReason = SessionBeforeCompactEvent["reason"];

// 10 FPS - position is wall-clock based, so sweep speed is unchanged;
// this only coarsens sampling to keep long-session frame costs down
const ANIM_INTERVAL_MS = 100;

type WorkingIndicatorAssistantMessage = {
  role: string;
  stopReason?: string;
};

type WorkingIndicatorSession = {
  start(): void;
  noteMessageEnd(message: WorkingIndicatorAssistantMessage | undefined): void;
  noteCompaction(reason: CompactionReason): void;
  setStatusIndicator(indicator: EditorStatusIndicator | undefined): void;
  noteInput(): void;
  pauseForPrompt(): void;
  resumeAfterPrompt(): void;
  settle(): void;
  dispose(): void;
};

type WorkingIndicatorRuntime = {
  current: WorkingIndicatorSession | null;
};

const runtimes = new WeakMap<ExtensionAPI, WorkingIndicatorRuntime>();

function getRuntime(pi: ExtensionAPI): WorkingIndicatorRuntime {
  let runtime = runtimes.get(pi);
  if (runtime) return runtime;

  runtime = { current: null };
  pi.on("agent_start", async () => {
    runtime.current?.start();
  });
  pi.on("message_end", async (event: { message?: unknown }) => {
    runtime.current?.noteMessageEnd(
      event.message as WorkingIndicatorAssistantMessage | undefined,
    );
  });
  pi.on("session_before_compact", async (event) => {
    runtime.current?.noteCompaction(event.reason);
  });
  pi.on("input", async () => {
    runtime.current?.noteInput();
  });
  pi.on("ui_prompt_start", async () => {
    runtime.current?.pauseForPrompt();
  });
  pi.on("ui_prompt_end", async () => {
    runtime.current?.resumeAfterPrompt();
  });
  pi.on("agent_settled", async () => {
    runtime.current?.settle();
  });
  runtimes.set(pi, runtime);
  return runtime;
}

function shimmerText(
  text: string,
  theme: Theme,
  color: Config["workingIndicator"]["shimmerColor"],
): string {
  if (theme.getColorMode() !== "truecolor") return theme.fg("dim", text);

  const { muted, [color]: highlight } = theme.colors;
  const t = Date.now() / 1000;
  const chars = [...text];
  const pad = 10;
  const period = chars.length + pad * 2;
  const sweep = 2.0;
  const pos = ((t % sweep) / sweep) * period;
  const half = 5.0;
  let out = "";

  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i]!;
    const dist = Math.abs(i + pad - pos);
    const intensity =
      dist <= half ? 0.5 * (1 + Math.cos((Math.PI * dist) / half)) : 0;

    out += styleText(
      ch,
      { fg: mixColors(muted, highlight, intensity * 0.9, "srgb") },
      "truecolor",
    );
  }
  return out;
}

export function assembleRunDuration(start: number): string {
  const duration = Date.now() - start;
  const totalSeconds = Math.round(duration / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  const parts: string[] = [];
  if (hours > 0) parts.push(`${hours}h`);
  if (minutes > 0) parts.push(`${minutes}m`);
  parts.push(`${seconds}s`);

  return parts.join(" ");
}

export function registerWorkingIndicator(
  pi: ExtensionAPI,
  ctx: ExtensionContext,
) {
  const runtime = getRuntime(pi);
  let runStartTime = 0;
  let animTimer: ReturnType<typeof setInterval> | null = null;
  let indicator: EditorStatusIndicator | undefined;
  let editorFactory: ReturnType<ExtensionContext["ui"]["getEditorComponent"]>;
  let compactionReason: CompactionReason | undefined;
  let compactionStartedAt = 0;
  let promptStartedAt = 0;
  let requestRender = () => {};
  let widgetOwned = false;
  let disposed = false;
  const compactionText = new Text("", 1, 0);

  ctx.ui.setWidget(
    WIDGET_KEY,
    (tui) => {
      widgetOwned = true;
      requestRender = () => tui.requestRender();
      return {
        render(width) {
          if (!indicator || disposed || width <= 0) return [];
          if (ctx.ui.getEditorComponent() !== editorFactory) {
            stopAnimation();
            return [];
          }
          const compacting =
            indicator.kind === "compaction" && compactionReason !== undefined;
          // The widget container supplies the leading gap; retain the gap below the status.
          return [
            ...(compacting
              ? compactionText.render(width)
              : indicator.render(width).slice(1)),
            "",
          ].map((line) => truncateToWidth(line, width, ""));
        },
        invalidate() {
          if (
            indicator?.kind === "compaction" &&
            compactionReason !== undefined
          )
            compactionText.setText(formatFrame());
          indicator?.invalidate();
        },
        dispose() {
          widgetOwned = false;
          stopAnimation();
          requestRender = () => {};
        },
      };
    },
    { placement: "aboveEditor" },
  );

  function stopAnimation(): void {
    if (animTimer) {
      clearInterval(animTimer);
      animTimer = null;
    }
  }

  function stopIndicator(): void {
    ctx.ui.setWorkingIndicator({ frames: [] });
    ctx.ui.setWorkingMessage("");
    stopAnimation();
  }

  function formatFrame(): string {
    const cfg = getConfig().workingIndicator;
    const compacting =
      indicator?.kind === "compaction" && compactionReason !== undefined;
    const label = compacting
      ? compactionReason === "manual"
        ? "Compacting"
        : "Auto-compacting"
      : "Working";
    const shimmered =
      promptStartedAt > 0
        ? ctx.ui.theme.fg("dim", label)
        : shimmerText(label, ctx.ui.theme, cfg.shimmerColor);
    const startedAt = compacting ? compactionStartedAt : runStartTime;
    const suffixParts: string[] = [];
    if (startedAt > 0 && cfg.showDuration) {
      const paused = promptStartedAt > 0 ? Date.now() - promptStartedAt : 0;
      suffixParts.push(assembleRunDuration(startedAt + paused));
    }
    const interrupt = keyText("app.interrupt");
    if (cfg.showInterruptHint && interrupt)
      suffixParts.push(
        `${interrupt} to ${compacting ? "cancel" : "interrupt"}`,
      );
    const overflow =
      compacting && compactionReason === "overflow"
        ? ctx.ui.theme.fg("dim", "Context overflow detected, ")
        : "";
    return (
      overflow +
      shimmered +
      (suffixParts.length > 0
        ? ctx.ui.theme.fg("dim", ` (${suffixParts.join(" · ")})`)
        : "")
    );
  }

  function renderFrame(): void {
    if (disposed) return;
    if (indicator && ctx.ui.getEditorComponent() !== editorFactory) {
      stopAnimation();
      return;
    }
    if (indicator?.kind === "compaction") {
      compactionText.setText(formatFrame());
    } else {
      ctx.ui.setWorkingIndicator({
        frames: [formatFrame()],
        intervalMs: ANIM_INTERVAL_MS,
      });
    }
    requestRender();
  }

  function startAnimation(): void {
    const compacting =
      indicator?.kind === "compaction" && compactionReason !== undefined;
    const working =
      runStartTime > 0 && (!indicator || indicator.kind === "working");
    if (
      disposed ||
      promptStartedAt > 0 ||
      (indicator && ctx.ui.getEditorComponent() !== editorFactory) ||
      (!compacting && !working)
    ) {
      stopAnimation();
      requestRender();
      return;
    }
    if (working) ctx.ui.setWorkingMessage("");
    renderFrame();
    if (!animTimer) animTimer = setInterval(renderFrame, ANIM_INTERVAL_MS);
  }

  let compactionPending = false;
  let lastStopReason: string | undefined;

  const session: WorkingIndicatorSession = {
    start() {
      // A compaction split continues the same task, so keep the original
      // start time and let the compaction gap count toward the total.
      if (!compactionPending || runStartTime === 0) runStartTime = Date.now();
      compactionPending = false;
      startAnimation();
    },
    noteMessageEnd(message) {
      if (message?.role === "assistant") lastStopReason = message.stopReason;
    },
    noteCompaction(reason) {
      compactionPending = true;
      compactionReason = reason;
      startAnimation();
    },
    setStatusIndicator(next) {
      if (disposed) return;
      if (next !== indicator) {
        if (indicator?.kind === "compaction") {
          compactionReason = undefined;
          compactionStartedAt = 0;
        }
        indicator = next;
        if (next?.kind === "compaction") compactionStartedAt = Date.now();
      }
      editorFactory = ctx.ui.getEditorComponent();
      startAnimation();
    },
    noteInput() {
      // New user input starts a new task: drop task-bound state.
      compactionPending = false;
      promptStartedAt = 0;
      lastStopReason = undefined;
    },
    pauseForPrompt() {
      if (
        (runStartTime === 0 && compactionStartedAt === 0) ||
        promptStartedAt > 0
      )
        return;
      promptStartedAt = Date.now();
      stopIndicator();
      if (indicator?.kind === "compaction" && compactionReason !== undefined) {
        compactionText.setText(formatFrame());
        requestRender();
      }
    },
    resumeAfterPrompt() {
      if (promptStartedAt === 0) return;

      const promptDuration = Math.max(0, Date.now() - promptStartedAt);
      promptStartedAt = 0;
      if (runStartTime > 0) runStartTime += promptDuration;
      if (compactionStartedAt > 0) compactionStartedAt += promptDuration;
      if (runStartTime > 0 || compactionStartedAt > 0) startAnimation();
    },
    settle() {
      // agent_settled fires only when no retry, compaction, or queued
      // continuation will run, so this is the true end of the task.
      const startedAt = runStartTime;
      runStartTime = 0;
      stopIndicator();

      if (
        startedAt > 0 &&
        lastStopReason === "stop" &&
        getConfig().workingIndicator.showDuration
      ) {
        ctx.ui.notify(`Worked for ${assembleRunDuration(startedAt)}`);
      }
      lastStopReason = undefined;
      compactionPending = false;
      promptStartedAt = 0;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      stopAnimation();
      if (runtime.current === session) {
        runtime.current = null;
        ctx.ui.setWorkingMessage();
        ctx.ui.setWorkingIndicator();
      }
      indicator = undefined;
      if (widgetOwned) ctx.ui.setWidget(WIDGET_KEY, undefined);
    },
  };

  runtime.current = session;
  return session;
}
