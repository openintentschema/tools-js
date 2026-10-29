// Digests of criteria and intents (spec section 6.4), over their RFC 8785 canonical form.

import { createHash } from 'node:crypto';

export type Digest = Record<string, string>; // in-toto DigestSet: algorithm -> lowercase hex

const CRITERION_FIELDS = ['key', 'statement', 'notation', 'kind', 'target', 'language'];

/** RFC 8785: sorted keys (UTF-16 code units) and ECMAScript number and string serialization. */
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

export function criterionSha256(criterion: Record<string, unknown>): string {
  const fields = Object.fromEntries(
    CRITERION_FIELDS.filter((k) => k in criterion).map((k) => [k, criterion[k]]),
  );
  return sha256(canonical(fields));
}

/** Over the intent without its top-level digest and status, criterion digests included. */
export function intentSha256(intent: Record<string, unknown>): string {
  const content = Object.fromEntries(
    Object.entries(intent).filter(([k]) => k !== 'digest' && k !== 'status'),
  );
  return sha256(canonical(content));
}

/** Two digest sets name the same content: they share an algorithm and agree on each. */
export function equal(a: Digest, b: Digest): boolean {
  const shared = Object.keys(a).filter((name) => name in b);
  return shared.length > 0 && shared.every((name) => a[name] === b[name]);
}

function sha256(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}
