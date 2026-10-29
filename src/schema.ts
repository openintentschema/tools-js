// Schema check against Appendix B. Each record is checked against its own type's definition,
// because the root oneOf reports only a bare failure.

import { readFileSync } from 'node:fs';
import { Ajv2020, type ErrorObject, type ValidateFunction } from 'ajv/dist/2020.js';
import formatsModule from 'ajv-formats';

import type { Report } from './report.ts';

export const STATEMENT_TYPE = 'https://in-toto.io/Statement/v1';
export const PASSPORT_PREDICATE_TYPE = 'https://ois.example/passport/v0.1'; // placeholder until the domain is set
export const RECORD_TYPES = ['intent', 'artifact', 'actor', 'evidence', 'decision', 'finding'];

type Schema = { $id: string; $defs: Record<string, { properties?: Record<string, unknown> }> };

const SCHEMA = JSON.parse(
  readFileSync(new URL('../schema/ois-0.1.schema.json', import.meta.url), 'utf8'),
) as Schema;
const ajv = new Ajv2020({ allErrors: true, strict: false });
formatsModule.default(ajv);
ajv.addSchema(SCHEMA);
const validators = new Map<string, ValidateFunction>();

/** Check one parsed document: a record, a bundle or a passport statement. */
export function check(document: unknown): Report[] {
  const reports: Report[] = [];
  if (isObject(document) && document._type === STATEMENT_TYPE) {
    if (document.predicateType !== PASSPORT_PREDICATE_TYPE) {
      reports.push(
        violation(`predicateType must be '${PASSPORT_PREDICATE_TYPE}'`, '$.predicateType'),
      );
    } else {
      container('passportPredicate', document.predicate, '$.predicate', reports);
    }
  } else if (isObject(document) && document.type === 'bundle') {
    container('bundle', document, '$', reports);
  } else {
    record(document, '$', reports);
  }
  return reports;
}

export function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function container(definition: string, instance: unknown, path: string, reports: Report[]): void {
  // Errors inside records[] are left to the per-record check below.
  const errors = run(definition, instance).filter((e) => !/^\/records\/\d+/.test(e.instancePath));
  reports.push(...toReports(errors, definition, path));
  if (isObject(instance) && Array.isArray(instance.records)) {
    instance.records.forEach((item, index) => {
      record(item, `${path}.records[${index}]`, reports);
    });
  }
}

function record(item: unknown, path: string, reports: Report[]): void {
  const kind = isObject(item) ? item.type : undefined;
  if (typeof kind !== 'string' || !RECORD_TYPES.includes(kind)) {
    reports.push(violation(`type must be one of ${RECORD_TYPES.join(', ')}`, `${path}.type`));
    return;
  }
  reports.push(...toReports(run(kind, item), kind, path));
}

function run(definition: string, instance: unknown): ErrorObject[] {
  let validator = validators.get(definition);
  if (validator === undefined) {
    validator = ajv.compile({ $ref: `${SCHEMA.$id}#/$defs/${definition}` });
    validators.set(definition, validator);
  }
  return validator(instance) ? [] : [...(validator.errors ?? [])];
}

function toReports(errors: ErrorObject[], definition: string, path: string): Report[] {
  const declared = new Set([
    ...Object.keys(SCHEMA.$defs[definition]?.properties ?? {}),
    ...Object.keys(SCHEMA.$defs.common?.properties ?? {}),
  ]);
  const specific = errors.filter((e) => !['oneOf', 'anyOf', 'if'].includes(e.keyword));
  const reports = new Map<string, Report>();
  for (const error of specific.length ? specific : errors) {
    if (error.keyword === 'unevaluatedProperties' && error.instancePath === '') {
      // A failing allOf branch evaluates none of its properties, so 2020-12 also calls the valid
      // common fields unexpected. Report only the names the definition lacks.
      const name = String(error.params.unevaluatedProperty);
      if (declared.has(name)) continue;
      error.message = `must NOT have unevaluated property '${name}'`;
    }
    const at = join(path, error.instancePath);
    const message = error.message ?? error.keyword;
    reports.set(`${at} ${message}`, violation(message, at));
  }
  return [...reports.values()];
}

function join(path: string, pointer: string): string {
  for (const part of pointer.split('/').slice(1)) {
    const name = part.replaceAll('~1', '/').replaceAll('~0', '~');
    path += /^\d+$/.test(name) ? `[${name}]` : `.${name}`;
  }
  return path;
}

function violation(message: string, path: string): Report {
  return { level: 'violation', rule: 'schema', message, path };
}
