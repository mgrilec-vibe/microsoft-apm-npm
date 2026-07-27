# Contributing

Thanks for helping improve `@mgrilec/apm`. This repository owns the npm launcher, its download and cache logic, and its documentation. The native Microsoft APM CLI is maintained upstream in [microsoft/apm](https://github.com/microsoft/apm).

## Before opening an issue

- Search existing issues first.
- Use the bug-report form for a wrapper defect; use a blank issue for a feature proposal or question.
- Do not include credentials, tokens, private URLs, or exploitable vulnerability details in public issues.
- Report problems in Microsoft APM itself to the [upstream project](https://github.com/microsoft/apm/issues).

A useful wrapper bug report includes the `@mgrilec/apm` version, Node.js version, operating system and architecture, exact command, expected result, actual result, and a minimal reproduction. Remove credentials, tokens, private URLs, and sensitive paths from logs.

## Development setup

This project requires Node.js 20 or later.

```sh
git clone https://github.com/mgrilec-vibe/microsoft-apm-npm.git
cd microsoft-apm-npm
npm ci
npm test
npm pack --dry-run
```

`npm test` runs the built-in Node.js test runner. `npm pack --dry-run` verifies the exact files that would be published and also runs the test suite through `prepack`.

## Making a change

1. Start from the current `main` branch and keep the change focused.
2. Follow the existing CommonJS and `node:test` conventions; do not introduce a formatter or framework solely for one change.
3. Add or update a test when changing observable launcher behavior, especially download verification, cache installation, platform selection, command forwarding, or error handling.
4. Update the README when installation, configuration, support, security, or publishing behavior changes.
5. Run `npm test` and `npm pack --dry-run` before opening a pull request.

The wrapper's trust boundary is intentional: it verifies downloaded archives, never uses an arbitrary `apm` from `PATH`, and rejects upstream `self-update`. Preserve those properties or explain any security-impacting change clearly in the pull request.

## Pull requests

Use the pull request template. Include a concise summary, the motivation, tests run, documentation changes, and any compatibility or security impact. Keep unrelated refactors out of the same pull request.

Contributions are accepted under this repository's [MIT License](LICENSE). By submitting a contribution, you agree that it may be distributed under that license.

## Community standards

All participants must follow the [Code of Conduct](CODE_OF_CONDUCT.md). For usage questions and support boundaries, see [SUPPORT.md](SUPPORT.md).
