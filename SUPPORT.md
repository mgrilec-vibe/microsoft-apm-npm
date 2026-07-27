# Support

## Scope

`@mgrilec/apm` is the npm launcher that downloads, verifies, caches, and starts Microsoft APM. Questions and bugs in that wrapper belong in this repository.

Microsoft APM commands, generated projects, and dependency behavior are maintained upstream. For those topics, use the [Microsoft APM repository](https://github.com/microsoft/apm).

## Getting help

1. Read the [README](README.md), especially the requirements, supported targets, configuration, and security model.
2. Search existing issues.
3. For a wrapper bug, use the bug-report form. Include the package version, Node.js version, operating system and architecture, command, and sanitized output.
4. For a wrapper question, open an issue with enough context to reproduce the behavior. Do not include credentials, tokens, private URLs, or sensitive file paths.

Suspected security vulnerabilities must not be disclosed in a public issue. This repository does not currently publish a private vulnerability-reporting channel; use GitHub's [report-content guidance](https://docs.github.com/en/communities/maintaining-your-safety-on-github/reporting-abuse-or-spam) if disclosure would expose users to harm. For the full threat model and the launcher's protection scope, see [docs/security-model.md](docs/security-model.md).