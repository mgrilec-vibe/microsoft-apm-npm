'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
  ARCHIVE_NAMES,
  hashesFromRelease,
  selectLatestStableRelease,
  updatePinnedRelease,
} = require('../scripts/update-apm-release');

function release(tag, { draft = false, prerelease = false, complete = true } = {}) {
  const assets = ARCHIVE_NAMES.flatMap((name, index) => {
    const asset = {
      name,
      digest: `sha256:${String(index + 1).repeat(64)}`,
    };
    return complete ? [
      asset,
      { name: `${name}.sha256`, browser_download_url: `https://checksums.example/${name}.sha256` },
    ] : [asset];
  });

  return { tag_name: tag, draft, prerelease, assets };
}

function checksumResponse(url) {
  const archive = ARCHIVE_NAMES.find((name) => url.endsWith(`${name}.sha256`));
  if (!archive) {
    throw new Error(`Unexpected checksum URL: ${url}`);
  }

  return {
    ok: true,
    text: async () => `${String(ARCHIVE_NAMES.indexOf(archive) + 1).repeat(64)}  ${archive}\n`,
  };
}

function releaseFetcher(releases) {
  return async (url) => (url.includes('.sha256')
    ? checksumResponse(url)
    : { ok: true, json: async () => releases });
}

test('selects the highest published stable semantic version', () => {
  const latest = selectLatestStableRelease([
    release('v0.26.0'),
    release('v0.27.0-rc.1'),
    release('v0.28.0', { prerelease: true }),
    release('v0.27.1'),
    release('v0.29.0', { draft: true }),
  ]);

  assert.equal(latest.tag_name, 'v0.27.1');
});

test('requires every archive and checksum sidecar', () => {
  assert.throws(
    () => hashesFromRelease(release('v0.27.0', { complete: false })),
    /\.sha256 sidecar/,
  );
});

test('updates the pinned manifest and documented version from release digests', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'apm-release-updater-'));
  await fs.mkdir(path.join(root, 'lib'));
  await fs.writeFile(
    path.join(root, 'lib', 'release-manifest.json'),
    `${JSON.stringify({ version: '0.26.0', hashes: {} })}\n`,
  );
  await fs.writeFile(path.join(root, 'README.md'), '0.26.0\n0.26.0\n');

  const result = await updatePinnedRelease({
    root,
    fetchImpl: releaseFetcher([release('v0.27.0')]),
  });

  assert.deepEqual(result, { updated: true, version: '0.27.0' });
  const manifest = JSON.parse(await fs.readFile(path.join(root, 'lib', 'release-manifest.json'), 'utf8'));
  assert.equal(manifest.version, '0.27.0');
  assert.equal(manifest.hashes['0.27.0']['apm-linux-x86_64.tar.gz'], '4'.repeat(64));
  assert.equal(await fs.readFile(path.join(root, 'README.md'), 'utf8'), '0.27.0\n0.27.0\n');
});

test('leaves files unchanged when the latest release is already pinned', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'apm-release-updater-'));
  await fs.mkdir(path.join(root, 'lib'));
  const manifest = `${JSON.stringify({ version: '0.26.0', hashes: {} })}\n`;
  await fs.writeFile(path.join(root, 'lib', 'release-manifest.json'), manifest);
  await fs.writeFile(path.join(root, 'README.md'), '0.26.0\n');

  const result = await updatePinnedRelease({
    root,
    fetchImpl: releaseFetcher([release('v0.26.0')]),
  });

  assert.deepEqual(result, { updated: false, version: '0.26.0' });
  assert.equal(await fs.readFile(path.join(root, 'lib', 'release-manifest.json'), 'utf8'), manifest);
});

test('follows release pagination before selecting a stable version', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'apm-release-updater-'));
  await fs.mkdir(path.join(root, 'lib'));
  await fs.writeFile(
    path.join(root, 'lib', 'release-manifest.json'),
    `${JSON.stringify({ version: '0.26.0', hashes: {} })}\n`,
  );
  await fs.writeFile(path.join(root, 'README.md'), '0.26.0\n');

  const urls = [];
  const result = await updatePinnedRelease({
    root,
    fetchImpl: async (url) => {
      urls.push(url);
      if (url.includes('.sha256')) {
        return checksumResponse(url);
      }
      if (url.includes('/next')) {
        return {
          ok: true,
          headers: { get: () => null },
          json: async () => [release('v0.27.0')],
        };
      }
      return {
        ok: true,
        headers: { get: () => '<https://api.github.com/next>; rel="next"' },
        json: async () => [release('v0.27.0-rc.1')],
      };
    },
  });

  assert.deepEqual(result, { updated: true, version: '0.27.0' });
  assert.equal(urls.length, 7);
});
