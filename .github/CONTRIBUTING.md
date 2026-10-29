# Contributing

Thank you for helping to build the reference tools for the Open Intent Schema.

## Before you start

- The validator implements the specification; it never defines it. What counts as valid is
  decided in [openintentschema/openintentschema](https://github.com/openintentschema/openintentschema)
  (specification, schema, conformance fixtures) under its `GOVERNANCE.md`.
- A change to what the validator accepts or reports therefore starts there, as an RFC issue,
  and lands in this implementation and in [openintentschema/tools](https://github.com/openintentschema/tools).
  Bug fixes, refactoring and tooling can go straight to a pull request here.
- Nothing in this repository may depend on, name or favour a specific product or vendor.
- Everyone taking part follows the [Code of Conduct](CODE_OF_CONDUCT.md).

## Developer Certificate of Origin

Every commit must carry a DCO sign-off, which states that you have the right to submit the
work under the Apache-2.0 license:

```
git commit -s -m "Describe your change"
```

## Pull requests

- One topic per pull request, with tests. A bug fix starts with a test that shows the bug.
- Do not edit the copies of the schema, examples or fixtures; update them with
  `node scripts/sync-spec.ts` from a clean checkout of the specification repository.
- CI must pass: `npm run check` and `npm test` on every supported Node.js version.
- User-visible changes get a line under "Unreleased" in `CHANGELOG.md`.

[docs/architecture.md](../docs/architecture.md) shows how the code is organised. Security issues
are reported privately, see [SECURITY.md](SECURITY.md).

## License

By contributing you agree that your contribution is licensed under Apache-2.0.
