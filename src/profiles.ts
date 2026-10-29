// Profiles this validator knows (section 10.2). A profile applies when a record lists it or the
// verifier asks for it; its rules are reported as violations under the profile's rule IDs.

import type { Document } from './document.ts';
import type { Report } from './report.ts';

export const REGULATED = 'https://openintentschema.io/profiles/regulated/v0.1';
const NAMES: Record<string, string> = { 'regulated/v0.1': REGULATED };

export class ProfileError extends Error {}

/** The URI of a profile given by URI or short name, such as regulated/v0.1. */
export function resolveProfile(name: string): string {
  const uri = NAMES[name] ?? name;
  if (!Object.values(NAMES).includes(uri)) {
    throw new ProfileError(`unknown profile '${name}'; known: ${Object.keys(NAMES).join(', ')}`);
  }
  return uri;
}

export function check(document: Document, profiles: Iterable<string> = []): Report[] {
  const listed = document.entries.flatMap((entry) => (entry.record.profiles ?? []) as string[]);
  return new Set([...profiles, ...listed]).has(REGULATED) ? regulated(document) : [];
}

function regulated(document: Document): Report[] {
  const reports: Report[] = [];
  for (const entry of document.ofType('intent')) {
    if (!('risk' in entry.record))
      reports.push(violation('P1', 'an intent carries risk', entry.path));
  }
  if (document.container) {
    for (const entry of document.ofType('decision')) {
      const decision = entry.record;
      if (!['intent-approval', 'release'].includes(decision.gate)) continue;
      const actor = document.record(decision.decidedBy);
      if (actor !== undefined && actor.type === 'actor' && actor.kind !== 'human') {
        const kind = /^[aeiou]/.test(actor.kind) ? `an ${actor.kind}` : `a ${actor.kind}`;
        const message = `a ${decision.gate} decision is made by a human, not ${kind}`;
        reports.push(violation('P2', message, `${entry.path}.decidedBy`));
      }
    }
    for (const entry of document.ofType('evidence')) {
      for (const [index, reference] of ((entry.record.inputs ?? []) as string[]).entries()) {
        const dataset = document.record(reference);
        if (
          dataset?.type === 'artifact' &&
          dataset.kind === 'dataset' &&
          dataset.classification === 'production'
        ) {
          const message = `no production dataset as test input: ${reference}`;
          reports.push(violation('P4', message, `${entry.path}.inputs[${index}]`));
        }
      }
    }
  }
  if (document.passport !== undefined && !document.enveloped) {
    reports.push(violation('P3', 'a passport is signed (DSSE envelope or Sigstore bundle)', '$'));
  }
  return reports;
}

function violation(rule: string, message: string, path: string): Report {
  return { level: 'violation', rule: `regulated/${rule}`, message, path };
}
