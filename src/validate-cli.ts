// Command line interface: ois validate FILE...

import { readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import type { TrustMaterial } from '@sigstore/verify';

import { loadTrustedRoots } from './keyless.ts';
import { ProfileError, resolveProfile } from './profiles.ts';
import { type Result, result } from './report.ts';
import { toSarif } from './sarif.ts';
import { loadTrustedKeys, SigningError, type TrustedKey } from './signing.ts';
import { validate } from './validator.ts';

export interface Io {
  out: (text: string) => void;
  err: (text: string) => void;
  stdin: () => string;
  version: string;
}

const EXIT_CONFORMS = 0;
const EXIT_VIOLATION = 1;
const EXIT_USAGE = 2;
const FORMATS = ['text', 'json', 'sarif'];
const USAGE = `usage: ois validate [-h] [--format {text,json,sarif}] [--trusted-key KEY]
                    [--trusted-root FILE] [--profile PROFILE]
                    FILE [FILE ...]

Validate OIS records, bundles and Quality Passports.

positional arguments:
  FILE                  JSON file, or - for stdin

options:
  -h, --help            show this help message and exit
  --format {text,json,sarif}
  --trusted-key KEY     public key (PEM) to verify signatures; a directory of
                        *.pub files, or KEYID=FILE
  --trusted-root FILE   Sigstore trusted root (JSON, or JSON lines from gh
                        attestation trusted-root)
  --profile PROFILE     also check this profile, by URI or name
                        (regulated/v0.1); records may list it too
`;

export function main(argv: string[], io: Io): number {
  let parsed: ReturnType<typeof parse>;
  try {
    parsed = parse(argv);
  } catch (error) {
    io.err(`${USAGE.split('\n\n')[0]}\nois validate: error: ${(error as Error).message}\n`);
    return EXIT_USAGE;
  }
  const { values, positionals } = parsed;
  if (values.help) {
    io.out(USAGE);
    return EXIT_CONFORMS;
  }
  const format = values.format ?? 'text';
  if (!FORMATS.includes(format) || !positionals.length) {
    const problem = positionals.length
      ? `argument --format: invalid choice: '${format}' (choose from ${FORMATS.join(', ')})`
      : 'the following arguments are required: FILE';
    io.err(`${USAGE.split('\n\n')[0]}\nois validate: error: ${problem}\n`);
    return EXIT_USAGE;
  }

  let profiles: string[];
  let trustedKeys: TrustedKey[];
  let trustedRoots: TrustMaterial[];
  try {
    profiles = (values.profile ?? []).map(resolveProfile);
    trustedKeys = loadTrustedKeys(values['trusted-key'] ?? []);
    trustedRoots = loadTrustedRoots(values['trusted-root'] ?? []);
  } catch (error) {
    if (!(error instanceof SigningError || error instanceof ProfileError || isFileError(error))) {
      throw error;
    }
    io.err(`ois validate: ${(error as Error).message}\n`);
    return EXIT_USAGE;
  }

  const results = new Map<string, [string, Result]>();
  for (const name of positionals) {
    let text: string;
    try {
      text = name === '-' ? io.stdin() : readFileSync(name, 'utf8');
    } catch (error) {
      io.err(`ois validate: ${name}: ${(error as Error).message}\n`);
      return EXIT_USAGE;
    }
    results.set(name, [text, check(text, trustedKeys, trustedRoots, profiles)]);
  }

  if (format === 'sarif') {
    io.out(`${JSON.stringify(toSarif(results, io.version), null, 2)}\n`);
  } else if (format === 'json') {
    const out = [...results].map(([file, [, r]]) => ({
      file,
      conforms: r.conforms,
      reports: r.reports,
    }));
    io.out(`${JSON.stringify(out, null, 2)}\n`);
  } else {
    for (const [name, [, r]] of results) {
      if (!r.reports.length) io.out(`${name}: conforms\n`);
      for (const report of r.reports) {
        io.out(`${name}: ${report.level} [${report.rule}] ${report.path}: ${report.message}\n`);
      }
    }
  }
  return [...results.values()].every(([, r]) => r.conforms) ? EXIT_CONFORMS : EXIT_VIOLATION;
}

function parse(argv: string[]) {
  return parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      help: { type: 'boolean', short: 'h' },
      format: { type: 'string' },
      'trusted-key': { type: 'string', multiple: true },
      'trusted-root': { type: 'string', multiple: true },
      profile: { type: 'string', multiple: true },
    },
  });
}

function check(
  text: string,
  trustedKeys: TrustedKey[],
  trustedRoots: TrustMaterial[],
  profiles: string[],
): Result {
  let document: unknown;
  try {
    document = JSON.parse(text);
  } catch (error) {
    const message = `not valid JSON: ${(error as Error).message}`;
    return result([{ level: 'violation', rule: 'json', message, path: '$' }]);
  }
  return validate(document, { trustedKeys, trustedRoots, profiles });
}

function isFileError(error: unknown): boolean {
  return error instanceof Error && 'code' in error && typeof error.code === 'string';
}
