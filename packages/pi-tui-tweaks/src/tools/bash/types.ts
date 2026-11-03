import type { Theme } from "@earendil-works/pi-coding-agent";
import type { BaseRenderState } from "../rendering/types";

export type BashRenderState = BaseRenderState & {
  callHighlightCache?: {
    source: string;
    colors: Theme["colors"];
    expandedCommand?: string;
    collapsedCommand?: string;
  };
  startedAt?: number;
  durationTimer?: ReturnType<typeof setInterval>;
  durationMs?: number;
  resultExpandable?: boolean;
};
