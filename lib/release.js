'use strict';

const DEFAULT_VERSION = '0.26.0';
const RELEASE_DOWNLOAD_BASE = 'https://github.com/microsoft/apm/releases/download';

const RELEASE_HASHES = {
  '0.26.0': {
    'apm-darwin-arm64.tar.gz': 'febddd0a8beb4be7b411e708ed746937a14482d5e0935eb776b7f35e320654df',
    'apm-darwin-x86_64.tar.gz': '6cc47251bbefabe36224bcc5370c1ef08405d4fd15900b42e11ba672ae29483f',
    'apm-linux-arm64.tar.gz': 'c4d6b5ab6d9bdca3c3c324db7ce8d1c4faf7b317f45a55a50ae2571eaa506d25',
    'apm-linux-x86_64.tar.gz': '3afba455c5283852ba4c392f668be7c27b65bc4a0fa60a8b53a4626c52628431',
    'apm-windows-x86_64.zip': '1b74a90c7ee6373ab2926addd110c1dbc5934a9675e5f436cac4d04f46cce2f5',
  },
};
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
