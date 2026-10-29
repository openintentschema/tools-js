// The conformance fixtures of the specification (section 11.3): each lists the exact
// (rule, level) pairs a validator must report.

import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

import { loadPublicKey, loadTrustedRoots, validate } from '../src/index.ts';

const FIXTURES = join(import.meta.dirname, 'fixtures');
const EXAMPLES = join(import.meta.dirname, 'examples');
const manifest = JSON.parse(readFileSync(join(FIXTURES, 'manifest.json'), 'utf8')) as {
  trustedKeys: string[];
  trustedRoots: string[];
  fixtures: { path: string; description: string; expect: { rule: string; level: string }[] }[];
};
const trustedKeys = manifest.trustedKeys.map((path) =>
  loadPublicKey(readFileSync(join(FIXTURES, path))),
);
const trustedRoots = loadTrustedRoots(manifest.trustedRoots.map((path) => join(FIXTURES, path)));

for (const entry of manifest.fixtures) {
  test(entry.path, () => {
    const document = JSON.parse(readFileSync(join(FIXTURES, entry.path), 'utf8'));
    const result = validate(document, { trustedKeys, trustedRoots });
    const reported = new Set(result.reports.map((r) => `${r.rule} ${r.level}`));
    const expected = new Set(entry.expect.map((e) => `${e.rule} ${e.level}`));
    assert.deepEqual([...reported].sort(), [...expected].sort(), entry.description);
  });
}

test('every fixture is in the manifest', () => {
  const onDisk = ['valid', 'invalid'].flatMap((folder) =>
    readdirSync(join(FIXTURES, folder), { recursive: true, encoding: 'utf8' })
      .filter((name) => name.endsWith('.json'))
      .map((name) => `${folder}/${name}`),
  );
  assert.deepEqual(onDisk.sort(), manifest.fixtures.map((e) => e.path).sort());
});

for (const name of readdirSync(EXAMPLES)) {
  test(`example ${name} passes the schema`, () => {
    const document = JSON.parse(readFileSync(join(EXAMPLES, name), 'utf8'));
    const schema = validate(document).reports.filter((r) => r.rule === 'schema');
    assert.deepEqual(schema, []);
  });
}
