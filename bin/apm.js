#!/usr/bin/env node
'use strict';

const { main } = require('../lib/run');

main().then(
  (exitCode) => {
    process.exitCode = exitCode;
  },
  (error) => {
    process.exitCode = 1;
    console.error(`microsoft-apm: ${error.message}`);
  },
);
