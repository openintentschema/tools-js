// Intent coverage by the reference method of Appendix D, on the worked example of the specification.

import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { CoverageError, coverage, METHOD, passportCoverage, round } from '../src/coverage.ts';
import { criterionSha256, intentSha256 } from '../src/digests.ts';
import type { OisRecord } from '../src/document.ts';
import { main, VERSION } from '../src/main.ts';
import { loadTrustedKeys } from '../src/signing.ts';

const FIXTURES = join(import.meta.dirname, 'fixtures');
const NS = 'https://ois.acme.example';
const INTENT = `${NS}/intents/INT-142@1`;
const BUILD = `${NS}/artifacts/ART-305`;
const EVIDENCE = `${NS}/evidence/EV-9021`;
const SCOPE = [`${INTENT}#AC-1`, `${INTENT}#AC-2`];

const load = (path: string): OisRecord => JSON.parse(readFileSync(join(FIXTURES, path), 'utf8'));
const passport = () => load('valid/passport.json');
const records = (): OisRecord[] => structuredClone(passport().predicate.records);
const byId = (items: OisRecord[], id: string) => items.find((r) => r.id === id) as OisRecord;

function values(items: OisRecord[], options: { intents?: string[]; scope?: string[] } = {}) {
  const result = coverage(items, { subject: BUILD, intents: [INTENT], ...options });
  return Object.fromEntries(result.measurements().map((m) => [m.name, m.value]));
}

function reasons(items: OisRecord[], key: string, scope?: string[]) {
  const result = coverage(items, {
    subject: BUILD,
    intents: [INTENT],
    ...(scope ? { scope } : {}),
  });
  const found = result.criteria.find((c) => c.reference.endsWith(`#${key}`));
  return (found?.reasons ?? []).map(([, why]) => why);
}

test('the worked example has coverage one half', () => {
  const result = passportCoverage(passport());
  assert.deepEqual(
    result.criteria.map((c) => c.reference),
    SCOPE,
  );
  assert.deepEqual(
    result.criteria.map((c) => c.counted),
    [[], [EVIDENCE]],
  );
  assert.deepEqual(result.measurements()[0], {
    name: 'intentCoverage',
    value: 0.5,
    method: METHOD,
  });
});

test('the variants of the worked example', () => {
  assert.deepEqual(values(records(), { scope: SCOPE }), {
    intentCoverage: 0.5,
    intentCoverageAttested: 0, // unsigned, so every context is self-declared (R12)
    intentCoverageWeighted: 0.5,
    intentCoverageDiverse: 0.5,
  });
});

test('without scope every criterion of the intent counts', () => {
  const measured = values(records());
  assert.equal(measured.intentCoverage, 0.3333);
  assert.equal(measured.intentCoverageWeighted, 0.375); // AC-1 high 3, AC-2 high 3, NFR-1 medium 2
});

test('a narrower scope, and none', () => {
  assert.equal(values(records(), { scope: [`${INTENT}#AC-2`] }).intentCoverage, 1);
  const other = [`${NS}/intents/INT-999@1#AC-1`];
  const result = coverage(records(), { subject: BUILD, intents: [INTENT], scope: other });
  assert.deepEqual(result.measurements(), []);
});

for (const [fields, reason] of [
  [{ result: 'fail' }, 'result is fail'],
  [{ derivedFrom: 'implementation' }, 'derivedFrom is implementation'],
  [{ subject: `${NS}/artifacts/ART-301` }, 'neither the release subject nor'],
  [{ observedAt: '2026-10-18T16:40:00Z' }, 'not after its subject was created'],
] as const) {
  test(`evidence that does not count: ${reason}`, () => {
    const items = records();
    Object.assign(byId(items, EVIDENCE), fields);
    assert.equal(values(items, { scope: SCOPE }).intentCoverage, 0);
    assert.ok(reasons(items, 'AC-2', SCOPE).some((why) => why.includes(reason)));
  });
}

test('evidence without subject, and revoked evidence', () => {
  const items = records();
  delete byId(items, EVIDENCE).subject;
  assert.deepEqual(reasons(items, 'AC-2'), ['no subject']);
  const revoked = records();
  revoked.push({
    ois: '0.1',
    type: 'decision',
    id: `${NS}/decisions/DEC-90`,
    createdAt: '2026-10-21T08:00:00Z',
    gate: 'evidence-revocation',
    subject: EVIDENCE,
    outcome: 'rejected',
    decidedBy: `${NS}/actors/qe-2c9d`,
    decidedAt: '2026-10-21T08:00:00Z',
    rationale: 'flaky',
  });
  assert.deepEqual(reasons(revoked, 'AC-2'), [`revoked by ${NS}/decisions/DEC-90`]);
  assert.deepEqual(reasons(records(), 'AC-1'), []);
});

for (const [measures, covered] of [
  [[{ name: 'responseTimeP95', value: 420, unit: 'ms' }], true],
  [[{ name: 'responseTimeP95', value: 500, unit: 'ms' }], true],
  [[{ name: 'responseTimeP95', value: 501, unit: 'ms' }], false],
  [[{ name: 'responseTimeP50', value: 100, unit: 'ms' }], false],
  [[{ name: 'responseTimeP95', value: 'fast' }], false],
  [[], false],
] as const) {
  test(`a target must be met: ${JSON.stringify(measures)}`, () => {
    const items = records();
    const nfr = { ...structuredClone(byId(items, EVIDENCE)), id: `${NS}/evidence/EV-9030` };
    Object.assign(nfr, { criterion: `${INTENT}#NFR-1`, measures });
    items.push(nfr);
    const result = coverage(items, { subject: BUILD, intents: [INTENT] });
    const found = result.criteria.find((c) => c.reference.endsWith('#NFR-1'));
    assert.equal(found?.covered, covered);
    if (!covered) assert.match(found?.reasons[0]?.[1] ?? '', /responseTimeP95 lte 500/);
  });
}

test('diverse producers', () => {
  const same = records();
  byId(same, `${NS}/actors/qe-agent`).model = {
    provider: 'ExampleAI',
    name: 'model-a',
    version: '2026-10',
  };
  assert.equal(values(same, { scope: SCOPE }).intentCoverageDiverse, 0);
  const human = records();
  byId(human, `${NS}/artifacts/ART-304`).producedBy = `${NS}/actors/qe-2c9d`;
  byId(human, `${NS}/actors/qe-agent`).model = byId(human, `${NS}/actors/dev-agent`).model;
  assert.equal(values(human, { scope: SCOPE }).intentCoverageDiverse, 0.5);
});

test('several intents are counted together', () => {
  const items = records();
  const other = structuredClone(items.find((r) => r.type === 'intent') as OisRecord);
  other.id = `${NS}/intents/INT-143`;
  other.criteria = other.criteria.slice(0, 1);
  for (const c of other.criteria) c.digest = { sha256: criterionSha256(c) };
  other.digest = { sha256: intentSha256(other) };
  items.push(other);
  const result = coverage(items, { subject: BUILD, intents: [INTENT, `${NS}/intents/INT-143@1`] });
  assert.equal(result.criteria.length, 4);
  assert.equal(result.measurements()[0]?.value, 0.25);
});

test('the release subject is needed', () => {
  const statement = passport();
  statement.predicate.records = statement.predicate.records.filter(
    (r: OisRecord) => r.id !== `${NS}/decisions/DEC-81`,
  );
  assert.throws(() => passportCoverage(statement), CoverageError);
  assert.throws(
    () => coverage(records(), { subject: `${NS}/x`, intents: [INTENT] }),
    /release subject/,
  );
});

test('a signed passport counts its signers for the attested variant', () => {
  const keys = loadTrustedKeys([join(FIXTURES, 'keys')]);
  const signed = passportCoverage(load('valid/signed-passport.json'), keys);
  const unsigned = passportCoverage(load('valid/signed-passport.json'));
  const attested = (c: typeof signed) => c.measurements()[1]?.value;
  assert.ok((attested(signed) ?? 0) > 0);
  assert.equal(attested(unsigned), 0);
});

test('rounding to four decimals, half to even as in the Python tools', () => {
  assert.equal(round(1 / 3), 0.3333);
  assert.equal(round(1 / 32), 0.0312);
  assert.equal(round(3 / 32), 0.0938);
  assert.equal(round(1), 1);
});

// --- command line -------------------------------------------------------------------------------

function run(argv: string[]) {
  let out = '';
  let err = '';
  const io = {
    out: (t: string) => {
      out += t;
    },
    err: (t: string) => {
      err += t;
    },
    stdin: () => '',
    version: VERSION,
  };
  return { code: main(['coverage', ...argv], io), out, err };
}

function written(statement: OisRecord): string {
  const directory = mkdtempSync(join(tmpdir(), 'ois-coverage-'));
  const path = join(directory, 'passport.json');
  writeFileSync(path, JSON.stringify(statement));
  return path;
}

test('the command line checks the declared coverage', () => {
  const good = run([join(FIXTURES, 'valid/passport.json')]);
  assert.equal(good.code, 0);
  assert.match(good.out, new RegExp(`${INTENT}#AC-1 {2}not covered`));
  assert.match(good.out, new RegExp(`${INTENT}#AC-2 {2}covered {2}${EVIDENCE}`));
  assert.match(good.out, /intentCoverage 0\.5 \(declared 0\.5\)/);
  const claimed = passport();
  claimed.predicate.assessments[0].value = 0.9;
  const bad = run([written(claimed)]);
  assert.equal(bad.code, 1);
  assert.match(bad.err, /declared intentCoverage 0\.9, computed 0\.5/);
});

test('the command line rounds to the declared precision', () => {
  const statement = passport();
  delete statement.predicate.scope;
  statement.predicate.assessments[0].value = 0.33;
  assert.equal(run([written(statement)]).code, 0);
});

test('the command line on records before the passport', () => {
  const directory = join(mkdtempSync(join(tmpdir(), 'ois-records-')), '.ois');
  mkdirSync(directory);
  records().forEach((record, index) => {
    writeFileSync(join(directory, `${index}.ois.json`), JSON.stringify(record));
  });
  const scoped = run([directory, '--build', BUILD, '--scope', `${INTENT}#AC-2`]);
  assert.equal(scoped.code, 0);
  assert.match(scoped.out, /intentCoverage 1\.0/);
  assert.equal(run([directory]).code, 2); // records need --build
});

test('the command line writes markdown', () => {
  const claimed = passport();
  claimed.predicate.assessments[0].value = 0.9;
  const { code, out } = run([written(claimed), '--format', 'markdown']);
  assert.equal(code, 1);
  assert.ok(out.startsWith('### Intent coverage\n'));
  assert.ok(out.includes('| intentCoverage | 50 % | 90 %, differs |'));
  assert.ok(
    out.includes('| `INT-142@1#AC-2` | WHEN an address cannot be assigned to a canton, THE portal'),
  );
  assert.ok(out.includes('… | covered | `EV-9021` |'));
});
