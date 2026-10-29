// Sigstore bundles (section 8.3): verified offline against chosen trusted roots; the signer is the
// certificate identity (OIDC issuer, subject).

import { readFileSync } from 'node:fs';
import { bundleFromJSON } from '@sigstore/bundle';
import { TrustedRoot } from '@sigstore/protobuf-specs';
import { type TrustMaterial, toSignedEntity, toTrustMaterial, Verifier } from '@sigstore/verify';

import { NOBODY, Signers } from './document.ts';
import type { Report } from './report.ts';
import { isObject } from './schema.ts';
import { type Opened, readPayload, SigningError } from './signing.ts';

const MEDIA_TYPE = 'application/vnd.dev.sigstore.bundle';
const TRUSTED_ROOT = 'application/vnd.dev.sigstore.trustedroot';

export function isSigstoreBundle(document: unknown): document is Record<string, unknown> {
  return isObject(document) && String(document.mediaType ?? '').startsWith(MEDIA_TYPE);
}

/** Trusted roots from files: one trusted root (JSON), or one per line as
 * `gh attestation trusted-root` writes them (JSON lines). */
export function loadTrustedRoots(specs: Iterable<string>): TrustMaterial[] {
  const roots: TrustMaterial[] = [];
  for (const spec of specs) {
    const text = readFileSync(spec, 'utf8');
    let documents: string[];
    try {
      JSON.parse(text);
      documents = [text];
    } catch {
      documents = text.split('\n').filter((line) => line.trim());
    }
    for (const document of documents) {
      try {
        const parsed = JSON.parse(document);
        if (!String(parsed.mediaType ?? '').startsWith(TRUSTED_ROOT))
          throw new Error(`mediaType is not ${TRUSTED_ROOT}`);
        roots.push(toTrustMaterial(TrustedRoot.fromJSON(parsed)));
      } catch (error) {
        throw new SigningError(`${spec}: not a Sigstore trusted root: ${(error as Error).message}`);
      }
    }
  }
  return roots;
}

export function openSigstoreBundle(
  bundle: Record<string, unknown>,
  roots: Iterable<TrustMaterial>,
): Opened {
  const envelope = bundle.dsseEnvelope;
  if (!isObject(envelope)) {
    const message = 'the bundle carries no DSSE envelope, so it cannot hold an OIS document';
    return { payload: undefined, signers: NOBODY, reports: [violation(message, '$')] };
  }
  const [payload, , reports] = readPayload(envelope, '$.dsseEnvelope');
  if (payload === undefined) return { payload, signers: NOBODY, reports };
  const trusted = [...roots];
  if (!trusted.length) {
    const message = 'no trusted root given (--trusted-root), so the signature cannot be checked';
    reports.push({ level: 'warning', rule: 'signature', message, path: '$.verificationMaterial' });
    return { payload, signers: NOBODY, reports };
  }
  let identity: [string, string];
  try {
    identity = verified(bundle, trusted);
  } catch (error) {
    reports.push(violation((error as Error).message, '$.verificationMaterial'));
    return { payload, signers: NOBODY, reports };
  }
  const unsigned = reports.some((r) => r.level === 'violation');
  return { payload, signers: unsigned ? NOBODY : new Signers([], [identity]), reports };
}

/** Certificate chain, transparency log entry and signature against any of the roots; any
 * identity is accepted here, R12 matches it to actors afterwards. */
function verified(bundle: Record<string, unknown>, roots: TrustMaterial[]): [string, string] {
  let parsed: ReturnType<typeof bundleFromJSON>;
  try {
    parsed = bundleFromJSON(bundle);
  } catch (error) {
    throw new SigningError(`not a valid Sigstore bundle: ${(error as Error).message}`);
  }
  let failure = '';
  for (const root of roots) {
    try {
      const signer = new Verifier(root).verify(toSignedEntity(parsed));
      return [
        signer.identity?.extensions?.issuer ?? '',
        signer.identity?.subjectAlternativeName ?? '',
      ];
    } catch (error) {
      failure = (error as Error).message;
    }
  }
  throw new SigningError(`the signature does not verify against any trusted root: ${failure}`);
}

function violation(message: string, path: string): Report {
  return { level: 'violation', rule: 'signature', message, path };
}
