# Changelog

## [Unreleased]

### Changed

- Updated workspace Pi dependencies to `1.5.0` and explicitly declared the package changelog path.
- Renamed `web_extract` to `web_fetch`, without an old-name alias. Both tool labels and rendered headings are lowercase: `web search` and `web fetch`; optional capitalization is controlled by TUI Tweaks.
- Simplified private API/tool module names and merged HTML-only content cleaning into the HTML extractor without changing extraction behavior.
- Removed `verbose`. Pi's native expansion state now switches between compact summaries and detailed results; expanded search keeps all returned entries and diagnostics.
- Added fetch-only `fetchPreviewLines` (default 20): expanded fetch shows beginning/end content lines with an omission count, keeping metadata and file references outside the limit. Positive limits clip long preview lines to terminal width; `-1` shows all available text with wrapping. Model output and saved files are unchanged.
- Replaced character/estimated-token fetch summaries with measured accepted-text line counts and UTF-8 sizes, excluding generated metadata. PDF summaries use known page counts and text sizes or report no readable text. Previewing does not change the totals; unknown historical measurements are omitted without reading files.

### Fixed

- Search and fetch show expand hints beside collapsed summaries and collapse hints in expanded views, using Pi's host-provided keybindings instead of an extension-local Pi copy.
- Web search and fetch titles are bold, matching Pi's built-in tools without bolding their arguments.
- Guard against `null`/`undefined` `query` in `buildToolCallText` — prevents rendering the literal string `"undefined"` in tool call text

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
