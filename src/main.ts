// Command line interface: ois <command> [ARGS...]; each command parses its own arguments.

import { readFileSync } from 'node:fs';

import { type Io, main as validate } from './validate-cli.ts';

const EXIT_USAGE = 2;
const COMMANDS: Record<string, [string, (argv: string[], io: Io) => number]> = {
  validate: ['check records, bundles and passports against the specification', validate],
};

export const VERSION: string = JSON.parse(
  readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
).version;

export const PROCESS_IO: Io = {
  out: (text) => process.stdout.write(text),
  err: (text) => process.stderr.write(text),
  stdin: () => readFileSync(0, 'utf8'),
  version: VERSION,
};

export function main(argv: string[], io: Io = PROCESS_IO): number {
  const [name, ...rest] = argv;
  if (name === undefined) {
    io.err(`${usage()}\n`);
    return EXIT_USAGE;
  }
  if (name === '-h' || name === '--help') {
    io.out(`${usage()}\n`);
    return 0;
  }
  if (name === '--version') {
    io.out(`${VERSION}\n`);
    return 0;
  }
  const command = COMMANDS[name];
  if (command === undefined) {
    io.err(`ois: unknown command '${name}'\n\n${usage()}\n`);
    return EXIT_USAGE;
  }
  return command[1](rest, io);
}

function usage(): string {
  const width = Math.max(...Object.keys(COMMANDS).map((name) => name.length));
  const lines = Object.entries(COMMANDS).map(
    ([name, [help]]) => `  ${name.padEnd(width)}  ${help}`,
  );
  return [
    'usage: ois <command> [ARGS...]',
    '',
    'Tools for the Open Intent Schema (OIS). Commands:',
    '',
    ...lines,
    '',
    'ois <command> --help shows the options of a command; ois --version the version.',
  ].join('\n');
}
