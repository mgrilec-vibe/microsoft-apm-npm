'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');

const { archiveDestination, cacheRoot, expectedChecksum } = require('../lib/installer');

test('uses an explicit cache directory unchanged except for normalization', () => {
  assert.equal(
    cacheRoot({ MICROSOFT_APM_CACHE_DIR: './cache' }, 'linux'),
    path.resolve('./cache'),
  );
});

test('uses the XDG cache directory on non-Windows platforms', () => {
  assert.equal(
    cacheRoot({ XDG_CACHE_HOME: '/var/cache/user' }, 'linux'),
    '/var/cache/user/microsoft-apm',
  );
});

test('uses LOCALAPPDATA on Windows', () => {
  assert.equal(
    cacheRoot({ LOCALAPPDATA: 'C:\\Users\\Agent\\AppData\\Local' }, 'win32'),
    path.join('C:\\Users\\Agent\\AppData\\Local', 'microsoft-apm'),
  );
});

test('parses the SHA-256 digest from a GitHub release sidecar', () => {
  const digest = 'a'.repeat(64);
  assert.equal(expectedChecksum(`${digest}  apm-linux-x86_64.tar.gz\n`), digest);
});

test('rejects malformed checksum sidecars', () => {
  assert.throws(() => expectedChecksum('not a checksum'), /SHA-256 digest/);
});

test('strips the trusted release directory while preserving installation contents', () => {
  const release = { archive: 'apm-linux-x86_64.tar.gz' };
  assert.equal(
    archiveDestination('/cache/apm', 'apm-linux-x86_64/_internal/libpython3.12.so.1.0', release),
    '/cache/apm/_internal/libpython3.12.so.1.0',
  );
});

test('rejects path traversal in archive entries', () => {
  const release = { archive: 'apm-linux-x86_64.tar.gz' };
  assert.throws(
    () => archiveDestination('/cache/apm', 'apm-linux-x86_64/../../outside', release),
    /unsafe path/,
  );
});
