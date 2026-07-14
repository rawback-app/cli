# AGENTS.md

This file applies to the entire repository. It gives coding agents the project
context and checks needed to make safe, reviewable changes.

## Project snapshot

- Runtime and package manager: Bun 1.3.14.
- Language: strict TypeScript using ESM and explicit `.ts` imports.
- CLI parser: Yargs; executable entry point: `src/index.ts`.
- API transports: JSON REST and Apollo GraphQL.
- Tests: Bun test runner under `test/`.
- Formatting and linting: `oxfmt` and `oxlint`.
- Release flow: Conventional Commits, Release Please, and GoReleaser.

## Before editing

1. Read `README.md` for the user workflow and `docs/development.md` for the
   architecture and validation commands.
2. Inspect `git status -sb` and preserve unrelated or user-owned changes.
3. Find the command implementation and its tests before changing behavior.
4. Use existing dependency-injection patterns instead of adding global mocks.

## Source-of-truth rules

- Define the command tree, options, validation, and dispatch in `src/cli.ts`.
- Put command behavior and output formatting in the relevant `src/*.ts` module.
- Author GraphQL operations in `src/schema/*.gql`.
- Never edit or commit `src/gql/`; it is generated and intentionally ignored.
- Use the committed `graphql.schema.json` for normal client generation. Refresh
  it with `bun run g` only when `../server` is available and the schema change is
  intentional.
- Keep secrets in `~/.rawback/`, never in repository fixtures or documentation.

## Implementation expectations

- Preserve strict typing, `exactOptionalPropertyTypes`, and
  `noUncheckedIndexedAccess`; avoid unsafe casts and broad `any` types.
- Keep errors actionable but do not include tokens or SFTP passwords.
- Write human-readable data to stdout, warnings/errors to stderr, and set a
  nonzero exit status for failures.
- Keep `--json` output stable and machine-readable. Do not mix prose into JSON on
  stdout.
- Validate command arguments before making API or filesystem calls when
  practical.
- Preserve upload safety checks: config permissions, account/username matching,
  enabled credentials, unique basenames, remote duplicates, quota, locks, resume
  identity, and SFTP host keys.
- Use `node:` imports for Node-compatible built-ins and follow the surrounding
  module's import ordering and formatting.

## Tests and generated code

Add or update focused tests for every behavior change. CLI help and validation
belong in spawn-based CLI tests; network, filesystem, and SFTP behavior should
use injected dependencies and temporary paths.

Run the smallest relevant test while iterating, then run the full suite:

```bash
bun test test/cli.test.ts
bun run check
```

`bun run check` is the required final validation. It covers GraphQL generation,
typechecking, tests, lint, formatting, and the standalone build. If a check
cannot run, report exactly which command was skipped and why.

## Documentation changes

When user-visible behavior changes, update all affected surfaces:

- Inline Yargs help in `src/cli.ts`
- Quick-start or examples in `README.md`
- Full options in `docs/commands.md`
- Setup, persistence, or security details in `docs/configuration.md`

Document actual current behavior; do not promise package managers, signing, or
platform support that the release configuration does not provide.

## Git and releases

Do not discard unrelated working-tree changes. Keep commits scoped and use a
Conventional Commit subject such as `feat:`, `fix:`, `docs:`, or `test:`. Do not
manually change the package version or release manifest unless the task is
specifically about the release process.
