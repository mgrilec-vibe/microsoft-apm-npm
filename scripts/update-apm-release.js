'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');

const RELEASES_URL = 'https://api.github.com/repos/microsoft/apm/releases?per_page=100';
const ARCHIVE_NAMES = [
  'apm-darwin-arm64.tar.gz',
  'apm-darwin-x86_64.tar.gz',
  'apm-linux-arm64.tar.gz',
  'apm-linux-x86_64.tar.gz',
  'apm-windows-x86_64.zip',
];
const STABLE_TAG_PATTERN = /^v(\d+)\.(\d+)\.(\d+)$/;
const SHA256_DIGEST_PATTERN = /^sha256:([a-f0-9]{64})$/i;

function parseStableVersion(tag) {
  const match = STABLE_TAG_PATTERN.exec(tag);
  if (!match) {
    return null;
  }

  return {
    version: match[0].slice(1),
    parts: match.slice(1).map(Number),
  };
}

function compareVersions(left, right) {
  for (let index = 0; index < left.parts.length; index += 1) {
    if (left.parts[index] !== right.parts[index]) {
      return left.parts[index] - right.parts[index];
    }
  }
  return 0;
}

function stableReleases(releases) {
  if (!Array.isArray(releases)) {
    throw new Error('Microsoft APM Releases API returned an invalid response.');
  }

  return releases
    .filter((release) => !release.draft && !release.prerelease)
    .map((release) => ({ ...release, parsedVersion: parseStableVersion(release.tag_name) }))
    .filter((release) => release.parsedVersion);
}

function selectLatestStableRelease(releases) {
  const stable = stableReleases(releases);
  if (stable.length === 0) {
    throw new Error('Microsoft APM has no published stable semantic-version release.');
  }

  return stable.reduce((latest, release) => (
    compareVersions(release.parsedVersion, latest.parsedVersion) > 0 ? release : latest
  ));
}

function availableHashesFromRelease(release) {
  const assets = new Map(release.assets.map((asset) => [asset.name, asset]));
  const hashes = {};

  for (const archive of ARCHIVE_NAMES) {
    const asset = assets.get(archive);
    const checksum = assets.get(`${archive}.sha256`);
    const digest = SHA256_DIGEST_PATTERN.exec(asset?.digest || '');
    if (asset && checksum?.browser_download_url && digest) {
      hashes[archive] = digest[1].toLowerCase();
    }
  }

  return hashes;
}

function hashesFromRelease(release) {
  const hashes = availableHashesFromRelease(release);
  if (Object.keys(hashes).length !== ARCHIVE_NAMES.length) {
    const missing = ARCHIVE_NAMES.find((archive) => !hashes[archive]);
    throw new Error(
      `Microsoft APM ${release.tag_name} is missing a SHA-256-digested ${missing} asset or its .sha256 sidecar.`,
    );
  }

  return hashes;
}

function checksumFromSidecar(contents, archive) {
  const escapedArchive = archive.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = new RegExp(`^\\s*([a-f0-9]{64})\\s+\\*?${escapedArchive}\\s*$`, 'im').exec(contents);
  if (!match) {
    throw new Error(`Microsoft APM checksum sidecar for ${archive} does not contain a valid digest.`);
  }
  return match[1].toLowerCase();
}

async function verifyChecksumSidecars(release, hashes, fetchImpl = globalThis.fetch) {
  const assets = new Map(release.assets.map((asset) => [asset.name, asset]));

  await Promise.all(ARCHIVE_NAMES.map(async (archive) => {
    const response = await fetchImpl(assets.get(`${archive}.sha256`).browser_download_url, {
      headers: { 'user-agent': 'mgrilec-apm-release-updater' },
    });
    if (!response.ok) {
      throw new Error(`Microsoft APM checksum sidecar request failed for ${archive} with ${response.status} ${response.statusText}.`);
    }

    if (checksumFromSidecar(await response.text(), archive) !== hashes[archive]) {
      throw new Error(`Microsoft APM checksum sidecar does not match GitHub's digest for ${archive}.`);
    }
  }));
}

function nextPageUrl(linkHeader) {
  if (!linkHeader) {
    return null;
  }

  for (const link of linkHeader.split(',')) {
    const match = /<([^>]+)>;\s*rel="next"/.exec(link);
    if (match) {
      return match[1];
    }
  }

  return null;
}

async function fetchReleases(fetchImpl = globalThis.fetch) {
  const releases = [];
  let url = RELEASES_URL;

  while (url) {
    const response = await fetchImpl(url, {
      headers: {
        accept: 'application/vnd.github+json',
        'user-agent': 'mgrilec-apm-release-updater',
      },
    });

    if (!response.ok) {
      throw new Error(`Microsoft APM Releases API request failed with ${response.status} ${response.statusText}.`);
    }

    const page = await response.json();
    if (!Array.isArray(page)) {
      throw new Error('Microsoft APM Releases API returned an invalid response.');
    }
    releases.push(...page);
    url = nextPageUrl(response.headers?.get('link'));
  }

  return releases;
}

function pinnedVersion(manifest) {
  const version = parseStableVersion(`v${manifest.version}`);
  if (!version) {
    throw new Error(`Release manifest has an invalid pinned version: ${JSON.stringify(manifest.version)}.`);
  }
  return version;
}

function serializeManifest(manifest, version, hashes) {
  return `${JSON.stringify({
    ...manifest,
    version,
    hashes,
  }, null, 2)}\n`;
}

async function readUpdateInputs(root, fetchImpl) {
  const manifestPath = path.join(root, 'lib', 'release-manifest.json');
  const [manifestContents, releases] = await Promise.all([
    fs.readFile(manifestPath, 'utf8'),
    fetchReleases(fetchImpl),
  ]);

  return {
    manifestPath,
    manifest: JSON.parse(manifestContents),
    releases,
  };
}

function mergeHistoricalHashes(existingHashes, discoveredHashes) {
  const mergedHashes = { ...existingHashes };

  for (const [version, releaseHashes] of Object.entries(discoveredHashes)) {
    const versionHashes = { ...mergedHashes[version] };
    for (const [archive, digest] of Object.entries(releaseHashes)) {
      if (versionHashes[archive] && versionHashes[archive] !== digest) {
        throw new Error(`Refusing to replace the pinned SHA-256 digest for ${version}/${archive}.`);
      }
      versionHashes[archive] = digest;
    }
    mergedHashes[version] = versionHashes;
  }

  return mergedHashes;
}

async function updatePinnedRelease({ root = path.resolve(__dirname, '..'), fetchImpl } = {}) {
  const readmePath = path.join(root, 'README.md');
  const [{ manifestPath, manifest, releases }, readme] = await Promise.all([
    readUpdateInputs(root, fetchImpl),
    fs.readFile(readmePath, 'utf8'),
  ]);
  const currentVersion = pinnedVersion(manifest);
  const release = selectLatestStableRelease(releases);

  if (compareVersions(release.parsedVersion, currentVersion) <= 0) {
    return { updated: false, version: manifest.version };
  }

  const hashes = hashesFromRelease(release);
  await verifyChecksumSidecars(release, hashes, fetchImpl);
  const nextReadme = readme.replaceAll(manifest.version, release.parsedVersion.version);
  if (nextReadme === readme) {
    throw new Error(`README.md does not document the current Microsoft APM version ${manifest.version}.`);
  }

  await Promise.all([
    fs.writeFile(
      manifestPath,
      serializeManifest(
        manifest,
        release.parsedVersion.version,
        mergeHistoricalHashes(manifest.hashes, { [release.parsedVersion.version]: hashes }),
      ),
    ),
    fs.writeFile(readmePath, nextReadme),
  ]);

  return { updated: true, version: release.parsedVersion.version };
}

async function backfillReleaseHashes({ root = path.resolve(__dirname, '..'), fetchImpl } = {}) {
  const { manifestPath, manifest, releases } = await readUpdateInputs(root, fetchImpl);
  const hashes = Object.fromEntries(stableReleases(releases).map((release) => [
    release.parsedVersion.version,
    availableHashesFromRelease(release),
  ]).filter(([, releaseHashes]) => Object.keys(releaseHashes).length > 0));
  const mergedHashes = mergeHistoricalHashes(manifest.hashes, hashes);
  const nextManifest = serializeManifest(manifest, manifest.version, mergedHashes);
  const currentManifest = await fs.readFile(manifestPath, 'utf8');

  if (nextManifest === currentManifest) {
    return { updated: false, version: manifest.version, versions: Object.keys(mergedHashes).length };
  }

  await fs.writeFile(manifestPath, nextManifest);
  return { updated: true, version: manifest.version, versions: Object.keys(mergedHashes).length };
}

async function main() {
  const result = process.argv.includes('--backfill-hashes')
    ? await backfillReleaseHashes()
    : await updatePinnedRelease();
  console.log(result.updated
    ? `Updated Microsoft APM release data for ${result.version}.`
    : `Microsoft APM release data is already current for ${result.version}.`);

  if (process.env.GITHUB_OUTPUT) {
    await fs.appendFile(process.env.GITHUB_OUTPUT, `updated=${result.updated}\nversion=${result.version}\n`);
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error.stack || error.message);
    process.exitCode = 1;
  });
}

module.exports = {
  ARCHIVE_NAMES,
  backfillReleaseHashes,
  checksumFromSidecar,
  compareVersions,
  hashesFromRelease,
  parseStableVersion,
  selectLatestStableRelease,
  stableReleases,
  updatePinnedRelease,
  verifyChecksumSidecars,
};
