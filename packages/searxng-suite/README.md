# @blazer2k/searxng-suite

SearXNG-based web search with category filtering and multi-format URL extraction for [pi](https://pi.dev).

**Current version:** 0.2.3 · [Changelog](CHANGELOG.md)

## Overview

This extension provides two LLM-callable tools:

- **`web_search`:** Search the web via your SearXNG instance with configurable result limits, timeouts, and SafeSearch.
- **`web_fetch`:** Fetch content from a URL, supporting multiple formats:

| Format     | Output                                                                           |
| ---------- | -------------------------------------------------------------------------------- |
| HTML       | Denoised, converted to Markdown with metadata (title, author, date, description) |
| Plain text | Raw text with source info                                                        |
| JSON       | Original JSON text with separate source info (`application/json`)                |
| PDF        | Original PDF saved unchanged; text per page when available (no OCR)              |
| Images     | Attached with metadata (format, size)                                            |

The tools render as `web search` and `web fetch`. TUI Tweaks controls optional capitalization; its default displays `Web search` and `Web fetch`. `web_fetch` replaces `web_extract`; the old identifier is not registered as an alias.

JSON is validated as UTF-8 without re-serializing it. One leading UTF-8 BOM is removed; otherwise the original text, whitespace, escapes, keys, and number spellings are preserved. Source and final URLs are separate from the JSON payload.

JSON uses the shared `maxContentBytes` download limit, including any BOM. Charset parameters are accepted, but the body must be UTF-8. An oversized or invalid JSON response fails without saving a partial JSON document.

![Example: searching and extracting university admission info](images/example.webp)

## Tool display

Both tools use Pi's normal expansion shortcut (`Ctrl+O` by default, or your configured binding). Dim `to expand` / `to collapse` hints show the active binding when details are available, including on failed fetches. Collapsed search shows only the result count alongside its hint; expanded search shows all returned entries and diagnostics. The fetch preview setting does not limit search. Hints are UI metadata outside the fetch content-line budget.

Fetch text summaries show measured lines and UTF-8 bytes, for example `245 lines, 12.0KB text`. Completed PDFs show known page counts and text size, such as `820 pages, 4.2MB text`, or `820 pages, no readable text`. Images keep their format and known byte-size summary. Failed or cancelled calls keep their failure status instead of a success summary.

Measurements cover all accepted document text before either preview is built. Generated source/status/file-path metadata is excluded; document-internal headings, PDF page headings/separators and JSON payload whitespace are included. These are text sizes, not download or saved-file sizes. They do not change with expansion, terminal width or `fetchPreviewLines`. Line counts follow Pi's native convention: a final newline does not add an extra line. UI omission counts describe the existing preview selection separately.

Historical results omit unknown totals; if no text measurements are known, the summary says `Text measurements unavailable`. The renderer does not read saved files or treat an old preview as the full document to reconstruct counts.

Expanded fetch shows relevant metadata and a text preview. `fetchPreviewLines` defaults to 20 and limits only document content lines: half from the beginning, half from the end, with an exact `+N lines` marker for the omitted middle. Odd limits give the extra line to the beginning; 1 shows the first line only. Metadata, errors, saved-file references and the omission marker are outside that budget. Document-internal headings and blank lines count as content.

With a positive limit, long preview lines are clipped to the available width with `...`; resizing recalculates the preview. Set `fetchPreviewLines` to `-1` to show all available text with normal wrapping. Metadata can still wrap, and image display is unchanged, so this is not a limit on the entire tool block's terminal height.

The preview uses only text already returned by the tool. For saved documents, its bottom is the end of the returned preview, not necessarily the end of the document. Display limits do not shorten the model's result, stop extraction, read saved files or create extra files. Small inline results may have hidden text without a saved-file path; increase the setting or use `-1` to display more available text.

The `verbose` setting has been removed. Expansion controls the display instead; normal settings repair removes the obsolete key without changing valid sibling preferences.

## Extracted output files

Text fitting Pi's inline limits is returned in full: at most 2,000 lines and 50 KB (51,200 UTF-8 bytes), including source info. Small outputs do not create saved text files; PDFs always keep their original file. Images remain native attachments.

Oversized text is saved completely before returning a limited preview and the actual absolute path. Files use private session folders in the operating system's temporary directory, with a unique directory per extraction: `content.md` for HTML-derived Markdown, `content.txt` for text/PDF text, and `content.json` for JSON. Saved JSON contains only the unchanged decoded payload, without source headers or notices. A single line too large for the preview may produce no text preview; the file still contains the complete output.

Use available file tools to read or search these paths. Line-based reading cannot split a single huge JSON line. Completed files survive `/reload` while they exist, but OS temporary storage is not a permanent archive. There is no catalog, automatic refetch, or compaction recovery. If saving fails, the tool reports a native error and any available bounded preview, without claiming a saved file.

Every PDF that finishes downloading within `maxContentBytes` and the session storage allowance is saved unchanged as `original.pdf` before text conversion. Its absolute path is returned even when extracted text is short, empty, or conversion fails. Oversized text uses `content.txt` in the same directory; short text needs no separate text file. A required original-save failure is reported as an error and conversion does not start.

No readable text does not prove that a PDF is empty or scanned. The retained original can be inspected using available PDF, OCR, or visual-processing tools/skills, but this extension does not run an OCR or vision pipeline.

## Resource limits

`maxContentBytes` independently limits each downloaded body and the accepted converted text, including source/page headers in saved text. It is not a combined download-plus-text allowance or a memory limit. All formats use the same ceiling; there are no separate format limits or fixed input-character cutoffs.

PDF downloads stream into an unfinished file and become `original.pdf` only after EOF and successful closure. PDF loading and sequential page conversion run in a Node worker. `pdfProcessingTimeoutMs` starts after the original is saved; timeout or cancellation terminates the worker and waits for it to exit. There is no configurable page cap. HTML/JSON parsing has byte limits but no hard CPU-time deadline. Neither byte limits nor workers impose a hard process-memory limit.

A stopped extraction is a native error, not a successful full extraction. The response reports the stop reason and, for PDFs, total pages when known, pages processed, and pages whose text was accepted. A processed page rejected by the text budget is counted as processed, not accepted. Available partial text is saved as `content.partial.txt` or `content.partial.md` and labeled partial, even if it would fit inline. JSON is kept complete and valid or rejected. Cancellation does not start new partial-file writes; already completed originals/text files remain available.

`maxSessionStorageBytes` counts retained and in-progress file-content bytes in the session folder, including originals and converted text. Extension writes in the same session are serialized, including streamed downloads; usage is read from disk again on each write and after reload. A full allowance refuses new saves without evicting earlier files. Files changed by other tools affect the next check; this is not a cross-process lock, a machine-wide disk guarantee, or an allowance for filesystem metadata. Small non-PDF inline results still do not access session storage.

The larger defaults are provisional, not benchmarked book-size or memory guarantees. Saved text is the complete accepted extraction unless explicitly labeled partial; it is not an unchanged copy of HTML/PDF bytes. Only the separately saved original PDF is a byte-for-byte copy of its completed downloaded body.

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
  "timeoutMs": 180000,
  "pdfProcessingTimeoutMs": 300000,
  "maxContentBytes": 104857600,
  "maxSessionStorageBytes": 1073741824,
  "safesearch": 0,
  "agentCanPickCategory": false,
  "allowPrivateUrls": false,
  "fetchPreviewLines": 20
}
```

| Setting                  | Default      | Meaning                                                                                                                                                          |
| ------------------------ | ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `maxResults`             | `10`         | Maximum results to return. Any integer >= 1, without a hard-coded upper bound.                                                                                   |
| `agentCanLimitResults`   | `false`      | Let the agent request fewer results through the optional `maxResults` tool argument, from 1 up to the configured maximum.                                        |
| `timeoutMs`              | `180000`     | Shared search/extraction network timeout, including response bodies; 1000-2147483647 ms. Existing valid numeric values, including fractions, are preserved.      |
| `pdfProcessingTimeoutMs` | `300000`     | PDF loading/conversion deadline; integer 1-2147483647 ms.                                                                                                        |
| `maxContentBytes`        | `104857600`  | Shared download/converted-text ceiling: 100 MB by default; integer 1-Number.MAX_SAFE_INTEGER bytes.                                                              |
| `maxSessionStorageBytes` | `1073741824` | Session file-content allowance: 1,024 MB by default; integer 1-Number.MAX_SAFE_INTEGER bytes.                                                                    |
| `safesearch`             | `0`          | SafeSearch: 0 (off), 1 (moderate), or 2 (strict).                                                                                                                |
| `agentCanPickCategory`   | `false`      | Let the agent choose one of the supported search categories.                                                                                                     |
| `allowPrivateUrls`       | `false`      | Permit local/private destinations for `web_fetch`.                                                                                                               |
| `fetchPreviewLines`      | `20`         | Expanded fetch content lines, split between beginning/end. Positive integer or `-1` for all available text. Metadata is outside the limit; search is unaffected. |

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

`web_fetch` sends requests from the machine running Pi. An untrusted website could redirect a request to a local service, or try to trick the agent into reading private data and sending it elsewhere. The default block limits that access. It does not sandbox Pi's other tools.

- `web_fetch` blocks local/private IPv4 and IPv6 destinations by default, including hostname lookups and redirects. Non-public, reserved, and IPv4 translation/tunnel ranges are also blocked conservatively.
- Every redirect is checked, with at most 20 redirects. The checked DNS addresses are passed directly to the connection; HTML links use the final page URL.
- `allowPrivateUrls: true` permits local/private destinations for `web_fetch`. Local SearXNG instances remain supported independently of this setting.
- `maxContentBytes` bounds arriving download bytes regardless of the declared length, and bounds accepted converted text. Large HTML/PDF parsing can still require substantially more memory than the download size.
- All search and extract results are flagged as untrusted content in the LLM context, including saved extraction files read later.

Sizes follow Pi's 1024-based convention: 1 KB = 1024 bytes and 1 MB = 1,048,576 bytes. Displays use Pi's `KB`/`MB` labels and formatter.

## Testing

With the repository's existing Node and Bun development dependencies installed, run `npm test` from the repository root for both SearXNG and TUI Tweaks. For SearXNG alone, run `npm test --workspace=@blazer2k/searxng-suite` from the root or `npm test` from this package directory. Tests do not install dependencies or contact a live service.

The runner isolates HOME, agent settings, configuration, temporary files and working directories, and removes its owned files afterward. Existing unit/rendering tests use Bun; transport, storage, worker and native-loader checks use Node's built-in test/assert APIs. Direct helper checks use Node's built-in TypeScript type stripping and a test-only relative-import resolver; registered tools use Pi's public resource loader. No build or loader dependency is added. Node test files run as separate direct entrypoints so test-CLI flags do not leak into PDF workers.

HTTP and DNS responses are deterministic fixtures. Connector tests run actual Node Undici against controlled in-memory sockets; other TCP/TLS connections and listening sockets are blocked. PDF tests distinguish synthetic worker failures/stalls from actual unpdf conversion of the small local PDF fixtures. Packed-entry/reload checks use a local offline npm tarball and the already-installed dependencies. Tests and fixtures are excluded from the published package.

## License

MIT – see [LICENSE](LICENSE)
