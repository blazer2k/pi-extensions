import { describe, expect, it } from "bun:test";
import { mkTheme, setTestConfig } from "../../testing/helpers";
import { getConfig } from "../../config/store";
import { getExpandedOutputLimit } from "../rendering/state";
import type { BaseRenderState } from "../rendering/types";
import { buildGenericResult } from "./result";

const theme = mkTheme();

function render(
  text: string,
  state: BaseRenderState = {},
  expanded = false,
): string {
  return buildGenericResult(
    { content: [{ type: "text", text }], details: undefined },
    state,
    { expanded, isPartial: false },
    theme,
    80,
  );
}

describe("buildGenericResult", () => {
  it("renders empty and truncated metadata together", () => {
    expect(render("", { truncated: true })).toBe("╰─ Truncated · (no output)");
  });

  it("summarizes collapsed output", () => {
    expect(render("one\ntwo")).toBe("╰─ 2 lines");
  });

  it("renders expanded output as a closed tree", () => {
    expect(render("one\ntwo", {}, true)).toBe("├─ 2 lines\n│  one\n╰─ two");
  });

  it("uses arbitrary limits for first-lines output and keeps -1 unlimited", () => {
    const previous = getConfig().tools.expandedOutputLimit;
    const items = Array.from({ length: 9 }, (_, index) => `line ${index + 1}`);
    const text = items.join("\n");
    try {
      for (const limit of [1, 3, 7, 25, -1]) {
        setTestConfig({ tools: { expandedOutputLimit: limit } });
        const visible = items.slice(0, limit === -1 ? items.length : limit);
        const output = render(text, {}, true);
        const rows = output.split("\n");
        expect(
          rows
            .filter(
              (row) => row.startsWith("│  ") || row.startsWith("╰─ line "),
            )
            .map((row) => row.slice(3)),
        ).toEqual(visible);
        const remaining = items.length - visible.length;
        if (remaining) expect(rows.at(-1)).toBe(`╰─ ${remaining} more lines`);
        else expect(rows.at(-1)).toBe("╰─ line 9");
        expect(render(text)).toBe("╰─ 9 lines");
      }
    } finally {
      setTestConfig({ tools: { expandedOutputLimit: previous } });
    }
  });

  it("limits expanded output using expandedOutputLimit", () => {
    const limit = getExpandedOutputLimit();
    const total = limit + 2;
    const text = Array.from(
      { length: total },
      (_, index) => `line ${index + 1}`,
    ).join("\n");
    const output = render(text, {}, true);

    expect(output).toContain(`├─ ${total} lines`);
    expect(output).toContain(`│  line ${limit}`);
    expect(output).not.toContain(`line ${limit + 1}`);
    expect(output).toContain("╰─ 2 more lines");
  });
});
