# @mgrilec-vibe/microsoft-apm

An npm launcher for the [Microsoft APM CLI](https://github.com/microsoft/apm). It downloads a verified, pinned upstream native binary into the user's cache on first use, then forwards every argument unchanged.

This package is not affiliated with or endorsed by Microsoft. APM itself is MIT-licensed by Microsoft.

## Install and run

```sh
npm install --save-dev @mgrilec-vibe/microsoft-apm
npm exec -- apm --version
npm exec -- apm install microsoft/apm
```

Or add a script to `package.json`:

```json
{
  "scripts": {
    "apm": "apm"
  },
  "devDependencies": {
    "@mgrilec-vibe/microsoft-apm": "^0.1.0"
  }
}
```

Then run `npm run apm -- --version` or any other upstream APM command.

## Behavior

- Defaults to Microsoft APM **0.26.0**. This is a deliberate version pin: it avoids a new upstream release changing an existing npm installation.
- Fetches the upstream release archive and its `.sha256` sidecar over HTTPS; the archive is verified before extraction.
- Uses only the executable it downloads; it never falls back to an unrelated `apm` found on `PATH`.
- Caches binaries under `$MICROSOFT_APM_CACHE_DIR` when set. Otherwise it uses `$XDG_CACHE_HOME/microsoft-apm`, `%LOCALAPPDATA%/microsoft-apm` on Windows, or `~/.cache/microsoft-apm`.
- Supports macOS (Intel and Apple Silicon), Linux (x86_64 and ARM64), and Windows (x86_64 and ARM64 through Microsoft APM's x86_64 Windows binary).

Set `MICROSOFT_APM_VERSION` to use another published upstream release:

```sh
MICROSOFT_APM_VERSION=0.26.0 npm exec -- apm --version
```

The value must be an explicit semantic version, with or without a leading `v`; release tags are never discovered implicitly. `apm self-update` is passed through to Microsoft APM and can therefore replace the cached executable outside this package's version pin.

## Requirements

- Node.js 20 or later.
- Network access to `github.com` on the first use of each APM version/platform.
- Linux native APM releases require glibc 2.35 or later. APM itself requires Git for dependency operations.

## Publishing

The package ships only its launcher source, license, and README. Before publishing, authenticate to the npm scope that owns `@mgrilec-vibe` and run:

```sh
npm publish
```

`prepack` runs the test suite automatically. Inspect the final artifact with `npm pack --dry-run`.
