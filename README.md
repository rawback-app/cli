# Rawback CLI

Use [Rawback](https://rawback.app) from a terminal or an automation script. The
CLI can sign in to your account, upload photo and RAW files, search your library,
inspect usage, and open your profile in a browser.

## What you can do

- Upload a file or recursively upload a directory over SFTP.
- Safely resume an interrupted upload and skip files already uploaded.
- Search photos by metadata, capture date, rating, location, and GPS data.
- Manage the SFTP credentials associated with your account.
- Inspect upload sessions, storage usage, AI credits, and pricing.
- Request machine-readable JSON from read and credential commands.

## Install

### Standalone binary

Download the archive for your operating system and CPU from
[GitHub Releases](https://github.com/rawback-app/cli/releases). Extract the
`rawback` binary (`rawback.exe` on Windows), put it in a directory on your
`PATH`, and verify it.

On Linux or macOS, replace `<archive>` with the downloaded `.tar.gz` filename:

```bash
tar -xzf <archive>
mkdir -p ~/.local/bin
install -m 0755 rawback ~/.local/bin/rawback
rawback --version
```

Make sure `~/.local/bin` is on your `PATH`. On Windows, extract the `.zip` in
PowerShell, then move `rawback.exe` into a directory on `PATH`:

```powershell
Expand-Archive .\rawback_Windows_x86_64.zip -DestinationPath .
.\rawback.exe --version
```

Once installed, view the available commands with:

```bash
rawback --help
```

Release archives are available for Linux (x86-64 and arm64), macOS (x86-64 and
Apple silicon), and Windows (x86-64). The standalone binary does not require Bun.

> Binaries are not currently code-signed or notarized. If your platform blocks
> the downloaded binary, build it from source instead.

### Build from source

[Bun 1.3.14](https://bun.sh/) is required:

```bash
git clone https://github.com/rawback-app/cli.git
cd cli
bun install --frozen-lockfile
bun run build
./dist/rawback --version
```

Move `dist/rawback` somewhere on your `PATH` if you want to run it outside the
repository.

## Quick start

### 1. Sign in

```bash
rawback auth
rawback auth status
```

`rawback auth` securely prompts for your email and password. The resulting
access and refresh tokens are saved in `~/.rawback/credentials.json`. Expired
access tokens are refreshed automatically when possible.

### 2. Browse your account

These commands work immediately after sign-in:

```bash
rawback photos list
rawback uploads
rawback usage
rawback pricing
rawback web
```

Add `--json` to data-oriented commands when you need structured output:

```bash
rawback photos list --page-size 10 --json
rawback usage --json
```

### 3. Set up uploads

Create an SFTP credential. Its password is displayed only once, so save it
before continuing:

```bash
rawback cred add --name "My computer"
```

Create `~/.rawback/config.yml` with the account slug shown by
`rawback auth status` and the generated password:

```yaml
sftp:
  endpoint: sftp://ftp.rawback.app:2222
  username: your-account-slug
  password: "generated-password"
```

On Linux and macOS, protect the file because it contains a password:

```bash
chmod 600 ~/.rawback/config.yml
```

Preview an upload, then run it:

```bash
rawback photos upload --path ~/Pictures/Export --dry-run
rawback photos upload --path ~/Pictures/Export
```

Directories are scanned recursively. Symbolic links and unsupported files are
skipped. Supported formats are ARW, CR2, CR3, DNG, HEIC, HEIF, JPEG, JPG, NEF,
PNG, RAF, and WebP.

For host-key pinning, resumable-upload behavior, and troubleshooting, see
[Configuration and uploads](docs/configuration.md).

## Common examples

```bash
# Search filenames and metadata
rawback photos list --search "Iceland"

# Combine filters; repeat or comma-separate multi-value filters
rawback photos list --camera-make Sony --rate 4,5 --has-gps

# Limit photos to a capture window
rawback photos list \
  --captured-after 2026-01-01 \
  --captured-before 2026-02-01

# Upload up to eight files in parallel
rawback photos upload --path ./photos --concurrency 8

# Inspect failed upload sessions
rawback uploads --status failed

# List, create, and revoke SFTP credentials
rawback cred list
rawback cred add --name "Home workstation"
rawback cred del 7
```

See the [command reference](docs/commands.md) for every command, option, default,
and automation note. You can also ask the binary for context-specific help:

```bash
rawback --help
rawback photos list --help
rawback photos upload --help
```

## Files and security

Rawback stores local state under `~/.rawback/`:

| File                     | Purpose                                             |
| ------------------------ | --------------------------------------------------- |
| `credentials.json`       | Access and refresh tokens created by `rawback auth` |
| `config.yml`             | Optional API/web hosts and SFTP upload settings     |
| `upload-progress.sqlite` | Resume history and trusted SFTP host keys           |

The CLI creates credential and upload-state files with restrictive permissions
on Unix. You create `config.yml` yourself, so upload commands require it to have
mode `0600` on Unix. Never commit files from `~/.rawback/` or paste their secrets
into issues and logs.

## Development

Install the pinned dependencies and run the CLI from source:

```bash
bun install --frozen-lockfile
bun run dev -- --help
```

Run the complete local validation suite and smoke-test the compiled binary:

```bash
bun run check
./dist/rawback --version
```

Useful focused checks are:

```bash
bun run typecheck
bun run test
bun run lint
bun run format:check
```

Install the repository's pre-commit hooks with `bun run hooks:install`. More
architecture, GraphQL generation, testing, and release notes are in
[the contributor guide](docs/development.md). Coding agents should also read
[`AGENTS.md`](AGENTS.md) before making changes.

## Releases

[Release Please](https://github.com/googleapis/release-please) derives versions
and changelogs from Conventional Commits. Merging its release PR triggers
GoReleaser, which builds the platform archives and publishes a
`checksums.txt` file with each GitHub Release.
