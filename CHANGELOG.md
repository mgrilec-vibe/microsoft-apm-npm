# Changelog

All notable changes to `@mgrilec/apm` are documented in this file. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- In-repo architecture deep-dive at `docs/architecture.md`.
- In-repo security-model deep-dive at `docs/security-model.md`.

## [0.1.0] - 2026-07-27

### Added

- Initial release.
- Verified-binary launcher that downloads, checksums, caches, and runs the Microsoft APM CLI on macOS, Linux, and Windows.
- Pinned default Microsoft APM version (`0.26.0`) with embedded SHA-256 digests per platform asset.
- Per-platform cache directory with version + arch-qualified keys and an installation marker.
- Per-target bounded cache lock with heartbeat and stale-reclamation.
- HTTPS-only download with `EnvHttpProxyAgent` for `HTTP_PROXY` / `HTTPS_PROXY`.
- Path-traversal protection and non-`file`/`directory` entry rejection for both tar and zip archives.
- Rejection of `apm self-update` to keep the verified binary inviolate.
- Configuration via `MICROSOFT_APM_VERSION`, `MICROSOFT_APM_CACHE_DIR`, `MICROSOFT_APM_DOWNLOAD_BASE_URL`, and three timeout variables.
- Bug report and pull request templates.

[Unreleased]: https://github.com/mgrilec/apm/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/mgrilec/apm/releases/tag/v0.1.0
