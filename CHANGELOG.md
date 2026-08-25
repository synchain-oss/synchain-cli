# Changelog

All notable changes to `@synchain/cli` are documented here.
The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added
- `publish.yml` workflow: the single, auditable entry point for releasing to npm.
  Manual `workflow_dispatch` only (no tag-triggered publishing), defaults to
  `dry_run`, runs the full gates plus release preflight assertions, and puts the
  real publish behind the `npm-publish` environment. Publishing uses npm trusted
  publishing (OIDC), which generates provenance attestations automatically; an
  `NPM_TOKEN` path stays available as a fallback.

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
