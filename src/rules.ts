// Integrity rules of spec section 5, checked on input that passed the schema. How each rule is
// read is fixed by the conformance fixtures (fixtures/README.md in the specification repository).
// A check that needs the record behind an unresolved reference skips it; R10 reports it once.

import { isDeepStrictEqual } from 'node:util';

import { criterionSha256, type Digest, equal, intentSha256 } from './digests.ts';
import { type Document, type Entry, type OisRecord, split } from './document.ts';
import type { Report } from './report.ts';

type Rule = (document: Document) => Generator<Report>;

/** R1: an approved intent has an approved intent-approval decision bound to its digest; the
 * approving actor SHOULD be human (info). */
function* r1Approval(document: Document): Generator<Report> {
  for (const entry of document.ofType('intent')) {
    const intent = entry.record;
    if (intent.status !== 'approved') continue;
    const subject = `${intent.id}@${intent.version}`;
    const approvals = document
      .ofType('decision')
      .filter(
        (d) =>
          d.record.gate === 'intent-approval' &&
          d.record.subject === subject &&
          d.record.outcome === 'approved' &&
          equal(d.record.subjectDigest ?? {}, intent.digest),
      );
    if (!approvals.length) {
      const message = `${subject} is approved, but no intent-approval decision approves it with a subjectDigest equal to its digest`;
      yield report('violation', 'R1', message, entry.path);
    }
    for (const decision of approvals) {
      const decidedBy = decision.record.decidedBy;
      if (isHuman(document, decidedBy) === false) {
        yield report(
          'info',
          'R1',
          `${subject} SHOULD be approved by a human, not ${decidedBy}`,
          `${decision.path}.decidedBy`,
        );
      }
    }
  }
}

/** R2: a criterion reference names a key that exists in that intent version. */
function* r2CriterionReferences(document: Document): Generator<Report> {
  for (const reference of document.references()) {
    const [intentRef, key] = split(reference.value, '#');
    const intent = key ? document.record(intentRef) : undefined;
    if (intent !== undefined && key !== undefined && criterion(intent, key) === undefined) {
      yield report('violation', 'R2', `${intentRef} has no criterion '${key}'`, reference.path);
    }
  }
}

/** R3: evidence names an artifact of kind test as test, and code or build as subject. */
function* r3EvidenceTargets(document: Document): Generator<Report> {
  for (const entry of document.ofType('evidence')) {
    for (const [name, kinds] of [
      ['test', ['test']],
      ['subject', ['code', 'build']],
    ] as const) {
      if (!(name in entry.record)) continue;
      const target = document.record(entry.record[name]);
      if (
        target !== undefined &&
        (target.type !== 'artifact' || !(kinds as readonly string[]).includes(target.kind))
      ) {
        const message = `${name} must be an artifact of kind ${kinds.join(' or ')}, not ${kindOf(target)}`;
        yield report('violation', 'R3', message, `${entry.path}.${name}`);
      }
    }
  }
}

/** R4: a test derived from the intent saw the criterion, or a version of the intent whose
 * criterion with the same key has the same digest, and no artifact of kind code. */
function* r4Derivation(document: Document): Generator<Report> {
  for (const [entry, intent, required, test] of derivedFromIntent(document)) {
    for (const message of r4(document, entry.record, intent, required, test)) {
      yield report('violation', 'R4', message, `${entry.path}.derivedFrom`);
    }
  }
}

/** R5: a test derived from the intent was not produced by the actor that produced the subject. */
function* r5Independence(document: Document): Generator<Report> {
  for (const [entry, , , test] of derivedFromIntent(document)) {
    const message = r5(document, entry.record, test);
    if (message !== undefined)
      yield report('violation', 'R5', message, `${entry.path}.derivedFrom`);
  }
}

function* r4(
  document: Document,
  evidence: OisRecord,
  intent: OisRecord,
  required: OisRecord,
  test: OisRecord,
): Generator<string> {
  const context: string[] = test.context ?? [];
  if (!context.length) {
    yield `test ${test.id} has no context`;
    return;
  }
  for (const reference of context) {
    const seen = document.record(reference);
    if (seen !== undefined && seen.type === 'artifact' && seen.kind === 'code') {
      yield `the context of test ${test.id} includes code ${reference}`;
    }
  }
  if (!context.some((reference) => covers(document, reference, intent, required))) {
    yield `the context of test ${test.id} includes neither ${evidence.criterion} nor a version of the intent with the same criterion digest`;
  }
}

function r5(document: Document, evidence: OisRecord, test: OisRecord): string | undefined {
  const subject = document.record(evidence.subject ?? '');
  if (subject === undefined || subject.type !== 'artifact') return undefined;
  const producer = actorId(test.producedBy);
  return producer === actorId(subject.producedBy)
    ? `test and subject are both produced by ${producer}`
    : undefined;
}

/** R8: evidence that uses a production dataset is reported (warning). */
function* r8ProductionData(document: Document): Generator<Report> {
  for (const entry of document.ofType('evidence')) {
    for (const [index, reference] of (entry.record.inputs ?? []).entries()) {
      const dataset = document.record(reference);
      if (
        dataset !== undefined &&
        dataset.type === 'artifact' &&
        dataset.classification === 'production'
      ) {
        yield report(
          'warning',
          'R8',
          `input ${reference} is a dataset classified as production`,
          `${entry.path}.inputs[${index}]`,
        );
      }
    }
  }
}

/** R9: a waiver SHOULD be made by a human (info). */
function* r9Waivers(document: Document): Generator<Report> {
  for (const entry of document.ofType('decision')) {
    const decidedBy = entry.record.decidedBy;
    if (entry.record.outcome === 'waived' && isHuman(document, decidedBy) === false) {
      yield report(
        'info',
        'R9',
        `a waiver SHOULD be made by a human, not ${decidedBy}`,
        `${entry.path}.decidedBy`,
      );
    }
  }
}

/** R10: every reference resolves to exactly one record; no conflicting duplicates. */
function* r10Resolution(document: Document): Generator<Report> {
  for (const reference of document.references()) {
    if (!document.resolve(reference.value).length) {
      yield report('violation', 'R10', `${reference.value} resolves to no record`, reference.path);
    }
  }
  const seen = new Map<string, [OisRecord, string]>();
  for (const entry of document.entries) {
    const key = JSON.stringify([entry.record.id, String(entry.record.version ?? '')]);
    const first = seen.get(key);
    if (first === undefined) seen.set(key, [content(entry.record), entry.path]);
    else if (!isDeepStrictEqual(first[0], content(entry.record))) {
      yield report('violation', 'R10', `same id as ${first[1]}, but different content`, entry.path);
    }
  }
}

/** R11: an evidence-revocation decision revokes evidence. */
function* r11Revocation(document: Document): Generator<Report> {
  for (const entry of document.ofType('decision')) {
    if (entry.record.gate !== 'evidence-revocation') continue;
    const subject = document.record(entry.record.subject);
    if (subject !== undefined && subject.type !== 'evidence') {
      const message = `evidence-revocation must have evidence as subject, not ${kindOf(subject)}`;
      yield report('violation', 'R11', message, `${entry.path}.subject`);
    }
  }
}

/** R12: a context counts as attested only if another actor recorded it and signed the bundle or
 * passport that carries it. Otherwise it is self-declared (warning). */
function* r12ContextAttestation(document: Document): Generator<Report> {
  for (const entry of document.ofType('artifact')) {
    const reason = selfDeclared(entry.record, document);
    if (reason !== undefined)
      yield report(
        'warning',
        'R12',
        `context is self-declared: ${reason}`,
        `${entry.path}.context`,
      );
  }
}

/** R13: a passport lists an intent that a current, unresolved high or critical finding references
 * directly or through a criterion (warning). */
function* r13OpenFindings(document: Document): Generator<Report> {
  if (document.passport === undefined) return;
  const findings = document.ofType('finding');
  const superseded = new Set(
    findings.filter((f) => 'supersedes' in f.record).map((f) => f.record.supersedes),
  );
  for (const [index, listed] of (document.passport.intents as string[]).entries()) {
    for (const entry of findings) {
      const finding = entry.record;
      if (superseded.has(finding.id) || !['high', 'critical'].includes(finding.severity)) continue;
      const concerns =
        finding.intent === listed || split(finding.criterion ?? '', '#')[0] === listed;
      if (concerns && !resolved(document, finding)) {
        yield report(
          'warning',
          'R13',
          `${listed} has an open ${finding.severity} finding ${finding.id}`,
          `$.predicate.intents[${index}]`,
        );
      }
    }
  }
}

/** R14: a finding has at most one superseding finding. */
function* r14FindingChain(document: Document): Generator<Report> {
  const first = new Map<string, string>();
  for (const entry of document.ofType('finding')) {
    const previous = entry.record.supersedes;
    if (previous === undefined) continue;
    const earlier = first.get(previous);
    if (earlier !== undefined) {
      yield report(
        'violation',
        'R14',
        `${previous} is already superseded by the finding at ${earlier}`,
        `${entry.path}.supersedes`,
      );
    } else first.set(previous, entry.path);
  }
}

/** R15: a passport lists approved intent versions that are not withdrawn, and SHOULD list the
 * latest version approved before issuedAt (info). */
function* r15PassportIntents(document: Document): Generator<Report> {
  if (document.passport === undefined) return;
  const issuedAt = time(document.passport.issuedAt);
  for (const [index, listed] of (document.passport.intents as string[]).entries()) {
    const intent = document.record(listed);
    if (intent === undefined || intent.type !== 'intent') continue;
    const path = `$.predicate.intents[${index}]`;
    const later = document
      .ofType('intent')
      .map((e) => e.record)
      .filter((r) => r.id === intent.id && r.version > intent.version);
    const withdrawn = later.filter((r) => r.status === 'withdrawn').map((r) => r.version as number);
    const newer = later
      .filter((r) => approvedBefore(document, r, issuedAt))
      .map((r) => r.version as number);
    if (intent.status !== 'approved') {
      yield report('violation', 'R15', `${listed} is ${intent.status}, not approved`, path);
    } else if (withdrawn.length) {
      yield report(
        'violation',
        'R15',
        `${listed} is withdrawn by version ${Math.min(...withdrawn)}`,
        path,
      );
    } else if (newer.length) {
      yield report(
        'info',
        'R15',
        `${listed} SHOULD be the latest approved version, which is ${Math.max(...newer)}`,
        path,
      );
    }
  }
}

/** R16 (proposed): a passport carries an approved or passed release decision for a build whose
 * digest matches a subject of the statement. */
function* r16ReleaseDecision(document: Document): Generator<Report> {
  if (document.passport === undefined) return;
  for (const entry of document.ofType('decision')) {
    const decision = entry.record;
    if (decision.gate !== 'release' || !['approved', 'passed'].includes(decision.outcome)) continue;
    const build = document.record(decision.subject);
    if (
      build !== undefined &&
      build.type === 'artifact' &&
      build.kind === 'build' &&
      document.subjects.some((subject) => equal(build.digest, subject))
    ) {
      return;
    }
  }
  const message =
    'no release decision with outcome approved or passed for a build whose digest matches a subject of the statement';
  yield report('violation', 'R16', message, '$.predicate.records');
}

/** R17 (proposed): intent and criterion digests match their content (section 6.4). */
function* r17Digests(document: Document): Generator<Report> {
  for (const entry of document.ofType('intent')) {
    const intent = entry.record;
    for (const [index, item] of (intent.criteria as OisRecord[]).entries()) {
      const stored = item.digest?.sha256;
      if (stored !== undefined && stored !== criterionSha256(item)) {
        yield report(
          'violation',
          'R17',
          `criterion '${item.key}': sha256 does not match its content`,
          `${entry.path}.criteria[${index}].digest`,
        );
      }
    }
    const stored = intent.digest?.sha256;
    if (stored !== undefined && stored !== intentSha256(intent)) {
      yield report(
        'violation',
        'R17',
        "sha256 does not match the intent's content",
        `${entry.path}.digest`,
      );
    }
  }
}

const RECORD_RULES: Rule[] = [r17Digests]; // also for a single record
const CONTAINER_RULES: Rule[] = [
  r1Approval,
  r2CriterionReferences,
  r3EvidenceTargets,
  r4Derivation,
  r5Independence,
  r8ProductionData,
  r9Waivers,
  r10Resolution,
  r11Revocation,
  r12ContextAttestation,
  r13OpenFindings,
  r14FindingChain,
  r15PassportIntents,
  r16ReleaseDecision,
]; // bundles and passports only

export function check(document: Document): Report[] {
  const rules = document.container ? [...RECORD_RULES, ...CONTAINER_RULES] : RECORD_RULES;
  return rules.flatMap((rule) => [...rule(document)]);
}

/** R12: why an artifact's context is self-declared, or undefined if it has none or it is attested:
 * recorded by another actor whose identity signed the document. */
export function selfDeclared(artifact: OisRecord, document: Document): string | undefined {
  if (!('context' in artifact)) return undefined;
  const recorder: string | undefined = artifact.contextRecordedBy;
  if (recorder === undefined) return 'no contextRecordedBy';
  if (actorId(recorder) === actorId(artifact.producedBy)) return 'recorded by its own producer';
  const actor = document.record(recorder);
  if (actor !== undefined && actor.type === 'actor' && document.signers.include(actor.identity))
    return undefined;
  if (!document.signers.any) return `the document is not signed by ${recorder}`;
  return `no verified signature by ${recorder} among the document's signatures`;
}

export function criterion(record: OisRecord, key: string): OisRecord | undefined {
  if (record.type !== 'intent') return undefined;
  return (record.criteria as OisRecord[]).find((c) => c.key === key);
}

function* derivedFromIntent(
  document: Document,
): Generator<[Entry, OisRecord, OisRecord, OisRecord]> {
  for (const entry of document.ofType('evidence')) {
    if (entry.record.derivedFrom !== 'intent') continue;
    const [intentRef, key = ''] = split(entry.record.criterion, '#');
    const intent = document.record(intentRef);
    const required = intent !== undefined ? criterion(intent, key) : undefined;
    const test = document.record(entry.record.test);
    if (
      intent === undefined ||
      required === undefined ||
      test === undefined ||
      test.type !== 'artifact'
    )
      continue;
    yield [entry, intent, required, test];
  }
}

/** Whether a context entry gives the producer the required criterion (R4). */
function covers(
  document: Document,
  reference: string,
  intent: OisRecord,
  required: OisRecord,
): boolean {
  const [base, rest = ''] = split(reference, '@');
  const [version, key = ''] = split(rest, '#');
  if (base !== intent.id || !version || !['', required.key].includes(key)) return false;
  if (version === String(intent.version)) return true;
  const other = document.record(`${base}@${version}`);
  const seen = other !== undefined ? criterion(other, required.key) : undefined;
  return seen !== undefined && equal(seen.digest ?? {}, (required.digest ?? {}) as Digest);
}

function actorId(reference: string): string {
  return split(reference, '@')[0];
}

/** Whether a reference names a human actor; undefined if it does not resolve to an actor. */
function isHuman(document: Document, reference: string): boolean | undefined {
  const actor = document.record(reference);
  if (actor === undefined || actor.type !== 'actor') return undefined;
  return actor.kind === 'human';
}

/** An approved finding-resolution decision for the finding, by an actor that produced, recorded
 * or decided none of the records in its resolvedBy. */
function resolved(document: Document, finding: OisRecord): boolean {
  const involved = new Set<string>();
  for (const reference of finding.resolvedBy ?? []) {
    const record = document.record(reference);
    for (const name of ['producedBy', 'recordedBy', 'decidedBy']) {
      if (record !== undefined && name in record) involved.add(actorId(record[name]));
    }
  }
  return document
    .ofType('decision')
    .some(
      (d) =>
        d.record.gate === 'finding-resolution' &&
        d.record.outcome === 'approved' &&
        d.record.subject === finding.id &&
        !involved.has(actorId(d.record.decidedBy)),
    );
}

/** Whether an intent version is approved by an intent-approval decision made before moment. */
function approvedBefore(document: Document, intent: OisRecord, moment: number): boolean {
  const subject = `${intent.id}@${intent.version}`;
  return (
    intent.status === 'approved' &&
    document
      .ofType('decision')
      .some(
        (d) =>
          d.record.gate === 'intent-approval' &&
          d.record.outcome === 'approved' &&
          d.record.subject === subject &&
          time(d.record.decidedAt) < moment,
      )
  );
}

function time(timestamp: string): number {
  return Date.parse(timestamp);
}

function kindOf(record: OisRecord): string {
  return 'kind' in record ? `${record.type} of kind ${record.kind}` : record.type;
}

/** What R10 compares: intents without status and digests, which approval adds; every other record
 * in full, digest included. */
export function content(record: OisRecord): OisRecord {
  if (record.type !== 'intent') return record;
  const compared: OisRecord = Object.fromEntries(
    Object.entries(record).filter(([k]) => k !== 'status' && k !== 'digest'),
  );
  if (Array.isArray(compared.criteria)) {
    compared.criteria = compared.criteria.map((c: unknown) =>
      c !== null && typeof c === 'object'
        ? Object.fromEntries(Object.entries(c).filter(([k]) => k !== 'digest'))
        : c,
    );
  }
  return compared;
}

function report(level: Report['level'], rule: string, message: string, path: string): Report {
  return { level, rule, message, path };
}
