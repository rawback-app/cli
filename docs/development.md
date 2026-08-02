# Contributor guide

## Prerequisites and setup

The repository pins Bun 1.3.14 in `package.json`. Install exactly the locked
dependency graph before developing:

```bash
bun install --frozen-lockfile
bun run hooks:install
```

GoReleaser 2.17 is required only for all-platform builds and release validation;
the normal development and `bun run check` workflow requires only Bun.

Run the TypeScript entry point through the development script:

```bash
bun run dev -- --help
bun run dev -- photos list --help
```

The extra `--` separates arguments for the package script from CLI arguments.

## Repository layout

| Path                  | Purpose                                              |
| --------------------- | ---------------------------------------------------- |
| `src/index.ts`        | Minimal executable entry point                       |
| `src/cli.ts`          | Yargs command hierarchy, options, and dispatch       |
| `src/features/*`      | Feature-specific presenters and UI controllers       |
| `src/ui/*`            | Shared Ink components, output ports, and formatters  |
| `src/api.ts`          | Public re-exports for API and credential clients     |
| `src/client.ts`       | CLI identity adapter for `@rawback/sdk`              |
| `src/session.ts`      | SDK token-session compatibility adapter              |
| `src/config.ts`       | SDK config re-exports                                |
| `src/upload.ts`       | Upload preflight, scanning, retry, and orchestration |
| `src/sftp-client.ts`  | SDK SFTP compatibility adapter                       |
| `src/upload-state.ts` | Portable JSON state and legacy SQLite migration      |
| `test/*.test.ts`      | Bun unit and CLI integration tests                   |

Command modules keep behavior separate from the CLI declaration and build
feature-specific UI documents for human output. Shared Ink components render
those documents as responsive tables, fields, notices, help, and activity
states. `CommandOutput` is the stdout/stderr boundary: JSON and raw content
bypass Ink decoration, while interactive-only animations are disabled for
injected or redirected output.

Injectable dependency objects let tests replace network clients, prompts,
output, filesystem paths, and SFTP transports.

## Validation

Run all checks before opening a pull request:

```bash
bun run check
```

That command typechecks, tests, lints, checks formatting, and builds
`dist/rawback`. Focused commands are available
while iterating:

```bash
bun run typecheck
bun run test
bun run lint
bun run format:check
bun run build
```

To run one test file:

```bash
bun test test/cli.test.ts
```

After a build, smoke-test the standalone artifact with:

```bash
./dist/rawback --help
./dist/rawback --version
```

## Shared SDK

Network, authentication, configuration, GraphQL operations, SFTP transport, and
portable upload state live in the sibling `../sdk` repository and are published
as `@rawback/sdk`. Make shared contract changes there first, run `pnpm check`,
then update the pinned SDK version in this repository. The CLI should retain
only Bun/Yargs/Ink behavior and thin compatibility adapters.

The SDK validates `metadata.concurrency` and owns the automatic CPU/memory worker
policy. CLI upload and photo-check adapters only forward the parsed setting; do
not duplicate its range or resource calculation here.

## API clients

Commands share `createRawbackClient` from `src/api.ts`. The factory reads
credentials and configuration through `@rawback/sdk` and exposes its native
fetch-based REST and GraphQL clients:

```ts
import { createRawbackClient } from './api.ts'

const client = await createRawbackClient()
```

The API host resolves in this order:

1. `apiHost` passed to `createRawbackClient`
2. `apiHost` in `~/.rawback/config.yml`
3. `https://api.rawback.app`

REST and GraphQL requests send `User-Agent: rawback-cli@<version>`. Authenticated
requests send the saved access token as a Bearer token. The compatibility
GraphQL client returns partial data together with a typed error when the server
does both.

The REST helper currently handles JSON requests and responses:

```ts
const response = await client.http.requestJson<MyResponse>('/api/v1/example', {
  method: 'POST',
  body: { example: true },
})
```

Non-success status codes throw `HttpError` with the parsed body. Malformed JSON
throws `JsonResponseError`.

## Change guidelines

- Keep `src/cli.ts`, command help, README examples, and `docs/commands.md` aligned.
- Add tests for option validation, error paths, and human/JSON output changes.
- Keep credentials, access tokens, refresh tokens, and SFTP passwords out of
  errors, snapshots, fixtures intended for publication, and logs.
- Preserve atomic writes and restrictive Unix permissions for secret-bearing
  files.
- Treat host-key verification, upload locking, duplicate detection, quota checks,
  and resumable-state behavior as safety boundaries.
- Use Conventional Commit subjects so Release Please categorizes changes.

## Releases

Pushes to `main` update the Release Please PR. Merging that PR creates a version
tag; the release workflow validates the commit and uses GoReleaser's Bun builder
to publish Linux, macOS, and Windows archives for x86-64 and arm64 plus
`checksums.txt`. Run the same cross-build locally with:

```bash
bun run build:all
goreleaser release --snapshot --clean
```

Snapshot releases generate unsigned local artifacts and never update Homebrew.
Production releases sign and notarize both macOS binaries, then publish
`Casks/rawback.rb` to `rawback-app/homebrew-tap`.

The release workflow requires these repository secrets and stops before uploading
assets if any are missing:

- `MACOS_SIGN_P12`: base64-encoded Developer ID Application certificate.
- `MACOS_SIGN_PASSWORD`: password for that certificate.
- `MACOS_NOTARY_KEY`: base64-encoded App Store Connect API key.
- `MACOS_NOTARY_KEY_ID`: App Store Connect key ID.
- `MACOS_NOTARY_ISSUER_ID`: App Store Connect issuer UUID.
- `HOMEBREW_TAP_GITHUB_TOKEN`: fine-grained token with Contents write access to
  `rawback-app/homebrew-tap`.

Never print these values or place them in repository files. Windows binaries are
released without Authenticode signatures.
