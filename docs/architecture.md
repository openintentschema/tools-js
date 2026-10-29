# Architecture

## A second implementation

The validator follows the specification and the conformance fixtures, not the Python code. The
modules mirror those of the Python `ois-tools` so that a change to a rule is easy to find in
both, but each rule is written from the specification and `fixtures/README.md`. CI checks both
against the same fixtures; schema messages may differ, rules and levels may not.

## Flow of one check

1. A DSSE envelope or Sigstore bundle is opened and its signature verified (`signing.ts`,
   `keyless.ts`). Its payload is checked from here on; who signed it is kept for R12.
2. Appendix B (`schema.ts`): each record against its own type's definition, with Ajv for JSON
   Schema 2020-12.
3. Only if the schema passes: the integrity rules (`rules.ts`) and profiles (`profiles.ts`) on the
   records (`document.ts`).

## Modules

| Module | Responsibility |
| --- | --- |
| `report.ts` | levels, reports, results |
| `schema.ts` | Appendix B check of a record, a bundle or a passport statement |
| `document.ts` | the records of the input with their JSONPaths, reference resolution, signers |
| `digests.ts` | RFC 8785 canonical JSON and the criterion and intent digests |
| `rules.ts` | one function per integrity rule, in rule order |
| `profiles.ts` | the profile `regulated/v0.1` |
| `signing.ts` | DSSE envelopes, key ids and trusted keys |
| `keyless.ts` | Sigstore bundles, verified offline with `@sigstore/verify` against trusted roots |
| `validator.ts` | `validate()`: signatures, schema, rules |
| `sarif.ts` | SARIF 2.1.0 output, with line numbers from a JSON scanner |
| `main.ts`, `validate-cli.ts`, `cli.ts` | the `ois` command |

## Design decisions

- **TypeScript that Node.js runs directly.** Only erasable syntax, `.ts` imports rewritten on
  build: tests and scripts need no compile step, and the package ships plain JavaScript.
- **Few dependencies.** Ajv for the schema, the Sigstore libraries for keyless signatures; DSSE,
  canonical JSON and the rules use Node.js only.
- **Same output as the Python tools.** Rules, levels, paths, messages of the integrity rules, exit
  codes and the JSON and SARIF formats match, so either implementation can replace the other in
  a pipeline. Schema messages come from Ajv and are worded differently.
- **Keyless without a fixed identity.** A bundle verifies when its certificate chains to a given
  trusted root and its transparency log entry holds; the certificate identity (issuer, subject)
  is then matched to actors by R12, not fixed in advance.
- **No network access.** Trusted keys and roots are files the verifier chooses.
