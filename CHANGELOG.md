# Changelog

All notable changes to `@synchain/cli` are documented here.
The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/).

## [Unreleased]

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
