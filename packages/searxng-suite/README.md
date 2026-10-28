# @blazer2k/searxng-suite

SearXNG-based web search with category filtering and multi-format URL extraction for [pi](https://pi.dev).

**Current version:** 0.2.3 · [Changelog](CHANGELOG.md)

## Overview

This extension provides two LLM-callable tools:

- **`web_search`:** Search the web via your SearXNG instance with configurable result limits, timeouts, and SafeSearch.
- **`web_extract`:** Extract content from any URL, supporting multiple formats:

| Format     | Output                                                                           |
| ---------- | -------------------------------------------------------------------------------- |
| HTML       | Denoised, converted to Markdown with metadata (title, author, date, description) |
| Plain text | Raw text with source info                                                        |
| JSON       | Original JSON text with separate source info (`application/json`)                |
| PDF        | Original PDF saved unchanged; text per page when available (no OCR)              |
| Images     | Attached with metadata (format, size)                                            |

JSON is validated as UTF-8 without re-serializing it. One leading UTF-8 BOM is removed; otherwise the original text, whitespace, escapes, keys, and number spellings are preserved. Source and final URLs are separate from the JSON payload.

JSON's download limit is 1 MB, including any BOM. Charset parameters are accepted, but the body must be UTF-8.

![Example: searching and extracting university admission info](images/example.webp)

## Extracted output files

Text fitting Pi's inline limits is returned in full: at most 2,000 lines and 50 KB (51,200 UTF-8 bytes), including source info. Small outputs do not create saved text files; PDFs always keep their original file. Images remain native attachments.

Oversized text is saved completely before returning a limited preview and the actual absolute path. Files use private session folders in the operating system's temporary directory, with a unique directory per extraction: `content.md` for HTML-derived Markdown, `content.txt` for text/PDF text, and `content.json` for JSON. Saved JSON contains only the unchanged decoded payload, without source headers or notices. A single line too large for the preview may produce no text preview; the file still contains the complete output.

Use available file tools to read or search these paths. Line-based reading cannot split a single huge JSON line. Completed files survive `/reload` while they exist, but OS temporary storage is not a permanent archive. There is no catalog, automatic refetch, or compaction recovery. If saving fails, the tool reports a native error and any available bounded preview, without claiming a saved file.

Every PDF that finishes downloading within the current 50-MB limit is saved unchanged as `original.pdf` before text conversion. Its absolute path is returned even when extracted text is short, empty, or conversion fails. Oversized text uses `content.txt` in the same directory; short text needs no separate text file. A required original-save failure is reported as an error and conversion does not start.

No readable text does not prove that a PDF is empty or scanned. The retained original can be inspected using available PDF, OCR, or visual-processing tools/skills, but this extension does not run an OCR or vision pipeline.

Larger configurable resource budgets are not implemented yet. Existing download and input-character limits still apply; saved text is the complete accepted extraction, not an unlimited download or an unchanged copy of HTML/PDF bytes. Only the separately saved original PDF is a byte-for-byte copy of its downloaded body.

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
- Content size limits prevent oversized downloads (2 MB HTML, 1 MB text/JSON, 50 MB PDF/images).
- All search and extract results are flagged as untrusted content in the LLM context, including saved extraction files read later.

Sizes follow Pi's 1024-based convention: 1 KB = 1024 bytes and 1 MB = 1,048,576 bytes. Displays use Pi's `KB`/`MB` labels and formatter.

## License

MIT – see [LICENSE](LICENSE)
