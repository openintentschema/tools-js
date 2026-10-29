// SARIF 2.1.0 for ois validate (GitHub code scanning, IDEs); report paths become line numbers.

import type { Level, Result } from './report.ts';

const SPEC = 'https://openintentschema.io/specification/';
const RULES: Record<string, [string, string?]> = {
  json: ['Not valid JSON', `${SPEC}serialization/`],
  schema: ['Appendix B: the JSON Schema', `${SPEC}appendix-b-json-schema/`],
  signature: ['DSSE and Sigstore signatures (section 8.3)', 'https://openintentschema.io/sign/'],
  R1: ['Approval'],
  R2: ['Criterion references'],
  R3: ['Evidence targets'],
  R4: ['Derivation'],
  R5: ['Independence'],
  R8: ['Production data'],
  R9: ['Waivers'],
  R10: ['Resolution'],
  R11: ['Revocation'],
  R12: ['Context attestation'],
  R13: ['Open findings'],
  R14: ['Finding chain'],
  R15: ['Passport intents'],
  R16: ['Release decision (proposed)'],
  R17: ['Digests (proposed)'],
  'regulated/P1': ['Regulated profile: intents carry risk'],
  'regulated/P2': ['Regulated profile: people approve intents and releases'],
  'regulated/P3': ['Regulated profile: passports are signed'],
  'regulated/P4': ['Regulated profile: no production data in tests'],
};
const LEVELS: Record<Level, string> = { violation: 'error', warning: 'warning', info: 'note' };

/** One run over the files, given as name -> [text, result]. */
export function toSarif(results: Map<string, [string, Result]>, version: string): object {
  const rules: string[] = [];
  const found = [];
  for (const [name, [text, result]] of results) {
    const lines = valueLines(text);
    for (const report of result.reports) {
      if (!rules.includes(report.rule)) rules.push(report.rule);
      found.push({
        ruleId: report.rule,
        ruleIndex: rules.indexOf(report.rule),
        level: LEVELS[report.level],
        message: { text: report.message },
        locations: [
          {
            physicalLocation: {
              artifactLocation: { uri: name === '-' ? 'stdin' : name },
              region: { startLine: line(lines, report.path) },
            },
            logicalLocations: [{ fullyQualifiedName: report.path, kind: 'member' }],
          },
        ],
      });
    }
  }
  const driver = {
    name: 'ois validate',
    version,
    informationUri: 'https://openintentschema.io/develop/tools/',
    rules: rules.map(rule),
  };
  return {
    $schema:
      'https://docs.oasis-open.org/sarif/sarif/v2.1.0/errata01/os/schemas/sarif-schema-2.1.0.json',
    version: '2.1.0',
    runs: [{ tool: { driver }, results: found }],
  };
}

/** The line of the value at a report path, or of its nearest existing parent. */
export function lineOf(text: string, path: string): number {
  return line(valueLines(text), path);
}

function rule(id: string): object {
  const [name = id, uri] = RULES[id] ?? [];
  const help =
    uri ??
    (id.startsWith('regulated/')
      ? 'https://openintentschema.io/profiles/regulated/v0.1/'
      : `${SPEC}relationships-and-integrity-rules/`);
  return { id, shortDescription: { text: name }, helpUri: help };
}

/** Payload paths of an envelope fall back to the payload; others to their nearest parent. */
function line(lines: Map<string, number>, path: string): number {
  while (path) {
    const found = lines.get(path);
    if (found !== undefined) return found;
    for (const payload of ['$.payload', '$.dsseEnvelope.payload']) {
      const at = lines.get(payload);
      if (at !== undefined && /^\$\.(predicate|records|subject)/.test(path)) return at;
    }
    path = path === '$' ? '' : path.replace(/(\.[^.[\]]+|\[\d+\])$/, '');
  }
  return 1;
}

/** The line where each value starts, by JSONPath; empty if the text is not JSON. */
function valueLines(text: string): Map<string, number> {
  const starts = [0];
  for (let i = 0; i < text.length; i++) if (text[i] === '\n') starts.push(i + 1);
  const found = new Map<string, number>();
  const lineAt = (index: number) => {
    let low = 0;
    let high = starts.length;
    while (low < high) {
      const middle = (low + high) >> 1;
      if ((starts[middle] ?? 0) <= index) low = middle + 1;
      else high = middle;
    }
    return low;
  };
  const at = (i: number) => {
    const c = text[i];
    if (c === undefined) throw new RangeError('end of text');
    return c;
  };
  const skip = (i: number) => {
    while (i < text.length && ' \t\r\n'.includes(at(i))) i++;
    return i;
  };
  const string = (i: number): [string, number] => {
    let j = i + 1;
    let out = '';
    while (at(j) !== '"') {
      if (at(j) === '\\') {
        out += text.slice(j, j + 2);
        j += 2;
      } else out += at(j++);
    }
    return [out, j + 1];
  };
  const value = (start: number, path: string): number => {
    let i = skip(start);
    found.set(path, lineAt(i));
    if (at(i) === '{') {
      i = skip(i + 1);
      while (at(i) !== '}') {
        const [key, next] = string(skip(i));
        i = skip(value(skip(next) + 1, `${path}.${key}`));
        if (at(i) === ',') i = skip(i + 1);
      }
      return i + 1;
    }
    if (at(i) === '[') {
      i = skip(i + 1);
      for (let index = 0; at(i) !== ']'; index++) {
        i = skip(value(i, `${path}[${index}]`));
        if (at(i) === ',') i = skip(i + 1);
      }
      return i + 1;
    }
    if (at(i) === '"') return string(i)[1];
    const match = /-?\d[\d.eE+-]*|true|false|null/y;
    match.lastIndex = i;
    if (!match.exec(text)) throw new RangeError(`unexpected character at ${i}`);
    return match.lastIndex;
  };
  try {
    value(0, '$');
  } catch {
    // not JSON: keep what was found
  }
  return found;
}
