# Development

How to work on `ois-tools` for Node.js. How it is built: [architecture.md](architecture.md).
Rules for contributions: [CONTRIBUTING.md](../.github/CONTRIBUTING.md).

## Setup and checks

Requires Node.js 24 or later.

```bash
npm ci                     # node_modules from package-lock.json
npm test                   # all tests, including every conformance fixture
npm run check              # strict type check and Biome
npm run build              # dist/ for the package
```

CI (`.github/workflows/checks.yml`) runs the same on Node.js 24 and 26, plus a job that checks the
copies from the specification (below) and one that compares the results with the Python tools.

## Copies from the specification

The schema, the examples and the conformance fixtures are copies from the
[specification repository](https://github.com/openintentschema/openintentschema). Never edit
them here. To update them, check out the specification next to this repository, commit there,
and run:

```bash
node scripts/sync-spec.ts ../openintentschema
```

The script refuses a checkout with uncommitted changes and records its commit in `spec.lock`.
CI checks out the specification at that commit and fails if a copy differs
(`sync-spec.ts --check`). Push the specification first, then this repository.

## Same results as the Python tools

`scripts/compare.ts` runs both implementations on every fixture: `validate` must give the same
rules, levels and paths, and the same messages for the integrity and profile rules; `coverage`
the same output and exit code. CI runs it against the Python release in `OIS_TOOLS` of
`checks.yml`; locally against a checkout of
[openintentschema/tools](https://github.com/openintentschema/tools):

```bash
node scripts/compare.ts ../tools/.venv/bin/ois
```

When the copied fixtures change what the validator reports, change both implementations and set
`OIS_TOOLS` to the Python release that follows the same specification commit.

## Releases

1. Add the changes under a new version in `CHANGELOG.md`, set `version` in `package.json` and
   update `package-lock.json` with `npm install --package-lock-only`.
2. Merge to `main` and wait for CI.
3. Push a tag: `git tag v<version> && git push origin v<version>`, then approve the job in the
   `npm` environment.

The workflow `.github/workflows/release.yml` checks that tag and version match, runs the tests,
packs the package, smoke-tests it from a clean install and publishes it to npm with trusted
publishing: no stored token, and npm records a signed provenance of where it was built. The `npm`
environment asks a maintainer to approve each release and accepts only tags `v*`
(*Settings → Environments → npm*). A published version cannot be replaced; fix forward with a
new version.

The trusted publisher is set on npmjs.com under *ois-tools → Settings → Trusted publishing*:
GitHub Actions, organization `openintentschema`, repository `tools-js`, workflow `release.yml`,
environment `npm`, and under *Allowed actions* `npm publish`. Without that permission npm answers
`E403 OIDC permission denied for this action`. A connection cannot be edited, only deleted and
created again. npm only offers trusted publishing for a package that exists, so version 0.1.0 was
published once by hand.

After a release, check the package from the registry itself, since `npm view` caches:

```bash
curl -s https://registry.npmjs.org/ois-tools | jq '."dist-tags"'
npx -y ois-tools@<version> --version
npm audit signatures                 # in a project that installed it: provenance verified
```

Then update the guides on the website (specification repository, `site/src/content/docs/`)
that describe a changed command.

## Conventions

- Newest released versions of Node.js, TypeScript, libraries and GitHub Actions, looked up
  rather than remembered; exact versions in `package.json`; Actions pinned to a commit SHA with
  the version as a comment. Dependencies are updated by hand, without bots.
- TypeScript that Node.js runs directly (`erasableSyntaxOnly`), Biome with line width 100.
- English in code and documentation; rule IDs and levels exactly as in the specification.
- Every commit carries a DCO sign-off: `git commit -s -m "<what changed>"`, one line.
- No network access at run time: commands read the files and keys they are given.
