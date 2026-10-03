# Changelog

All notable changes to `@synchain/cli` are documented here.
The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/).

## Unreleased

### Added
- `synchain --help` now says how to authenticate, so neither a person nor an agent needs a second
  command to find out how to log in. After the command list come three blocks:
  - **Authentication**: requests carry a CLI key (`synch_live_sk_…`) as `Authorization: Bearer`;
    generate one at `https://www.synchain.ca/settings` under Settings → CLI Access (it is shown
    once); `synchain login` on a terminal, `SYNCHAIN_TOKEN=synch_live_sk_… synchain login`
    without one; only `login` takes the key from `SYNCHAIN_TOKEN`; check with `synchain doctor`
    (offline) and `synchain whoami`.
  - **Environment**: `SYNCHAIN_TOKEN`, `SYNCHAIN_ERROR_FORMAT`, `XDG_CONFIG_HOME`, `APPDATA`.
  - **Examples**, with a pointer to `synchain help safety`.
- `synchain --help --format json` carries the same at the root of the command tree: `auth`
  (`scheme`, `credential`, `env`, `envReadBy`, `login`, `obtain`, `verify`) and `environment`
  (`[{ name, description }]`), placed before `commands`. Subcommand nodes are unchanged.
- The exported `CommandTree` type declares the two new root fields (`auth`, `environment`) as
  required. No new type names are exported.

### Changed
- README: the quick start is now a single Quickstart sequence that runs from
  `npm install -g @synchain/cli` through `login`, `whoami` and `project use` to a first upload, in
  both the English and the Chinese half.

## 0.9.0 - 2026-10-01

### Restored
- Agent-facing contract that 0.4.0–0.5.1 shipped from the old monorepo and 0.6.0 silently lost when this
  repository was extracted from an earlier snapshot: global `--format json|text`, `synchain --help --format json`
  (the whole command tree as JSON), `--dry-run` on every mutating command, a typed error hierarchy
  (`ApiError` and its subclasses `AuthError`, `ForbiddenError`, `NotFoundError`, `ConflictError`,
  `ValidationError`, `RateLimitError`, `ServerError`), and TypeScript declarations in the published
  package.
  - `--dry-run` covers 13 commands: `files upload|mv|rename|rm`, `folders mkdir|rename|rm`,
    `calendar add|edit|rm`, `discussion post|reply` and `notifications read`. It resolves ids and
    validates input, prints what would change (`{"dryRun":true,"action","target"}` with `--json`),
    sends no write and exits 0; `files rm --dry-run` stops before the confirmation prompt. The only
    requests it makes are read-only: the id lookups the real command makes, the upload-URL request of
    `files upload`, and the unread count for `notifications read --all`.
  - The package now declares `types` and `exports` (`.` and `./package.json` only). The entry point
    exports the error classes and the types `ErrorEnvelope`, `OutputFormat`, `CommandTree`,
    `CommandTreeNode` and `CommandTreeOption`, nothing else.

### Added
- `synchain doctor`: an offline preflight that checks Node, config, key shape and base URL without any
  network call; exits 1 when a check fails.
- Structured errors: one-line JSON envelope `{"error":{"code","status","url","detail"}}` on stderr.
  `code` is the server's own error code when it sends one, `http_<status>` when it does not, or a CLI
  code such as `unknown_option`, `no_project_selected`, `ambiguous_id`, `id_not_found`,
  `unauthenticated` or `network_error`. `detail` has terminal escape sequences removed and is capped at
  2000 characters; a presigned storage URL is reported without its query string. For a request that got
  no response, `detail` names the system error code when there is one (`fetch failed (ECONNREFUSED)`).
- `--json` on `files rm`, `folders rm` and `calendar rm` (`{"deleted":{…}}` on success).
- `synchain help safety`: which commands take `--dry-run`, and what a rehearsal can and cannot see.
- `context7.json` for Context7 indexing.

### Changed
- **Errors are JSON by default when stderr is not a terminal** (scripts, CI, agents). Set
  `SYNCHAIN_ERROR_FORMAT=text` to keep the old coloured prose. `--json` / `--format json` always
  select JSON.
- **Exit codes are now categorised** (2 usage, 3 unauthenticated, 4 forbidden, 5 not found, 6 conflict /
  validation, 7 rate limited, 8 server; 1 for everything else). Scripts that test `$? -eq 1` for every
  failure need updating.
- **`files rm` without `--yes` and without a terminal now fails** with exit 2 and code
  `confirmation_required`, before sending anything. It used to print `Cancelled.` on stdout (even with
  `--json`) and exit 0 without deleting, which a script could read as success. On a terminal it still
  asks.
- Whenever errors are JSON, stderr carries JSON lines only: `files upload` and `files download` no longer
  print their progress bar or completion line there, and the `files rename` extension warning and the
  orphaned-upload note become `{"warning":{…}}` lines.
- `login --base-url` help no longer suggests the server can be self-hosted: it overrides the API host
  for testing against another deployment.
- The npm description now matches the Synchain website's positioning.

### Fixed
- `synchain login` with stdin not a terminal (CI, agents, `</dev/null`) no longer stops at the base-URL
  prompt, exits 0 and saves nothing. It never prompts there now: the key comes from `SYNCHAIN_TOKEN`,
  the base URL from `--base-url`, else the stored one, else the default. Without `SYNCHAIN_TOKEN` it
  fails before sending anything, with exit 2 and code `missing_argument`.
- A base URL with credentials in it (`https://user:pass@…`) is refused with a clear message, and no
  error message quotes the credentials.
- `-h` passed as an option value (e.g. `--title -h`) is no longer mistaken for a help request. That was
  how 0.5.1 detected `--help --format json`; the restored version asks the help renderer instead.

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
