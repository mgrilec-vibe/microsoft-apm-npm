# Security model

This page is the long-form security reference for `@mgrilec/apm`. It expands the executive summary in [README §5](../README.md#5-security-model) with the threat-model reasoning behind each protection.

If you are a user who just wants to install the package safely, the README is enough. If you are reviewing the launcher's security posture, reviewing a related change, or triaging a vulnerability, read this.

## Headline guarantee

On a **fresh installation**, the launcher verifies the downloaded archive before publishing it to the cache. For the default version, the archive must match both the upstream sidecar and a digest embedded in this package; for an explicitly selected non-default version, it must match the upstream sidecar. On a later cache hit, the launcher checks only the executable and release marker, not a fresh digest, so the cache directory remains an operating-system trust boundary.

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

The launcher crosses three trust boundaries:

1. **The npm package** that you `npm install`. For the default release, you trust it to embed the expected digests and to enforce verification.
2. **The upstream release server or configured mirror** that serves archive bytes and the SHA-256 sidecar. The default release has a package-embedded digest in addition to that sidecar; an explicitly selected non-default release trusts the sidecar.
3. **The local cache directory.** The launcher verifies bytes before first publication, but later cache hits are not re-hashed. A principal that can replace the cached executable and marker can change what is run.

When invoked, the cached Microsoft APM binary may fetch a Microsoft-internal CLI into the user's home directory. That step is upstream behavior.

## Threat model per protection

For each protection below: what attack the protection defends against, the source-level mechanism, and what an attacker would have to do to defeat it.

### Version predictability (`lib/run.js`, `lib/release.js`)

- **Attack.** A compromised upstream or MITM convinces your machine that "the latest" Microsoft APM should be X.0, which happens to be malicious.
- **Defense.** `MICROSOFT_APM_VERSION` is a required, explicit semver (with optional `v` prefix). Floating tags (`latest`, `next`) and range specifiers (`^x.y.z`) are rejected by `normalizeVersion`. The default version is the package's pinned `0.26.0`.
- **What defeats it.** A user who configures their environment to a different version on their own initiative. The launcher respects that and trusts the upstream sidecar at that point; no protective claim is made beyond "what you asked for is what you get".
- **What does not defeat it.** Replacing the embedded digest, because the digest itself is the protection (see [Release pin vs. embedded digest](#release-pin-vs-embedded-digest) below).

### Download integrity (`lib/installer.js`)

- **Attack.** A network attacker or release-server compromise swaps archive bytes before the launcher publishes a cache entry.
- **Defense.** `verifyChecksum` hashes each downloaded archive. For the default version it requires agreement among archive bytes, the upstream sidecar, and the package-embedded digest. For a non-default version it compares the archive only to the sidecar.
- **What defeats it.** A default-release substitution requires changing the package-embedded digest (or defeating SHA-256). For a non-default release, a trusted transport proxy or configured mirror that can alter both the archive and its sidecar can make a matching pair.
- **What does not defeat it.** A passive or unauthenticated network observer cannot change a successful HTTPS response. This does not extend to a locally modified cache; see [Cache layout consistency](#cache-layout-consistency).

### Transport (`lib/release.js`)

- **Attack.** Redirect downloads to `http:`, a `file:` URL, or a credentialed HTTPS endpoint that an attacker controls.
- **Defense.** `normalizeDownloadBaseUrl` enforces `https:`, no userinfo, no query string, and no fragment. The default is hardcoded to GitHub Releases, which the user has to actively replace.
- **Limit.** The host's TLS trust configuration remains in scope. A trusted TLS-interception proxy can modify an explicitly selected non-default release together with its sidecar; the default release remains constrained by its package-embedded digest.

### Archive safety (`lib/installer.js`)

- **Attack.** A tampered archive writes outside its declared root (`..`), uses a tar device/fifo/symlink entry to redirect reads, or escapes the installation directory.
- **Defense.**
  - `archiveDestination` rejects entries not under the archive root, entries with empty / `.` / `..` segments, and entries with backslashes.
  - The final destination is asserted to remain under the installation directory (`path.resolve` + `startsWith`).
  - Tar rejects any entry whose type is not `file` or `directory`. ZIP entry names ending in `/` become directories; remaining ZIP entries are written as regular files after path validation. The ZIP path does not inspect or reject archive metadata types separately.
- **What defeats it.** A vulnerability in `tar-stream` or `yauzl` that bypasses our entry-level filter. Upstream dependency CVEs are tracked and patched through normal update flow.
- **What does not defeat it.** A "well-formed" archive whose *contents* are themselves malicious. The launcher verifies bytes; it does not parse APM. See [What the launcher does not protect against](#what-the-launcher-does-not-protect-against).

### Cache layout consistency (`lib/installer.js`)

- **Attack.** A partial or wrong-version installation is mistaken for a usable cache entry.
- **Defense.** `isUsableInstallation` requires an executable and `.microsoft-apm-npm-layout-v2` whose exact contents equal the requested release tag. The cache directory path also includes the requested version, platform, and architecture.
- **Limit.** This is a layout check, not a cache-integrity check: the launcher does not re-hash a cached executable. A principal that can write both the executable and marker can replace the program that runs.
- **What does not defeat it.** The marker is written in the temporary installation directory after extraction and before `fs.rename` publishes that directory. A partial final directory missing the marker is therefore treated as absent.

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
- **Defense.** `assertSupportedCommand` rejects `apm self-update` with a descriptive error before any binary is invoked. The launcher does not provide another command-line path to overwrite the cached executable.
- **What defeats it.** Direct filesystem access to the cache directory can still replace the cached executable and marker; protect that directory with normal OS permissions.

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
