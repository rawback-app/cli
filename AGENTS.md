# cli — agent guide

`@rawback/cli`: the terminal client for Rawback, for humans and AI agents.
Authenticate, upload photos/RAW/video over SFTP with resumable state, search the
library in plain language, manage albums and their multilingual articles, and
drive Canon cameras over CCAPI.

It sits at the consumer end of the Rawback dependency graph: `@rawback/sdk`
carries all network/auth/config/upload logic and `@rawback/ccapi-js` the camera
transport, both pinned exactly. It shares `~/.rawback/` with the Desktop app, so
signing in or pairing a camera in one moves the other.

Distributed as a compiled standalone binary via GitHub Releases, the install
scripts and a Homebrew cask — **not** published to npm.

## Commands

| Command                                                  | What it does                                                 |
| -------------------------------------------------------- | ------------------------------------------------------------ |
| `bun run check`                                          | **The gate.** typecheck → test → lint → format:check → build |
| `bun run dev`                                            | Run from source (`bun run src/index.ts`)                     |
| `bun run build`                                          | Compile the standalone binary to `dist/rawback`              |
| `bun run build:all`                                      | Cross-compile every release target (needs GoReleaser 2.17)   |
| `bun test`                                               | Full suite                                                   |
| `bun test test/cli.test.ts`                              | One file — use this while iterating                          |
| `bun run typecheck` / `lint` / `format` / `format:check` | Individual steps                                             |
| `bun run hooks:install`                                  | Install the lefthook pre-commit hooks                        |

`bun run check` is the required final validation; it is what CI runs. If a check
cannot run, report exactly which command was skipped and why.

## Layout

| Path                                                                              | What                                                                                                                                                                            |
| --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/index.ts`                                                                    | `#!/usr/bin/env bun` shim; delegates to `features/cli/runtime.ts`                                                                                                               |
| `src/cli.ts`                                                                      | The entire yargs command tree — 76 commands, options, validation, dispatch                                                                                                      |
| `src/features/`                                                                   | Per-domain presenters and UI controllers (`albums/ articles/ auth/ camera/ cli/ config/ credentials/ dreams/ memory/ photos/ pricing/ shares/ upload/ uploads/ usage/ videos/`) |
| `src/ui/`                                                                         | Ink rendering, formatting, and the `CommandOutput` stdout/stderr boundary                                                                                                       |
| `src/camera*.ts`                                                                  | CCAPI registry, session, store, liveview, events, settings                                                                                                                      |
| `src/upload*.ts`, `photo-check.ts`, `video-repair.ts`                             | Transfer pipeline                                                                                                                                                               |
| `src/api.ts`, `client.ts`, `http.ts`, `session.ts`, `credentials.ts`, `sftp-*.ts` | SDK adapters                                                                                                                                                                    |
| `src/gql/`                                                                        | Generated GraphQL client — never hand-edit                                                                                                                                      |
| `test/`                                                                           | 42 Bun test files, flat                                                                                                                                                         |
| `docs/`                                                                           | `commands.md`, `configuration.md`, `development.md`                                                                                                                             |

## Project snapshot

- Runtime and package manager: Bun 1.4.0.
- Language: strict TypeScript using ESM and explicit `.ts` imports.
- CLI parser: Yargs; executable entry point: `src/index.ts`.
- Shared application kernel: `@rawback/sdk` (Node-compatible ESM).
- API transports: SDK-backed JSON REST and typed GraphQL.
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
- Put command behaviour in the relevant `src/*.ts` module, and **presentation in
  `src/features/<domain>/` and `src/ui/`** — output formatting moved out of the
  flat `src/*.ts` modules.
- Author shared GraphQL operations and transport behavior in `../sdk`; this
  repository should keep only CLI presentation and platform adapters.
- Keep secrets in `~/.rawback/`, never in repository fixtures or documentation.
- Diagnostics go to `~/.rawback/logs/` through the SDK's pino logger, **never**
  to stdout: stdout is the `--json` contract. Records use pino's argument
  order, `logger.info({ event }, 'message')`, and `pino-roll` numbers every
  file, so use `activeLogFile()` rather than building a name. `src/log-level.ts` holds the
  `--log-level`/`-v` singleton and must stay SDK-free at runtime (its import is
  type-only) for the same startup-cost reason `src/trace.ts` documents.

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
- Prefer Bun-native or standard APIs when they provide equivalent behavior. Use
  `node:` imports for compatibility APIs without a suitable Bun replacement,
  and follow the surrounding module's import ordering and formatting.

## Tests and generated code

Add or update focused tests for every behavior change. CLI help and validation
belong in spawn-based CLI tests; network, filesystem, and SFTP behavior should
use injected dependencies and temporary paths.

Run the smallest relevant test while iterating, then run the full suite:

```bash
bun test test/cli.test.ts
bun run check
```

`bun run check` is the required final validation. It covers typechecking, tests,
lint, formatting, and the standalone build. If a check
cannot run, report exactly which command was skipped and why.

## Documentation changes

When user-visible behavior changes, update all affected surfaces:

- Inline Yargs help in `src/cli.ts`
- Quick-start or examples in `README.md`
- Full options in `docs/commands.md`
- Setup, persistence, or security details in `docs/configuration.md`

Document actual current behavior; do not promise package managers, signing, or
platform support that the release configuration does not provide.

## Gotchas

- `~/.rawback/{config.yml,credentials.json,upload-state.json,cameras.json}` and
  `~/.rawback/logs/` are shared with the Desktop app at runtime. Changing a
  file's shape here breaks Desktop, and the contract is owned by `@rawback/sdk`,
  not by this repo. `rawback logs purge` clears Desktop's log too, by design.
- `@rawback/sdk` and `@rawback/ccapi-js` are pinned to exact versions. Bumping
  one means regenerating the lockfile; CI installs `--frozen-lockfile`.
- The binary's `--version` must equal `package.json`'s version — CI asserts it
  explicitly, so a hand-edited version fails the build.
- This is the one **public** Rawback repo. Keep secrets out of fixtures,
  examples and docs; `~/.rawback/` is the only place credentials belong.

## Git and releases

Do not discard unrelated working-tree changes. Keep commits scoped and use a
Conventional Commit subject such as `feat:`, `fix:`, `docs:`, or `test:`. Do not
manually change the package version or release manifest unless the task is
specifically about the release process.
