# pi-extensions

Monorepo for Pi CLI extensions.

npm workspaces. Clone, `npm install` at the root, that's it.

No build step — packages publish raw `.ts`, Pi loads TypeScript directly.

## Packages

| Package                                     | Install                                   | Description                                                                      |
| ------------------------------------------- | ----------------------------------------- | -------------------------------------------------------------------------------- |
| [`searxng-suite`](packages/searxng-suite)   | `pi install npm:@blazer2k/searxng-suite`  | SearxNG-based web search with category filtering and multi-format URL extraction |
| [`pi-personality`](packages/pi-personality) | `pi install npm:@blazer2k/pi-personality` | Switchable communication styles (Codex-style `/personality` command)             |
| [`pi-tui-tweaks`](packages/pi-tui-tweaks)   | `pi install npm:@blazer2k/pi-tui-tweaks`  | Configurable styling and compact tool rendering for Pi's interactive TUI         |

## License

MIT
