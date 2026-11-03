import type {
  KeybindingHints,
  Theme,
  ToolRenderResultOptions,
} from "@earendil-works/pi-coding-agent";

export type BaseRenderState = {
  blinkTimer?: { invalidate: () => void };
  hasResult?: boolean;
  truncated?: boolean;
  isError?: boolean;
  expanded?: boolean;
  callExpandable?: boolean;
};

export type ResultStatusState = BaseRenderState & {
  truncated: boolean;
  isError: boolean;
};

export type ListResultConfig = {
  emptyMessage: string;
  singularLabel: string;
  pluralLabel: string;
  preprocess: (text: string) => string[];
};

export type ToolTextResult = {
  content: Array<{ type: string; text?: string }>;
  details?: unknown;
};

export type FormatResultFn = (
  result: ToolTextResult,
  state: ResultStatusState,
  options: ToolRenderResultOptions,
  theme: Theme,
  width: number,
  keyText: KeybindingHints["keyText"],
) => string;

export type BlinkIndicator = {
  unfilled: string;
  filled: string;
};
