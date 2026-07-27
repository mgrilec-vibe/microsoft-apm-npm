'use strict';

const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { downloadDispatcher, verifyChecksum, withInstallLock } = require('../lib/installer');
const { assertSupportedCommand } = require('../lib/run');

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

test('serializes concurrent installation of the same cache target', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'microsoft-apm-lock-'));
  const installation = path.join(directory, '0.26.0', 'linux-x64');
  await fs.mkdir(path.dirname(installation), { recursive: true });
  const events = [];
  const environment = {
    MICROSOFT_APM_LOCK_TIMEOUT_MS: '1000',
    MICROSOFT_APM_LOCK_STALE_MS: '10000',
  };

  try {
    const first = withInstallLock(installation, environment, async () => {
      events.push('first-start');
      await delay(50);
      events.push('first-end');
    });
    await delay(5);
    const second = withInstallLock(installation, environment, async () => {
      events.push('second-start');
      events.push('second-end');
    });

    await Promise.all([first, second]);
    assert.deepEqual(events, ['first-start', 'first-end', 'second-start', 'second-end']);
  } finally {
    await fs.rm(directory, { force: true, recursive: true });
  }
});

test('reclaims an abandoned lock after its stale interval', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'microsoft-apm-stale-lock-'));
  const installation = path.join(directory, '0.26.0', 'linux-x64');
  const lock = `${installation}.lock`;
  await fs.mkdir(lock, { recursive: true });
  await fs.writeFile(path.join(lock, 'owner.json'), '{}\n');
  const staleTime = new Date(Date.now() - 10_000);
  await fs.utimes(path.join(lock, 'owner.json'), staleTime, staleTime);

  try {
    let acquired = false;
    await withInstallLock(
      installation,
      { MICROSOFT_APM_LOCK_TIMEOUT_MS: '1000', MICROSOFT_APM_LOCK_STALE_MS: '1' },
      async () => {
        acquired = true;
      },
    );
    assert.equal(acquired, true);
  } finally {
    await fs.rm(directory, { force: true, recursive: true });
  }
});

test('preserves the checksum-managed update boundary', () => {
  assert.doesNotThrow(() => assertSupportedCommand(['install', 'microsoft/apm']));
  assert.throws(() => assertSupportedCommand(['self-update']), /self-update is disabled/);
});

test('requires the upstream sidecar to agree with a wrapper-pinned checksum', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'microsoft-apm-checksum-'));
  const archive = path.join(directory, 'apm.tar.gz');
  const checksum = `${archive}.sha256`;
  const contents = 'verified Microsoft APM artifact';
  const digest = createHash('sha256').update(contents).digest('hex');
  await fs.writeFile(archive, contents);
  await fs.writeFile(checksum, `${digest}  apm.tar.gz\n`);

  try {
    await verifyChecksum(archive, checksum, digest);
    await assert.rejects(
      verifyChecksum(archive, checksum, '0'.repeat(64)),
      /does not match this wrapper's pinned release digest/,
    );
  } finally {
    await fs.rm(directory, { force: true, recursive: true });
  }
});

test('creates an environment-aware proxy dispatcher only when a proxy is configured', async () => {
  assert.equal(downloadDispatcher({}), undefined);
  const dispatcher = downloadDispatcher({
    HTTPS_PROXY: 'http://proxy.example:8080',
    NO_PROXY: 'localhost,.internal.example',
  });
  try {
    assert.equal(typeof dispatcher.dispatch, 'function');
  } finally {
    await dispatcher.close();
  }
});
