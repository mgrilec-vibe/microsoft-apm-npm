# Changelog

All notable changes to `@mgrilec/apm` are documented in this file. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]
## [0.1.2] - 2026-08-08

### Changed

- Updated the pinned Microsoft APM release from `0.26.0` to `0.28.0` and added embedded SHA-256 digests for its supported assets.

## [0.1.1] - 2026-07-27

### Added

- npm package metadata linking users to the project homepage and issue tracker.

## [0.1.0] - 2026-07-27

### Added

- Initial implementation of the verified Microsoft APM launcher.
- In-repo architecture deep-dive at `docs/architecture.md`.
- In-repo security-model deep-dive at `docs/security-model.md`.
- Pinned default Microsoft APM version (`0.26.0`) with embedded SHA-256 digests per platform asset.
- Per-platform cache directory with version + arch-qualified keys and an installation marker.
- Per-target bounded cache lock with heartbeat and stale-reclamation.
- HTTPS-only download with `EnvHttpProxyAgent` for `HTTP_PROXY` / `HTTPS_PROXY`.
- Path-traversal protection and tar non-`file`/`directory` entry rejection.
- Rejection of `apm self-update` to keep the verified binary inviolate.
- Configuration via `MICROSOFT_APM_VERSION`, `MICROSOFT_APM_CACHE_DIR`, `MICROSOFT_APM_DOWNLOAD_BASE_URL`, and three timeout variables.
- Bug report and pull request templates.
