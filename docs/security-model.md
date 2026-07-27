# Security model

This page is the long-form security reference for `@mgrilec/apm`. It expands the executive summary in [README §5](../README.md#5-security-model) with the threat-model reasoning behind each protection.

If you are a user who just wants to install the package safely, the README is enough. If you are reviewing the launcher's security posture, reviewing a related change, or triaging a vulnerability, read this.

## Headline guarantee

When the launcher runs an APM command, it runs the exact bytes that the package expected at install time — no more, no less. Everything else on this page is the machinery that makes that statement true.

## Trust boundaries

```
+----------------+        +----------------------+        +-----------------+
|   npm package  | -----> |  launcher process    | -----> |  cached binary  |
|     bytes      |        |  (this repo)         |        |  (on disk)      |
+----------------+        +----------------------+        +-----------------+
                                |
                                v
                       upstream release server
                       (GitHub Releases or mirror)
```

The launcher sits between two trust boundaries:

1. **The npm package** that you `npm install`. You trust it to embed correct digests and to enforce verification.
2. **The upstream release server** that serves archive bytes. The launcher does not trust this server; it treats it as untrusted.

The output of the launcher (the cached binary) is treated as untrusted by Microsoft APM itself: when invoked, a normal APM install will fetch a Microsoft-internal CLI into the user's home directory. That step is upstream behavior.

## Threat model per protection

For each protection below: what attack the protection defends against, the source-level mechanism, and what an attacker would have to do to defeat it.

### Version predictability (`lib/run.js`, `lib/release.js`)

- **Attack.** A compromised upstream or MITM convinces your machine that "the latest" Microsoft APM should be X.0, which happens to be malicious.
- **Defense.** `MICROSOFT_APM_VERSION` is a required, explicit semver (with optional `v` prefix). Floating tags (`latest`, `next`) and range specifiers (`^x.y.z`) are rejected by `normalizeVersion`. The default version is the package's pinned `0.26.0`.
- **What defeats it.** A user who configures their environment to a different version on their own initiative. The launcher respects that and trusts the upstream sidecar at that point; no protective claim is made beyond "what you asked for is what you get".
- **What does not defeat it.** Replacing the embedded digest, because the digest itself is the protection (see [Release pin vs. embedded digest](#release-pin-vs-embedded-digest) below).

### Download integrity (`lib/installer.js`)

- **Attack.** A network attacker swaps the archive bytes in flight and serves the launcher's cached executable something different.
- **Defense.** The archive bytes are hashed with SHA-256 and compared to the sidecar (and, for the default version, the embedded digest). The sidecar is fetched over the same HTTPS connection, but TLS guarantees authenticity of the channel, and the embedded digest guarantees the sidecar itself has not been substituted.
- **What defeats it.** A *simultaneous* compromise of the upstream GitHub Releases endpoint, the TLS chain trusted by the host, and the package's own embedded digest. Three independent pivots.
- **What does not defeat it.** TLS interception alone, because the launcher retains the upper bound of "matches what we expected". An attacker-only check would also require a non-match; with a pinned digest, any substituted archive hashes differently from expectation.

### Transport (`lib/release.js`)

- **Attack.** Redirect downloads to `http:`, a `file:` URL, or a credentialed HTTPS endpoint that an attacker controls.
- **Defense.** `normalizeDownloadBaseUrl` enforces `https:`, no userinfo, no query string, no fragment. The default is hardcoded to GitHub Releases, which the user has to actively replace.
- **What defeats it.** A user who intentionally points the launcher at a mirror that later loses integrity. The launcher trusts whatever mirror you give it to the same extent it trusts GitHub Releases.

### Archive safety (`lib/installer.js`)

- **Attack.** A tampered archive writes outside its declared root (`..`), uses device/fifo/symlink entries to redirect reads, or escapes the installation directory.
- **Defense.** Three guards:
  - `archiveDestination` rejects entries not under the archive root, entries with empty / `.` / `..` segments, and entries with backslashes.
  - The final destination is asserted to remain under the installation directory (`path.resolve` + `startsWith`).
  - Tar rejects any entry whose type is not `file` or `directory`; ZIP skips non-`file` entries.
- **What defeats it.** A vulnerability in `tar-stream` or `yauzl` that bypasses our entry-level filter. Upstream dependency CVEs are tracked and patched through normal update flow.
- **What does not defeat it.** A "well-formed" archive whose *contents* are themselves malicious. The launcher verifies bytes; it does not parse APM. See [What the launcher does not protect against](#what-the-launcher-does-not-protect-against).

### Cache integrity (`lib/installer.js`)

- **Attack.** A user copies a pre-populated cache directory from a different `(version, platform, arch)` and expects to bypass a download.
- **Defense.** The marker `.microsoft-apm-npm-layout-v2` must contain exactly the upstream tag matching the requested version. Otherwise `isUsableInstallation` returns `false` and the launch path re-downloads.
- **What defeats it.** A user who happens to *want* to run the cached bytes from an alternate version. Set `MICROSOFT_APM_VERSION` accordingly; that is not a defect, that is configuration.
- **What does not defeat it.** Partial installs. A directory that has the executable but is missing the marker is treated as absent. The marker is set as the final step, after rename.

### Concurrent install safety (`lib/installer.js`)

- **Attack.** Two first-run launchers each download their own copy of the archive, race to write into the install directory, and leave a half-extracted cache entry.
- **Defense.** A per-target `mkdir`-based lock at `<installDirectory>.lock` serializes the "fetch + verify + extract + publish" path. The lock-holder writes `owner.json` and re-stamps its `mtime` on a heartbeat. After acquiring, the launcher re-checks the cache so that a holder finishing its install short-circuits another process.
- **What defeats it.** A launcher that holds the lock past `MICROSOFT_APM_LOCK_STALE_MS` without heartbeating. After that window, the directory is reclaimable.
- **What does not defeat it.** A second launcher racing the first into the same temporary directory. Each launcher creates its own `mkdtemp` named `.install-XXXX`, so there is no collision.

### Lock held forever (`lib/installer.js`)

- **Attack.** A wedged launcher holds the lock indefinitely; future first-runs block until `MICROSOFT_APM_LOCK_TIMEOUT_MS`.
- **Defense.** The launcher writes `mtime` every heartbeat; if `Date.now() - mtimeMs > MICROSOFT_APM_LOCK_STALE_MS`, the lock directory is removed and the next acquirer proceeds. The error message when timeout is reached explicitly tells the maintainer how to recover.
- **What defeats it.** A lock-holder whose `mtime` keeps updating but whose progress is stalled on I/O. The launcher does not detect a stalled-but-heartbeating lock; the documentation advises raising `MICROSOFT_APM_LOCK_STALE_MS` if your hardware requires a longer honest install time.

### `PATH` redirection (`lib/installer.js`, `lib/run.js`)

- **Attack.** A user installs a malicious `apm` to `/usr/local/bin` so the launcher picks it up via the inherited environment.
- **Defense.** The launcher resolves the cached binary by absolute path and `spawn`s it directly. It never searches `PATH`. There is no fallback.

### `apm self-update` (`lib/run.js`)

- **Attack.** The upstream APM supports a `self-update` command that replaces the binary in place. An attacker who controls the cached binary could use this to bypass the launcher-pinned version.
- **Defense.** `assertSupportedCommand` rejects `apm self-update` with a descriptive error before any binary is invoked. The launcher does not provide any other path to overwrite the cached executable.
- **What does not defeat it.** Direct filesystem access to the cache directory. See [What the launcher does not protect against](#what-the-launcher-does-not-protect-against).

### Loss of TTY/stdin/stdout (`lib/run.js`)

- **Attack.** A launcher that swallows signals, exit codes, or terminal output, hiding APM errors from the user.
- **Defense.** `spawn` is invoked with `stdio: 'inherit'`, propagating all three streams as well as the child's exit code and signal behavior (`signalExitCode` maps signals to the POSIX 128+N convention).

## Release pin vs. embedded digest

This is the difference between "trust Microsoft GitHub Releases to publish correct digests" and "trust the version I asked for is the version I got".

### Default version (`0.26.0`)

The package ships `RELEASE_HASHES` in `lib/release.js`. For each supported asset, the launcher checks **both** the upstream sidecar digest and the embedded one. Mismatch is fatal.

This protects against a compromised GitHub Releases account distributing a tampered tarball: even if the upstream sidecar itself has been re-signed, the embedded digest still has to match.

### Other versions

The launcher verifies the archive's SHA-256 against the upstream sidecar only. Opting in to a non-default version is opting in to "trust the upstream maintainer to publish a correct sidecar".

There is no "trust the most recent tag" mode. Floating tags (`latest`, `next`) are rejected by `normalizeVersion`.

## What the launcher does not protect against

Listed explicitly so you know what you still need to defend upstream or in your operating environment.

- **A malicious npm package update.** If you `npm install` a tampered version of `@mgrilec/apm`, the launcher no longer represents this repository. Pin versions in `package.json` and review upgrades.
- **A malicious lockfile.** The launcher never evaluates scripts; it only executes the package's own JavaScript. Lockfile integrity (running with `npm ci` instead of `npm install`) is upstream of the launcher.
- **A compromised Microsoft APM binary that satisfies the SHA-256.** Microsoft APM's checksum is the launcher's check; it does not have insight into what the binary itself does at runtime. This is the same trust boundary as fetching the binary directly.
- **A compromised local machine.** The launcher writes to the cache directory and reads the lock heartbeat; an attacker who can write to those locations can run arbitrary code. Use OS-level controls to defend the cache.
- **Network-level active downgrade attacks that bypass TLS.** The launcher does not pin the TLS version or the CA; it relies on Node's defaults. Defense is at the OS / network layer.
- **Side effects of the upstream Microsoft APM binary.** When the verified APM binary runs, it can fetch additional code, write to your filesystem, or call out to other services. That is upstream behavior; this handbook documents the boundary, not the upstream's posture.

## How a defender should reason about a security report

When you triage a wrapper-side security issue, ask:

1. Which protection above is missing or weakened in the affected version?
2. Is the issue reproducible from a fresh install (no preexisting cache)?
3. Does the fix require a new `RELEASE_HASHES` entry, new lock semantics, a parser fix, or a behavior change?
4. What is the rollback path (`MICROSOFT_APM_VERSION` pinning, `MICROSOFT_APM_CACHE_DIR` rotation)?

## Reporting a vulnerability

The repository does not currently publish a private vulnerability-reporting channel. For sensitive defects that would expose users to harm if disclosed publicly, follow [GitHub's report-content guidance](https://docs.github.com/en/communities/maintaining-your-safety-on-github/reporting-abuse-or-spam). For non-sensitive defects, open a [bug report](https://github.com/mgrilec/apm/issues/new?template=bug.yml).

## Cross-references

- [README §5 Security model](../README.md#5-security-model) — the user-facing summary.
- [Architecture](architecture.md) — same flow, viewed as source code.
- [Configuration](../README.md#3-configuration) — variables that change security-relevant behavior.
