# Changelog

All notable changes to `@synchain/cli` are documented here.
The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/).

## [0.7.0] - 2026-09-05

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
- Server-derived strings printed by `project use` and `whoami` are now ANSI-sanitized. The
  `ref` column of `project ls` always was (via `renderTable`), but `project use` had no such
  funnel, and the project name it writes into `config.json` was replayed unsanitized by every
  later `whoami` — offline, with no request involved.

## [0.6.0] - 2026-08-14

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

## [0.4.0] - 2026-08-13

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
