# @blazer2k/pi-tui-tweaks

Compact tool output and configurable styling for [Pi's interactive TUI](https://pi.dev).

**Current version:** 0.1.0

## Overview

This extension adds:

- A compact or enlarged Pi logo at session start, with the version below it. You can also keep Pi's own header or hide the header content.
- Native, compact, or rounded editor styles. The custom styles show the working directory, git branch, model, token usage, and context percentage in their borders.
- A choice of Pi's embedded Working indicator or a separate shimmer label in compact and rounded styles.
- Compact tool output with tree-style lines and clickable paths when your terminal supports them. This also works with eligible third-party tools.
- Optional capitalization of tool headers, enabled by default.

![Example: compact tool output](images/example.webp)

![Example: rounded editor border with working indicator](images/editor.webp)

## Installation

```bash
pi install npm:@blazer2k/pi-tui-tweaks
```

For local development:

```bash
git clone https://github.com/blazer2k/pi-blz.git
cd pi-blz
npm install
pi -e ./packages/pi-tui-tweaks/index.ts
```

The entry point is the package-root `index.ts`. Update any Pi extension paths or enable/disable filters that still reference this package's previous `src/index.ts` entry.

## Settings

Edit `~/.pi/agent/pi-tui-tweaks.json`, then run `/reload` in pi. Changes are loaded at startup or on reload, not when the file is edited. This extension does not add a settings command.

Only the new filename, environment variable, and nested format are supported. The previous `ui-settings.json` is left untouched and ignored; nothing is migrated automatically. Configure the new file before reloading.

The file is created with defaults when the extension loads. Missing keys are filled in, and invalid values fall back to their defaults. Use JSON booleans and numbers, not quoted strings. Use `PI_TUI_TWEAKS_CONFIG_PATH` to choose a different settings file.

For example:

```json
{
  "header": {
    "style": "compact",
    "align": "left"
  },
  "workingIndicator": {
    "style": "native",
    "shimmerColor": "accent",
    "showInterruptHint": true,
    "showDuration": true
  },
  "tools": {
    "enabled": true,
    "enhanceCustomTools": true,
    "capitalizeNames": true,
    "capitalizeMetadata": true,
    "treeCorner": "rounded",
    "indicator": {
      "style": "circle",
      "color": "success"
    },
    "expandedOutputLimit": 20,
    "collapsedOutputDisplay": "preview",
    "showExpansionHint": true
  },
  "editor": {
    "style": "rounded",
    "color": "dim",
    "showThinkingLevel": true,
    "showCacheTokens": false,
    "showCost": true,
    "showBranch": true
  }
}
```

The table uses dotted paths for the nested JSON fields:

| JSON path                            | Default     | Allowed values / purpose                              |
| ------------------------------------ | ----------- | ----------------------------------------------------- |
| `header.style`                       | `"compact"` | `"native"`, `"compact"`, `"large"`, `"off"`           |
| `header.align`                       | `"left"`    | `"left"`, `"center"`; custom headers only             |
| `workingIndicator.style`             | `"shimmer"` | `"native"`, `"shimmer"`; custom editors only          |
| `workingIndicator.shimmerColor`      | `"accent"`  | `"accent"`, `"success"`, `"text"`; shimmer highlight  |
| `workingIndicator.showInterruptHint` | `true`      | Show the interrupt hint; shimmer only                 |
| `workingIndicator.showDuration`      | `true`      | Show elapsed and completion time; shimmer only        |
| `tools.enabled`                      | `true`      | Enable this extension's tool rendering overrides      |
| `tools.enhanceCustomTools`           | `true`      | Compact eligible extension tools, including Codemode  |
| `tools.capitalizeNames`              | `true`      | Capitalize headers drawn by this extension            |
| `tools.capitalizeMetadata`           | `true`      | Use sentence-case labels in generated tool metadata   |
| `tools.treeCorner`                   | `"rounded"` | `"rounded"` (╰), `"square"` (└); closing connector    |
| `tools.indicator.style`              | `"circle"`  | `"dot"`, `"circle"`, `"diamond"`                      |
| `tools.indicator.color`              | `"success"` | `"success"`, `"text"`, `"toolTitle"`                  |
| `tools.expandedOutputLimit`          | `20`        | Any positive integer; `-1` means unlimited            |
| `tools.collapsedOutputDisplay`       | `"preview"` | `"preview"`, `"summary"`                              |
| `tools.showExpansionHint`            | `true`      | Show expand/collapse keybinding hints                 |
| `editor.style`                       | `"rounded"` | `"native"`, `"compact"`, `"rounded"`                  |
| `editor.color`                       | `"dim"`     | `"thinking"`, `"dim"`, `"muted"`; custom editors only |
| `editor.showThinkingLevel`           | `true`      | Show the thinking level in custom editors             |
| `editor.showCacheTokens`             | `false`     | Show cache read/write tokens in custom editors        |
| `editor.showCost`                    | `true`      | Show total session cost in custom editors             |
| `editor.showBranch`                  | `true`      | Show the git branch in custom editors                 |

## Header

| `header.style` | Display                                                                                                 |
| -------------- | ------------------------------------------------------------------------------------------------------- |
| `native`       | Pi's own startup header and hints, as configured in Pi. This extension leaves it untouched.             |
| `compact`      | Native-size logo, four columns wide and two lines tall, with the version below it and no startup hints. |
| `large`        | Enlarged logo, eight columns wide and four lines tall, with the version below it and no startup hints.  |
| `off`          | No header content. Pi's startup warnings and resource notices are unchanged.                            |

Custom headers respect Pi's `quietStartup` setting: `false` and `"header"` show the logo; `true` hides it unless you pass `--verbose`. Our `header.style: "off"` stays hidden even with `--verbose`, and `native` leaves this behavior to Pi.

`header.align` supports `left` and `center`. It applies to `compact` and `large`, including their Apple Terminal fallback. It has no effect in `native` or `off`.

The logo uses Pi's coral, blue, and yellow colors in the terminal's color mode. In Apple Terminal, both custom modes show a colored `Pi` wordmark instead. The version remains below it.

## Editor

| `editor.style` | Display                                                                                                                  |
| -------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `native`       | Pi's untouched editor, native footer, and Working indicator embedded in the upper rule.                                  |
| `compact`      | Two horizontal rules with our metadata, no corners or side borders, and centered `↑ N more` / `↓ N more` scroll notices. |
| `rounded`      | Rounded borders with our metadata and scroll arrows on the right edge.                                                   |

In compact and rounded styles, the working directory and optional branch sit in the upper rule. The lower rule shows the model and optional thinking level on the left, with token usage, optional cost, and context usage on the right. Compact keeps native input layout and places autocomplete below the lower rule.

`editor.color` and the `editor.show*` settings apply only to compact and rounded. The default color is `dim`; `thinking` follows Pi's thinking-level colors. Shell input uses Pi's Bash-mode color. Embedded native Working and compaction indicators use the same color as the border. Retry and branch-summary indicators keep Pi's colors. High context usage retains warning and error colors.

Compact and rounded use a footer for extension status messages. Native leaves both Working and footer status messages to Pi.

## Working indicator

`workingIndicator.style` applies only to compact and rounded editors:

- `shimmer` (default): The current standalone animated "Working" label, with optional elapsed time, interrupt hint, and completion duration. `workingIndicator.showInterruptHint` and `workingIndicator.showDuration` apply only to this style.
- `native`: Pi's own indicator in the top border, with status on the left and directory/branch on the right. Pi manages its animation, lifecycle, retry, compaction, and branch-summary statuses. Narrow layouts shorten metadata or show only the spinner; compact scroll counts remain centered when space allows.

`workingIndicator.shimmerColor` selects the shimmer highlight: `"accent"` (default), `"success"`, or `"text"` from Pi's theme. The muted base, animation, dim duration and interrupt hint stay unchanged. Outside truecolor mode, the label remains static dim text. Native Working indicators ignore this setting.

With `editor.style: "native"`, all `workingIndicator` settings are ignored. Pi's editor and indicator remain untouched. Change styles through the settings file and `/reload`.

## Built-in tool display

Set `tools.enabled` to `false` to leave all tool display to Pi and other extensions. This overrides the other `tools` settings, including Codemode and custom-tool enhancements. Header, editor, and Working indicator settings are unaffected. Apply the change with `/reload`.

The extension changes how read, write, edit, bash, ls, find, and grep look. Pi still runs the original tools and controls their arguments, source information, and availability. Your `defaultTools` setting and CLI options decide which tools are active; this extension does not enable them.

`tools.treeCorner` chooses the closing connector: `"rounded"` (default) draws `╰─`, and `"square"` draws `└─`. Vertical lines, intermediate branches, and omission markers are unchanged. This affects only connectors drawn by this extension, not output text, native/self-owned renderers, or editor borders. Apply changes with `/reload`.

Tool calls and output fit the available terminal width and adjust when you resize it. They follow Pi's `outputPad` setting, including changes made during a session.

`tools.expandedOutputLimit` limits expanded ls/find/grep list items and generic custom-tool text lines. It accepts any positive integer and defaults to `20`; `-1` means unlimited. Lists show the beginning and end with an omission marker between them, with odd limits giving the extra item to the beginning. A limit of `1` shows one beginning item. Generic text shows the first lines. The limit counts logical items or lines, not wrapped screen rows, and does not cap Bash, Read, Write, Edit, Codemode, or expanded errors.

Rename `tools.maxExpandedEntries` to `tools.expandedOutputLimit` in existing settings before reloading to preserve your chosen limit. The old key is ignored; there is no alias or automatic migration.

Unfinished indicators in expanded Bash, Write, and wrapped Codemode blink in fullscreen mode. In regular mode they stay dim and still, avoiding repeated redraws of terminal scrollback. Completed indicators stay still in both modes. These mode rules apply only to expanded calls and work with every editor style.

Running Bash calls show elapsed time. Completed calls use Pi's recorded duration, including when you reopen a session. Older results without a recorded duration show no timing label. Pi's HTML export shows the command and output without a duration label.

## Collapsed Bash and Codemode output

`tools.collapsedOutputDisplay` has two options:

- `preview`: Show up to three output lines. For longer output, show the first line, an omission marker, and the last line. Long lines are shortened to fit the terminal.
- `summary`: Hide ordinary output and show its line count below the tool call.

This setting applies to Codemode while `tools.enhanceCustomTools` is enabled. Failed Codemode scripts still show a short error message in either mode.

## Codemode display

With `tools.enhanceCustomTools` enabled, collapsed Codemode shows a syntax-highlighted script preview and a count of nested tool calls. Below the output, it shows running, failed, and cancelled call counts when available, along with duration, available model-call costs, and hints for expanding the display.

The live timer starts when script execution is observed. Completed calls use Pi's recorded execution duration, including when you reopen a session. Results without a recorded duration show no timing label, even if their output includes a wall-time header.

Expanding Codemode shows Pi's script display, nested-call details, and all returned output, followed by the extension's summary line. Execution timing appears once, in that summary line. `tools.expandedOutputLimit` does not limit Codemode output. Costs can appear both in Pi's nested-call details and in the extension's summary.

Links to full output files remain visible in both preview and summary mode, as do warnings about failed saves. Expanding the display does not read those files or restore output that Pi omitted. Pi handles image display.

## Custom-tool display

A tool-call block is the part of the conversation showing one tool's header, arguments, and output. It can span several terminal lines.

`tools.enhanceCustomTools` controls compact display for eligible extension tools, including Codemode. Turning it off uses their normal display. This setting does not affect the seven built-in tool displays.

Pi checks this setting when it creates or rebuilds a tool-call block. Existing component instances keep their layout and drawing functions. After editing the configuration, run `/reload` so new or rebuilt blocks use the updated settings.

If a custom tool has a working `renderCall()` function, the extension keeps its header wording. If that function is missing or fails, the extension builds a simple header using the tool identifier, such as `web_search`. A separate display label such as "Web Search" is not available through Pi's public renderer API.

Tools that provide their own layout with `renderShell: "self"` keep that layout and their own labels.

## Tool-name capitalization

`tools.capitalizeNames` applies to headers drawn by this extension: Read, Write, Edit, Bash, Ls, Find, Grep, and wrapped Codemode or third-party tools.

It defaults to `true` and capitalizes the first visible character, for example `read` becomes `Read` and `mcp` becomes `Mcp`. Turning it off preserves the original spelling; it does not force lowercase. Tools that draw their own layout keep their own capitalization.

This setting changes only the displayed header. Tool identifiers, arguments, resource tags such as `[skill]`, output text, and Pi's nested-call details stay unchanged.

## Metadata capitalization

`tools.capitalizeMetadata` defaults to `true` and uses sentence case for labels drawn by this extension: `Took`, `Elapsed`, `Truncated`, `Script failed`, and `Model calls`. For example:

```text
╰─ Took 1.2s · Truncated · 42 lines
╰─ 3 calls · 1 failed · Took 1.2s · Model calls $0.02
```

Set it to `false` to preserve the previous metadata spelling. It is independent of `tools.capitalizeNames`. Numeric phrases, units, hints, `(no output)`, arguments, output text, Pi's nested-call details, and self-owned renderers stay unchanged. Apply changes with `/reload`.

## Compatibility with other extensions

Tool display uses Pi's public `registerToolRenderer()` API. The extension does not monkey-patch Pi's methods or prototypes, or replace tool registrations. Pi continues to load its own Codemode extension without replacement warnings or built-in configuration changes.

The extension uses `getAllTools()` to identify built-in tools from their source information. A third-party tool named `codemode` gets ordinary custom-tool treatment. If source information is unavailable, the extension leaves the tool's display unchanged.

Pi checks renderer overrides in extension load order. This extension consults the next renderer in the chain once per tool lookup. If reading tool or renderer information fails, it leaves that renderer unchanged. If a custom renderer fails while drawing, it uses a simple fallback display. Each problem is reported once per tool and failure type until session cleanup.

Each loaded copy of this extension tracks and cleans up its own custom-tool timers.

## Editor and footer compatibility

Pi allows one custom editor and one custom footer at a time. Extensions cannot automatically combine their editors or footers.

In compact and rounded styles, this extension installs a `CustomEditor` subclass. Its footer shows extension-provided status messages. Native does not replace the editor or footer.

On shutdown, it restores the previous editor only if its custom editor is still active. An editor installed later by another extension is left alone. Editor selection follows extension load order, including after `/reload`.

If another extension replaces the footer, Pi disposes this extension's footer. During shutdown, this extension clears the footer only if it still owns it.

## License

MIT
