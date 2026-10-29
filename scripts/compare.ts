// Compare this implementation with the Python ois-tools on every conformance fixture.
//
//   node scripts/compare.ts <command that runs the Python ois>...
//   node scripts/compare.ts uvx --from 'ois-tools[sigstore]==0.12.0' ois
//
// validate: per file the same (rule, level, path) reports, and the same message for the
// integrity and profile rules; schema and Sigstore library messages are worded differently.
// coverage: the same output, error output and exit code; for passports also with trust and as
// Markdown.

import { spawnSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';

import { main, VERSION } from '../src/main.ts';

const ROOT = join(import.meta.dirname, '..');
const FIXTURES = join('tests', 'fixtures');
const TRUST = [
  '--trusted-key',
  join(FIXTURES, 'keys'),
  '--trusted-root',
  join(FIXTURES, 'keys', 'sigstore-public-good.trusted_root.json'),
];
const WORDED_ELSEWHERE = new Set(['schema', 'signature', 'json']);

interface Run {
  code: number;
  out: string;
  err: string;
}
interface Reported {
  file: string;
  reports: { rule: string; level: string; path: string; message: string }[];
}

const python = process.argv.slice(2);
if (!python.length) {
  console.error('usage: node scripts/compare.ts <command that runs the Python ois>...');
  process.exit(2);
}

function py(args: string[]): Run {
  const [command = '', ...rest] = python;
  const done = spawnSync(command, [...rest, ...args], { cwd: ROOT, encoding: 'utf8' });
  if (done.error) throw done.error;
  return { code: done.status ?? -1, out: done.stdout, err: done.stderr };
}

function js(args: string[]): Run {
  const run = { code: 0, out: '', err: '' };
  const io = {
    out: (text: string) => {
      run.out += text;
    },
    err: (text: string) => {
      run.err += text;
    },
    stdin: () => '',
    version: VERSION,
  };
  run.code = main(args, io);
  return run;
}

const files = ['valid', 'invalid']
  .flatMap((folder) =>
    readdirSync(join(ROOT, FIXTURES, folder), { recursive: true, encoding: 'utf8' })
      .filter((name) => name.endsWith('.json'))
      .map((name) => join(FIXTURES, folder, name)),
  )
  .sort();
const problems: string[] = [];

const validate = ['validate', '--format', 'json', ...TRUST, ...files];
const pythonReports = JSON.parse(py(validate).out) as Reported[];
const jsReports = JSON.parse(js(validate).out) as Reported[];
for (const [index, file] of files.entries()) {
  const key = (r: Reported['reports'][number]) =>
    JSON.stringify([r.rule, r.level, r.path, WORDED_ELSEWHERE.has(r.rule) ? '' : r.message]);
  const a = [...new Set(pythonReports[index]?.reports.map(key))].sort();
  const b = [...new Set(jsReports[index]?.reports.map(key))].sort();
  if (JSON.stringify(a) !== JSON.stringify(b)) {
    problems.push(
      `validate ${file}:\n  Python ${a.join('\n         ')}\n  JS     ${b.join('\n         ')}`,
    );
  }
}

const passport = (file: string) =>
  /"(_type|payloadType|mediaType)"/.test(readFileSync(join(ROOT, file), 'utf8'));
for (const file of files) {
  const variants = passport(file)
    ? [[], TRUST, ['--format', 'markdown'], [...TRUST, '--format', 'markdown']]
    : [[]];
  for (const extra of variants) {
    const args = ['coverage', file, ...extra];
    const a = py(args);
    const b = js(args);
    if (a.code !== b.code || a.out !== b.out || a.err !== b.err) {
      problems.push(
        `${args.join(' ')}: Python exit ${a.code}, JS exit ${b.code}\n${a.out}${a.err}---\n${b.out}${b.err}`,
      );
    }
  }
}

for (const problem of problems) console.error(problem);
console.log(
  `${files.length} fixtures, validate and coverage: ${problems.length ? `${problems.length} differences` : 'same results'} (${relative(ROOT, join(ROOT, FIXTURES))})`,
);
process.exit(problems.length ? 1 : 0);
