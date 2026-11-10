# Changelog

Versions up to `0.2.3` were published as `@blazer2k/searxng-suite`.

## [0.3.0] - 2026-11-10

**Breaking changes**

- Renamed the package from `@blazer2k/searxng-suite` to `@blazer2k/pi-searxng`. Remove the old package and install the new one.
- Renamed the `web_extract` tool to `web_fetch`. There is no alias.
- Replaced the `/search-config` command with the `pi-searxng.json` settings file. Edit the file and use Pi's `/reload`; settings load only at startup and on reload. The old `pi-searxng-suite.json` file is ignored; settings are not migrated automatically.
- Renamed `limit` to `maxResults`, `llmCanOverrideLimit` to `agentCanLimitResults`, and `llmCanPickCategory` to `agentCanPickCategory`. Category selection is now off by default and limited to `general`, `news`, `science`, and `videos`.
- Removed the `verbose` setting. Results expand and collapse with Pi's own shortcut.
- Pi `1.5.0` and Node.js `22.19.0` are now the minimum supported versions.

**Added**

- `web_fetch` returns `application/json` responses as their original text, without re-serialization.
- Output too large to return inline is saved to a file in full, and the agent gets a preview with the path.
- Every completed PDF download is kept as `original.pdf`, including when its text cannot be extracted.
- Search results include SearXNG's engine warnings, corrections, and suggestions.
- `fetchPreviewLines` sets how many content lines an expanded fetch shows, taken from the beginning and the end.
- `pdfProcessingTimeoutMs` and `maxSessionStorageBytes` limit PDF conversion time and the space used by saved files.

**Changed**

- Collapsed fetch results show measured lines and sizes instead of estimated tokens. PDFs show their page count.
- One `maxContentBytes` limit, 100 MB by default, replaces the fixed download limits per format.
- PDFs are downloaded to disk and converted page by page in a separate worker, which stops on timeout or cancellation.
- The default network timeout is now 180 seconds instead of 15.
- Tool titles are bold, like Pi's built-in tools.
- Declared the package changelog path so Pi can show release notes after updates.
- Reworked the README with a recording and a new package image. Media stays in the repository and is excluded from the npm package.

**Fixed**

- Timeouts cover the whole response body, and size limits apply to the bytes actually received.
- `web_fetch` checks resolved addresses and every redirect against the private-address rules.
- Links in converted HTML resolve against the final URL after redirects.
- HTML cleaning no longer removes article, reference, or discussion content together with navigation.
- Failed, timed-out, and cancelled calls keep Pi's error status instead of returning as ordinary results.
- Expand and collapse hints follow Pi's configured keybindings.
- Shortened titles, snippets, and error messages no longer end in half of an emoji.

## [0.2.3] – 2026-06-11

### Fixed

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
