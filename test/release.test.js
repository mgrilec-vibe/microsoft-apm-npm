'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const { DEFAULT_VERSION, normalizeVersion, resolveRelease } = require('../lib/release');

for (const [platform, arch, archive, executable] of [
  ['darwin', 'arm64', 'apm-darwin-arm64.tar.gz', 'apm'],
  ['darwin', 'x64', 'apm-darwin-x86_64.tar.gz', 'apm'],
  ['linux', 'arm64', 'apm-linux-arm64.tar.gz', 'apm'],
  ['linux', 'x64', 'apm-linux-x86_64.tar.gz', 'apm'],
  ['win32', 'x64', 'apm-windows-x86_64.zip', 'apm.exe'],
  ['win32', 'arm64', 'apm-windows-x86_64.zip', 'apm.exe'],
]) {
  test(`resolves ${platform}/${arch}`, () => {
    const release = resolveRelease(platform, arch);
    assert.equal(release.archive, archive);
    assert.equal(release.executable, executable);
    assert.equal(release.version, DEFAULT_VERSION);
    assert.equal(release.archiveUrl, `https://github.com/microsoft/apm/releases/download/v${DEFAULT_VERSION}/${archive}`);
  });
}

test('normalizes a leading v in an explicit version', () => {
  assert.equal(normalizeVersion('v1.2.3-rc.1'), '1.2.3-rc.1');
});

test('rejects versions that cannot be safely embedded in a release URL', () => {
  assert.throws(() => normalizeVersion('latest'), /explicit semantic version/);
  assert.throws(() => normalizeVersion('1.2.3/../other'), /explicit semantic version/);
});

test('rejects targets with no upstream release', () => {
  assert.throws(() => resolveRelease('freebsd', 'x64'), /no native release/);
});
