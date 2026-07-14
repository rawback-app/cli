# Rawback CLI

Command-line tools for Rawback users and AI agents.

## Requirements

- [Bun 1.3.14](https://bun.sh/)

## Development

Install the pinned dependencies:

```bash
bun install --frozen-lockfile
```

Run the CLI from source:

```bash
bun run dev -- --help
```

Run all validation checks and compile a local standalone binary:

```bash
bun run check
./dist/rawback --version
```

Individual checks are also available:

```bash
bun run typecheck
bun run test
bun run lint
bun run format:check
```

## API clients

Future commands share the clients exported from `src/api.ts`. The factory reads
credentials from `~/.rawback/credentials.json`, configures JSON REST requests,
and creates an Apollo Client for `/api/v2/graphql`:

```ts
import { createRawbackClient } from "./api.ts";

const client = await createRawbackClient();
// Pass generated documents to client.graphql.query or client.graphql.mutate.
```

GraphQL operations live in `src/schema/**/*.gql`; the auth status query is the
first generated operation. Regenerate the typed documents after adding more.

The API host is resolved in this order:

1. `apiHost` passed to `createRawbackClient`
2. `apiHost` in `~/.rawback/config.yml`
3. `https://api.rawback.app`

Both REST and GraphQL requests send `User-Agent: rawback-cli@<version>`. When
credentials are present, they also send the saved access token as a Bearer token.
Apollo queries default to `no-cache` and `errorPolicy: 'all'`, allowing callers to
inspect partial data and GraphQL errors together.

The REST client only handles JSON in this foundation phase:

```ts
const response = await client.http.requestJson<MyResponse>("/api/v1/example", {
  method: "POST",
  body: { example: true },
});
```

Non-successful status codes throw `HttpError` with the parsed response body.
Malformed JSON throws `JsonResponseError`.

## Credentials

Credentials use this shape and are written atomically with restrictive permissions
on Unix:

```json
{
  "token": "access token",
  "refreshToken": "refresh token"
}
```

Use `readCredentials`, `writeCredentials`, and `deleteCredentials` from
`src/api.ts`. The credentials directory and file are created only when credentials
are first saved.

Authenticated clients automatically exchange an expired access token through
`/api/v1/auth/refresh`, save the rotated token pair, and retry the failed REST or
GraphQL request once.

## Configuration

All commands read `~/.rawback/config.yml`. The file is optional for commands that do not
need SFTP. Uploads use this nested configuration:

```yaml
apiHost: https://api.rawback.app
sftp:
  endpoint: sftp://ftp.rawback.app:2222
  username: annatarhe
  password: "generated SFTP credential password"
  # Optional explicit pin; otherwise the first host key is trusted and saved.
  # hostFingerprint: SHA256:base64-fingerprint
```

The endpoint contains only the host and optional port; credentials stay in
`sftp.username` and `sftp.password`. Because this file contains a password,
`upload` requires mode `0600` on Unix. An explicit `apiHost` passed to the client
factory takes precedence over the config file.

## GraphQL generation

GraphQL operations are authored in `src/schema/*.gql`. The committed
`graphql.schema.json` lets standalone CLI checkouts regenerate types
without cloning the server repository:

```bash
bun run graphql:generate
```

When the sibling `../server` repository is available, refresh both the schema
snapshot and generated client with:

```bash
bun run g
```

Generated files under `src/gql/` are ignored and must not be committed. The
development, build, typecheck, test, and validation scripts regenerate them as
needed; `bun run graphql:check` also verifies that the output remains ignored.

Install the Git pre-commit hooks with `bun run hooks:install`. The hooks format
and lint staged TypeScript and JavaScript files using the same tools as CI.

## Usage

```text
rawback auth [--email <email>] [--password <password>] [--force]
rawback auth status
rawback credentials list [--json]
rawback credentials add [--name <name>] [--json]
rawback credentials delete <id> [--force] [--json]
rawback upload --path <file-or-directory> [--concurrency 4] [--dry-run]
rawback [options]

Rawback CLI for humans and AI agents

Options:
  -h, --help     display help for command    [boolean]
  -V, --version  output the current version  [boolean]
```

`rawback auth` prompts for any omitted email or password. If stored credentials
still authenticate successfully, it asks before replacing them; `--force` skips
that check and confirmation. Supplying both credentials with `--force` supports
non-interactive login. Passwords passed with `--password` may be visible in shell
history and process listings.

`rawback auth status` validates the saved session through the API and prints basic
account information. Both commands refresh expired access tokens when the stored
refresh token is still valid.

`rawback credentials` manages the authenticated account's FTP/SFTP upload
credentials. The command is also available as `rawback cred`, and `delete` can
be shortened to `del`:

```bash
rawback cred list
rawback cred add --name "Home PC"
rawback cred del 7
rawback cred del 7 --force --json
```

`add` prompts for the name when it is omitted. The server always generates the
password; it cannot be chosen or changed. Save it from the create response
immediately because it cannot be retrieved by `list`. Deletion asks for
confirmation unless `--force` is supplied. Every credentials action supports
`--json` for automation.

`rawback upload` accepts one supported photo/RAW file or recursively scans a
directory, skipping symbolic links. It validates the authenticated account,
enabled SFTP credentials, username, exact remote duplicates, basename collisions,
and remaining quota before opening one SFTP connection. Up to `--concurrency`
(default 4, maximum 16) files stream in parallel over that connection.

Completed files are recorded in `~/.rawback/upload-progress.sqlite` using Bun's
built-in SQLite support. Re-running the command skips completed files whose path,
size, and modification time still match; an interrupted file restarts from zero.
The first observed SSH host key is saved in the same database unless
`hostFingerprint` pins it explicitly.

`--dry-run` does not connect to SFTP or modify progress state. It reports pending
and skipped counts, bytes, and an ETA based on matching upload history, falling
back to a labeled 10 Mbps estimate when history is unavailable.

Unknown arguments are reported on stderr and exit with status 1.

## Releases

Release Please maintains versions and the changelog from Conventional Commits.
When its release PR is merged, GoReleaser compiles and publishes standalone
archives for:

- Linux x86-64 (baseline) and arm64
- macOS x86-64 and arm64
- Windows x86-64 (baseline)

Each GitHub Release includes a `checksums.txt` file. Package-manager publishing,
code signing, and notarization are not configured yet.
