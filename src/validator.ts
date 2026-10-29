// Validate a parsed OIS document: signatures, then Appendix B, then the rules of section 5.

import type { TrustMaterial } from '@sigstore/verify';

import { Document, NOBODY, type OisRecord } from './document.ts';
import { isSigstoreBundle, openSigstoreBundle } from './keyless.ts';
import { check as checkProfiles } from './profiles.ts';
import { type Report, type Result, result } from './report.ts';
import { check as checkRules } from './rules.ts';
import { check as checkSchema, isObject } from './schema.ts';
import { isEnvelope, openEnvelope, type TrustedKey } from './signing.ts';

export interface Options {
  trustedKeys?: Iterable<TrustedKey>;
  trustedRoots?: Iterable<TrustMaterial>;
  profiles?: Iterable<string>; // profile URIs to check besides those the records list
}

/** Check a record, bundle, passport, DSSE envelope or Sigstore bundle, and the profiles its
 * records list or `profiles` names. Integrity rules run only after the schema passes; report paths
 * on a payload are relative to it. */
export function validate(document: unknown, options: Options = {}): Result {
  let signers = NOBODY;
  let enveloped = false;
  let reports: Report[] = [];
  if (isEnvelope(document)) {
    const opened = openEnvelope(document, options.trustedKeys ?? []);
    if (opened.payload === undefined) return result(opened.reports);
    enveloped = Array.isArray(document.signatures) && document.signatures.length > 0;
    ({ payload: document, signers, reports } = opened);
  } else if (isSigstoreBundle(document)) {
    const opened = openSigstoreBundle(document, options.trustedRoots ?? []);
    if (opened.payload === undefined) return result(opened.reports);
    const envelope = document.dsseEnvelope;
    enveloped =
      isObject(envelope) && Array.isArray(envelope.signatures) && envelope.signatures.length > 0;
    ({ payload: document, signers, reports } = opened);
  }
  const schema = checkSchema(document);
  if (!schema.length && isObject(document)) {
    const parsed = Document.of(document as OisRecord, signers, enveloped);
    schema.push(...checkRules(parsed), ...checkProfiles(parsed, options.profiles ?? []));
  }
  return result([...reports, ...schema]);
}
