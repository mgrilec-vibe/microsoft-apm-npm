'use strict';

const {
  version: DEFAULT_VERSION,
  hashes: RELEASE_HASHES,
} = require('./release-manifest.json');
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

function normalizeDownloadBaseUrl(value = RELEASE_DOWNLOAD_BASE) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`MICROSOFT_APM_DOWNLOAD_BASE_URL must be a valid HTTPS URL; received ${JSON.stringify(value)}.`);
  }

  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) {
    throw new Error('MICROSOFT_APM_DOWNLOAD_BASE_URL must be an HTTPS URL without credentials, query parameters, or fragments.');
  }
  return url.toString().replace(/\/$/, '');
}

function resolveRelease(platform, arch, version = DEFAULT_VERSION, downloadBaseUrl = RELEASE_DOWNLOAD_BASE) {
  const asset = PLATFORM_ASSETS[`${platform}-${arch}`];
  if (!asset) {
    throw new Error(
      `Microsoft APM has no native release for ${platform}/${arch}. Supported targets: ${Object.keys(PLATFORM_ASSETS).join(', ')}.`,
    );
  }

  const normalizedVersion = normalizeVersion(version);
  const tag = `v${normalizedVersion}`;
  const archiveUrl = `${normalizeDownloadBaseUrl(downloadBaseUrl)}/${tag}/${asset.archive}`;

  return {
    ...asset,
    version: normalizedVersion,
    tag,
    archiveUrl,
    checksumUrl: `${archiveUrl}.sha256`,
    expectedChecksum: RELEASE_HASHES[normalizedVersion]?.[asset.archive],
  };
}

module.exports = {
  DEFAULT_VERSION,
  PLATFORM_ASSETS,
  RELEASE_HASHES,
  normalizeVersion,
  resolveRelease,
  normalizeDownloadBaseUrl,
};
