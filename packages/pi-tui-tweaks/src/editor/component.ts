import {
  CustomEditor,
  type ExtensionAPI,
  type ExtensionContext,
  type KeybindingsManager,
} from "@earendil-works/pi-coding-agent";
import {
  truncateToWidth,
  type EditorTheme,
  type TUI,
  type TuiMouseEvent,
  type TuiMouseEventResult,
} from "@earendil-works/pi-tui";
import type { Config } from "../config/definition";
import { getConfig } from "../config/store";
import {
  buildCompactTopLine,
  buildCompactBottomLine,
  frameEditorLines,
  type BorderFn,
  type EditorStatusIndicator,
} from "./frame";
import { buildEditorFrameData } from "./status";
import type { SessionUsage } from "./usage";

export class EnhancedEditor extends CustomEditor {
  private nativeStatusIndicator?: EditorStatusIndicator;
  private renderedBorder?: string;
  private compactBottomBorder = "";
  private compactAutocompleteStart?: number;

  constructor(
    tui: TUI,
    theme: EditorTheme,
    kb: KeybindingsManager,
    private readonly ctx: ExtensionContext,
    private readonly pi: ExtensionAPI,
    private readonly getGitBranch: () => string | null,
    private readonly getCurrentUsage: () => SessionUsage,
    private readonly style: Exclude<Config["editor"]["style"], "native">,
    private readonly onStatusIndicator?: (
      indicator: EditorStatusIndicator | undefined,
    ) => void,
  ) {
    super(tui, theme, kb, {
      paddingX: style === "rounded" ? 0 : 1,
      embedWorkingStatus:
        onStatusIndicator !== undefined ||
        getConfig().workingIndicator.style === "native",
    });
  }

  override setWorkingStatusIndicator(
    indicator: EditorStatusIndicator | undefined,
  ): void {
    // Keep Pi's intermediate border plain; we place the status ourselves.
    super.setWorkingStatusIndicator(undefined);
    this.nativeStatusIndicator =
      this.embedWorkingStatus && !this.onStatusIndicator
        ? indicator
        : undefined;
    this.onStatusIndicator?.(indicator);
  }

  private buildFrameData(config: Config) {
    const thinkingLevel = this.pi.getThinkingLevel();
    const supportedLevels = this.ctx.model?.thinkingLevelMap;

    return buildEditorFrameData(
      {
        cwd: this.ctx.cwd,
        modelId: this.ctx.model?.id,
        modelContextWindow: this.ctx.model?.contextWindow,
        modelSupportsReasoning: this.ctx.model?.reasoning === true,
        activeThinkingLevel: thinkingLevel ?? null,
        activeThinkingLevelSupported: Boolean(
          thinkingLevel &&
          supportedLevels &&
          supportedLevels[thinkingLevel] !== null,
        ),
        contextPercent: this.ctx.getContextUsage()?.percent ?? null,
        gitBranch: config.editor.showBranch ? this.getGitBranch() : null,
        usage: this.getCurrentUsage(),
      },
      config,
    );
  }

  private getBorder(config: Config): BorderFn {
    if (this.getText().trim().startsWith("!")) {
      return this.ctx.ui.theme.getBashModeBorderColor();
    }

    const color = config.editor.color;
    if (color === "thinking") {
      return this.ctx.ui.theme.getThinkingBorderColor(
        this.pi.getThinkingLevel() ?? "off",
      );
    }

    return (text: string) => this.ctx.ui.theme.fg(color, text);
  }

  protected override renderTopBorder(
    width: number,
    hiddenLineCount: number,
  ): string {
    if (this.style !== "compact")
      return super.renderTopBorder(width, hiddenLineCount);
    const config = getConfig();
    return buildCompactTopLine(
      width,
      this.buildFrameData(config).cwd,
      this.borderColor,
      hiddenLineCount,
      this.nativeStatusIndicator,
    );
  }

  protected override renderBottomBorder(
    width: number,
    hiddenLineCount: number,
  ): string {
    if (this.style !== "compact")
      return super.renderBottomBorder(width, hiddenLineCount);
    const config = getConfig();
    this.compactBottomBorder = buildCompactBottomLine(
      width,
      this.buildFrameData(config),
      this.ctx.ui.theme,
      this.borderColor,
      hiddenLineCount,
    );
    return this.compactBottomBorder;
  }

  override handleMouse(event: TuiMouseEvent): TuiMouseEventResult | undefined {
    if (
      this.style === "compact" &&
      this.isShowingAutocomplete() &&
      this.compactAutocompleteStart !== undefined &&
      event.y >= this.compactAutocompleteStart
    ) {
      // Pi's mouse coordinates include the bottom rule before the list.
      return super.handleMouse({ ...event, y: event.y + 1 });
    }
    return super.handleMouse(event);
  }

  override render(width: number): string[] {
    const config = getConfig();
    const border = this.getBorder(config);
    const renderedBorder = border("─");
    const borderChanged =
      this.renderedBorder !== renderedBorder ||
      this.borderColor("─") !== renderedBorder;
    this.borderColor = border;
    this.renderedBorder = renderedBorder;
    if (borderChanged) this.nativeStatusIndicator?.invalidate();
    if (this.style === "compact") {
      const lines = super.render(Math.max(1, width));
      this.compactAutocompleteStart = undefined;
      if (this.isShowingAutocomplete()) {
        const bottom = lines.lastIndexOf(this.compactBottomBorder);
        if (bottom > 0 && bottom < lines.length - 1) {
          this.compactAutocompleteStart = bottom;
          lines.push(...lines.splice(bottom, 1));
        }
      }
      return lines.map((line) => truncateToWidth(line, Math.max(0, width), ""));
    }
    const lines = super.render(Math.max(1, width - 2));
    if (lines.length < 2) return lines;

    return frameEditorLines(
      lines,
      width,
      this.buildFrameData(config),
      this.ctx.ui.theme,
      this.borderColor,
      this.nativeStatusIndicator,
    );
  }
}
