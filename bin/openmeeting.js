#!/usr/bin/env node
// openmeeting CLI entry: forwards argv to src/cli.js and exits with its code.
import { main } from '../src/cli.js';

main(process.argv.slice(2)).then(
  (code) => {
    process.exitCode = code;
  },
  (err) => {
    process.stderr.write(`${(err && err.stack) || err}\n`);
    process.exitCode = 1;
  },
);
