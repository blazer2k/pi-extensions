import { normalizeOutput } from "../rendering/text";
import type { BashToolDetails } from "@earendil-works/pi-coding-agent";

const BASH_STATUS_PATTERN =
  /^(?:Command exited with code \d+|Command terminated without an exit code|Command timed out after .+ seconds(?:\. The shell exited .+)?|Command aborted)$/;

export function parseBashErrorText(text: string): {
  output: string;
  status?: string;
} {
  const normalized = normalizeOutput(text).replace(
    /^\(no output\)\n\n(?=Command (?:exited|terminated|timed out|aborted))/,
    "",
  );
  const lines = normalized.split("\n");
  const lastLine = lines.at(-1) ?? "";

  if (!BASH_STATUS_PATTERN.test(lastLine)) return { output: normalized };

  const output = lines.slice(0, -1).join("\n").trimEnd();
  return {
    output: output === "(no output)" ? "" : output,
    status: lastLine,
  };
}

export function stripBashTruncationNotice(
  text: string,
  details: BashToolDetails | undefined,
): string {
  if (!details?.truncation?.truncated && !details?.fullOutputPath) return text;

  const normalized = normalizeOutput(text);
  const footerStart = normalized.lastIndexOf("\n\n[");
  if (footerStart === -1 || !normalized.endsWith("]")) return text;

  const footer = normalized.slice(footerStart);
  if (details.fullOutputPath && !footer.includes(details.fullOutputPath)) {
    return text;
  }
  if (!details.fullOutputPath && !footer.includes("Showing lines")) return text;

  return normalized.slice(0, footerStart).trimEnd();
}
