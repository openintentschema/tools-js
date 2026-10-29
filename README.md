# ois-tools (JavaScript)

[![npm](https://img.shields.io/npm/v/ois-tools)](https://www.npmjs.com/package/ois-tools)
[![Checks](https://github.com/openintentschema/tools-js/actions/workflows/checks.yml/badge.svg)](https://github.com/openintentschema/tools-js/actions/workflows/checks.yml)

The validator of the [Open Intent Schema (OIS)](https://openintentschema.io) for Node.js, the
open data standard that links what was required to what was built and to the evidence in
between. It checks records, bundles and Quality Passports against the specification: the JSON
Schema of Appendix B, the integrity rules R1 to R5 and R8 to R17, the profile `regulated/v0.1`,
DSSE signatures and keyless Sigstore signatures. And it recomputes the intent coverage a passport
declares.

It is the second implementation of the validator, next to the Python
[`ois-tools`](https://github.com/openintentschema/tools), and passes the same conformance
fixtures. The Python package also writes records; this one checks them: `ois validate` and
`ois coverage`.

## Install

```bash
npx ois-tools validate passport.json          # without installing
npm install -g ois-tools                      # then: ois validate passport.json
npm install --save-dev ois-tools              # in a project: npx ois validate passport.json
```

Node.js 24 or later.

## Official packages

Published only as [`ois-tools` on PyPI](https://pypi.org/project/ois-tools/),
[`ois-tools` on npm](https://www.npmjs.com/package/ois-tools) and
`ghcr.io/openintentschema/ois-tools`, each built and signed by a workflow of the
`openintentschema` organization on GitHub. A package under another name or scope is not part of
the project. How to check where a download was built:
[Official packages](https://openintentschema.io/develop/tools/#official-packages).

## Validate

```bash
ois validate bundle.json passport.json
ois validate passport.dsse.json --trusted-key keys/
ois validate passport.sigstore.json --trusted-root trusted_root.json
ois validate passport.json --profile regulated/v0.1
ois validate passport.json --format sarif > ois.sarif
```

| Option | Meaning |
| --- | --- |
| `--format` | `text` (default), `json`, or `sarif` for GitHub code scanning and IDEs |
| `--trusted-key` | a PEM public key, a directory of `*.pub` files, or `KEYID=FILE`; repeatable |
| `--trusted-root` | a Sigstore trusted root, or JSON lines as `gh attestation trusted-root` writes them; repeatable |
| `--profile` | also check a profile, by URI or name (`regulated/v0.1`); records may list it too |

Exit code 0 means every file conforms (warnings and info allowed), 1 a violation, 2 that an
argument or file could not be read. Rules, levels, paths, exit codes and formats are the same as
those of the Python `ois validate`; only the wording of schema errors differs.

Each report has a level, a rule and a JSONPath:

```
passport.json: warning [R12] $.predicate.records[7].context: context is self-declared: no contextRecordedBy
```

| Level | Meaning |
| --- | --- |
| `violation` | a MUST is broken; the file does not conform |
| `warning` | a rule asks for a report, for example a self-declared context (R12) |
| `info` | a SHOULD is not followed |

Signatures are checked offline: DSSE envelopes with Ed25519 or ECDSA keys you trust, Sigstore
bundles against trusted roots you give. The signer's key id or certificate identity then counts
for R12, so a context recorded and signed by another actor is attested.

## Coverage

```bash
ois coverage passport.json                        # also checks the coverage the passport declares
ois coverage passport.dsse.json --trusted-key keys/   # with the attested variant
ois coverage .ois/ --build "$BUILD"               # before the passport: what is still missing
ois coverage passport.json --format markdown >> "$GITHUB_STEP_SUMMARY"
```

```
https://ois.acme.example/intents/INT-142@1#AC-1  not covered
    no evidence
https://ois.acme.example/intents/INT-142@1#AC-2  covered  https://ois.acme.example/evidence/EV-9021
intentCoverage 0.5 (declared 0.5)
intentCoverageAttested 0.0
intentCoverageWeighted 0.5
intentCoverageDiverse 0.5
```

Intent coverage follows the reference method of Appendix D, with its attested, weighted and
diverse variants. `--intent` and `--scope` choose what counts for records; a passport names its
own. Records are read from JSON files and directories; YAML drafts are read by the Python tools.
Exit code 1 means a declared value differs from the computed one, at the precision the passport
declares; 2 that a file could not be read or the release subject is missing. The output is the
same as that of the Python `ois coverage`.

## As a library

```js
import { readFileSync } from 'node:fs';
import { loadTrustedKeys, validate } from 'ois-tools';

const passport = JSON.parse(readFileSync('passport.dsse.json', 'utf8'));
const result = validate(passport, { trustedKeys: loadTrustedKeys(['keys/']) });
if (!result.conforms) console.error(result.reports);
```

`validate(document, { trustedKeys, trustedRoots, profiles })` returns `{ conforms, reports }`;
`passportCoverage(passport, trustedKeys, trustedRoots)` and `coverage(records, { subject,
intents, scope })` return the coverage per criterion and its `measurements()`.
`loadTrustedRoots(files)` reads Sigstore trusted roots, `resolveProfile(name)` a profile URI.

## Privacy

`ois validate` and `ois coverage` open no network connection. They read the files and keys they
are given and print the result.

## Documentation

- [Specification, schema and conformance fixtures](https://github.com/openintentschema/openintentschema)
- [Reference tools](https://openintentschema.io/develop/tools/) on the website
- [Architecture](docs/architecture.md): how the validator is built, and why

## Contributing

See [CONTRIBUTING.md](.github/CONTRIBUTING.md). Changes to what counts as valid start in the
specification repository.

## License

Apache-2.0, see [LICENSE](LICENSE).
