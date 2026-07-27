'use strict';

const { constants } = require('node:os');
const { spawn } = require('node:child_process');
const { ensureApmBinary } = require('./installer');

function signalExitCode(signal) {
  return 128 + (constants.signals[signal] || 1);
}

function run(binary, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(binary, args, { stdio: 'inherit' });
    child.once('error', reject);
    child.once('exit', (code, signal) => resolve(code === null ? signalExitCode(signal) : code));
  });
}

async function main(args = process.argv.slice(2)) {
  const binary = await ensureApmBinary();
  return run(binary, args);
}

module.exports = { main, run, signalExitCode };
