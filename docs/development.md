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

| Path                    | Purpose                                              |
| ----------------------- | ---------------------------------------------------- |
| `src/index.ts`          | Minimal executable entry point                       |
| `src/cli.ts`            | Yargs command hierarchy, options, and dispatch       |
| `src/features/*`        | Feature-specific presenters and UI controllers       |
| `src/ui/*`              | Shared Ink components, output ports, and formatters  |
| `src/api.ts`            | Public re-exports for API and credential clients     |
| `src/client.ts`         | CLI identity adapter for `@rawback/sdk`              |
| `src/session.ts`        | SDK token-session compatibility adapter              |
| `src/config.ts`         | SDK config re-exports                                |
| `src/camera*.ts`        | Canon CCAPI store, session, registry, and commands   |
| `src/features/camera/*` | Camera presenters and the interactive explorer       |
| `src/upload.ts`         | Upload preflight, scanning, retry, and orchestration |
| `src/sftp-client.ts`    | SDK SFTP compatibility adapter                       |
| `src/upload-state.ts`   | Portable JSON state and legacy SQLite migration      |
| `test/*.test.ts`        | Bun unit and CLI integration tests                   |

Command modules keep behavior separate from the CLI declaration and build
feature-specific UI documents for human output. Shared Ink components render
those documents as responsive tables, fields, quota meters, charts, notices,
help, and activity states. Chart and meter geometry lives in `src/ui/chart.ts`
as pure functions so it can be unit-tested without rendering. `CommandOutput` is
the stdout/stderr boundary: JSON and raw content bypass Ink decoration, while
interactive-only animations are disabled for injected or redirected output.

Injectable dependency objects let tests replace network clients, prompts,
output, filesystem paths, and SFTP transports.

## Camera client

Camera support is built on `@rawback/ccapi-js`, pinned exactly like the SDK. Two
import rules keep it out of the way of everything else:

- Camera modules must never import `@rawback/sdk`. Nothing about talking to a
  camera needs the Rawback API, and pulling the SDK barrel in would cost startup
  time.
- `src/cli.ts` must never import `@rawback/ccapi-js`. The camera group is
  declarations plus a lazy `await import('./camera*.ts')`, so `rawback --help`
  never loads the camera client — the same discipline `src/trace.ts` documents.

`src/camera-registry.ts` is the catalogue of CCAPI endpoints. It is a source file
rather than data on purpose: the compiler checks every call against the library,
so a version bump that renames a method fails `bun run typecheck`. Adding an
entry there surfaces it in both `rawback camera api` and the interactive
explorer at once. `test/camera-registry.test.ts` also invokes every entry against
a throwing fetch, which catches a removed method that still typechecks through an
`any`.

`~/.rawback/cameras.json` is shared with the Rawback desktop app. The file format
is the contract between the two, and it is implemented once in each repository —
so a change to its shape needs a matching change there. The natural long-term
home for it is `@rawback/sdk`, which both already depend on.

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

Snapshot releases do not apply our Developer ID signature or submit to Apple,
and never update Homebrew. Production releases sign and notarize both macOS CLI
binaries and the bundled `ffmpeg` and `ffprobe` for x64 and arm64, then publish
`Casks/rawback.rb` to `rawback-app/homebrew-tap`.

GoReleaser's built-in notarization covers the CLI build artifacts, but not files
added through `archives.files`. After staging, `scripts/sign-video-tools.ts`
signs and notarizes those four macOS helpers in place using
[Quill](https://github.com/anchore/quill). The release workflow installs Quill
0.7.1 with a pinned SHA-256 checksum. It reuses the existing `MACOS_*` secrets
through environment variables; no credentials are passed as command arguments.
Each submission waits for Apple's result, with a 20-minute process timeout.
Missing helpers, missing credentials, or a failed submission stop the release
before packaging and checksum generation. Snapshot builds skip this hook's
signing work and do not require Quill or signing credentials.

For a production release run locally, install Quill 0.7.1 on `PATH` alongside
GoReleaser and supply the same release secrets. To verify a published macOS
archive after extraction, inspect all three executables:

```bash
codesign --verify --strict --verbose=2 ./rawback
codesign --verify --strict --verbose=2 ./ffmpeg/ffmpeg
codesign --verify --strict --verbose=2 ./ffmpeg/ffprobe
spctl --assess --type execute --verbose=2 ./ffmpeg/ffmpeg
spctl --assess --type execute --verbose=2 ./ffmpeg/ffprobe
```

Signature checks alone do not prove notarization; test the downloaded release
on a Mac with Gatekeeper enabled as well. Existing unsigned downloads need to
be replaced with a release containing the signed helpers.

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

### Video repair SDK release dependency

Video repair and preparation diagnostics require the pending SDK release with
preparation callbacks, the skip-thumbnail option, and updated video detail fields.
The CLI remains pinned to published `@rawback/sdk` 0.3.1 without a package patch.
After those SDK changes are released, update the dependency and lockfile, then
run `bun run check` before merging the CLI changes.

Deploy the server's additive `Video.audioChunkCount` field before using repair or
the updated web detail query. No database migration is required.
