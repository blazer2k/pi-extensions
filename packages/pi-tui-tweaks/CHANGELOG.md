# Changelog

The initial `0.1.0` release was published as `@blazer2k/pi-ui-enhancements`.

## [Unreleased]

**Breaking changes**

- Renamed the package to `@blazer2k/pi-tui-tweaks`, the settings file from `ui-settings.json` to `pi-tui-tweaks.json`, and the environment override to `PI_TUI_TWEAKS_CONFIG_PATH`.
- Replaced flat settings with nested `header`, `workingIndicator`, `tools`, and `editor` sections. `maxExpandedEntries` is now `tools.expandedOutputLimit`. Old keys and files are ignored; settings are not migrated automatically.
- Moved the extension entry point from `src/index.ts` to package-root `index.ts`. Local extension paths and filters need updating.
- Removed the in-session settings menu. Edit the JSON file and use Pi's `/reload`; configuration loads only at startup and on reload.

**Added**

- Native and compact editor styles alongside the rounded editor, with style-specific metadata and scroll indicators.
- A choice of native or shimmer Working indicators, with configurable `accent`, `success`, or `text` shimmer highlights.
- Shimmer `Compacting` and `Auto-compacting` indicators with separate elapsed-time clocks, shared display settings, and cancellation hints that follow Pi's keybindings.
- A tool-rendering master switch, configurable status-indicator shapes and colors, and square or rounded closing tree connectors.
- Native Codemode enhancements with script previews, nested-call details, recorded timing, and available model-call costs. Expanded output retains Pi's images and full-output links.
- Tool-name capitalization for built-in tools and a separate setting for generated metadata capitalization.

**Changed**

- Replaced figlet headers with `native`, `compact`, `large`, and `off` logo styles. Custom headers follow Pi's `quietStartup` setting and `--verbose` flag.
- Tool rendering uses Pi's public `registerToolRenderer()` API instead of replacing tools or patching Pi's prototypes. Pi retains control of tool activation, execution, and model-facing results.
- Tool output wraps to the available viewport width instead of a configured maximum width.
- Expanded list and generic custom-tool output limits accept any positive integer or `-1` for unlimited output, with a default of `20`.
- Collapsed Bash and Codemode output supports preview and summary modes. Previews show up to three lines; expanded Write output shows the full written content.
- Active expanded tool indicators blink in fullscreen mode and remain static in regular mode.
- Updated editor and renderer integrations for Pi releases through `1.4.0`.
- Reworked the README with screenshots and an animated demo. Documentation media stays in the repository and is excluded from the npm package.

**Fixed**

- Compact editor autocomplete stays above the bottom rule, with mouse selection aligned to the displayed suggestions.
- Preserved ANSI colors, tree prefixes, and blank lines when wrapping and truncating tool output.
- Completed Bash and Codemode calls use Pi's recorded durations, including when reopening sessions.
- Working duration includes automatic compaction and excludes time spent waiting for UI prompts.
- Corrected session token and cost totals, including standalone runs and refreshes after branch navigation.
- Read line ranges handle numeric strings and null values using Pi's native formatting helper.
- Embedded native Working and compaction indicators follow the editor border color.

## [0.1.0] - 2026-06-29

**Added**

- Configurable ASCII headers using figlet and bundled Greek Pi fonts, with color, alignment, and version display options.
- A rounded editor showing the working directory, Git branch, model, token usage, cost, and context usage.
- A shimmer Working label with elapsed time, an interrupt hint, and a completion-duration notification.
- Compact tree-style rendering for Read, Write, Edit, Bash, Ls, Find, Grep, and eligible third-party tools, with expandable results and clickable paths.
- A `/ui` settings menu, persistent JSON configuration, and the `PI_UI_ENHANCEMENTS_CONFIG_PATH` override.
- Optional capitalization of custom-tool labels.

[Unreleased]: https://github.com/blazer2k/pi-extensions/compare/a214f3c1c365f2f5b5775f73ac9937abbf5b9d3c...HEAD
[0.1.0]: https://github.com/blazer2k/pi-extensions/tree/a214f3c1c365f2f5b5775f73ac9937abbf5b9d3c/packages/pi-ui-enhancements
