# Changelog

Versions up to `0.2.3` were published as `@blazer2k/searxng-suite`.

## [Unreleased]

- Renamed the package from `@blazer2k/searxng-suite` to `@blazer2k/pi-searxng`. Remove the old package and install the new one.
- Renamed `web_extract` to `web_fetch` without an alias. Native labels/headings are lowercase `web search` and `web fetch`.
- Replaced `/search-config` with file-based `pi-searxng.json` settings. Invalid fields are repaired independently, read failures do not overwrite the file, and schemas/settings refresh at startup or `/reload`. Old names/files are not migrated. Agent result-limit and category permissions default to false; supported categories are `general`, `news`, `science` and `videos`.
- Removed `verbose` in favor of Pi's native expansion state. Expanded search keeps all returned entries and diagnostics. Added fetch-only `fetchPreviewLines` (20 by default) with head/tail lines, exact omissions, width clipping and `-1` for all available returned text. Display changes do not load files or alter model output.
- Replaced character/token estimates with measured accepted-text lines and UTF-8 sizes. PDF summaries use known page counts and text size or report no readable text. Generated metadata is excluded and unknown historical measurements are omitted.
- Added validated `application/json` fetching without re-serialization. Whitespace, duplicate keys, escapes and number spellings are retained; one leading UTF-8 BOM is removed. Invalid/oversized JSON does not produce partial JSON files.
- Save oversized accepted text before returning a bounded inline preview and actual file path. Save every completed PDF original unchanged before conversion, including when text is empty or conversion fails. Incomplete conversions remain native errors, with clearly labeled partial text when saving succeeds. Completed files survive reload while retained in temporary storage.
- Added shared fetch download/accepted-text and session-storage byte budgets, streamed PDF downloads and sequential PDF processing in an interruptible Node worker. Processing timeout/cancellation awaits worker exit; progress distinguishes processed and accepted pages. There is no page cap or hard process-memory guarantee; larger resource defaults remain provisional.
- Enforced body timeouts and actual arriving-byte limits. Fetch validates public destinations and redirects, passes checked DNS answers to the connection and keeps search authentication separate. HTML links use the final URL; conservative cleaning preserves article/reference/discussion content.
- Preserve bounded search engine diagnostics, suggestions and corrections before result limiting. Failures keep native error/cancellation status and do not stringify arbitrary abort reasons. Saving failures do not claim complete files.
- Use bold tool titles and host-configured expand/collapse hints without bolding arguments. Incomplete call arguments no longer render a literal `undefined`.
- Simplified private search/fetch modules and kept HTML cleaning inside its extractor. Updated workspace Pi dependencies to 1.5.1 and declared the changelog path explicitly.
- Added permanent offline tests to the root/package commands, including Node connectors/workers, renderer IO and credential checks, reproducible PDF fixtures and isolated source/packed loading. Documented current settings, previews, files, limits and validation workflow. Replaced the README screenshot with a recording and updated the package image; images are no longer shipped in the npm package.

## [0.2.2] – 2026-05-17

### Changed

- Converted screenshot images from PNG to WebP

## [0.2.1] – 2026-05-17

### Fixed

- Accept `null` values in SearXNG response fields (`content`, `title`, `url`, `engine`) — image search results with null fields no longer throw "Invalid SearXNG response shape"

## [0.2.0] – 2026-05-17

### Added

- **Search categories** – LLM can target searches to specific SearXNG categories: `general`, `images`, `videos`, `news`, `it`, `science`, `files`, `social media`
- **LLM limit override** – When enabled, the LLM can request fewer results than the configured maximum per search
- **`llmCanPickCategory` setting** – Toggle to allow/disallow LLM category selection (default: `true`)
- **`llmCanOverrideLimit` setting** – Toggle to allow/disallow LLM limit override (default: `false`)

### Changed

- Search category is shown inline in tool call rendering (e.g. `search "query" (news)`)

## [0.1.2] – 2026-05-15

### Fixed

- Updated imports from `@mariozechner` to `@earendil-works` scope
- Added `@types/turndown` dev dependency

## [0.1.1] – 2026-05-14

### Added

- Gallery preview image for pi extension marketplace

## [0.1.0] – 2026-05-14

### Added

- **`web_search` tool** – SearXNG-powered web search with configurable limits, timeouts, and SafeSearch
- **`web_extract` tool** – URL content extraction supporting HTML, plain text, PDF, and images
- **Config system** – JSON-based config with TypeBox validation, self-repair, and default values
- **Runtime settings UI** – `/search-config` command to adjust settings without restarting
- **Security** – Private IP blocking, content size limits, untrusted content flagging
