// The records of an input document and reference resolution as fixtures/README.md fixes it:
// <id>@<version> to that intent or actor version, <id> to the record without version,
// <id>@<version>#<key> to the intent version.

import { STATEMENT_TYPE } from './schema.ts';

// biome-ignore lint/suspicious/noExplicitAny: records are JSON that passed the schema check
export type OisRecord = Record<string, any>;

const REFERENCE_FIELDS: Record<string, string[]> = {
  intent: ['producedBy', 'supersedes'],
  artifact: ['producedBy', 'inputs', 'context', 'contextRecordedBy'],
  actor: [],
  evidence: ['criterion', 'test', 'subject', 'inputs', 'recordedBy'],
  decision: ['subject', 'decidedBy', 'evidence'],
  finding: ['criterion', 'intent', 'subject', 'reportedBy', 'resolvedBy', 'supersedes'],
};
const PASSPORT_REFERENCE_FIELDS = ['intents', 'scope', 'issuedBy'];

export interface Entry {
  record: OisRecord;
  path: string; // JSONPath of the record in the input document
}

export interface Reference {
  value: string;
  path: string;
}

/** Who signed a document, as verified: key ids under trusted keys, and the issuer and subject of
 * certificates verified under trusted roots. */
export class Signers {
  readonly keyids: Set<string>;
  readonly identities: Set<string>; // JSON of [issuer, subject]

  constructor(keyids: Iterable<string> = [], identities: Iterable<[string, string]> = []) {
    this.keyids = new Set(keyids);
    this.identities = new Set([...identities].map((pair) => JSON.stringify(pair)));
  }

  get any(): boolean {
    return this.keyids.size > 0 || this.identities.size > 0;
  }

  /** Whether an actor identity (section 4.4) is among the signers (section 8.3). */
  include(identity: unknown): boolean {
    if (identity === null || typeof identity !== 'object') return false;
    const { keyId, issuer, subject } = identity as Record<string, unknown>;
    return (
      (typeof keyId === 'string' && this.keyids.has(keyId)) ||
      this.identities.has(JSON.stringify([issuer, subject]))
    );
  }
}

export const NOBODY = new Signers();

/** The records of a single record, a bundle or a passport, after the schema check passed. */
export class Document {
  readonly entries: Entry[];
  readonly container: boolean; // false for a single record: no rules across records apply
  readonly passport: OisRecord | undefined; // the predicate, for passports
  readonly subjects: Record<string, string>[]; // statement subject digests
  readonly signers: Signers;
  readonly enveloped: boolean; // in a DSSE envelope or Sigstore bundle with a signature
  private readonly byId = new Map<string, Entry[]>();

  constructor(
    entries: Entry[],
    options: {
      container?: boolean;
      passport?: OisRecord;
      subjects?: Record<string, string>[];
      signers?: Signers;
      enveloped?: boolean;
    } = {},
  ) {
    this.entries = entries;
    this.container = options.container ?? true;
    this.passport = options.passport;
    this.subjects = options.subjects ?? [];
    this.signers = options.signers ?? NOBODY;
    this.enveloped = options.enveloped ?? false;
    for (const entry of entries) {
      const found = this.byId.get(entry.record.id) ?? [];
      found.push(entry);
      this.byId.set(entry.record.id, found);
    }
  }

  static of(document: OisRecord, signers: Signers = NOBODY, enveloped = false): Document {
    if (document._type === STATEMENT_TYPE) {
      // Appendix B covers only the predicate, so the statement's subject is read defensively.
      const subject: unknown = document.subject;
      const subjects = (Array.isArray(subject) ? subject : [])
        .filter(
          (s) => s !== null && typeof s === 'object' && s.digest && typeof s.digest === 'object',
        )
        .map((s) => s.digest as Record<string, string>);
      return new Document(entries(document.predicate.records, '$.predicate.records'), {
        passport: document.predicate,
        subjects,
        signers,
        enveloped,
      });
    }
    if (document.type === 'bundle') {
      return new Document(entries(document.records, '$.records'), { signers });
    }
    return new Document([{ record: document, path: '$' }], { container: false, signers });
  }

  /** Every record a reference names; more than one only for records in several states. */
  resolve(reference: string): Entry[] {
    const [base = '', rest] = split(reference, '@');
    const version = split(rest ?? '', '#')[0];
    const candidates = this.byId.get(base) ?? [];
    if (version)
      return candidates.filter(
        (e) => String(e.record.version) === version && 'version' in e.record,
      );
    return candidates.filter((e) => !('version' in e.record));
  }

  /** The record a reference names, or undefined if it does not resolve. */
  record(reference: string): OisRecord | undefined {
    return this.resolve(reference)[0]?.record;
  }

  ofType(kind: string): Entry[] {
    return this.entries.filter((entry) => entry.record.type === kind);
  }

  /** Every reference in the document, in document order. */
  *references(): Generator<Reference> {
    for (const entry of this.entries) {
      yield* referencesOf(entry.record, REFERENCE_FIELDS[entry.record.type] ?? [], entry.path);
    }
    if (this.passport !== undefined) {
      yield* referencesOf(this.passport, PASSPORT_REFERENCE_FIELDS, '$.predicate');
    }
  }
}

/** Python's str.partition: the part before the first separator, and the rest (or undefined). */
export function split(text: string, separator: string): [string, string | undefined] {
  const index = text.indexOf(separator);
  return index < 0
    ? [text, undefined]
    : [text.slice(0, index), text.slice(index + separator.length)];
}

function entries(records: OisRecord[], path: string): Entry[] {
  return records.map((record, index) => ({ record, path: `${path}[${index}]` }));
}

function* referencesOf(record: OisRecord, fields: string[], path: string): Generator<Reference> {
  for (const name of fields) {
    const value = record[name];
    if (typeof value === 'string') yield { value, path: `${path}.${name}` };
    else if (Array.isArray(value)) {
      for (const [index, item] of value.entries())
        yield { value: item, path: `${path}.${name}[${index}]` };
    }
  }
}
