'use strict';

const { constants } = require('node:os');
const { spawn } = require('node:child_process');
const { ensureApmBinary } = require('./installer');

function signalExitCode(signal) {
  return 128 + (constants.signals[signal] || 1);
}

function assertSupportedCommand(args) {
  if (args[0] === 'self-update') {
    throw new Error(
      'apm self-update is disabled because it would replace the checksum-verified binary. Update this npm package or set MICROSOFT_APM_VERSION instead.',
    );
  }
}

function run(binary, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(binary, args, { stdio: 'inherit' });
    child.once('error', reject);
    child.once('exit', (code, signal) => resolve(code === null ? signalExitCode(signal) : code));
  });
}

async function main(args = process.argv.slice(2)) {
  assertSupportedCommand(args);
  const binary = await ensureApmBinary();
  return run(binary, args);
}

module.exports = { assertSupportedCommand, main, run, signalExitCode };
