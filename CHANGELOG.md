# Changelog

`ois-tools` for Node.js. [Semantic Versioning](https://semver.org/); during 0.x any release may
change behaviour.

## Unreleased

## 0.3.0

- Draft 5 of the specification: the passport predicate type, the schema `$id` and the coverage
  method URI are under `https://openintentschema.io/`; passports with the old placeholder type
  are rejected.
- R16, R17 and the rule IDs `schema` and `signature` are rules of the specification.

## 0.2.0

- `ois coverage`: intent coverage by the reference method of Appendix D, per criterion, with the
  check of what a passport declares; text and Markdown output.
- `coverage()`, `passportCoverage()` and `collect()` in the library.

## 0.1.0

- `ois validate`: Appendix B, R1 to R17, the profile `regulated/v0.1`, DSSE and keyless Sigstore
  signatures; text, JSON and SARIF output. Passes every conformance fixture of the specification.
- `validate()` and the loaders for keys and trusted roots as a library.
