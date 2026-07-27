'use strict';

const DEFAULT_VERSION = '0.26.0';
const RELEASE_DOWNLOAD_BASE = 'https://github.com/microsoft/apm/releases/download';
const VERSION_PATTERN = /^v?(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?)$/;

const PLATFORM_ASSETS = {
  'darwin-arm64': {
    archive: 'apm-darwin-arm64.tar.gz',
    executable: 'apm',
  },
  'darwin-x64': {
    archive: 'apm-darwin-x86_64.tar.gz',
    executable: 'apm',
  },
  'linux-arm64': {
    archive: 'apm-linux-arm64.tar.gz',
    executable: 'apm',
  },
  'linux-x64': {
    archive: 'apm-linux-x86_64.tar.gz',
    executable: 'apm',
  },
  'win32-arm64': {
    archive: 'apm-windows-x86_64.zip',
    executable: 'apm.exe',
  },
  'win32-x64': {
    archive: 'apm-windows-x86_64.zip',
    executable: 'apm.exe',
  },
};

function normalizeVersion(value = DEFAULT_VERSION) {
  const match = VERSION_PATTERN.exec(value);
  if (!match) {
    throw new Error(
      `MICROSOFT_APM_VERSION must be an explicit semantic version; received ${JSON.stringify(value)}.`,
    );
  }

  return match[1];
}

function resolveRelease(platform, arch, version = DEFAULT_VERSION) {
  const asset = PLATFORM_ASSETS[`${platform}-${arch}`];
  if (!asset) {
    throw new Error(
      `Microsoft APM has no native release for ${platform}/${arch}. Supported targets: ${Object.keys(PLATFORM_ASSETS).join(', ')}.`,
    );
  }

  const normalizedVersion = normalizeVersion(version);
  const tag = `v${normalizedVersion}`;
  const archiveUrl = `${RELEASE_DOWNLOAD_BASE}/${tag}/${asset.archive}`;

  return {
    ...asset,
    version: normalizedVersion,
    tag,
    archiveUrl,
    checksumUrl: `${archiveUrl}.sha256`,
  };
}

module.exports = {
  DEFAULT_VERSION,
  PLATFORM_ASSETS,
  normalizeVersion,
  resolveRelease,
};
