'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
  ARCHIVE_NAMES,
  backfillReleaseHashes,
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

function checksumResponse(url, mismatch = false) {
  const archive = ARCHIVE_NAMES.find((name) => url.endsWith(`${name}.sha256`));
  if (!archive) {
    throw new Error(`Unexpected checksum URL: ${url}`);
  }

  const index = ARCHIVE_NAMES.indexOf(archive) + (mismatch ? 2 : 1);
  return {
    ok: true,
    text: async () => `${String(index).repeat(64)}  ${archive}\n`,
  };
}

function releaseFetcher(releases, { mismatch = false } = {}) {
  return async (url) => (url.includes('.sha256')
    ? checksumResponse(url, mismatch)
    : { ok: true, json: async () => releases });
}

async function writeFixture({ version = '0.26.0', hashes = {} } = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'apm-release-updater-'));
  await fs.mkdir(path.join(root, 'lib'));
  const manifest = `${JSON.stringify({ version, hashes })}\n`;
  await fs.writeFile(path.join(root, 'lib', 'release-manifest.json'), manifest);
  await fs.writeFile(path.join(root, 'README.md'), `${version}\n${version}\n`);
  return { root, manifest };
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

test('updates the pin and preserves historical hashes', async () => {
  const { root } = await writeFixture({
    hashes: { '0.25.0': { 'apm-linux-x86_64.tar.gz': 'a'.repeat(64) } },
  });

  const result = await updatePinnedRelease({
    root,
    fetchImpl: releaseFetcher([release('v0.27.0')]),
  });

  assert.deepEqual(result, { updated: true, version: '0.27.0' });
  const manifest = JSON.parse(await fs.readFile(path.join(root, 'lib', 'release-manifest.json'), 'utf8'));
  assert.equal(manifest.version, '0.27.0');
  assert.equal(manifest.hashes['0.25.0']['apm-linux-x86_64.tar.gz'], 'a'.repeat(64));
  assert.equal(manifest.hashes['0.27.0']['apm-linux-x86_64.tar.gz'], '4'.repeat(64));
  assert.equal(await fs.readFile(path.join(root, 'README.md'), 'utf8'), '0.27.0\n0.27.0\n');
});

test('does not downgrade a newer pinned release', async () => {
  const { root, manifest } = await writeFixture({ version: '0.27.0' });

  const result = await updatePinnedRelease({
    root,
    fetchImpl: releaseFetcher([release('v0.26.0')]),
  });

  assert.deepEqual(result, { updated: false, version: '0.27.0' });
  assert.equal(await fs.readFile(path.join(root, 'lib', 'release-manifest.json'), 'utf8'), manifest);
});

test('rejects checksum sidecars that disagree with GitHub asset digests', async () => {
  const { root } = await writeFixture();

  await assert.rejects(
    () => updatePinnedRelease({
      root,
      fetchImpl: releaseFetcher([release('v0.27.0')], { mismatch: true }),
    }),
    /does not match GitHub's digest/,
  );
});

test('backfills hashes for all compatible stable releases', async () => {
  const { root } = await writeFixture();

  const result = await backfillReleaseHashes({
    root,
    fetchImpl: releaseFetcher([
      release('v0.25.0'),
      release('v0.26.0'),
      release('v0.27.0-rc.1'),
      release('v0.28.0', { prerelease: true }),
    ]),
  });

  assert.deepEqual(result, { updated: true, version: '0.26.0', versions: 2 });
  const manifest = JSON.parse(await fs.readFile(path.join(root, 'lib', 'release-manifest.json'), 'utf8'));
  assert.deepEqual(Object.keys(manifest.hashes).sort(), ['0.25.0', '0.26.0']);
});

test('backfill preserves hashes for releases no longer returned by the API', async () => {
  const { root } = await writeFixture({
    hashes: { '0.3.0': { 'apm-linux-x86_64.tar.gz': 'a'.repeat(64) } },
  });

  const result = await backfillReleaseHashes({
    root,
    fetchImpl: releaseFetcher([release('v0.25.0')]),
  });

  assert.deepEqual(result, { updated: true, version: '0.26.0', versions: 2 });
  const manifest = JSON.parse(await fs.readFile(path.join(root, 'lib', 'release-manifest.json'), 'utf8'));
  assert.equal(manifest.hashes['0.3.0']['apm-linux-x86_64.tar.gz'], 'a'.repeat(64));
});

test('backfill rejects a release digest that conflicts with an existing pin', async () => {
  const { root } = await writeFixture({
    hashes: { '0.25.0': { 'apm-linux-x86_64.tar.gz': 'a'.repeat(64) } },
  });

  await assert.rejects(
    () => backfillReleaseHashes({
      root,
      fetchImpl: releaseFetcher([release('v0.25.0')]),
    }),
    /Refusing to replace the pinned SHA-256 digest/,
  );
});

test('backfills available hashes from older releases with incomplete platform support', async () => {
  const { root } = await writeFixture();
  const olderRelease = release('v0.7.8');
  olderRelease.assets = olderRelease.assets.filter((asset) => (
    asset.name === 'apm-linux-x86_64.tar.gz' || asset.name === 'apm-linux-x86_64.tar.gz.sha256'
  ));

  const result = await backfillReleaseHashes({
    root,
    fetchImpl: releaseFetcher([olderRelease]),
  });

  assert.deepEqual(result, { updated: true, version: '0.26.0', versions: 1 });
  const manifest = JSON.parse(await fs.readFile(path.join(root, 'lib', 'release-manifest.json'), 'utf8'));
  assert.deepEqual(manifest.hashes['0.7.8'], {
    'apm-linux-x86_64.tar.gz': '4'.repeat(64),
  });
});

test('follows release pagination before selecting a stable version', async () => {
  const { root } = await writeFixture();
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
