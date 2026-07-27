'use strict';

const { createHash } = require('node:crypto');
const { createReadStream, createWriteStream } = require('node:fs');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { pipeline } = require('node:stream/promises');
const { Readable } = require('node:stream');
const { createGunzip } = require('node:zlib');
const tar = require('tar-stream');
const yauzl = require('yauzl');

const { DEFAULT_VERSION, resolveRelease } = require('./release');

const INSTALLATION_MARKER = '.microsoft-apm-npm-layout-v2';

function cacheRoot(environment, platform) {
  if (environment.MICROSOFT_APM_CACHE_DIR) {
    return path.resolve(environment.MICROSOFT_APM_CACHE_DIR);
  }

  if (platform === 'win32' && environment.LOCALAPPDATA) {
    return path.join(environment.LOCALAPPDATA, 'microsoft-apm');
  }

  return path.join(environment.XDG_CACHE_HOME || path.join(os.homedir(), '.cache'), 'microsoft-apm');
}

async function isUsableFile(file) {
  try {
    await fs.access(file, process.platform === 'win32' ? fs.constants.F_OK : fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

async function isUsableInstallation(directory, release) {
  if (!(await isUsableFile(path.join(directory, release.executable)))) {
    return false;
  }

  try {
    return (await fs.readFile(path.join(directory, INSTALLATION_MARKER), 'utf8')) === release.tag;
  } catch {
    return false;
  }
}

async function download(url, destination) {
  const response = await fetch(url, {
    headers: { 'user-agent': '@mgrilec-vibe/microsoft-apm npm launcher' },
    redirect: 'follow',
  });

  if (!response.ok || !response.body) {
    throw new Error(`Download failed (${response.status} ${response.statusText}) for ${url}.`);
  }

  await pipeline(Readable.fromWeb(response.body), createWriteStream(destination, { flags: 'wx' }));
}

function expectedChecksum(contents) {
  const match = /^\s*([a-f0-9]{64})\s+/im.exec(contents);
  if (!match) {
    throw new Error('Upstream checksum file did not contain a SHA-256 digest.');
  }

  return match[1].toLowerCase();
}

async function sha256(file) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) {
    hash.update(chunk);
  }
  return hash.digest('hex');
}

async function verifyChecksum(archive, checksumFile) {
  const expected = expectedChecksum(await fs.readFile(checksumFile, 'utf8'));
  const actual = await sha256(archive);
  if (actual !== expected) {
    throw new Error(`Downloaded Microsoft APM archive failed SHA-256 verification (expected ${expected}, got ${actual}).`);
  }
}

function archiveRoot(release) {
  return release.archive.replace(/\.(tar\.gz|zip)$/, '');
}

function archiveDestination(installationDirectory, entryName, release) {
  const prefix = `${archiveRoot(release)}/`;
  if (!entryName.startsWith(prefix)) {
    throw new Error(`Archive entry is outside the expected ${archiveRoot(release)} directory: ${entryName}.`);
  }

  const relativePath = entryName.slice(prefix.length);
  if (!relativePath) {
    return null;
  }
  const segments = relativePath.replace(/\/$/, '').split('/');
  if (entryName.includes('\\') || segments.some((segment) => !segment || segment === '.' || segment === '..')) {
    throw new Error(`Archive entry has an unsafe path: ${entryName}.`);
  }


  const destination = path.resolve(installationDirectory, ...relativePath.split('/'));
  if (!destination.startsWith(`${installationDirectory}${path.sep}`)) {
    throw new Error(`Archive entry escapes the installation directory: ${entryName}.`);
  }
  return destination;
}

async function extractTar(archive, installationDirectory, release) {
  const extractor = tar.extract();

  extractor.on('entry', (header, entry, next) => {
    let destination;
    try {
      destination = archiveDestination(installationDirectory, header.name, release);
    } catch (error) {
      entry.resume();
      entry.once('end', () => next(error));
      return;
    }

    if (!destination || header.type === 'directory') {
      Promise.resolve(destination && fs.mkdir(destination, { recursive: true })).then(
        () => {
          entry.resume();
          entry.once('end', next);
        },
        (error) => next(error),
      );
      return;
    }

    if (header.type !== 'file') {
      entry.resume();
      entry.once('end', () => next(new Error(`Archive contains unsupported ${header.type} entry: ${header.name}.`)));
      return;
    }

    fs.mkdir(path.dirname(destination), { recursive: true }).then(
      () => pipeline(entry, createWriteStream(destination, { mode: header.mode, flags: 'wx' })),
    ).then(
      () => next(),
      (error) => next(error),
    );
  });

  await pipeline(createReadStream(archive), createGunzip(), extractor);
}

async function extractZip(archive, installationDirectory, release) {
  const zipfile = await yauzl.openPromise(archive, { lazyEntries: true, validateEntrySizes: true });

  try {
    for await (const entry of zipfile.eachEntry()) {
      const destination = archiveDestination(installationDirectory, entry.fileName, release);
      if (!destination || entry.fileName.endsWith('/')) {
        if (destination) {
          await fs.mkdir(destination, { recursive: true });
        }
        continue;
      }

      await fs.mkdir(path.dirname(destination), { recursive: true });
      const source = await zipfile.openReadStreamPromise(entry);
      await pipeline(source, createWriteStream(destination, { flags: 'wx' }));
    }
  } finally {
    zipfile.close();
  }
}

async function extractArchive(archive, installationDirectory, release) {
  if (release.archive.endsWith('.tar.gz')) {
    await extractTar(archive, installationDirectory, release);
  } else if (release.archive.endsWith('.zip')) {
    await extractZip(archive, installationDirectory, release);
  } else {
    throw new Error(`Unsupported Microsoft APM archive format: ${release.archive}.`);
  }

  const binary = path.join(installationDirectory, release.executable);
  if (!(await isUsableFile(binary))) {
    throw new Error(`Archive did not contain an executable ${release.executable}.`);
  }
  if (process.platform !== 'win32') {
    await fs.chmod(binary, 0o700);
  }
}

async function ensureApmBinary({
  platform = process.platform,
  arch = process.arch,
  environment = process.env,
} = {}) {
  const release = resolveRelease(platform, arch, environment.MICROSOFT_APM_VERSION || DEFAULT_VERSION);
  const root = cacheRoot(environment, platform);
  const installDirectory = path.join(root, release.version, `${platform}-${arch}`);
  const binary = path.join(installDirectory, release.executable);

  if (await isUsableInstallation(installDirectory, release)) {
    return binary;
  }

  await fs.mkdir(path.dirname(installDirectory), { recursive: true });
  await fs.rm(installDirectory, { force: true, recursive: true });
  const temporaryDownloadDirectory = await fs.mkdtemp(path.join(path.dirname(installDirectory), '.download-'));
  const temporaryInstallationDirectory = await fs.mkdtemp(path.join(path.dirname(installDirectory), '.install-'));

  try {
    const archive = path.join(temporaryDownloadDirectory, release.archive);
    const checksum = `${archive}.sha256`;

    await Promise.all([download(release.archiveUrl, archive), download(release.checksumUrl, checksum)]);
    await verifyChecksum(archive, checksum);
    await extractArchive(archive, temporaryInstallationDirectory, release);
    await fs.writeFile(path.join(temporaryInstallationDirectory, INSTALLATION_MARKER), release.tag);

    try {
      await fs.rename(temporaryInstallationDirectory, installDirectory);
    } catch (error) {
      if ((error.code !== 'EEXIST' && error.code !== 'ENOTEMPTY') || !(await isUsableInstallation(installDirectory, release))) {
        throw error;
      }
    }

    if (!(await isUsableInstallation(installDirectory, release))) {
      throw new Error(`Microsoft APM installation did not produce ${binary}.`);
    }
    return binary;
  } finally {
    await Promise.all([
      fs.rm(temporaryDownloadDirectory, { force: true, recursive: true }),
      fs.rm(temporaryInstallationDirectory, { force: true, recursive: true }),
    ]);
  }
}

module.exports = {
  cacheRoot,
  ensureApmBinary,
  expectedChecksum,
  archiveDestination,
  sha256,
};
