// Command line interface: ois coverage PASSPORT | ois coverage INPUT... --build REF
//
// Shows per criterion what counts and why other evidence does not; for a passport, checks the
// declared coverage.

import { parseArgs } from 'node:util';

import { CollectError, collect, files, latestApproved, load } from './collect.ts';
import {
  type Coverage,
  CoverageError,
  coverage,
  METHOD,
  passportCoverage,
  round,
} from './coverage.ts';
import { isSigstoreBundle, loadTrustedRoots, openSigstoreBundle } from './keyless.ts';
import { isObject, STATEMENT_TYPE } from './schema.ts';
import { isEnvelope, loadTrustedKeys, openEnvelope, SigningError } from './signing.ts';
import type { Io } from './validate-cli.ts';

const EXIT_OK = 0;
const EXIT_DIFFERS = 1;
const EXIT_USAGE = 2;
const FORMATS = ['text', 'markdown'];
const USAGE = `usage: ois coverage [-h] [--build BUILD] [--intent INTENTS] [--scope SCOPE]
                    [--format {text,markdown}] [--trusted-key KEY]
                    [--trusted-root FILE]
                    INPUT [INPUT ...]

Intent coverage by the reference method of Appendix D, per criterion, and a
check of the coverage a passport declares.

positional arguments:
  INPUT                 a passport, or record and bundle files and directories
                        such as .ois/

options:
  -h, --help            show this help message and exit
  --build BUILD         release subject for records (a passport names its own)
  --intent INTENTS      versioned intent (default: latest approved of each)
  --scope SCOPE         criterion reference in scope
  --format {text,markdown}
                        markdown: tables for a CI job summary or a pull
                        request comment
  --trusted-key KEY     public key for a signed passport (attested coverage);
                        a directory, or KEYID=FILE
  --trusted-root FILE   Sigstore trusted root for a keyless signed passport
                        (attested coverage)
`;

export function main(argv: string[], io: Io): number {
  let parsed: ReturnType<typeof parse>;
  try {
    parsed = parse(argv);
  } catch (error) {
    return usageError(io, (error as Error).message);
  }
  const { values, positionals } = parsed;
  if (values.help) {
    io.out(USAGE);
    return EXIT_OK;
  }
  const format = values.format ?? 'text';
  if (!positionals.length) return usageError(io, 'the following arguments are required: INPUT');
  if (!FORMATS.includes(format)) {
    return usageError(
      io,
      `argument --format: invalid choice: '${format}' (choose from text, markdown)`,
    );
  }

  let result: Coverage;
  let declared = new Map<string, unknown>();
  try {
    const documents = files(positionals).map(load);
    const single = documents.length === 1 ? documents[0] : undefined;
    let statement = single;
    if (isEnvelope(single)) statement = openEnvelope(single, []).payload;
    else if (isSigstoreBundle(single)) statement = openSigstoreBundle(single, []).payload;
    if (isObject(statement) && statement._type === STATEMENT_TYPE) {
      result = passportCoverage(
        single,
        loadTrustedKeys(values['trusted-key'] ?? []),
        loadTrustedRoots(values['trusted-root'] ?? []),
      );
      const predicate = statement.predicate as { assessments?: Record<string, unknown>[] };
      declared = new Map(
        (predicate.assessments ?? [])
          .filter((a) => a.method === METHOD)
          .map((a) => [String(a.name), a.value]),
      );
    } else {
      if (values.build === undefined)
        throw new CoverageError('records need --build: the release subject');
      const records = collect(documents);
      result = coverage(records, {
        subject: values.build,
        intents: values.intent ?? latestApproved(records),
        ...(values.scope ? { scope: values.scope } : {}),
      });
    }
  } catch (error) {
    const known = [CoverageError, CollectError, SigningError].some((kind) => error instanceof kind);
    if (!known && !(error instanceof Error && 'code' in error)) throw error;
    io.err(`ois coverage: ${(error as Error).message}\n`);
    return EXIT_USAGE;
  }

  const differs = result
    .measurements()
    .filter((m) => declared.has(m.name) && !agrees(declared.get(m.name), m.value))
    .map((m) => m.name);
  if (format === 'markdown') {
    io.out(markdown(result, declared, differs));
  } else {
    io.out(show(result));
    for (const { name, value } of result.measurements()) {
      const stated = declared.has(name) ? ` (declared ${number(declared.get(name))})` : '';
      io.out(`${name} ${number(value)}${stated}\n`);
    }
  }
  for (const name of differs) {
    const computed = result.measurements().find((m) => m.name === name)?.value;
    io.err(
      `ois coverage: declared ${name} ${number(declared.get(name))}, computed ${number(computed)}\n`,
    );
  }
  return differs.length ? EXIT_DIFFERS : EXIT_OK;
}

/** The coverage and each criterion as Markdown tables; ids shortened to their last part. */
export function markdown(
  result: Coverage,
  declared: Map<string, unknown>,
  differs: string[],
): string {
  const lines = ['### Intent coverage', ''];
  if (!result.criteria.length) return [...lines, 'No criteria in scope.', ''].join('\n');
  lines.push('| Measure | Value | Declared |', '| --- | --- | --- |');
  for (const { name, value } of result.measurements()) {
    let stated = declared.has(name) ? percent(declared.get(name)) : '';
    if (differs.includes(name)) stated += ', differs';
    lines.push(`| ${name} | ${percent(value)} | ${stated} |`);
  }
  lines.push('', '| Criterion | Statement | Status | Evidence |', '| --- | --- | --- | --- |');
  for (const criterion of result.criteria) {
    let statement = cell(criterion.statement);
    if ([...statement].length > 80)
      statement = `${[...statement].slice(0, 79).join('').trimEnd()}…`;
    const evidence = criterion.covered
      ? criterion.counted.map((e) => `\`${short(e)}\``).join(', ')
      : criterion.reasons.map(([e, why]) => `\`${short(e)}\`: ${cell(why)}`).join('; ');
    const status = criterion.covered ? 'covered' : 'not covered';
    lines.push(
      `| \`${short(criterion.reference)}\` | ${statement} | ${status} | ${evidence || 'no evidence'} |`,
    );
  }
  return [...lines, ''].join('\n');
}

/** Text safe inside a Markdown table cell. */
export function cell(text: string): string {
  return text.replaceAll('|', '\\|').split(/\s+/).filter(Boolean).join(' ');
}

function show(result: Coverage): string {
  let out = '';
  for (const criterion of result.criteria) {
    if (criterion.covered) {
      out += `${criterion.reference}  covered  ${criterion.counted.join(', ')}\n`;
      continue;
    }
    out += `${criterion.reference}  not covered\n`;
    if (!criterion.reasons.length) out += '    no evidence\n';
    for (const [evidence, why] of criterion.reasons) out += `    ${evidence}: ${why}\n`;
  }
  return out;
}

/** Equal at the precision the passport declares: 0.33 agrees with 0.3333. */
function agrees(declared: unknown, computed: number): boolean {
  if (typeof declared !== 'number') return false;
  const text = number(declared);
  const decimals = text.includes('e') ? 4 : (text.split('.')[1] ?? '').replace(/0+$/, '').length;
  return round(computed, decimals) === round(declared, decimals);
}

/** A value as the Python tools print it: 1.0 and 0.5, exponents below 1e-4. */
function number(value: unknown): string {
  if (typeof value !== 'number') return String(value);
  if (Number.isInteger(value)) return `${value}.0`;
  if (Math.abs(value) < 1e-4) return value.toExponential().replace(/e([+-])(\d)$/, 'e$10$2');
  return String(value);
}

function percent(value: unknown): string {
  return typeof value === 'number' ? `${Number((value * 100).toPrecision(4))} %` : String(value);
}

function short(reference: string): string {
  return reference.replace(/\/+$/, '').split('/').pop() ?? reference;
}

function usageError(io: Io, problem: string): number {
  io.err(`${USAGE.split('\n\n')[0]}\nois coverage: error: ${problem}\n`);
  return EXIT_USAGE;
}

function parse(argv: string[]) {
  return parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      help: { type: 'boolean', short: 'h' },
      build: { type: 'string' },
      intent: { type: 'string', multiple: true },
      scope: { type: 'string', multiple: true },
      format: { type: 'string' },
      'trusted-key': { type: 'string', multiple: true },
      'trusted-root': { type: 'string', multiple: true },
    },
  });
}
