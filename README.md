# Rawback CLI

Use [Rawback](https://rawback.app) from a terminal or an automation script. The
CLI can sign in to your account, upload photo and RAW files, search your library,
manage albums and their Markdown articles, inspect usage, and open your profile
in a browser.

## What you can do

- Upload a file or recursively upload a directory over SFTP.
- Safely resume an interrupted upload and skip files already uploaded.
- Search photos by metadata, capture date, rating, location, and GPS data.
- Create and curate albums, smart filters, cover images, tags, and Markdown stories.
- List and inspect daily AI-generated dream recaps, including their contributing photos.
- Browse content shared with you and manage your outgoing share links.
- Manage the SFTP credentials associated with your account.
- Inspect upload sessions, storage usage, AI credits, and pricing.
- Request machine-readable JSON from read and credential commands.

## Install

### Installer script

On Linux and macOS, download the matching release, verify its SHA-256 checksum,
and install it into `~/.local/bin`:

```bash
curl -fsSL https://raw.githubusercontent.com/rawback-app/cli/main/install.sh | sh
```

The installer does not edit shell startup files. If `~/.local/bin` is not on
`PATH`, add it yourself. To choose another user-owned directory:

```bash
curl -fsSL https://raw.githubusercontent.com/rawback-app/cli/main/install.sh | \
  RAWBACK_INSTALL_DIR="$HOME/bin" sh
```

On Windows, run the PowerShell installer:

```powershell
irm https://raw.githubusercontent.com/rawback-app/cli/main/install.ps1 | iex
```

It installs to `$HOME\.local\bin` and warns if that directory is not on
`PATH`. Set `$env:RAWBACK_INSTALL_DIR` before running it to select another
directory.

### Homebrew

On macOS, install the signed and notarized binary from the Rawback tap:

```bash
brew install --cask rawback-app/tap/rawback
```

Upgrade it later with `brew upgrade --cask rawback-app/tap/rawback`.

### Manual download

Download the archive for your operating system and CPU, plus `checksums.txt`,
from [GitHub Releases](https://github.com/rawback-app/cli/releases). Verify the
archive, extract `rawback` (`rawback.exe` on Windows), and put it on `PATH`.

Once installed, view the available commands with:

```bash
rawback --help
```

Release archives are available for Linux, macOS, and Windows on both x86-64 and
arm64. The standalone binary does not require Bun. macOS binaries are Developer
ID-signed and notarized; Windows binaries are not currently Authenticode-signed.

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

To cross-compile every release target locally, install GoReleaser 2.17 and run:

```bash
bun run build:all
```

## Quick start

### 1. Sign in

```bash
rawback auth
rawback auth status
```

`rawback auth` creates a 10-minute device session, prints a copyable approval
link, and opens it in your browser. Sign in on the web if needed, review the CLI
request details, and authorize it. The resulting access and refresh tokens are
saved in `~/.rawback/credentials.json`. Expired access tokens are refreshed
automatically when possible. Temporary device-session creation failures are
retried before the command reports an error with a support trace ID when
available.

### 2. Browse your account

These commands work immediately after sign-in:

```bash
rawback photos list
rawback dream list
rawback album list
rawback shares list
rawback uploads
rawback usage
rawback pricing
rawback web
```

Add `--json` to data-oriented commands when you need structured output:

```bash
rawback photos list --page-size 10 --json
rawback dream get 42 --json
rawback shares list --scope with-me --type album --json
rawback usage --json
```

Human-facing output uses a compact terminal UI with responsive columns, status
notices, and activity indicators. During uploads, an interactive terminal shows
aggregate progress, transfer speed, ETA, and the active files. Redirected output
stays line-oriented and does not contain cursor-control sequences. `--json`,
article `--content-only`, and `--version` remain undecorated for scripts and
other tools.

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
  password: 'generated-password'
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
skipped; the command fails if the selected path contains no supported files.
Supported image formats are JPEG/JPG, PNG, WebP, GIF, TIFF, HEIC/HEIF, BMP, and
AVIF. Supported RAW formats are CR2, CR3, NEF, ARW, DNG, RAF, ORF, PEF, RW2,
SRW, and X3F.

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

# List and inspect daily dream recaps
rawback dream list
rawback dream get 42

# Retry a failed dream after an AI-credit warning
rawback dream retry 42

# Create and inspect an album
rawback album create --name "Iceland" --permission private
rawback album view 42

# Add a photo and write the album's Markdown article
rawback album image add 42 108
rawback album article edit 42 --title "Iceland in winter" --content-file story.md
rawback album article publish 42

# Browse incoming shares and manage an outgoing link
rawback shares list --scope with-me --type photo
rawback shares list --kind link --access restricted --expiry valid
rawback shares recipients 7
rawback shares link 7 --copy
rawback shares disable 7

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
rawback dream --help
rawback album --help
rawback album article --help
rawback shares list --help
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
GoReleaser, which builds all six platform archives, signs and notarizes the
macOS binaries, publishes the Homebrew Cask, and includes a `checksums.txt`
file with each GitHub Release.
