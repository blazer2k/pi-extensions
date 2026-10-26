# @blazer2k/searxng-suite

SearXNG-based web search with category filtering and multi-format URL extraction for [pi](https://pi.dev).

**Current version:** 0.2.3 · [Changelog](CHANGELOG.md)

## Overview

This extension provides two LLM-callable tools:

- **`web_search`:** Search the web via your SearXNG instance with configurable result limits, timeouts, and SafeSearch.
- **`web_extract`:** Extract content from any URL, supporting multiple formats:

| Format     | Output                                                                              |
| ---------- | ----------------------------------------------------------------------------------- |
| HTML       | Denoised, converted to Markdown with metadata (title, author, date, description)    |
| Plain text | Raw text with source info                                                           |
| PDF        | Text extracted per page with headers and separators (text-native PDFs only, no OCR) |
| Images     | Attached with metadata (format, size)                                               |

![Example: searching and extracting university admission info](images/example.webp)

## Requirements

- **Node.js 22.19.0+** (extensions run via jiti)
- A running [SearXNG](https://searxng.org) instance (local or remote)

## Installation

```bash
pi install npm:@blazer2k/searxng-suite
```

Or install locally for development:

```bash
git clone https://github.com/blazer2k/pi-extensions.git
cd pi-extensions
npm install
pi -e ./packages/searxng-suite/src/index.ts
```

## Configuration

### Environment Variables

| Variable          | Default                 | Description                              |
| ----------------- | ----------------------- | ---------------------------------------- |
| `SEARXNG_URL`     | `http://localhost:8888` | Base URL of your SearXNG instance        |
| `SEARXNG_API_KEY` | _(none)_                | Bearer token for authenticated instances |

These must be available to the process running pi – set them in your shell profile, systemd service, or however you launch pi.

## Settings

Edit `pi-searxng.json` inside Pi's agent directory, usually `~/.pi/agent/pi-searxng.json`, then run `/reload`. The directory follows `PI_CODING_AGENT_DIR`; `PI_SEARXNG_CONFIG_PATH` selects a different settings file. The file and its parent directory are created if missing.

```json
{
  "maxResults": 10,
  "agentCanLimitResults": false,
  "timeoutMs": 15000,
  "safesearch": 0,
  "agentCanPickCategory": false,
  "allowPrivateUrls": false,
  "verbose": false
}
```

| Setting                | Default | Meaning                                                                                                                   |
| ---------------------- | ------- | ------------------------------------------------------------------------------------------------------------------------- |
| `maxResults`           | `10`    | Maximum results to return. Any integer >= 1, without a hard-coded upper bound.                                            |
| `agentCanLimitResults` | `false` | Let the agent request fewer results through the optional `maxResults` tool argument, from 1 up to the configured maximum. |
| `timeoutMs`            | `15000` | Request timeout in milliseconds, from 1000 to 120000.                                                                     |
| `safesearch`           | `0`     | SafeSearch: 0 (off), 1 (moderate), or 2 (strict).                                                                         |
| `agentCanPickCategory` | `false` | Let the agent choose one of the supported search categories.                                                              |
| `allowPrivateUrls`     | `false` | Permit local/private destinations for `web_extract`.                                                                      |
| `verbose`              | `false` | Show result text instead of the compact summary.                                                                          |

All settings take effect at startup or `/reload`, including the tool schemas. Increasing `maxResults` only retains more results from one SearXNG response; it does not add pagination.

Missing or invalid settings get their defaults individually, valid values are preserved, and unknown keys are removed. Boolean and numeric values are not coerced from strings. Read, parse, and write errors are reported; a file that cannot be read or parsed is not overwritten, and a normalization write failure does not discard valid loaded settings.

`/search-config` is no longer registered. The old `pi-searxng-suite.json` file is left untouched and is not read or migrated. Old setting names are not aliases for the new names.

## Search Categories

Category picking is off by default (`agentCanPickCategory: false`), so searches omit the category parameter. Valid preferences in the selected settings file are preserved. Enable it if you want specialized searches and your instance has working engines in these categories:

| Category  | Use case                       |
| --------- | ------------------------------ |
| `general` | General web search             |
| `news`    | News articles                  |
| `science` | Scientific papers and articles |
| `videos`  | Video search                   |

When enabled, the agent receives the category choices in the tool schema.

## Security

`web_extract` sends requests from the machine running Pi. An untrusted website could redirect a request to a local service, or try to trick the agent into reading private data and sending it elsewhere. The default block limits that access. It does not sandbox Pi's other tools.

- `web_extract` blocks local/private IPv4 and IPv6 destinations by default, including hostname lookups and redirects. Non-public, reserved, and IPv4 translation/tunnel ranges are also blocked conservatively.
- Every redirect is checked, with at most 20 redirects. The checked DNS addresses are passed directly to the connection; HTML links use the final page URL.
- `allowPrivateUrls: true` permits local/private destinations for `web_extract`. Local SearXNG instances remain supported independently of this setting.
- Content size limits prevent oversized downloads (2 MB HTML, 1 MB text, 50 MB PDF/images).
- All search and extract results are flagged as untrusted content in the LLM context.

Sizes follow Pi's 1024-based convention: 1 KB = 1024 bytes and 1 MB = 1,048,576 bytes. Displays use Pi's `KB`/`MB` labels and formatter.

## License

MIT – see [LICENSE](LICENSE)
