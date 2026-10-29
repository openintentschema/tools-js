// DSSE envelopes for bundles and passports (section 8.3) with Ed25519 or ECDSA keys; a key id is
// the SHA-256 of the DER public key. Reports use the rule ID "signature"; an envelope with a
// violation counts as unsigned.

import { createHash, createPublicKey, type KeyObject, verify } from 'node:crypto';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { NOBODY, Signers } from './document.ts';
import type { Report } from './report.ts';
import { isObject, STATEMENT_TYPE } from './schema.ts';

export const IN_TOTO = 'application/vnd.in-toto+json';
export const OIS_BUNDLE = 'application/vnd.ois+json';

export class SigningError extends Error {}

export interface TrustedKey {
  keyid: string;
  key: KeyObject;
}

/** What an envelope holds: its payload if it is JSON, who signed it as verified (nobody if it
 * counts as unsigned), and the signature reports. */
export interface Opened {
  payload: unknown;
  signers: Signers;
  reports: Report[];
}

export function isEnvelope(document: unknown): document is Record<string, unknown> {
  return isObject(document) && ['payloadType', 'payload', 'signatures'].every((k) => k in document);
}

export function keyId(key: KeyObject): string {
  return createHash('sha256')
    .update(key.export({ type: 'spki', format: 'der' }))
    .digest('hex');
}

export function loadPublicKey(pem: Buffer | string, keyid?: string): TrustedKey {
  let key: KeyObject;
  try {
    key = createPublicKey(pem);
  } catch (error) {
    throw new SigningError(`not a PEM public key: ${(error as Error).message}`);
  }
  if (key.asymmetricKeyType !== 'ed25519' && key.asymmetricKeyType !== 'ec') {
    throw new SigningError('only Ed25519 and ECDSA keys are supported');
  }
  return { keyid: keyid ?? keyId(key), key };
}

/** Trusted keys from command line values: a PEM file, a directory of *.pub files, or KEYID=FILE
 * for a key whose id is not derived from it. */
export function loadTrustedKeys(specs: Iterable<string>): TrustedKey[] {
  const keys: TrustedKey[] = [];
  for (const spec of specs) {
    const at = spec.lastIndexOf('=');
    const [keyid, name] = at < 0 ? [undefined, spec] : [spec.slice(0, at), spec.slice(at + 1)];
    const directory = statSync(name, { throwIfNoEntry: false })?.isDirectory() ?? false;
    const files = directory
      ? readdirSync(name)
          .filter((f) => f.endsWith('.pub'))
          .sort()
          .map((f) => join(name, f))
      : [name];
    if (directory && !files.length) throw new SigningError(`${name} holds no *.pub file`);
    keys.push(...files.map((file) => loadPublicKey(readFileSync(file), keyid || undefined)));
  }
  return keys;
}

/** DSSE v1 pre-authentication encoding of payload type and payload. */
export function pae(payloadType: string, body: Buffer): Buffer {
  const kind = Buffer.from(payloadType, 'utf8');
  return Buffer.concat([
    Buffer.from(`DSSEv1 ${kind.length} `),
    kind,
    Buffer.from(` ${body.length} `),
    body,
  ]);
}

/** The payload of a DSSE envelope, its bytes, and violations of section 8.3: not base64 JSON
 * (payload undefined), not a bundle or passport, or the wrong payload type. */
export function readPayload(
  envelope: Record<string, unknown>,
  path = '$',
): [unknown, Buffer, Report[]] {
  let body: Buffer;
  let payload: unknown;
  try {
    body = strictBase64(envelope.payload ?? '');
    payload = JSON.parse(body.toString('utf8'));
  } catch (error) {
    const message = `payload is not base64 JSON: ${(error as Error).message}`;
    return [undefined, Buffer.alloc(0), [violation(message, `${path}.payload`)]];
  }
  const reports: Report[] = [];
  const required = payloadTypeOf(payload);
  if (required === undefined) {
    reports.push(
      violation('only a bundle or a passport is signed (section 8.3)', `${path}.payload`),
    );
  } else if (envelope.payloadType !== required) {
    const kind = envelope.payloadType;
    const shown = typeof kind === 'string' ? `'${kind}'` : String(kind);
    const message = `payload type ${shown}; this payload requires '${required}'`;
    reports.push(violation(message, `${path}.payloadType`));
  }
  return [payload, body, reports];
}

export function openEnvelope(
  envelope: Record<string, unknown>,
  trusted: Iterable<TrustedKey>,
): Opened {
  const keys = new Map([...trusted].map((k) => [k.keyid, k.key]));
  const [payload, body, reports] = readPayload(envelope);
  if (payload === undefined) return { payload, signers: NOBODY, reports };
  const signatures = Array.isArray(envelope.signatures) ? (envelope.signatures as unknown[]) : [];
  if (!signatures.length)
    reports.push(violation('the envelope carries no signature', '$.signatures'));

  const signers = new Set<string>();
  const data = pae(String(envelope.payloadType), body);
  for (const [index, signature] of signatures.entries()) {
    const path = `$.signatures[${index}]`;
    const keyid = isObject(signature) ? signature.keyid : undefined;
    const key = typeof keyid === 'string' ? keys.get(keyid) : undefined;
    if (key === undefined) {
      const message = `key ${keyid ?? 'None'} is not trusted, so this signature cannot be checked`;
      reports.push({ level: 'warning', rule: 'signature', message, path });
    } else if (
      typeof keyid === 'string' &&
      verifies(key, isObject(signature) ? signature.sig : undefined, data)
    ) {
      signers.add(keyid);
    } else {
      reports.push(violation(`the signature by key ${keyid} does not verify`, path));
    }
  }
  const unsigned = reports.some((r) => r.level === 'violation');
  return { payload, signers: unsigned ? NOBODY : new Signers(signers), reports };
}

function payloadTypeOf(document: unknown): string | undefined {
  if (isObject(document) && document._type === STATEMENT_TYPE) return IN_TOTO;
  if (isObject(document) && document.type === 'bundle') return OIS_BUNDLE;
  return undefined;
}

function verifies(key: KeyObject, sig: unknown, data: Buffer): boolean {
  try {
    const signature = strictBase64(sig);
    return verify(key.asymmetricKeyType === 'ed25519' ? null : 'sha256', data, key, signature);
  } catch {
    return false;
  }
}

/** Base64 with correct padding and no other characters. */
function strictBase64(value: unknown): Buffer {
  const text = String(value);
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(text) || text.length % 4 !== 0) {
    throw new Error('invalid base64');
  }
  return Buffer.from(text, 'base64');
}

function violation(message: string, path: string): Report {
  return { level: 'violation', rule: 'signature', message, path };
}
