// Copy schema, examples and fixtures from a checkout of the specification repository.
//
//   node scripts/sync-spec.ts [SPEC_DIR]          copy and record the commit in spec.lock
//   node scripts/sync-spec.ts --check SPEC_DIR    fail if a copy differs from SPEC_DIR
//
// SPEC_DIR defaults to ../openintentschema. Copying requires a clean checkout, so that spec.lock
// names a commit that holds exactly what was copied.

import { execFileSync } from 'node:child_process';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const LOCK = join(ROOT, 'spec.lock');
const REPOSITORY = 'https://github.com/openintentschema/openintentschema';
const FILES: Record<string, string> = { 'schema/ois.schema.json': 'schema/ois-0.1.schema.json' };
const TREES: Record<string, string> = { examples: 'tests/examples', fixtures: 'tests/fixtures' };
const COPIED = /\.(json|pub)$/; // documents and the fixtures' public test keys

function files(tree: string): string[] {
  if (!existsSync(tree)) return [];
  return readdirSync(tree, { recursive: true, encoding: 'utf8' })
    .filter((name) => COPIED.test(name))
    .map((name) => join(tree, name))
    .sort();
}

function pairs(spec: string): Map<string, string> {
  const result = new Map<string, string>();
  for (const [source, copy] of Object.entries(FILES))
    result.set(join(ROOT, copy), join(spec, source));
  for (const [source, copy] of Object.entries(TREES)) {
    for (const path of files(join(spec, source))) {
      result.set(join(ROOT, copy, relative(join(spec, source), path)), path);
    }
  }
  return result;
}

function check(spec: string): string[] {
  const expected = pairs(spec);
  const problems: string[] = [];
  for (const [copy, source] of expected) {
    if (!existsSync(copy) || !readFileSync(copy).equals(readFileSync(source))) {
      problems.push(`${relative(ROOT, copy)}: differs from the specification`);
    }
  }
  for (const tree of Object.values(TREES)) {
    for (const stray of files(join(ROOT, tree))) {
      if (!expected.has(stray)) problems.push(`${relative(ROOT, stray)}: not in the specification`);
    }
  }
  return problems;
}

function head(spec: string): string {
  const git = (...args: string[]) =>
    execFileSync('git', ['-C', spec, ...args], { encoding: 'utf8' }).trim();
  if (git('status', '--porcelain')) {
    console.error(`${spec} has uncommitted changes; commit them first`);
    process.exit(1);
  }
  return git('rev-parse', 'HEAD');
}

function sync(spec: string): void {
  const commit = head(spec);
  for (const tree of Object.values(TREES))
    rmSync(join(ROOT, tree), { recursive: true, force: true });
  const copies = pairs(spec);
  for (const [copy, source] of copies) {
    mkdirSync(dirname(copy), { recursive: true });
    copyFileSync(source, copy);
  }
  writeFileSync(LOCK, `repository = "${REPOSITORY}"\ncommit = "${commit}"\n`);
  console.log(`copied ${copies.size} files from ${commit}`);
}

const args = process.argv.slice(2);
const checking = args.includes('--check');
const spec = resolve(args.find((a) => a !== '--check') ?? join(ROOT, '..', 'openintentschema'));
if (checking) {
  const locked = /commit = "([0-9a-f]+)"/.exec(readFileSync(LOCK, 'utf8'))?.[1];
  const problems = check(spec);
  for (const problem of problems) console.error(problem);
  if (problems.length) console.error(`copies do not match ${REPOSITORY} at ${locked}`);
  process.exit(problems.length ? 1 : 0);
}
sync(spec);
