# Changelog

All notable changes to `@synchain/cli` are documented here.
The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/).

## 0.8.0 - 2026-09-06

### Changed
- **The default host is now `https://www.synchain.ca`**, the platform's own origin, rather than
  the Vercel deployment domain that used to sit there. Both serve the same production app, which
  is why nothing was ever broken -- and why it went unnoticed: a deployment hostname is an
  implementation detail that can be retired without warning, and it was the value the CLI taught
  every unconfigured login to trust. **Existing installs are unaffected**: the `baseUrl` in your
  `config.json` still wins, and `--base-url` still overrides. Contract record:
  `docs/contract-changes/20260906-default-base-url.md`.
- The two help strings that spelled the default host out now read the constant instead. That
  duplication is why the value was wrong in three places at once.
- `synchain help project` now describes what `project use` has accepted since 0.7.0: a custom ID
  or `synchain-<uuid>`, not only a UUID or its 8-character prefix, and the `ref` column is what
  `project ls` prints. `docs/reference.md` and `docs/install-for-agents.md` were updated with the
  feature; this help text was the surface that got missed.

### Security
- **`folders ls` no longer lets a folder name drive your terminal.** `renderTree` built its own
  lines instead of going through `renderTable`, so it never inherited that funnel's ANSI
  stripping -- and neither did the `folders create` / `rm` / `rename` success lines. Folder names
  are set by any member of the project, which made this the most reachable escape-injection point
  in the CLI: no hostile server, no `--base-url`, nothing to get past. One member renames a
  folder; the next person to run `folders ls` wears it. (`files ls` in the same file was always
  safe, because it goes through `renderTable`.)
- **`files upload` sanitizes the storage error body.** A failed storage `PUT` printed the remote
  response verbatim, bypassing the sanitizing `formatApiError` gained in 0.7.0 -- and over a wider
  trust boundary, since that body comes from whatever host the API returned in `uploadUrl`, not
  from the configured API host.
- **Numeric server fields are sanitized too.** `number` is a compile-time claim, not a runtime
  one: `apiFetch` is a bare `res.json() as T`, so a field declared `total: number` can arrive as
  a string carrying an escape. Counts look like the last place an escape could hide, which is
  exactly why they were skipped. Validation runs *before* the arithmetic -- `offset + 1` on a
  string is concatenation, so a check on the result would already be too late.
- **Error bodies are capped by line count as well as by characters.** The two bound different
  things: characters keep stderr from flooding, lines keep the error's own first line from
  scrolling out of view. 2000 characters of newlines is still ~666 lines.
- **Every remaining server string now goes through the sanitizer, and every shortened id goes
  through one shared `shortId` helper** that sanitizes *before* slicing -- cutting first can land
  mid-escape and make the truncation itself the injection. This closed a dozen further sites an
  audit turned up beyond the two originally reported: the download path printed on completion
  (sanitized 19 lines earlier in the same flow, but not here), the notification line's id / type /
  timestamp, `relativeTime` and `formatLocal` returning the raw string when parsing fails, ids
  echoed by `files`/`discussion`/`calendar` success and 404 lines, the storage key in the upload
  warning, and the logout confirmation prompt -- the one server string fed to a prompt rather than
  to `console.*`, which is why a `grep console` sweep never saw it.

## 0.7.0 - 2026-09-05

Adds custom project IDs to `project use` / `project ls`.

### Added
- **Custom project IDs.** A project may now carry a short, sayable custom ID (e.g.
  `my-band`) alongside its canonical UUID. `project use` accepts it, and `project ls`
  prints it in the renamed `ref` column, so that column pastes straight back into
  `project use`.
  - Hyphens do not count toward matching: `my-band` and `myband` are the same ID,
    matching the server's own uniqueness key. The spoken form is what matters.
  - Custom IDs are matched **exactly, never by prefix**; prefix matching stays a
    UUID-only affair.
  - Input is folded with `trim` → `NFKC` → `toLowerCase`, so a full-width `ｍｙ－ｂａｎｄ`
    pasted from a CJK IME resolves the same way it does in a browser.
- `synchain-<uuid>` is now accepted by `project use`: that is what the web "Copy ID"
  button yields for a project with no custom ID.
- Consumes the optional `customId` field of `projects[]` in `/api/user/me`. Contract
  record: `docs/contract-changes/20260905-project-custom-id.md`.

### Changed
- `project ls` renames its `id` column to `ref`, since it may now print a custom ID
  rather than a UUID prefix. `--json` output is unaffected (it still carries the full
  `id`, plus `customId` when the server sends it).

### Security
- Custom IDs and UUIDs are resolved from **separate candidate pools**. Sharing one
  `startsWith` pool would not error — it would silently switch to the wrong project, so
  every later `files rm` would land in someone else's. After a custom-ID hit the UUID pool
  is still consulted, and a collision in either direction reports an ambiguity error naming
  both full UUIDs instead of guessing.
- `project use` asserts that what it persists is a canonical UUID. A custom ID is mutable
  and never belongs in an API path; storing one would leave a later command firing at a
  string that no longer points at this project.
- The cross-namespace shadow check folds **both sides** to the spoken form. Matching custom
  IDs on the hyphen-stripped form declares `ca-fe` and `cafe` to be one identifier, so the
  collision gate has to treat them as one too — otherwise the two spellings get opposite
  answers and a user picks between "warned" and "silently landed on another project" by
  guessing where a hyphen goes. Folding one side is not enough: the hyphens may be the id's
  rather than the input's, and that half is the more dangerous one, since the spoken channel
  is exactly where hyphens get dropped. Case is folded on both sides for the same reason:
  `project ls` prints an id verbatim, so an upper-case one would produce a `ref` the lane
  folds and the gate does not.
- **API error bodies are ANSI-sanitized.** Every command's failure path runs through
  `formatApiError`, and a non-JSON response body reached the terminal verbatim. This is the
  most reachable of these paths, not the least: it does not require getting past
  authentication, so a `text/plain` 4xx from a hostile server -- one a user was talked into
  passing to `--base-url`, say -- was enough. Multi-line bodies keep their line breaks.
- Server-derived strings printed by `project use` and `whoami` are now ANSI-sanitized. The
  `ref` column of `project ls` always was (via `renderTable`), but `project use` had no such
  funnel, and the project name it writes into `config.json` was replayed unsanitized by every
  later `whoami` — offline, with no request involved.

## 0.6.0 - 2026-08-14

Second public release. Skips 0.5.x (those versions belong to the old monorepo
numbering on npm; 0.6.0 starts the independent-repository era cleanly).

### Added
- Branch gate (naming + DCO + frozen-contract path guard) and review bots
  (claude / deepseek / pr-agent) for every PR.
- Frozen-contract change record:
  `docs/contract-changes/20260814-cli-extraction-url-migration.md`.
- Regression test for clean error exits (`exit-crash.test.ts`).

### Changed
- All 76 `process.exit(1)` call sites replaced with `process.exitCode = 1` so the
  process drains the event loop before exiting.
- Removed stale references to private monorepo issues across 8 files.

### Fixed
- **Windows crash on any API error**: the CLI aborted with a libuv
  `UV_HANDLE_CLOSING` assertion (exit code 0xC0000409) right after printing a
  400/401 API error, because `process.exit(1)` raced the closing HTTP
  connection. Every error path now exits cleanly with code 1.

## 0.4.0 - 2026-08-13

First public release on npm. The CLI now lives in its own repository.

### Added
- Published to npm as `@synchain/cli` (`synchain` binary).
- CI on Node 20 / 22 (Linux) and Node 20 (Windows): typecheck, tests, build,
  and a `--help` smoke check.

### Changed
- Extracted from the Synchain monorepo into `synchain-oss/synchain-cli`; the repository
  root is now the package root, so build commands no longer need a subdirectory step.
- Documentation moved to `docs/reference.md` and `docs/install-for-agents.md`;
  all in-product documentation links now point at this repository.
- `homepage`, `bugs.url` and `repository.url` updated accordingly.

### Fixed
- Corrected an outdated documentation note about the package license; the package
  has been MIT-licensed since 2026-07.

## Prior history (0.1.0 – 0.3.0)

Versions up to 0.3.0 were developed inside the private Synchain monorepo and were
never published to npm. Their history is not part of this repository's git log
(see the initial commit for the source revision).
