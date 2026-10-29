import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

import { main, VERSION } from '../src/main.ts';
import { lineOf } from '../src/sarif.ts';
import type { Io } from '../src/validate-cli.ts';

const FIXTURES = join(import.meta.dirname, 'fixtures');

function run(argv: string[], stdin = ''): { code: number; out: string; err: string } {
  let out = '';
  let err = '';
  const io: Io = {
    out: (t) => {
      out += t;
    },
    err: (t) => {
      err += t;
    },
    stdin: () => stdin,
    version: VERSION,
  };
  return { code: main(argv, io), out, err };
}

const fixture = (path: string) => join(FIXTURES, path);

test('a conforming file', () => {
  const { code, out } = run(['validate', fixture('valid/level-1-bundle.json')]);
  assert.equal(code, 0);
  assert.equal(out, `${fixture('valid/level-1-bundle.json')}: conforms\n`);
});

test('a violation exits with 1 and names rule and path', () => {
  const { code, out } = run(['validate', fixture('invalid/R5/same-producer.json')]);
  assert.equal(code, 1);
  assert.match(out, /: violation \[R5\] \$\.records\[\d+\]\.derivedFrom: test and subject/);
});

test('json output', () => {
  const { out } = run(['validate', '--format', 'json', fixture('valid/bundle.json')]);
  const [first] = JSON.parse(out);
  assert.equal(first.conforms, true);
  assert.ok(first.reports.length > 0);
  assert.ok(
    first.reports.every(
      (r: { rule: string; level: string }) => r.rule === 'R12' && r.level === 'warning',
    ),
  );
});

test('signed passports with trusted keys and roots', () => {
  const keys = ['--trusted-key', fixture('keys')];
  assert.equal(run(['validate', ...keys, fixture('valid/signed-passport.json')]).code, 0);
  const roots = ['--trusted-root', fixture('keys/sigstore-public-good.trusted_root.json')];
  const keyless = run(['validate', ...roots, fixture('valid/keyless-passport.json')]);
  assert.equal(keyless.out, `${fixture('valid/keyless-passport.json')}: conforms\n`);
  const tampered = run(['validate', ...roots, fixture('invalid/signature/keyless-tampered.json')]);
  assert.equal(tampered.code, 1);
  assert.match(tampered.out, /violation \[signature\] \$\.verificationMaterial/);
});

test('a key id given with the key', () => {
  const key = `custom-id=${fixture('keys/passport-issuer.pub')}`;
  const result = run(['validate', '--trusted-key', key, fixture('valid/signed-passport.json')]);
  assert.match(result.out, /key [0-9a-f]{64} is not trusted/);
});

test('profiles by name', () => {
  const passport = fixture('valid/passport.json');
  assert.equal(run(['validate', passport]).code, 0);
  const regulated = run(['validate', '--profile', 'regulated/v0.1', passport]);
  assert.equal(regulated.code, 1);
  assert.match(regulated.out, /\[regulated\/P3\]/);
  const unknown = run(['validate', '--profile', 'banking/v9', passport]);
  assert.equal(unknown.code, 2);
  assert.match(unknown.err, /unknown profile 'banking\/v9'; known: regulated\/v0\.1/);
});

test('stdin and invalid JSON', () => {
  const { code, out } = run(['validate', '-'], '{"ois": ');
  assert.equal(code, 1);
  assert.match(out, /^-: violation \[json\] \$: not valid JSON/);
});

test('usage errors exit with 2', () => {
  assert.equal(run([]).code, 2);
  assert.equal(run(['nonsense']).code, 2);
  assert.equal(run(['validate']).code, 2);
  assert.equal(run(['validate', '--format', 'xml', 'a.json']).code, 2);
  assert.equal(run(['validate', '--colour', 'a.json']).code, 2);
  assert.equal(run(['validate', 'missing.json']).code, 2);
  assert.equal(run(['validate', '--trusted-key', 'missing.pub', 'a.json']).code, 2);
  assert.equal(
    run(['validate', '--trusted-root', fixture('keys/agent-runtime.pub'), 'a.json']).code,
    2,
  );
});

test('help and version', () => {
  assert.match(run(['--help']).out, /validate {2}check records/);
  assert.match(run(['validate', '--help']).out, /^usage: ois validate/);
  assert.equal(run(['--version']).out, `${VERSION}\n`);
});

test('sarif points at lines', () => {
  const path = fixture('invalid/R5/same-producer.json');
  const log = JSON.parse(run(['validate', '--format', 'sarif', path]).out);
  assert.equal(log.version, '2.1.0');
  const [runResult] = log.runs;
  const finding = runResult.results.find((r: { ruleId: string }) => r.ruleId === 'R5');
  const location = finding.locations[0];
  const text = readFileSync(path, 'utf8');
  assert.equal(
    location.physicalLocation.region.startLine,
    lineOf(text, location.logicalLocations[0].fullyQualifiedName),
  );
  assert.equal(runResult.tool.driver.rules[finding.ruleIndex].id, 'R5');
});

test('line of a report path', () => {
  const text =
    '{\n  "records": [\n    {"id": "a"},\n    {\n      "derivedFrom": "intent"\n    }\n  ]\n}\n';
  assert.equal(lineOf(text, '$'), 1);
  assert.equal(lineOf(text, '$.records[0]'), 3);
  assert.equal(lineOf(text, '$.records[1].derivedFrom'), 5);
  assert.equal(lineOf(text, '$.records[1].missing'), 4);
  assert.equal(lineOf(text, '$.records[9]'), 2);
});
