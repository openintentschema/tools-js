# AGENTS.md

Guidance for coding agents and new contributors. Start with [README.md](README.md).

## What this repository is

The reference tools of the Open Intent Schema (OIS) in JavaScript: one command, `ois`, with
`validate` and `coverage`, a second implementation of the validator and of the coverage method
next to the Python one in
[openintentschema/tools](https://github.com/openintentschema/tools). Published on npm as
`ois-tools` (Node.js 24+, TypeScript, Apache-2.0), also usable as a library.

The standard lives in [openintentschema/openintentschema](https://github.com/openintentschema/openintentschema),
usually checked out next to this one as `../openintentschema`. **The validator implements the
specification; it never defines it.** What is valid, which rule applies and at which level is
decided there; `fixtures/README.md` there fixes how each rule is read. Both implementations must
report the same rules and levels for every fixture. Nothing here may depend on, name or favour a
product or vendor.

## Where things are

| Path | Content |
| --- | --- |
| `src/` | the package; one module per concern, see [docs/architecture.md](docs/architecture.md) |
| `tests/` | tests; `fixtures/` and `examples/` are copies from the specification |
| `schema/` | copy of Appendix B, shipped in the package |
| `scripts/sync-spec.ts`, `spec.lock` | copy schema, examples and fixtures; the specification commit they come from |
| `.github/` | CI and release workflows, templates, contributing guide, Code of Conduct, security policy |

## Commands

```bash
npm ci                                   # node_modules from package-lock.json
npm test                                 # all tests, including every conformance fixture
npm run check                            # strict type check and Biome (lint and format)
npm run build                            # dist/ for the package
node scripts/sync-spec.ts ../openintentschema   # update the copies from a clean checkout
```

Tests and scripts run as TypeScript directly (Node.js type stripping); only `npm run build`
compiles.

## Rules for changes

- Never edit the copies in `tests/fixtures/`, `tests/examples/` or `schema/`; change the
  specification repository and sync.
- A new or changed rule starts as an RFC there, then lands in both implementations.
- Tests first; a bug fix starts with a test that shows the bug.
- No network access, and only syntax that Node.js can strip (`erasableSyntaxOnly`).
- Keep `docs/architecture.md` current with design decisions, `CHANGELOG.md` with user-visible
  changes, and the README with every changed command.
- Code comments state only the essentials; rationale goes to `docs/architecture.md`.
- English everywhere; rule IDs and levels exactly as in the specification.
- Newest released versions of Node.js, libraries, tools and GitHub Actions, looked up rather
  than remembered; exact versions in `package.json`; Actions pinned to a commit SHA with the
  version as a comment; no update bots.
- Commits: one line, with DCO sign-off: `git commit -s -m "<what changed>"`.
