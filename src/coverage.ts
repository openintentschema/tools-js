// Intent coverage by the reference method of Appendix D and its variants. Several listed intents
// are counted together (section 8.2).

import type { TrustMaterial } from '@sigstore/verify';

import { equal } from './digests.ts';
import { Document, NOBODY, type OisRecord, type Signers, split } from './document.ts';
import { isSigstoreBundle, openSigstoreBundle } from './keyless.ts';
import { criterion as criterionOf, selfDeclared } from './rules.ts';
import { isObject, STATEMENT_TYPE } from './schema.ts';
import { isEnvelope, openEnvelope, type TrustedKey } from './signing.ts';

export const METHOD = 'https://openintentschema.io/methods/basic-intent-coverage/v0.1';
const NAMES = [
  'intentCoverage',
  'intentCoverageAttested',
  'intentCoverageWeighted',
  'intentCoverageDiverse',
];
const WEIGHTS: Record<string, number> = { high: 3, medium: 2, low: 1 };
export const OPERATORS: Record<string, (a: number, b: number) => boolean> = {
  lt: (a, b) => a < b,
  lte: (a, b) => a <= b,
  gt: (a, b) => a > b,
  gte: (a, b) => a >= b,
  eq: (a, b) => a === b,
};

export class CoverageError extends Error {}

export interface Criterion {
  reference: string; // <intent>@<version>#<key>
  statement: string;
  weight: number;
  counted: string[]; // evidence ids that count
  attested: string[]; // of those, the ones whose test context is not self-declared
  diverse: string[]; // of those, the ones with diverse producers
  reasons: [string, string][]; // (evidence id, why it does not count)
  covered: boolean;
}

export interface Measurement {
  name: string;
  value: number;
  method: string;
}

export class Coverage {
  readonly criteria: Criterion[];

  constructor(criteria: Criterion[]) {
    this.criteria = criteria;
  }

  /** intentCoverage and its variants, rounded to four decimals; none without criteria. */
  measurements(): Measurement[] {
    if (!this.criteria.length) return [];
    const total = this.criteria.reduce((sum, c) => sum + c.weight, 0);
    const share = (covered: (c: Criterion) => boolean) =>
      this.criteria.filter(covered).length / this.criteria.length;
    const fractions = [
      share((c) => c.counted.length > 0),
      share((c) => c.attested.length > 0),
      this.criteria.filter((c) => c.counted.length).reduce((sum, c) => sum + c.weight, 0) / total,
      share((c) => c.diverse.length > 0),
    ];
    return NAMES.map((name, i) => ({ name, value: round(fractions[i] ?? 0), method: METHOD }));
  }
}

/** Coverage of a passport: its intents and scope, for the build its release decision names. A
 * signed passport counts its verified signers for the attested variant (R12). */
export function passportCoverage(
  document: unknown,
  trustedKeys: Iterable<TrustedKey> = [],
  trustedRoots: Iterable<TrustMaterial> = [],
): Coverage {
  let statement = document;
  let signers = NOBODY;
  if (isEnvelope(document)) {
    ({ payload: statement, signers } = openEnvelope(document, trustedKeys));
  } else if (isSigstoreBundle(document)) {
    ({ payload: statement, signers } = openSigstoreBundle(document, trustedRoots));
  }
  if (!isObject(statement) || statement._type !== STATEMENT_TYPE) {
    throw new CoverageError('not a passport: expected an in-toto Statement');
  }
  const predicate = statement.predicate as OisRecord;
  const subject = Array.isArray(statement.subject) ? statement.subject : [];
  const subjects = subject.filter(isObject).map((s) => s.digest as Record<string, string>);
  const build = releaseSubject(documentOf(predicate.records), subjects);
  if (build === undefined) {
    throw new CoverageError(
      'no release decision approves a build whose digest matches the statement subject (R16)',
    );
  }
  return coverage(predicate.records, {
    subject: build.id,
    intents: predicate.intents,
    ...(predicate.scope ? { scope: predicate.scope } : {}),
    signers,
  });
}

/** The build artifact of an approved or passed release decision that matches a subject. */
export function releaseSubject(
  document: Document,
  subjects: Record<string, string>[],
): OisRecord | undefined {
  for (const entry of document.ofType('decision')) {
    const decision = entry.record;
    if (decision.gate !== 'release' || !['approved', 'passed'].includes(decision.outcome)) continue;
    const build = document.record(decision.subject);
    if (
      build?.type === 'artifact' &&
      build.kind === 'build' &&
      subjects.some((s) => isObject(s) && equal(build.digest, s))
    ) {
      return build;
    }
  }
  return undefined;
}

/** Coverage of the listed intent versions for the release subject (an artifact id); `signers`
 * signed the document carrying the records (R12). */
export function coverage(
  records: OisRecord[],
  options: { subject: string; intents: string[]; scope?: string[]; signers?: Signers },
): Coverage {
  const document = documentOf(records, options.signers);
  const release = document.record(options.subject);
  if (release?.type !== 'artifact') {
    throw new CoverageError(
      `the release subject ${options.subject} is not an artifact among the records`,
    );
  }
  const criteria: Criterion[] = [];
  for (const listed of options.intents) {
    const intent = document.record(listed);
    if (intent?.type !== 'intent') continue;
    const reference = `${intent.id}@${intent.version}`;
    for (const required of intent.criteria as OisRecord[]) {
      if (options.scope !== undefined && !options.scope.includes(`${reference}#${required.key}`)) {
        continue;
      }
      criteria.push(criterionCoverage(document, intent, required, release));
    }
  }
  return new Coverage(criteria);
}

/** Rounded to `digits` decimals, half to even on exact ties. */
export function round(value: number, digits = 4): number {
  const factor = 10 ** digits;
  const scaled = value * factor;
  const floor = Math.floor(scaled);
  if (scaled - floor === 0.5 && (floor + 0.5) / factor === value) {
    return (floor % 2 === 0 ? floor : floor + 1) / factor;
  }
  return Number(value.toFixed(digits));
}

function criterionCoverage(
  document: Document,
  intent: OisRecord,
  required: OisRecord,
  release: OisRecord,
): Criterion {
  const counted: string[] = [];
  const attested: string[] = [];
  const diverse: string[] = [];
  const reasons: [string, string][] = [];
  for (const entry of document.ofType('evidence')) {
    const evidence = entry.record;
    let why = relevance(document, evidence, intent, required);
    if (why === '') continue; // evidence for another criterion
    why ??= reason(document, evidence, required, release);
    if (why !== undefined) {
      reasons.push([evidence.id, why]);
      continue;
    }
    counted.push(evidence.id);
    const test = document.record(evidence.test) ?? {};
    if (selfDeclared(test, document) === undefined) attested.push(evidence.id);
    if (isDiverse(document, test, document.record(evidence.subject) ?? {}))
      diverse.push(evidence.id);
  }
  return {
    reference: `${intent.id}@${intent.version}#${required.key}`,
    statement: required.statement,
    weight: WEIGHTS[required.criticality ?? ''] ?? 1,
    counted,
    attested,
    diverse,
    reasons,
    covered: counted.length > 0,
  };
}

/** undefined if the evidence is for this criterion now; why not if it is for the same criterion
 * in another version; "" if it concerns another criterion. */
function relevance(
  document: Document,
  evidence: OisRecord,
  intent: OisRecord,
  required: OisRecord,
): string | undefined {
  const [base, rest = ''] = split(evidence.criterion, '@');
  const [version, key = ''] = split(rest, '#');
  if (base !== intent.id || key !== required.key) return '';
  if (version === String(intent.version)) return undefined;
  if (Number(version) > intent.version) return `for the later version ${version}`;
  const earlier = document.record(`${base}@${version}`);
  const seen = earlier !== undefined ? criterionOf(earlier, key) : undefined;
  if (seen === undefined || !equal(seen.digest ?? {}, required.digest ?? {})) {
    return `stale: the criterion changed since version ${version}`;
  }
  return undefined;
}

/** Why a counted-evidence condition of Appendix D fails, or undefined if all hold. */
function reason(
  document: Document,
  evidence: OisRecord,
  required: OisRecord,
  release: OisRecord,
): string | undefined {
  if (evidence.result !== 'pass') return `result is ${evidence.result}`;
  if (evidence.derivedFrom !== 'intent') return `derivedFrom is ${evidence.derivedFrom}`;
  const subject: string | undefined = evidence.subject;
  if (subject === undefined) return 'no subject';
  if (subject !== release.id && !(release.inputs ?? []).includes(subject)) {
    return `subject ${subject} is neither the release subject nor one of its inputs`;
  }
  for (const entry of document.ofType('decision')) {
    if (entry.record.gate === 'evidence-revocation' && entry.record.subject === evidence.id) {
      return `revoked by ${entry.record.id}`;
    }
  }
  const produced = document.record(subject);
  if (produced === undefined) return `subject ${subject} is not among the records`;
  if (Date.parse(evidence.observedAt) <= Date.parse(produced.createdAt)) {
    return `observed at ${evidence.observedAt}, not after its subject was created at ${produced.createdAt}`;
  }
  const target = required.target;
  if (target !== undefined && !meets(evidence.measures ?? [], target)) {
    return `no measure ${target.metric} ${target.operator} ${target.value}`;
  }
  return undefined;
}

function meets(measures: OisRecord[], target: OisRecord): boolean {
  const compare = OPERATORS[target.operator];
  return measures.some(
    (m) =>
      m.name === target.metric &&
      typeof m.value === 'number' &&
      compare !== undefined &&
      compare(m.value, target.value),
  );
}

/** At least one producer is human, or both are agents whose models share no provider and name. */
function isDiverse(document: Document, test: OisRecord, subject: OisRecord): boolean {
  const [first, second] = [test, subject].map((r) => document.record(r.producedBy ?? ''));
  if (first?.type !== 'actor' || second?.type !== 'actor') return false;
  if (first.kind === 'human' || second.kind === 'human') return true;
  if (first.kind !== 'agent' || second.kind !== 'agent') return false;
  return !models(first).some((a) =>
    models(second).some((b) => a.provider === b.provider && a.name === b.name),
  );
}

function models(agent: OisRecord): OisRecord[] {
  return Array.isArray(agent.model) ? agent.model : [agent.model];
}

function documentOf(records: OisRecord[], signers: Signers = NOBODY): Document {
  return new Document(
    records.map((record, i) => ({ record, path: `$.records[${i}]` })),
    { signers },
  );
}
