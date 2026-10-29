// Validation reports with the three levels of spec section 11.1.

/** violation: a MUST is broken; warning: a rule asks for a report; info: a SHOULD is not followed. */
export type Level = 'violation' | 'warning' | 'info';

export interface Report {
  level: Level;
  rule: string; // "schema", "signature", R1 to R17, or a profile rule such as regulated/P1
  message: string;
  path: string; // JSONPath into the input document
}

export interface Result {
  reports: Report[];
  conforms: boolean; // no violation
}

export function result(reports: Report[]): Result {
  return { reports, conforms: !reports.some((r) => r.level === 'violation') };
}
