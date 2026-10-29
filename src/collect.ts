// The records of record, bundle and passport files, each once (R10), and the intents they approve.

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { isDeepStrictEqual } from 'node:util';

import type { OisRecord } from './document.ts';
import { isSigstoreBundle, openSigstoreBundle } from './keyless.ts';
import { content } from './rules.ts';
import { isObject, STATEMENT_TYPE } from './schema.ts';
import { isEnvelope, openEnvelope } from './signing.ts';

export class CollectError extends Error {}

/** Files as given, and in directories every JSON file, recursively and sorted. YAML is read by
 * the Python tools only. */
export function files(inputs: string[]): string[] {
  const found: string[] = [];
  for (const input of inputs) {
    if (statSync(input).isDirectory()) {
      const names = readdirSync(input, { recursive: true, encoding: 'utf8' });
      found.push(
        ...names
          .filter((name) => name.endsWith('.json'))
          .map((name) => join(input, name))
          .filter((path) => statSync(path).isFile())
          .sort(),
      );
    } else if (/\.ya?ml$/.test(input)) {
      throw new CollectError(`${input}: YAML is read by the Python ois-tools; give JSON records`);
    } else {
      found.push(input);
    }
  }
  return found;
}

export function load(path: string): unknown {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    if (error instanceof SyntaxError)
      throw new CollectError(`${path}: not valid JSON: ${error.message}`);
    throw error;
  }
}

/** The records of single records, bundles and passports, each once. Identical copies are merged;
 * of a draft and its approved record, the approved one stays. Two records with the same id (and
 * version) but different content break R10. */
export function collect(documents: Iterable<unknown>): OisRecord[] {
  const result: OisRecord[] = [];
  const position = new Map<string, number>();
  for (const document of documents) {
    for (const record of recordsOf(document)) {
      const key = JSON.stringify([record.id, String(record.version ?? '')]);
      const at = position.get(key);
      if (at === undefined) {
        position.set(key, result.length);
        result.push(record);
        continue;
      }
      const kept = result[at] as OisRecord;
      if (!isDeepStrictEqual(content(kept), content(record))) {
        throw new CollectError(`R10: two records ${record.id} differ in content`);
      }
      if (record.status === 'approved' && kept.status !== 'approved') result[at] = record;
    }
  }
  return result;
}

/** Per intent id, in order of appearance, its latest approved version (R15). */
export function latestApproved(records: OisRecord[]): string[] {
  const latest = new Map<string, number>();
  for (const record of records) {
    if (record.type === 'intent' && record.status === 'approved') {
      latest.set(record.id, Math.max(latest.get(record.id) ?? 0, record.version));
    }
  }
  return [...latest].map(([id, version]) => `${id}@${version}`);
}

function recordsOf(document: unknown): OisRecord[] {
  let opened = document;
  if (isEnvelope(document)) opened = openEnvelope(document, []).payload;
  else if (isSigstoreBundle(document)) opened = openSigstoreBundle(document, []).payload;
  if (!isObject(opened)) {
    throw new CollectError('expected a JSON object: a record, a bundle or a passport');
  }
  if (opened._type === STATEMENT_TYPE) return (opened.predicate as OisRecord).records;
  if (opened.type === 'bundle') return opened.records as OisRecord[];
  if (!('type' in opened)) {
    if (!('criteria' in opened)) {
      throw new CollectError(`not an OIS record: ${opened.id ?? 'no id'} has no type`);
    }
    return [{ ois: '0.1', type: 'intent', ...opened }]; // an authored intent (section 7)
  }
  return [opened];
}
